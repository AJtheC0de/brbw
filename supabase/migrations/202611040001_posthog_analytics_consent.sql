-- Optional PostHog product analytics consent. The browser remains the source
-- of truth for whether the SDK may load; this record documents the latest
-- account-level decision without storing analytics identifiers or events.
alter table public.user_profiles
  add column if not exists analytics_consent_at timestamptz,
  add column if not exists analytics_consent_version text
    check (analytics_consent_version is null or char_length(analytics_consent_version) <= 20);

comment on column public.user_profiles.analytics_consent_at is
  'Latest explicit opt-in timestamp for optional PostHog product analytics; null means not granted or revoked.';

comment on column public.user_profiles.analytics_consent_version is
  'Version of the analytics consent wording most recently accepted or rejected.';
