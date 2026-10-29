-- Documented consent and automatic retention limits.

-- Consent records. AI processing (OpenAI) and CV usage are opt-in and are
-- enforced server-side by the Edge Functions, not only in the browser.
alter table public.user_profiles
  add column if not exists privacy_policy_version text check (privacy_policy_version is null or char_length(privacy_policy_version) <= 20),
  add column if not exists privacy_accepted_at timestamptz,
  add column if not exists ai_processing_consent_at timestamptz,
  add column if not exists ai_cv_consent_at timestamptz;

-- Retention: personal data that only exists for processing is removed
-- automatically. Applications, interviews and CVs stay until the user deletes
-- them or the account.
create or replace function public.purge_expired_personal_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Unreviewed suggestions expire after 30 days, reviewed ones are removed after 90 days.
  update public.automation_suggestions
    set status = 'expired', reviewed_at = now()
    where status = 'pending' and created_at < now() - interval '30 days';
  delete from public.automation_suggestions
    where status in ('accepted', 'rejected', 'expired') and coalesce(reviewed_at, created_at) < now() - interval '90 days';

  -- The webhook ledger is only needed for deduplication.
  delete from public.inbound_messages where received_at < now() - interval '30 days';

  -- Technical processing history.
  delete from public.automation_runs where created_at < now() - interval '90 days';

  -- Rate limit windows are at most one day long.
  delete from public.rate_limit_buckets where window_start < now() - interval '2 days';
end;
$$;

revoke all on function public.purge_expired_personal_data() from public, anon, authenticated;
grant execute on function public.purge_expired_personal_data() to service_role;

-- Daily schedule via pg_cron. If the extension is unavailable, the function
-- can be scheduled manually (Dashboard → Integrations → Cron).
do $$
begin
  create extension if not exists pg_cron;
  if exists (select 1 from cron.job where jobname = 'jobply-retention') then
    perform cron.unschedule('jobply-retention');
  end if;
  perform cron.schedule('jobply-retention', '17 3 * * *', 'select public.purge_expired_personal_data()');
exception when others then
  raise notice 'pg_cron not available, schedule public.purge_expired_personal_data() manually: %', sqlerrm;
end $$;
