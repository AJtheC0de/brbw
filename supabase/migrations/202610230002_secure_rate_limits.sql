-- Replace the vulnerable client-configurable limiter with fixed server-owned
-- profiles and add an atomic service-only quota for inbound AI processing.

create table if not exists public.rate_limit_buckets (
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket text not null,
  window_start timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  primary key (user_id, bucket)
);

alter table public.rate_limit_buckets enable row level security;
revoke all on public.rate_limit_buckets from anon, authenticated;

drop function if exists public.consume_rate_limit(text, integer, integer);

create or replace function public.consume_rate_limit(bucket_name text)
returns table (allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  max_requests integer;
  window_seconds integer;
  current_count integer;
  current_start timestamptz;
begin
  if caller is null then raise exception 'Authentication required'; end if;

  case bucket_name
    when 'foundation-health' then max_requests := 30; window_seconds := 60;
    when 'magic-import' then max_requests := 10; window_seconds := 3600;
    else raise exception 'Unknown rate-limit bucket';
  end case;

  insert into public.rate_limit_buckets as limits (user_id, bucket, window_start, request_count)
  values (caller, bucket_name, now(), 1)
  on conflict (user_id, bucket) do update
    set window_start = case
      when limits.window_start + make_interval(secs => window_seconds) <= now() then now()
      else limits.window_start
    end,
    request_count = case
      when limits.window_start + make_interval(secs => window_seconds) <= now() then 1
      else least(limits.request_count + 1, max_requests + 1)
    end
  returning request_count, window_start into current_count, current_start;

  return query select
    current_count <= max_requests,
    greatest(0, max_requests - current_count),
    current_start + make_interval(secs => window_seconds);
end;
$$;

revoke all on function public.consume_rate_limit(text) from public, anon;
grant execute on function public.consume_rate_limit(text) to authenticated;

create or replace function public.consume_inbound_email_quota(target_user_id uuid)
returns table (
  allowed boolean,
  burst_remaining integer,
  daily_remaining integer,
  reset_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  quota_now timestamptz := clock_timestamp();
  burst_max constant integer := 5;
  burst_seconds constant integer := 600;
  daily_max constant integer := 25;
  daily_seconds constant integer := 86400;
  burst_count integer;
  burst_start timestamptz;
  daily_count integer;
  daily_start timestamptz;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Service role required';
  end if;
  if target_user_id is null then raise exception 'Target user is required'; end if;

  insert into public.rate_limit_buckets as limits (user_id, bucket, window_start, request_count)
  values (target_user_id, 'inbound-email:burst', quota_now, 1)
  on conflict (user_id, bucket) do update
    set window_start = case
      when limits.window_start + make_interval(secs => burst_seconds) <= quota_now then quota_now
      else limits.window_start
    end,
    request_count = case
      when limits.window_start + make_interval(secs => burst_seconds) <= quota_now then 1
      else least(limits.request_count + 1, burst_max + 1)
    end
  returning request_count, window_start into burst_count, burst_start;

  insert into public.rate_limit_buckets as limits (user_id, bucket, window_start, request_count)
  values (target_user_id, 'inbound-email:daily', quota_now, 1)
  on conflict (user_id, bucket) do update
    set window_start = case
      when limits.window_start + make_interval(secs => daily_seconds) <= quota_now then quota_now
      else limits.window_start
    end,
    request_count = case
      when limits.window_start + make_interval(secs => daily_seconds) <= quota_now then 1
      else least(limits.request_count + 1, daily_max + 1)
    end
  returning request_count, window_start into daily_count, daily_start;

  return query select
    burst_count <= burst_max and daily_count <= daily_max,
    greatest(0, burst_max - burst_count),
    greatest(0, daily_max - daily_count),
    greatest(
      burst_start + make_interval(secs => burst_seconds),
      daily_start + make_interval(secs => daily_seconds)
    );
end;
$$;

revoke all on function public.consume_inbound_email_quota(uuid) from public, anon, authenticated;
grant execute on function public.consume_inbound_email_quota(uuid) to service_role;
