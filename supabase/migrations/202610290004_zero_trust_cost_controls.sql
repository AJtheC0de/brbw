-- Defense-in-depth controls for paid external services.
-- All externally billable work must be reserved atomically before dispatch.

create table if not exists public.account_security (
  user_id uuid primary key references auth.users(id) on delete cascade,
  blocked_at timestamptz,
  tokens_valid_after timestamptz not null default '-infinity',
  reason text check (reason is null or char_length(reason) <= 200),
  updated_at timestamptz not null default now()
);

create table if not exists public.service_controls (
  service text primary key check (service in ('openai', 'stripe_checkout')),
  enabled boolean not null default true,
  reason text check (reason is null or char_length(reason) <= 200),
  daily_unit_limit bigint not null check (daily_unit_limit > 0),
  changed_at timestamptz not null default now()
);

insert into public.service_controls (service, daily_unit_limit)
values ('openai', 1000000), ('stripe_checkout', 1000)
on conflict (service) do nothing;

create table if not exists public.service_daily_usage (
  service text not null references public.service_controls(service) on delete cascade,
  usage_day date not null,
  reserved_units bigint not null default 0 check (reserved_units >= 0),
  actual_units bigint not null default 0 check (actual_units >= 0),
  updated_at timestamptz not null default now(),
  primary key (service, usage_day)
);

create table if not exists public.ai_daily_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_day date not null,
  request_count integer not null default 0 check (request_count >= 0),
  reserved_units bigint not null default 0 check (reserved_units >= 0),
  actual_units bigint not null default 0 check (actual_units >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, usage_day)
);

create table if not exists public.security_incidents (
  id uuid primary key default gen_random_uuid(),
  service text not null,
  reason text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.billing_operations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 16 and 128),
  payload_hash text not null check (char_length(payload_hash) = 64),
  status text not null default 'reserved'
    check (status in ('reserved', 'dispatched', 'completed', 'failed', 'unknown')),
  stripe_customer_id text,
  stripe_session_id text,
  checkout_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

alter table public.ai_usage_events
  add column if not exists idempotency_key text,
  add column if not exists payload_hash text,
  add column if not exists estimated_units bigint not null default 0,
  add column if not exists actual_units bigint not null default 0,
  add column if not exists external_request_id text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.ai_usage_events drop constraint if exists ai_usage_events_state_check;
alter table public.ai_usage_events add constraint ai_usage_events_state_check
  check (state in ('reserved', 'dispatched', 'consumed', 'failed', 'unknown'));

create unique index if not exists ai_usage_events_idempotency_idx
  on public.ai_usage_events (user_id, feature, idempotency_key)
  where idempotency_key is not null;

alter table public.account_security enable row level security;
alter table public.service_controls enable row level security;
alter table public.service_daily_usage enable row level security;
alter table public.ai_daily_usage enable row level security;
alter table public.security_incidents enable row level security;
alter table public.billing_operations enable row level security;

revoke all on public.account_security from public, anon, authenticated;
revoke all on public.service_controls from public, anon, authenticated;
revoke all on public.service_daily_usage from public, anon, authenticated;
revoke all on public.ai_daily_usage from public, anon, authenticated;
revoke all on public.security_incidents from public, anon, authenticated;
revoke all on public.billing_operations from public, anon, authenticated;

create or replace function public.assert_active_session(
  target_user_id uuid,
  target_session_id uuid,
  token_issued_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  security_row public.account_security%rowtype;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Service role required';
  end if;
  if target_user_id is null or target_session_id is null or token_issued_at is null then
    return false;
  end if;

  if not exists (
    select 1 from auth.sessions s
    where s.id = target_session_id and s.user_id = target_user_id
  ) then
    return false;
  end if;

  select * into security_row
  from public.account_security
  where user_id = target_user_id;

  if security_row.blocked_at is not null then return false; end if;
  if token_issued_at < coalesce(security_row.tokens_valid_after, '-infinity'::timestamptz) then
    return false;
  end if;
  return true;
end;
$$;

create or replace function public.reserve_ai_operation(
  target_user_id uuid,
  feature_name text,
  operation_key text,
  operation_payload_hash text,
  estimated_cost_units bigint,
  require_active_session boolean default true,
  target_session_id uuid default null,
  token_issued_at timestamptz default null
)
returns table (
  allowed boolean,
  reservation_id uuid,
  is_premium boolean,
  used integer,
  remaining integer,
  denial_reason text,
  duplicate boolean,
  operation_state text
)
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  quota_limit constant integer := 3;
  premium_daily_limit constant integer := 50;
  burst_limit integer := 5;
  premium boolean := false;
  free_usage integer := 0;
  daily_usage integer := 0;
  burst_usage integer := 0;
  reserved_id uuid;
  existing public.ai_usage_events%rowtype;
  control public.service_controls%rowtype;
  global_used bigint := 0;
  local_day date := (clock_timestamp() at time zone 'Europe/Zurich')::date;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Service role required';
  end if;
  if target_user_id is null then raise exception 'Target user is required'; end if;
  if feature_name not in ('magic-import', 'interview-prep', 'inbound-email') then
    raise exception 'Unknown AI feature';
  end if;
  if operation_key is null or char_length(operation_key) not between 16 and 128 then
    raise exception 'Invalid operation key';
  end if;
  if operation_payload_hash is null or operation_payload_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid payload hash';
  end if;
  if estimated_cost_units < 1 or estimated_cost_units > 100000 then
    raise exception 'Invalid estimated cost';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ai-user:' || target_user_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('service:openai:' || local_day::text, 0));

  select * into control from public.service_controls where service = 'openai' for update;
  if not found or not control.enabled then
    return query select false, null::uuid, false, 0, 0, 'service_disabled'::text, false, null::text;
    return;
  end if;

  if require_active_session and not public.assert_active_session(
    target_user_id, target_session_id, token_issued_at
  ) then
    return query select false, null::uuid, false, 0, 0, 'session_revoked'::text, false, null::text;
    return;
  end if;

  if exists (
    select 1 from public.account_security s
    where s.user_id = target_user_id and s.blocked_at is not null
  ) then
    return query select false, null::uuid, false, 0, 0, 'account_blocked'::text, false, null::text;
    return;
  end if;

  select * into existing
  from public.ai_usage_events
  where user_id = target_user_id
    and feature = feature_name
    and idempotency_key = operation_key;

  if found then
    if existing.payload_hash is distinct from operation_payload_hash then
      return query select false, existing.id, existing.was_premium, 0, 0,
        'idempotency_conflict'::text, true, existing.state;
    else
      return query select false, existing.id, existing.was_premium, 0, 0,
        ('duplicate_' || existing.state)::text, true, existing.state;
    end if;
    return;
  end if;

  select exists (
    select 1 from public.billing_accounts b
    where b.user_id = target_user_id
      and b.subscription_status in ('active', 'trialing')
      and b.current_period_end is not null
      and b.current_period_end > now()
  ) into premium;

  select count(*)::integer into free_usage
  from public.ai_usage_events u
  where u.user_id = target_user_id
    and not u.was_premium
    and (
      u.state in ('dispatched', 'consumed', 'unknown')
      or (u.state = 'reserved' and u.created_at > now() - interval '1 hour')
    );

  if not premium and free_usage >= quota_limit then
    return query select false, null::uuid, false, free_usage, 0,
      'free_quota_exhausted'::text, false, null::text;
    return;
  end if;

  select coalesce(request_count, 0) into daily_usage
  from public.ai_daily_usage
  where user_id = target_user_id and usage_day = local_day;

  if premium and daily_usage >= premium_daily_limit then
    return query select false, null::uuid, true, daily_usage, 0,
      'daily_quota_exhausted'::text, false, null::text;
    return;
  end if;

  burst_limit := case feature_name
    when 'interview-prep' then 5
    when 'magic-import' then 5
    else 10
  end;
  select count(*)::integer into burst_usage
  from public.ai_usage_events
  where user_id = target_user_id
    and feature = feature_name
    and created_at > now() - interval '5 minutes';
  if burst_usage >= burst_limit then
    return query select false, null::uuid, premium, daily_usage, 0,
      'burst_quota_exhausted'::text, false, null::text;
    return;
  end if;

  select coalesce(reserved_units, 0) into global_used
  from public.service_daily_usage
  where service = 'openai' and usage_day = local_day;
  if global_used + estimated_cost_units > control.daily_unit_limit then
    update public.service_controls
      set enabled = false,
          reason = 'automatic daily budget circuit breaker',
          changed_at = now()
      where service = 'openai';
    insert into public.security_incidents (service, reason, details)
    values ('openai', 'daily_budget_exhausted', jsonb_build_object(
      'reserved_units', global_used,
      'attempted_units', estimated_cost_units,
      'limit', control.daily_unit_limit
    ));
    return query select false, null::uuid, premium, daily_usage, 0,
      'service_budget_exhausted'::text, false, null::text;
    return;
  end if;

  insert into public.service_daily_usage (service, usage_day, reserved_units)
  values ('openai', local_day, estimated_cost_units)
  on conflict (service, usage_day) do update
    set reserved_units = public.service_daily_usage.reserved_units + excluded.reserved_units,
        updated_at = now();

  insert into public.ai_daily_usage (user_id, usage_day, request_count, reserved_units)
  values (target_user_id, local_day, 1, estimated_cost_units)
  on conflict (user_id, usage_day) do update
    set request_count = public.ai_daily_usage.request_count + 1,
        reserved_units = public.ai_daily_usage.reserved_units + excluded.reserved_units,
        updated_at = now();

  insert into public.ai_usage_events (
    user_id, feature, state, was_premium, idempotency_key,
    payload_hash, estimated_units, updated_at
  ) values (
    target_user_id, feature_name, 'reserved', premium, operation_key,
    operation_payload_hash, estimated_cost_units, now()
  ) returning id into reserved_id;

  return query select true, reserved_id, premium, free_usage,
    case when premium then null::integer else greatest(0, quota_limit - free_usage - 1) end,
    null::text, false, 'reserved'::text;
end;
$$;

create or replace function public.mark_ai_operation_dispatched(reservation uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Service role required';
  end if;
  update public.ai_usage_events
  set state = 'dispatched', updated_at = now()
  where id = reservation and state = 'reserved';
end;
$$;

create or replace function public.finish_ai_operation(
  reservation uuid,
  outcome text,
  provider_request_id text default null,
  actual_cost_units bigint default 0
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  usage_row public.ai_usage_events%rowtype;
  local_day date;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Service role required';
  end if;
  if outcome not in ('consumed', 'failed', 'unknown') then
    raise exception 'Invalid outcome';
  end if;
  select * into usage_row from public.ai_usage_events where id = reservation for update;
  if not found or usage_row.state in ('consumed', 'failed') then return; end if;
  local_day := (usage_row.created_at at time zone 'Europe/Zurich')::date;
  update public.ai_usage_events
  set state = outcome,
      completed_at = case when outcome in ('consumed', 'failed') then now() else null end,
      external_request_id = left(provider_request_id, 200),
      actual_units = greatest(0, actual_cost_units),
      updated_at = now()
  where id = reservation;
  if actual_cost_units > 0 then
    update public.ai_daily_usage
      set actual_units = actual_units + actual_cost_units, updated_at = now()
      where user_id = usage_row.user_id and usage_day = local_day;
    update public.service_daily_usage
      set actual_units = actual_units + actual_cost_units, updated_at = now()
      where service = 'openai' and usage_day = local_day;
  end if;
end;
$$;

create or replace function public.reserve_billing_operation(
  target_user_id uuid,
  operation_key text,
  operation_payload_hash text,
  target_session_id uuid,
  token_issued_at timestamptz
)
returns table (
  allowed boolean,
  operation_id uuid,
  duplicate boolean,
  operation_state text,
  existing_url text,
  denial_reason text
)
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  existing public.billing_operations%rowtype;
  control public.service_controls%rowtype;
  local_day date := (clock_timestamp() at time zone 'Europe/Zurich')::date;
  current_units bigint := 0;
  new_id uuid;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Service role required';
  end if;
  if operation_key is null or char_length(operation_key) not between 16 and 128 then
    raise exception 'Invalid operation key';
  end if;
  if operation_payload_hash is null or operation_payload_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid payload hash';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('billing-user:' || target_user_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('service:stripe_checkout:' || local_day::text, 0));

  if not public.assert_active_session(target_user_id, target_session_id, token_issued_at) then
    return query select false, null::uuid, false, null::text, null::text, 'session_revoked'::text;
    return;
  end if;
  select * into control from public.service_controls where service = 'stripe_checkout' for update;
  if not found or not control.enabled then
    return query select false, null::uuid, false, null::text, null::text, 'service_disabled'::text;
    return;
  end if;
  select * into existing from public.billing_operations
  where user_id = target_user_id and idempotency_key = operation_key;
  if found then
    if existing.payload_hash is distinct from operation_payload_hash then
      return query select false, existing.id, true, existing.status, existing.checkout_url, 'idempotency_conflict'::text;
    elsif existing.status = 'completed' and existing.checkout_url is not null
      and existing.updated_at > now() - interval '23 hours' then
      return query select true, existing.id, true, existing.status, existing.checkout_url, null::text;
    elsif existing.status in ('unknown', 'failed', 'completed') or existing.updated_at < now() - interval '2 minutes' then
      update public.billing_operations set status = 'reserved', updated_at = now() where id = existing.id;
      return query select true, existing.id, true, 'reserved'::text, existing.checkout_url, null::text;
    else
      return query select false, existing.id, true, existing.status, existing.checkout_url, 'operation_in_progress'::text;
    end if;
    return;
  end if;

  select coalesce(reserved_units, 0) into current_units
  from public.service_daily_usage
  where service = 'stripe_checkout' and usage_day = local_day;
  if current_units + 1 > control.daily_unit_limit then
    update public.service_controls
      set enabled = false, reason = 'automatic daily checkout circuit breaker', changed_at = now()
      where service = 'stripe_checkout';
    insert into public.security_incidents (service, reason, details)
    values ('stripe_checkout', 'daily_budget_exhausted', jsonb_build_object('limit', control.daily_unit_limit));
    return query select false, null::uuid, false, null::text, null::text, 'service_budget_exhausted'::text;
    return;
  end if;
  insert into public.service_daily_usage (service, usage_day, reserved_units)
  values ('stripe_checkout', local_day, 1)
  on conflict (service, usage_day) do update
    set reserved_units = public.service_daily_usage.reserved_units + 1, updated_at = now();
  insert into public.billing_operations (user_id, idempotency_key, payload_hash)
  values (target_user_id, operation_key, operation_payload_hash)
  returning id into new_id;
  return query select true, new_id, false, 'reserved'::text, null::text, null::text;
end;
$$;

revoke all on function public.assert_active_session(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.reserve_ai_operation(uuid, text, text, text, bigint, boolean, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.mark_ai_operation_dispatched(uuid) from public, anon, authenticated;
revoke all on function public.finish_ai_operation(uuid, text, text, bigint) from public, anon, authenticated;
revoke all on function public.reserve_billing_operation(uuid, text, text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.assert_active_session(uuid, uuid, timestamptz) to service_role;
grant execute on function public.reserve_ai_operation(uuid, text, text, text, bigint, boolean, uuid, timestamptz) to service_role;
grant execute on function public.mark_ai_operation_dispatched(uuid) to service_role;
grant execute on function public.finish_ai_operation(uuid, text, text, bigint) to service_role;
grant execute on function public.reserve_billing_operation(uuid, text, text, uuid, timestamptz) to service_role;

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
set search_path = pg_catalog, public
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
    and not was_premium
    and (
      state in ('dispatched', 'consumed', 'unknown')
      or (state = 'reserved' and created_at > now() - interval '1 hour')
    );
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

revoke all on function public.get_ai_usage_status(uuid) from public, anon, authenticated;
grant execute on function public.get_ai_usage_status(uuid) to service_role;

-- Extend the existing retention job without creating a second cron schedule.
create or replace function public.purge_expired_personal_data()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, cron
as $$
begin
  update public.automation_suggestions
    set status = 'expired', reviewed_at = now()
    where status = 'pending' and created_at < now() - interval '30 days';
  delete from public.automation_suggestions
    where status in ('accepted', 'rejected', 'expired')
      and coalesce(reviewed_at, created_at) < now() - interval '90 days';
  delete from public.inbound_messages where received_at < now() - interval '30 days';
  delete from public.automation_runs where created_at < now() - interval '90 days';
  delete from public.rate_limit_buckets where window_start < now() - interval '2 days';
  delete from public.ai_usage_events
    where state in ('failed', 'reserved') and created_at < now() - interval '2 days';
  update public.ai_usage_events set state = 'unknown', updated_at = now()
    where state = 'dispatched' and updated_at < now() - interval '30 minutes';
  delete from public.ai_daily_usage where usage_day < current_date - 45;
  delete from public.service_daily_usage where usage_day < current_date - 90;
  delete from public.billing_operations
    where created_at < now() - interval '30 days' and status in ('completed', 'failed');
  update public.billing_operations set status = 'unknown', updated_at = now()
    where status in ('reserved', 'dispatched') and updated_at < now() - interval '30 minutes';
  delete from public.stripe_webhook_events where processed_at < now() - interval '90 days';
  delete from cron.job_run_details where end_time < now() - interval '7 days';
end;
$$;

revoke all on function public.purge_expired_personal_data() from public, anon, authenticated;
grant execute on function public.purge_expired_personal_data() to service_role;
