-- Sharing a schedule with other accounts, and deleting your own account.
--
-- project_members (0002) already models who may do what. This adds the verbs.
-- Everything here is a SECURITY DEFINER function because it must look people up
-- by email in auth.users, which the API does not expose — so each function
-- checks the caller itself, first, and refuses with 42501 (permission denied).

-- Membership changes reach other browsers live (a schedule shared with you
-- appears in your list without a refresh).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'project_members'
  ) then
    alter publication supabase_realtime add table public.project_members;
  end if;
end
$$;

-- A viewer can read a schedule but never write it. Without an explicit check
-- their UPDATE would match zero rows under RLS and "succeed" silently.
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

  if found then
    if private.project_role(p_id) not in ('owner', 'editor') then
      raise exception 'forbidden' using errcode = '42501';
    end if;

    if cur.editor_id is not null
       and cur.editor_id <> p_client_id
       and cur.editor_seen > now() - interval '90 seconds' then
      raise exception 'locked:%', cur.editor_id using errcode = 'P0001';
    end if;

    update public.projects set
      name        = p_name,
      data_date   = p_data_date,
      tasks       = coalesce(p_tasks, '[]'::jsonb),
      links       = coalesce(p_links, '[]'::jsonb),
      updated_at  = coalesce(p_updated_at, now()),
      client_id   = p_client_id,
      editor_id   = p_client_id,
      editor_seen = now()
    where id = p_id;
  else
    insert into public.projects
      (id, name, data_date, tasks, links, updated_at, client_id, editor_id, editor_seen, owner_id)
    values
      (p_id, p_name, p_data_date, coalesce(p_tasks, '[]'::jsonb), coalesce(p_links, '[]'::jsonb),
       coalesce(p_updated_at, now()), p_client_id, p_client_id, now(), (select auth.uid()));
  end if;
end;
$$;

-- Everyone on a schedule, with the names and emails a share dialog needs.
-- Visible to any member; empty for anyone else.
create or replace function public.project_people(p_id text)
returns table (user_id uuid, email text, display_name text, role text)
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id, u.email::text, p.display_name, m.role
  from public.project_members m
  join auth.users u on u.id = m.user_id
  left join public.profiles p on p.id = m.user_id
  where m.project_id = p_id
    and private.project_role(p_id) is not null
  order by (m.role = 'owner') desc, lower(u.email);
$$;

-- Share with an account by email, as editor or viewer. Owner only. Sharing
-- again with the same address just changes their role.
create or replace function public.share_project(p_id text, p_email text, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  target uuid;
begin
  if me is null or private.project_role(p_id) is distinct from 'owner' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_role not in ('editor', 'viewer') then
    raise exception 'role must be editor or viewer';
  end if;

  select id into target from auth.users where lower(email) = lower(trim(p_email));
  if target is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if target = me then
    return jsonb_build_object('ok', false, 'reason', 'self');
  end if;

  insert into public.project_members (project_id, user_id, role)
  values (p_id, target, p_role)
  on conflict (project_id, user_id) do update set role = excluded.role
    where public.project_members.role <> 'owner';
  return jsonb_build_object('ok', true);
end;
$$;

-- Change someone's access. Owner only; the owner's own row is fixed.
create or replace function public.set_member_role(p_id text, p_user uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or private.project_role(p_id) is distinct from 'owner' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_role not in ('editor', 'viewer') then
    raise exception 'role must be editor or viewer';
  end if;
  update public.project_members set role = p_role
  where project_id = p_id and user_id = p_user and role <> 'owner';
end;
$$;

-- Remove someone (owner), or leave a schedule shared with you (anyone).
-- The owner cannot be removed; they delete the schedule instead.
create or replace function public.remove_member(p_id text, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not (p_user = me or private.project_role(p_id) = 'owner') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from public.project_members
  where project_id = p_id and user_id = p_user and role <> 'owner';
end;
$$;

-- Delete the caller's own account. Everything cascades: their profile, their
-- memberships, and the schedules they own (which disappear for anyone those
-- were shared with — the app says so before it lets them confirm).
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.project_people(text) from public, anon;
revoke all on function public.share_project(text, text, text) from public, anon;
revoke all on function public.set_member_role(text, uuid, text) from public, anon;
revoke all on function public.remove_member(text, uuid) from public, anon;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.project_people(text) to authenticated;
grant execute on function public.share_project(text, text, text) to authenticated;
grant execute on function public.set_member_role(text, uuid, text) to authenticated;
grant execute on function public.remove_member(text, uuid) to authenticated;
grant execute on function public.delete_my_account() to authenticated;
