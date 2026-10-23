-- Application IDs are client-generated and only need to be unique inside one
-- tenant. Keep the reverse unique index for existing composite foreign keys.

create unique index if not exists applications_id_user_idx
  on public.applications (id, user_id);

do $$
declare
  current_definition text;
begin
  select pg_get_constraintdef(oid)
    into current_definition
  from pg_constraint
  where conrelid = 'public.applications'::regclass
    and conname = 'applications_pkey';

  if current_definition is distinct from 'PRIMARY KEY (user_id, id)' then
    if current_definition is not null then
      alter table public.applications drop constraint applications_pkey;
    end if;
    alter table public.applications
      add constraint applications_pkey primary key (user_id, id);
  end if;
end;
$$;
