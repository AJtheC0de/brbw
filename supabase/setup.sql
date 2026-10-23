-- Bewerbungs-Tracker: einmal im Supabase SQL Editor ausführen.
-- Der Publishable Key erhält dadurch nur Zugriff auf Daten des angemeldeten Benutzers.

create table if not exists public.applications (
  id text not null,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  firma text not null,
  stelle text not null default '',
  datum date,
  status text not null default 'offen' check (status in ('offen', 'angebot', 'absage', 'keine', 'zurueckgezogen')),
  phase text not null default 'beworben' check (phase in ('beworben', 'gespraech1', 'gespraech2', 'final')),
  phase_dates jsonb not null default '{}'::jsonb,
  entscheid_am date,
  links jsonb not null default '[]'::jsonb,
  notes jsonb not null default '[]'::jsonb,
  updated_at bigint not null default 0,
  primary key (user_id, id)
);

-- Foundation fields used by Magic Import, interview preparation and follow-ups.
-- `add column if not exists` also upgrades projects that already use this script.
alter table public.applications
  add column if not exists job_url text,
  add column if not exists job_description text,
  add column if not exists company_logo_url text,
  add column if not exists location text,
  add column if not exists employment_type text,
  add column if not exists workload text,
  add column if not exists work_model text,
  add column if not exists contact_name text,
  add column if not exists contact_email text,
  add column if not exists salary_text text,
  add column if not exists follow_up_at timestamptz,
  add column if not exists follow_up_done_at timestamptz,
  add column if not exists next_action text,
  add column if not exists source_metadata jsonb not null default '{}'::jsonb;

create unique index if not exists applications_id_user_idx
  on public.applications (id, user_id);

create index if not exists applications_user_date_idx
  on public.applications (user_id, datum desc);

alter table public.applications enable row level security;

drop policy if exists "Users can read own applications" on public.applications;
create policy "Users can read own applications"
  on public.applications for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own applications" on public.applications;
create policy "Users can insert own applications"
  on public.applications for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own applications" on public.applications;
create policy "Users can update own applications"
  on public.applications for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete own applications" on public.applications;
create policy "Users can delete own applications"
  on public.applications for delete
  to authenticated
  using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.applications to authenticated;

-- Optional onboarding profile. A row belongs to exactly one authenticated
-- account and is never readable through the anonymous role.
create table if not exists public.user_profiles (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) <= 80),
  target_role text check (target_role is null or char_length(target_role) <= 120),
  employment_status text check (
    employment_status is null or employment_status in ('employed', 'unemployed', 'student', 'other')
  ),
  monthly_application_goal smallint check (
    monthly_application_goal is null or monthly_application_goal between 1 and 50
  ),
  onboarding_completed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_profiles
  add column if not exists ai_completed_tasks jsonb not null default '{}'::jsonb;

alter table public.user_profiles enable row level security;

drop policy if exists "Users read own profile" on public.user_profiles;
create policy "Users read own profile"
  on public.user_profiles for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users create own profile" on public.user_profiles;
create policy "Users create own profile"
  on public.user_profiles for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users update own profile" on public.user_profiles;
create policy "Users update own profile"
  on public.user_profiles for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on public.user_profiles from public, anon, authenticated;
grant select, insert, update on public.user_profiles to authenticated;

-- Cached AI results. Keeping them separate avoids overwriting the application
-- and makes regeneration/auditing predictable.
create table if not exists public.application_ai_artifacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  application_id text not null,
  kind text not null check (kind in ('job_summary', 'interview_prep', 'note_summary', 'elevator_pitch', 'follow_up_draft')),
  status text not null default 'ready' check (status in ('pending', 'ready', 'failed')),
  content jsonb not null default '{}'::jsonb,
  input_hash text not null default '',
  provider text not null default '',
  model text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, application_id, kind),
  foreign key (application_id, user_id)
    references public.applications (id, user_id) on delete cascade
);

-- Machine-detected changes are proposals first. The user explicitly accepts
-- them before the application is modified.
create table if not exists public.automation_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  application_id text,
  source text not null check (source in ('job_import', 'email', 'system')),
  suggestion_type text not null,
  payload jsonb not null default '{}'::jsonb,
  confidence numeric(4,3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'expired')),
  source_ref text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique (user_id, source, source_ref),
  foreign key (application_id, user_id)
    references public.applications (id, user_id) on delete cascade
);

-- One stable, human-readable forwarding alias per account. alias_token remains
-- available as a legacy lookup key so previously issued addresses keep working.
create table if not exists public.inbound_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  alias_token uuid not null default gen_random_uuid() unique,
  alias_slug text unique,
  provider text not null default 'resend',
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

alter table public.inbound_addresses
  add column if not exists alias_slug text,
  add column if not exists provider text not null default 'resend',
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists inbound_addresses_alias_slug_idx
  on public.inbound_addresses (lower(alias_slug))
  where alias_slug is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'inbound_addresses_alias_slug_format'
      and conrelid = 'public.inbound_addresses'::regclass
  ) then
    alter table public.inbound_addresses
      add constraint inbound_addresses_alias_slug_format
      check (alias_slug is null or alias_slug ~ '^[a-z][a-z0-9-]{2,31}$');
  end if;
end $$;

-- Minimal processing ledger for reliable webhook deduplication. Raw email bodies
-- are fetched just-in-time from the provider and are never stored here.
create table if not exists public.inbound_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'resend',
  provider_message_id text not null,
  provider_event_id text,
  status text not null default 'received' check (status in ('received', 'processing', 'suggested', 'ignored', 'failed')),
  suggestion_id uuid references public.automation_suggestions(id) on delete set null,
  error_code text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, provider_message_id)
);

-- User-visible operational history. Never store raw emails or API secrets here.
create table if not exists public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  operation text not null,
  status text not null check (status in ('started', 'succeeded', 'failed')),
  metadata jsonb not null default '{}'::jsonb,
  error_code text,
  created_at timestamptz not null default now()
);

create index if not exists ai_artifacts_user_app_idx
  on public.application_ai_artifacts (user_id, application_id);
create index if not exists suggestions_user_status_idx
  on public.automation_suggestions (user_id, status, created_at desc);
create index if not exists automation_runs_user_created_idx
  on public.automation_runs (user_id, created_at desc);
create index if not exists inbound_messages_user_received_idx
  on public.inbound_messages (user_id, received_at desc);

alter table public.application_ai_artifacts enable row level security;
alter table public.automation_suggestions enable row level security;
alter table public.inbound_addresses enable row level security;
alter table public.inbound_messages enable row level security;
alter table public.automation_runs enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['application_ai_artifacts', 'automation_suggestions']
  loop
    execute format('drop policy if exists "Users manage own rows" on public.%I', table_name);
    execute format(
      'create policy "Users manage own rows" on public.%I for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
      table_name
    );
  end loop;
end $$;

grant select, insert, update, delete on public.application_ai_artifacts to authenticated;
grant select, insert, update, delete on public.automation_suggestions to authenticated;
drop policy if exists "Users manage own rows" on public.automation_runs;
drop policy if exists "Users read own automation runs" on public.automation_runs;
create policy "Users read own automation runs"
  on public.automation_runs for select
  to authenticated
  using ((select auth.uid()) = user_id);
revoke all on public.automation_runs from anon;
revoke insert, update, delete on public.automation_runs from authenticated;
grant select on public.automation_runs to authenticated;
drop policy if exists "Users manage own rows" on public.inbound_addresses;
drop policy if exists "Users read own inbound address" on public.inbound_addresses;
create policy "Users read own inbound address"
  on public.inbound_addresses for select
  to authenticated
  using ((select auth.uid()) = user_id);
revoke insert, update, delete on public.inbound_addresses from authenticated;
grant select on public.inbound_addresses to authenticated;
revoke all on public.inbound_messages from anon, authenticated;
grant select on public.inbound_messages to authenticated;

drop policy if exists "Users read own inbound messages" on public.inbound_messages;
create policy "Users read own inbound messages"
  on public.inbound_messages for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- Fixed-window rate limiting for authenticated Edge Function calls.
-- The table itself is private; callers can only consume their own quota via RPC.
create table if not exists public.rate_limit_buckets (
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket text not null,
  window_start timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  primary key (user_id, bucket)
);
alter table public.rate_limit_buckets enable row level security;
revoke all on public.rate_limit_buckets from anon, authenticated;

-- Remove the legacy overload first: its client-controlled max/window parameters
-- would otherwise remain callable even after the safe function is installed.
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
    when 'interview-prep' then max_requests := 5; window_seconds := 86400;
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

-- The inbound webhook has no user JWT. Only service_role may reserve these
-- fixed per-user quotas, and both windows are updated in one transaction.
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

-- Explicit least-privilege grants. Supabase projects may have broad default
-- privileges for newly created public tables; do not rely on RLS alone.
revoke all on table
  public.applications,
  public.application_ai_artifacts,
  public.automation_suggestions,
  public.inbound_addresses,
  public.inbound_messages,
  public.automation_runs,
  public.rate_limit_buckets,
  public.user_profiles
from public, anon, authenticated;

grant select, insert, update, delete on public.applications to authenticated;
grant select, insert, update, delete on public.application_ai_artifacts to authenticated;
grant select, insert, update, delete on public.automation_suggestions to authenticated;
grant select on public.inbound_addresses to authenticated;
grant select on public.inbound_messages to authenticated;
grant select on public.automation_runs to authenticated;
grant select, insert, update on public.user_profiles to authenticated;

-- Bewerbungsgespräche belong to exactly one application and tenant.
create table if not exists public.interviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  application_id text not null,
  scheduled_at timestamptz not null,
  stage text not null default 'first' check (stage in ('screening', 'first', 'second', 'final', 'other')),
  format text not null default 'video' check (format in ('video', 'phone', 'onsite', 'other')),
  interviewer text,
  meeting_url text,
  notes text not null default '',
  ai_prep jsonb,
  ai_prepared_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (application_id, user_id) references public.applications (id, user_id) on delete cascade
);
create index if not exists interviews_user_scheduled_idx on public.interviews (user_id, scheduled_at desc);
alter table public.interviews enable row level security;
drop policy if exists "Users read own interviews" on public.interviews;
create policy "Users read own interviews" on public.interviews for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users create own interviews" on public.interviews;
create policy "Users create own interviews" on public.interviews for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Users update own interviews" on public.interviews;
create policy "Users update own interviews" on public.interviews for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Users delete own interviews" on public.interviews;
create policy "Users delete own interviews" on public.interviews for delete to authenticated using ((select auth.uid()) = user_id);
revoke all on public.interviews from public, anon, authenticated;
grant select, insert, update, delete on public.interviews to authenticated;

alter table public.user_profiles
  add column if not exists cv_path text,
  add column if not exists cv_name text,
  add column if not exists cv_uploaded_at timestamptz;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('private-cvs', 'private-cvs', false, 10485760, array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "Users upload own CV" on storage.objects;
create policy "Users upload own CV" on storage.objects for insert to authenticated with check (bucket_id = 'private-cvs' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Users read own CV" on storage.objects;
create policy "Users read own CV" on storage.objects for select to authenticated using (bucket_id = 'private-cvs' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Users replace own CV" on storage.objects;
create policy "Users replace own CV" on storage.objects for update to authenticated using (bucket_id = 'private-cvs' and (storage.foldername(name))[1] = (select auth.uid())::text) with check (bucket_id = 'private-cvs' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Users delete own CV" on storage.objects;
create policy "Users delete own CV" on storage.objects for delete to authenticated using (bucket_id = 'private-cvs' and (storage.foldername(name))[1] = (select auth.uid())::text);
