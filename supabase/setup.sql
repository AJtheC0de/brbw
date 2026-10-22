-- Bewerbungs-Tracker: einmal im Supabase SQL Editor ausführen.
-- Der Publishable Key erhält dadurch nur Zugriff auf Daten des angemeldeten Benutzers.

create table if not exists public.applications (
  id text primary key,
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
  updated_at bigint not null default 0
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

-- One unguessable forwarding alias per account. The mail provider integration
-- will use this in a later phase; no mailbox is activated by this migration.
create table if not exists public.inbound_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  alias_token uuid not null default gen_random_uuid() unique,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id)
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

alter table public.application_ai_artifacts enable row level security;
alter table public.automation_suggestions enable row level security;
alter table public.inbound_addresses enable row level security;
alter table public.automation_runs enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['application_ai_artifacts', 'automation_suggestions', 'inbound_addresses', 'automation_runs']
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
grant select, insert, update, delete on public.inbound_addresses to authenticated;
grant select, insert, update, delete on public.automation_runs to authenticated;

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

create or replace function public.consume_rate_limit(
  bucket_name text,
  max_requests integer,
  window_seconds integer
)
returns table (allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  current_count integer;
  current_start timestamptz;
begin
  if caller is null then raise exception 'Authentication required'; end if;
  if bucket_name is null or length(bucket_name) > 80 then raise exception 'Invalid bucket'; end if;
  if max_requests < 1 or max_requests > 1000 then raise exception 'Invalid max_requests'; end if;
  if window_seconds < 1 or window_seconds > 86400 then raise exception 'Invalid window_seconds'; end if;

  insert into public.rate_limit_buckets as limits (user_id, bucket, window_start, request_count)
  values (caller, bucket_name, now(), 1)
  on conflict (user_id, bucket) do update
    set window_start = case
      when limits.window_start + make_interval(secs => window_seconds) <= now() then now()
      else limits.window_start
    end,
    request_count = case
      when limits.window_start + make_interval(secs => window_seconds) <= now() then 1
      else limits.request_count + 1
    end
  returning request_count, window_start into current_count, current_start;

  return query select
    current_count <= max_requests,
    greatest(0, max_requests - current_count),
    current_start + make_interval(secs => window_seconds);
end;
$$;

revoke all on function public.consume_rate_limit(text, integer, integer) from public, anon;
grant execute on function public.consume_rate_limit(text, integer, integer) to authenticated;
