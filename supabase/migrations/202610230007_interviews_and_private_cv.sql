-- Tenant-isolated interview workspace and private CV storage.

create table if not exists public.interviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  application_id text not null,
  scheduled_at timestamptz not null,
  stage text not null default 'first' check (stage in ('screening', 'first', 'second', 'final', 'other')),
  format text not null default 'video' check (format in ('video', 'phone', 'onsite', 'other')),
  interviewer text,
  meeting_url text,
  notes text not null default '',
  ai_prep jsonb,
  ai_prepared_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (application_id, user_id)
    references public.applications (id, user_id) on delete cascade
);

create index if not exists interviews_user_scheduled_idx
  on public.interviews (user_id, scheduled_at desc);

alter table public.interviews enable row level security;

create policy "Users read own interviews" on public.interviews for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users create own interviews" on public.interviews for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Users update own interviews" on public.interviews for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users delete own interviews" on public.interviews for delete to authenticated
  using ((select auth.uid()) = user_id);

alter table public.user_profiles
  add column if not exists cv_path text,
  add column if not exists cv_name text,
  add column if not exists cv_uploaded_at timestamptz;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'private-cvs', 'private-cvs', false, 10485760,
  array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Users upload own CV" on storage.objects for insert to authenticated
  with check (bucket_id = 'private-cvs' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Users read own CV" on storage.objects for select to authenticated
  using (bucket_id = 'private-cvs' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Users replace own CV" on storage.objects for update to authenticated
  using (bucket_id = 'private-cvs' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'private-cvs' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Users delete own CV" on storage.objects for delete to authenticated
  using (bucket_id = 'private-cvs' and (storage.foldername(name))[1] = (select auth.uid())::text);

revoke all on public.interviews from public, anon, authenticated;
grant select, insert, update, delete on public.interviews to authenticated;

-- The existing limiter only accepts server-owned bucket names.
create or replace function public.consume_rate_limit(bucket_name text)
returns table (allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  max_requests integer;
  window_seconds integer;
  current_count integer;
  current_start timestamptz;
begin
  if caller is null then raise exception 'Authentication required'; end if;
  case bucket_name
    when 'foundation-health' then max_requests := 30; window_seconds := 60;
    when 'magic-import' then max_requests := 10; window_seconds := 3600;
    when 'interview-prep' then max_requests := 5; window_seconds := 86400;
    else raise exception 'Unknown rate-limit bucket';
  end case;
  insert into public.rate_limit_buckets as limits (user_id, bucket, window_start, request_count)
  values (caller, bucket_name, now(), 1)
  on conflict (user_id, bucket) do update set
    window_start = case when limits.window_start + make_interval(secs => window_seconds) <= now() then now() else limits.window_start end,
    request_count = case when limits.window_start + make_interval(secs => window_seconds) <= now() then 1 else least(limits.request_count + 1, max_requests + 1) end
  returning request_count, window_start into current_count, current_start;
  return query select current_count <= max_requests, greatest(0, max_requests - current_count), current_start + make_interval(secs => window_seconds);
end;
$$;

revoke all on function public.consume_rate_limit(text) from public, anon;
grant execute on function public.consume_rate_limit(text) to authenticated;
