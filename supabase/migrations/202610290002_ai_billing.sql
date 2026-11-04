-- Permanent AI trial quota and Stripe-backed premium entitlements.

create table if not exists public.billing_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  subscription_status text not null default 'inactive'
    check (subscription_status in ('inactive', 'incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused')),
  currency text check (currency is null or currency in ('chf', 'eur')),
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  terms_version text check (terms_version is null or char_length(terms_version) <= 20),
  terms_accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  feature text not null check (feature in ('magic-import', 'interview-prep', 'inbound-email')),
  state text not null default 'reserved' check (state in ('reserved', 'consumed', 'failed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists ai_usage_events_user_state_idx
  on public.ai_usage_events (user_id, state, created_at desc);

create table if not exists public.stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  processed_at timestamptz not null default now()
);

alter table public.billing_accounts enable row level security;
alter table public.ai_usage_events enable row level security;
alter table public.stripe_webhook_events enable row level security;

-- Billing identifiers are never exposed through direct table access. The
-- authenticated billing-status function returns only the safe status fields.
drop policy if exists "Users read own billing status" on public.billing_accounts;

revoke all on public.billing_accounts from public, anon, authenticated;
revoke all on public.ai_usage_events from public, anon, authenticated;
revoke all on public.stripe_webhook_events from public, anon, authenticated;

create or replace function public.reserve_ai_usage(target_user_id uuid, feature_name text)
returns table (
  allowed boolean,
  reservation_id uuid,
  is_premium boolean,
  used integer,
  remaining integer,
  denial_reason text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  quota_limit constant integer := 3;
  premium boolean := false;
  usage_count integer := 0;
  reserved_id uuid;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Service role required';
  end if;
  if target_user_id is null then raise exception 'Target user is required'; end if;
  if feature_name not in ('magic-import', 'interview-prep', 'inbound-email') then
    raise exception 'Unknown AI feature';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_user_id::text, 0));

  select exists (
    select 1 from public.billing_accounts b
    where b.user_id = target_user_id
      and b.subscription_status in ('active', 'trialing')
      and (b.current_period_end is null or b.current_period_end > now())
  ) into premium;

  select count(*)::integer into usage_count
  from public.ai_usage_events u
  where u.user_id = target_user_id
    and (
      u.state = 'consumed'
      or (u.state = 'reserved' and u.created_at > now() - interval '1 hour')
    );

  if not premium and usage_count >= quota_limit then
    return query select false, null::uuid, false, usage_count, 0, 'free_quota_exhausted'::text;
    return;
  end if;

  insert into public.ai_usage_events (user_id, feature, state)
  values (target_user_id, feature_name, 'reserved')
  returning id into reserved_id;

  return query select
    true,
    reserved_id,
    premium,
    usage_count,
    case when premium then null::integer else greatest(0, quota_limit - usage_count - 1) end,
    null::text;
end;
$$;

create or replace function public.finish_ai_usage(reservation uuid, succeeded boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Service role required';
  end if;
  update public.ai_usage_events
    set state = case when succeeded then 'consumed' else 'failed' end,
        completed_at = now()
    where id = reservation and state = 'reserved';
end;
$$;

create or replace function public.get_ai_usage_status(target_user_id uuid)
returns table (
  is_premium boolean,
  used integer,
  remaining integer,
  subscription_status text,
  currency text,
  current_period_end timestamptz,
  cancel_at_period_end boolean,
  has_stripe_customer boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  quota_limit constant integer := 3;
  account public.billing_accounts%rowtype;
  premium boolean := false;
  usage_count integer := 0;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Service role required';
  end if;
  if target_user_id is null then raise exception 'Target user is required'; end if;

  select * into account from public.billing_accounts where user_id = target_user_id;
  premium := coalesce(
    account.subscription_status in ('active', 'trialing')
      and (account.current_period_end is null or account.current_period_end > now()),
    false
  );

  select count(*)::integer into usage_count
  from public.ai_usage_events
  where user_id = target_user_id and state = 'consumed';

  return query select
    premium,
    usage_count,
    case when premium then null::integer else greatest(0, quota_limit - usage_count) end,
    coalesce(account.subscription_status, 'inactive'),
    account.currency,
    account.current_period_end,
    coalesce(account.cancel_at_period_end, false),
    account.stripe_customer_id is not null;
end;
$$;

revoke all on function public.reserve_ai_usage(uuid, text) from public, anon, authenticated;
revoke all on function public.finish_ai_usage(uuid, boolean) from public, anon, authenticated;
revoke all on function public.get_ai_usage_status(uuid) from public, anon, authenticated;
grant execute on function public.reserve_ai_usage(uuid, text) to service_role;
grant execute on function public.finish_ai_usage(uuid, boolean) to service_role;
grant execute on function public.get_ai_usage_status(uuid) to service_role;

-- Keep successful uses for the lifetime free allowance. Failed/stale
-- reservations and the webhook deduplication ledger are technical data only.
create or replace function public.purge_expired_personal_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.automation_suggestions
    set status = 'expired', reviewed_at = now()
    where status = 'pending' and created_at < now() - interval '30 days';
  delete from public.automation_suggestions
    where status in ('accepted', 'rejected', 'expired') and coalesce(reviewed_at, created_at) < now() - interval '90 days';
  delete from public.inbound_messages where received_at < now() - interval '30 days';
  delete from public.automation_runs where created_at < now() - interval '90 days';
  delete from public.rate_limit_buckets where window_start < now() - interval '2 days';
  delete from public.ai_usage_events
    where state in ('failed', 'reserved') and created_at < now() - interval '2 days';
  delete from public.stripe_webhook_events where processed_at < now() - interval '90 days';
end;
$$;

revoke all on function public.purge_expired_personal_data() from public, anon, authenticated;
grant execute on function public.purge_expired_personal_data() to service_role;
