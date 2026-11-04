-- Extend the persisted interface-language allowlist with Albanian.
alter table public.user_profiles
  drop constraint if exists user_profiles_preferred_language_check;

alter table public.user_profiles
  add constraint user_profiles_preferred_language_check
  check (preferred_language is null or preferred_language in ('de', 'en', 'fr', 'es', 'sv', 'sq'));

comment on column public.user_profiles.preferred_language is
  'Explicit Jobply interface language: de, en, fr, es, sv or sq.';
