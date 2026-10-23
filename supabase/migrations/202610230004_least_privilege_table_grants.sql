-- Remove Supabase's broad default table grants and restore only the operations
-- required by the authenticated client. RLS remains the tenant boundary.

revoke all on table
  public.applications,
  public.application_ai_artifacts,
  public.automation_suggestions,
  public.inbound_addresses,
  public.inbound_messages,
  public.automation_runs,
  public.rate_limit_buckets
from public, anon, authenticated;

grant select, insert, update, delete on public.applications to authenticated;
grant select, insert, update, delete on public.application_ai_artifacts to authenticated;
grant select, insert, update, delete on public.automation_suggestions to authenticated;
grant select on public.inbound_addresses to authenticated;
grant select on public.inbound_messages to authenticated;
grant select on public.automation_runs to authenticated;
