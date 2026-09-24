-- Fix for 0004: check the caller's role before touching the row.
--
-- SELECT ... FOR UPDATE needs update rights, so for a viewer it matched
-- nothing, and save_project fell through to its "new project" branch and
-- failed with a duplicate-key error instead of a permission error; claim_editor
-- answered "granted" for a lock that did nothing. Both are now refused up front
-- with 42501. Caught by scripts/verify-rls.mjs before any client used sharing.

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
  my_role text := private.project_role(p_id);
begin
  -- A member who may not edit is refused before anything else happens.
  if my_role is not null and my_role not in ('owner', 'editor') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select editor_id, editor_seen into cur
  from public.projects where id = p_id
  for update;

  if found then
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

create or replace function public.claim_editor(p_id text, p_client_id text, p_force boolean default false)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  cur record;
  my_role text := private.project_role(p_id);
begin
  if my_role is not null and my_role not in ('owner', 'editor') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select editor_id, editor_seen into cur
  from public.projects where id = p_id
  for update;

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
