-- Fix for 0002: a brand-new project could never be saved.
--
-- INSERT ... ON CONFLICT DO UPDATE checks the proposed row against the SELECT
-- policy too, and that policy rests on the owner's membership row, which only
-- the AFTER INSERT trigger writes. Branch explicitly instead: update what
-- exists, insert what does not. Caught by the two-account verification run
-- before any client code used it.
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
