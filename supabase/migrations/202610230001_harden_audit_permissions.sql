-- automation_runs is an immutable server-written audit trail.
-- Authenticated users may inspect only their own records; writes use service_role.
alter table public.automation_runs enable row level security;

drop policy if exists "Users manage own rows" on public.automation_runs;
drop policy if exists "Users read own automation runs" on public.automation_runs;

create policy "Users read own automation runs"
  on public.automation_runs for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.automation_runs from anon;
revoke insert, update, delete on public.automation_runs from authenticated;
grant select on public.automation_runs to authenticated;
