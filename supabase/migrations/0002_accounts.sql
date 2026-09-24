-- Marga: user accounts.
--
-- Replaces the shared passcode. Every schedule belongs to an account, and the
-- database itself decides who may read or write it (row-level security) — the
-- browser holds a user session, not a shared secret.
--
-- Structure for what comes next, without building it yet:
--   * project_members is the sharing model from day one. Today it only ever
--     holds the owner; inviting collaborators later is rows, not a rewrite.
--   * profiles.plan is where a subscription lands. Users cannot write it; only
--     the service role (a future billing webhook) can.

create schema if not exists private;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------- profiles --

create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  plan         text not null default 'free',
  created_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.profiles force row level security;

drop policy if exists profiles_read_own on public.profiles;
create policy profiles_read_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
-- Column grant: a user can rename themselves, never change their own plan.
grant update (display_name) on public.profiles to authenticated;

-- A profile row for every new account.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ----------------------------------------------------------- projects: owner --

alter table public.projects
  add column if not exists owner_id uuid references auth.users (id) on delete cascade;
alter table public.projects alter column owner_id set default auth.uid();
create index if not exists projects_owner_idx on public.projects (owner_id);

-- ---------------------------------------------------------- project_members --

create table if not exists public.project_members (
  project_id text not null references public.projects (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       text not null check (role in ('owner', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index if not exists project_members_user_idx on public.project_members (user_id);

alter table public.project_members enable row level security;
alter table public.project_members force row level security;

-- The caller's role on a project, or null. SECURITY DEFINER so policies on
-- project_members can use it without recursing into themselves. Lives in the
-- private schema, which the API does not expose.
create or replace function private.project_role(pid text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.project_members
  where project_id = pid and user_id = (select auth.uid());
$$;
revoke all on function private.project_role(text) from public, anon;
grant execute on function private.project_role(text) to authenticated;

drop policy if exists members_read on public.project_members;
create policy members_read on public.project_members
  for select to authenticated
  using (user_id = (select auth.uid()) or private.project_role(project_id) is not null);

revoke all on public.project_members from anon, authenticated;
grant select on public.project_members to authenticated;

-- The creator of a project is its owner. Existing rows with no owner simply
-- stay invisible until assigned.
create or replace function private.add_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.owner_id is not null then
    insert into public.project_members (project_id, user_id, role)
    values (new.id, new.owner_id, 'owner')
    on conflict (project_id, user_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists projects_owner_membership on public.projects;
create trigger projects_owner_membership
  after insert or update of owner_id on public.projects
  for each row execute function private.add_owner_membership();

-- ------------------------------------------------------- projects: policies --

drop policy if exists projects_read_anon on public.projects;
drop policy if exists projects_read on public.projects;
drop policy if exists projects_insert on public.projects;
drop policy if exists projects_update on public.projects;
drop policy if exists projects_delete on public.projects;

create policy projects_read on public.projects
  for select to authenticated
  using (private.project_role(id) is not null);

create policy projects_insert on public.projects
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy projects_update on public.projects
  for update to authenticated
  using (private.project_role(id) in ('owner', 'editor'))
  with check (private.project_role(id) in ('owner', 'editor'));

create policy projects_delete on public.projects
  for delete to authenticated
  using (private.project_role(id) = 'owner');

revoke all on public.projects from anon;
revoke all on public.projects from authenticated;
grant select, insert, delete on public.projects to authenticated;
-- Every column except the owner: ownership changes only through the server.
grant update (name, data_date, tasks, links, updated_at, client_id, editor_id, editor_seen)
  on public.projects to authenticated;

comment on table public.projects is
  'One row per schedule, mirroring ProjectDoc. Visible to its members (project_members); written by owners and editors.';

-- --------------------------------------------------------- the editor lock --
-- One editor at a time, enforced in the database so it holds however the
-- client behaves. Both run as the caller, so RLS still decides what they touch.
-- 90 seconds without a heartbeat and the lock is abandoned (src/persist/lock.ts).

create or replace function public.save_project(
  p_id text,
  p_name text,
  p_data_date date,
  p_tasks jsonb,
  p_links jsonb,
  p_updated_at timestamptz,
  p_client_id text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  cur record;
begin
  select editor_id, editor_seen into cur
  from public.projects where id = p_id
  for update;

  if found
     and cur.editor_id is not null
     and cur.editor_id <> p_client_id
     and cur.editor_seen > now() - interval '90 seconds' then
    raise exception 'locked:%', cur.editor_id using errcode = 'P0001';
  end if;

  insert into public.projects
    (id, name, data_date, tasks, links, updated_at, client_id, editor_id, editor_seen, owner_id)
  values
    (p_id, p_name, p_data_date, coalesce(p_tasks, '[]'::jsonb), coalesce(p_links, '[]'::jsonb),
     coalesce(p_updated_at, now()), p_client_id, p_client_id, now(), (select auth.uid()))
  on conflict (id) do update set
    name        = excluded.name,
    data_date   = excluded.data_date,
    tasks       = excluded.tasks,
    links       = excluded.links,
    updated_at  = excluded.updated_at,
    client_id   = excluded.client_id,
    editor_id   = excluded.editor_id,
    editor_seen = excluded.editor_seen;
end;
$$;

create or replace function public.claim_editor(p_id text, p_client_id text, p_force boolean default false)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  cur record;
begin
  select editor_id, editor_seen into cur
  from public.projects where id = p_id
  for update;

  -- Not saved yet: nothing to lock; the first save claims it.
  if not found then
    return jsonb_build_object('granted', true, 'editorId', p_client_id);
  end if;

  if not p_force
     and cur.editor_id is not null
     and cur.editor_id <> p_client_id
     and cur.editor_seen > now() - interval '90 seconds' then
    return jsonb_build_object('granted', false, 'editorId', cur.editor_id);
  end if;

  update public.projects set editor_id = p_client_id, editor_seen = now() where id = p_id;
  return jsonb_build_object('granted', true, 'editorId', p_client_id);
end;
$$;

revoke all on function public.save_project(text, text, date, jsonb, jsonb, timestamptz, text) from public, anon;
revoke all on function public.claim_editor(text, text, boolean) from public, anon;
grant execute on function public.save_project(text, text, date, jsonb, jsonb, timestamptz, text) to authenticated;
grant execute on function public.claim_editor(text, text, boolean) to authenticated;
