-- Keep paid AI usage separate from the permanent three-use free allowance and
-- require a verified future Stripe period end for every premium entitlement.

alter table public.ai_usage_events
  add column if not exists was_premium boolean not null default false;

create index if not exists ai_usage_events_free_consumed_idx
  on public.ai_usage_events (user_id, created_at desc)
  where state = 'consumed' and not was_premium;

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
      and b.current_period_end is not null
      and b.current_period_end > now()
  ) into premium;

  select count(*)::integer into usage_count
  from public.ai_usage_events u
  where u.user_id = target_user_id
    and not u.was_premium
    and (
      u.state = 'consumed'
      or (u.state = 'reserved' and u.created_at > now() - interval '1 hour')
    );

  if not premium and usage_count >= quota_limit then
    return query select false, null::uuid, false, usage_count, 0, 'free_quota_exhausted'::text;
    return;
  end if;

  insert into public.ai_usage_events (user_id, feature, state, was_premium)
  values (target_user_id, feature_name, 'reserved', premium)
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
      and account.current_period_end is not null
      and account.current_period_end > now(),
    false
  );

  select count(*)::integer into usage_count
  from public.ai_usage_events
  where user_id = target_user_id
    and state = 'consumed'
    and not was_premium;

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
revoke all on function public.get_ai_usage_status(uuid) from public, anon, authenticated;
grant execute on function public.reserve_ai_usage(uuid, text) to service_role;
grant execute on function public.get_ai_usage_status(uuid) to service_role;
