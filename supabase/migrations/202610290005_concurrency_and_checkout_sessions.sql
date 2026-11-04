-- Close the remaining cost-amplification races:
-- one active AI provider operation and one open Checkout Session per user.

update public.ai_usage_events
set state = case when state = 'reserved' then 'failed' else 'unknown' end,
    updated_at = now(),
    completed_at = case when state = 'reserved' then now() else completed_at end
where state = 'reserved' and updated_at < now() - interval '10 minutes'
   or state = 'dispatched' and updated_at < now() - interval '10 minutes';

with ranked as (
  select id, row_number() over (
    partition by user_id order by updated_at desc, created_at desc
  ) as position
  from public.ai_usage_events
  where state in ('reserved', 'dispatched')
)
update public.ai_usage_events usage
set state = 'unknown', updated_at = now()
from ranked
where usage.id = ranked.id and ranked.position > 1;

create unique index if not exists ai_usage_events_one_active_per_user_idx
  on public.ai_usage_events (user_id)
  where state in ('reserved', 'dispatched');

alter table public.billing_operations
  add column if not exists expires_at timestamptz;

alter table public.billing_operations
  drop constraint if exists billing_operations_status_check;
alter table public.billing_operations
  add constraint billing_operations_status_check
  check (status in (
    'reserved', 'dispatched', 'completed', 'fulfilled',
    'expired', 'failed', 'unknown'
  ));

update public.billing_operations
set expires_at = coalesce(expires_at, created_at + interval '24 hours')
where status = 'completed';

update public.billing_operations
set status = 'expired', updated_at = now()
where status = 'completed' and expires_at <= now();

with ranked as (
  select id, row_number() over (
    partition by user_id order by updated_at desc, created_at desc
  ) as position
  from public.billing_operations
  where status in ('reserved', 'dispatched', 'completed')
)
update public.billing_operations operation
set status = 'expired', updated_at = now()
from ranked
where operation.id = ranked.id and ranked.position > 1;

create unique index if not exists billing_operations_one_open_per_user_idx
  on public.billing_operations (user_id)
  where status in ('reserved', 'dispatched', 'completed');

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
  other_open public.billing_operations%rowtype;
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

  update public.billing_operations
  set status = 'expired', updated_at = now()
  where user_id = target_user_id
    and status = 'completed'
    and expires_at <= now();
  update public.billing_operations
  set status = 'unknown', updated_at = now()
  where user_id = target_user_id
    and status in ('reserved', 'dispatched')
    and updated_at < now() - interval '2 minutes';

  select * into existing
  from public.billing_operations
  where user_id = target_user_id and idempotency_key = operation_key;
  if found then
    if existing.payload_hash is distinct from operation_payload_hash then
      return query select false, existing.id, true, existing.status,
        existing.checkout_url, 'idempotency_conflict'::text;
    elsif existing.status = 'completed' and existing.checkout_url is not null
      and existing.expires_at > now() then
      return query select true, existing.id, true, existing.status,
        existing.checkout_url, null::text;
    elsif existing.status in ('unknown', 'failed', 'expired') then
      if exists (
        select 1 from public.billing_operations active
        where active.user_id = target_user_id
          and active.id <> existing.id
          and active.status in ('reserved', 'dispatched', 'completed')
      ) then
        return query select false, existing.id, true, existing.status,
          null::text, 'checkout_already_open'::text;
        return;
      end if;
      update public.billing_operations
      set status = 'reserved', checkout_url = null, stripe_session_id = null,
          expires_at = null, updated_at = now()
      where id = existing.id;
      return query select true, existing.id, true, 'reserved'::text, null::text, null::text;
    else
      return query select false, existing.id, true, existing.status,
        existing.checkout_url, 'operation_in_progress'::text;
    end if;
    return;
  end if;

  select * into other_open
  from public.billing_operations
  where user_id = target_user_id
    and status in ('reserved', 'dispatched', 'completed')
  order by updated_at desc
  limit 1;
  if found then
    if other_open.status = 'completed' and other_open.checkout_url is not null
      and other_open.expires_at > now() then
      return query select true, other_open.id, true, other_open.status,
        other_open.checkout_url, null::text;
    end if;
    return query select false, other_open.id, true, other_open.status,
      null::text, 'checkout_already_open'::text;
    return;
  end if;

  select coalesce(reserved_units, 0) into current_units
  from public.service_daily_usage
  where service = 'stripe_checkout' and usage_day = local_day;
  if current_units + 1 > control.daily_unit_limit then
    update public.service_controls
    set enabled = false,
        reason = 'automatic daily checkout circuit breaker',
        changed_at = now()
    where service = 'stripe_checkout';
    insert into public.security_incidents (service, reason, details)
    values ('stripe_checkout', 'daily_budget_exhausted',
      jsonb_build_object('limit', control.daily_unit_limit));
    return query select false, null::uuid, false, null::text,
      null::text, 'service_budget_exhausted'::text;
    return;
  end if;

  insert into public.service_daily_usage (service, usage_day, reserved_units)
  values ('stripe_checkout', local_day, 1)
  on conflict (service, usage_day) do update
  set reserved_units = public.service_daily_usage.reserved_units + 1,
      updated_at = now();

  insert into public.billing_operations (user_id, idempotency_key, payload_hash)
  values (target_user_id, operation_key, operation_payload_hash)
  returning id into new_id;
  return query select true, new_id, false, 'reserved'::text,
    null::text, null::text;
end;
$$;

revoke all on function public.reserve_billing_operation(uuid, text, text, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.reserve_billing_operation(uuid, text, text, uuid, timestamptz)
  to service_role;

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
    where state = 'dispatched' and updated_at < now() - interval '10 minutes';
  delete from public.ai_daily_usage where usage_day < current_date - 45;
  delete from public.service_daily_usage where usage_day < current_date - 90;
  update public.billing_operations set status = 'expired', updated_at = now()
    where status = 'completed' and expires_at <= now();
  delete from public.billing_operations
    where created_at < now() - interval '30 days'
      and status in ('completed', 'fulfilled', 'expired', 'failed');
  update public.billing_operations set status = 'unknown', updated_at = now()
    where status in ('reserved', 'dispatched')
      and updated_at < now() - interval '10 minutes';
  delete from public.stripe_webhook_events where processed_at < now() - interval '90 days';
  delete from cron.job_run_details where end_time < now() - interval '7 days';
end;
$$;

revoke all on function public.purge_expired_personal_data() from public, anon, authenticated;
grant execute on function public.purge_expired_personal_data() to service_role;
