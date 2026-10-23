-- User-scoped completion ledger for the dashboard AI briefing.
-- RLS on user_profiles keeps every task acknowledgement tenant-bound.
alter table public.user_profiles
  add column if not exists ai_completed_tasks jsonb not null default '{}'::jsonb;

revoke all on public.user_profiles from public, anon;
grant select, insert, update on public.user_profiles to authenticated;
