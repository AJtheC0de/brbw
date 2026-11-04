-- Persist the user's explicit interface-language choice across devices.
alter table public.user_profiles
  add column if not exists preferred_language text
  check (preferred_language is null or preferred_language in ('de', 'en', 'fr', 'es', 'sv'));

comment on column public.user_profiles.preferred_language is
  'Explicit Jobply interface language: de, en, fr, es or sv.';
