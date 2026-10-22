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
