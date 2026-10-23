-- Optional, tenant-isolated onboarding answers.
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

alter table public.user_profiles enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_profiles' and policyname = 'Users read own profile') then
    create policy "Users read own profile"
      on public.user_profiles for select to authenticated
      using ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_profiles' and policyname = 'Users create own profile') then
    create policy "Users create own profile"
      on public.user_profiles for insert to authenticated
      with check ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_profiles' and policyname = 'Users update own profile') then
    create policy "Users update own profile"
      on public.user_profiles for update to authenticated
      using ((select auth.uid()) = user_id)
      with check ((select auth.uid()) = user_id);
  end if;
end $$;

revoke all on public.user_profiles from public, anon, authenticated;
grant select, insert, update on public.user_profiles to authenticated;
