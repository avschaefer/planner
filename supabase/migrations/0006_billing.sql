-- Marga: subscription billing (Stripe).
--
-- No free tier and no feature gating. Every account has full access during a
-- 30-day trial; after it, access needs a live subscription. Access is decided
-- here, in the database, for every query, write and realtime event — the app
-- only draws the lockout screen. Data is never deleted by a lapse: it is
-- hidden until the account subscribes again.
--
-- Billing state lives on profiles and is written only by the service role —
-- the Stripe webhook (api/billing/webhook.ts). Users keep their existing
-- column grant, which covers display_name alone, so no billing column is
-- writable from the browser.
--
-- APPLY AT SHIP TIME: existing accounts get a fresh 30-day trial starting from
-- the moment this runs.
--
-- Idempotent: safe to run more than once.

-- ---------------------------------------------------------- billing state --

alter table public.profiles
  add column if not exists trial_ends_at        timestamptz,
  add column if not exists stripe_customer_id   text,
  add column if not exists stripe_subscription_id text,
  add column if not exists subscription_status  text,
  add column if not exists current_period_end   timestamptz,
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists billing_synced_at    timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_stripe_customer_id_key') then
    alter table public.profiles add constraint profiles_stripe_customer_id_key unique (stripe_customer_id);
  end if;
end
$$;

-- Any account that somehow has no profile row gets one, so it gets a trial.
insert into public.profiles (id, display_name)
select u.id, nullif(trim(u.raw_user_meta_data ->> 'display_name'), '')
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id);

-- Existing accounts: a fresh 30 days from now. New accounts: 30 days from
-- creation, since the profile row is written when the account is.
update public.profiles set trial_ends_at = now() + interval '30 days' where trial_ends_at is null;
alter table public.profiles alter column trial_ends_at set default (now() + interval '30 days');
alter table public.profiles alter column trial_ends_at set not null;

-- plan was a placeholder ('free'). It is now the billing interval of the
-- subscription in effect, or null when there is none.
alter table public.profiles alter column plan drop default;
alter table public.profiles alter column plan drop not null;
update public.profiles set plan = null where plan is not null and plan not in ('monthly', 'annual');
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_plan_check') then
    alter table public.profiles add constraint profiles_plan_check check (plan in ('monthly', 'annual'));
  end if;
end
$$;

-- Unchanged, restated so the rule sits next to the columns it protects: users
-- read their own row and may update display_name only.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant select, insert, update on public.profiles to service_role;

-- -------------------------------------------------------- webhook events --
-- Every processed Stripe event, by id, so a redelivery is recognised. Only the
-- service role touches it; RLS on with no policies and no grants means the
-- public roles cannot even see it exists.

create table if not exists public.stripe_events (
  id          text primary key,
  type        text not null,
  received_at timestamptz not null default now()
);
alter table public.stripe_events enable row level security;
alter table public.stripe_events force row level security;
revoke all on public.stripe_events from anon, authenticated;
grant select, insert on public.stripe_events to service_role;

-- ---------------------------------------------------------------- access --

-- The one rule. Mirrored for display only in src/persist/billing.ts.
--   * in trial, or
--   * a subscription Stripe still considers live. past_due keeps access while
--     Stripe retries the card; canceled, unpaid, incomplete, incomplete_expired
--     and paused do not.
create or replace function private.has_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select p.trial_ends_at > now()
        or p.subscription_status in ('active', 'trialing', 'past_due')
    from public.profiles p
    where p.id = (select auth.uid())
  ), false);
$$;
revoke all on function private.has_access() from public, anon;
grant execute on function private.has_access() to authenticated;

-- ------------------------------------------------------- projects: policies --
-- Each rule from 0002, plus access. Checked per caller: a schedule shared with
-- a paying collaborator stays open to them even if its owner lapses, and a
-- lapsed collaborator loses everything, including what was shared with them.
-- `(select ...)` so Postgres evaluates it once per statement, not per row.

drop policy if exists projects_read on public.projects;
create policy projects_read on public.projects
  for select to authenticated
  using ((select private.has_access()) and private.project_role(id) is not null);

drop policy if exists projects_insert on public.projects;
create policy projects_insert on public.projects
  for insert to authenticated
  with check ((select private.has_access()) and owner_id = (select auth.uid()));

drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects
  for update to authenticated
  using ((select private.has_access()) and private.project_role(id) in ('owner', 'editor'))
  with check ((select private.has_access()) and private.project_role(id) in ('owner', 'editor'));

drop policy if exists projects_delete on public.projects;
create policy projects_delete on public.projects
  for delete to authenticated
  using ((select private.has_access()) and private.project_role(id) = 'owner');

-- Membership rows too: realtime on project_members and the shared-list tags.
drop policy if exists members_read on public.project_members;
create policy members_read on public.project_members
  for select to authenticated
  using (
    (select private.has_access())
    and (user_id = (select auth.uid()) or private.project_role(project_id) is not null)
  );

-- --------------------------------------------------------- write functions --
-- Refused up front with SQLSTATE PT402, which PostgREST returns as HTTP 402,
-- so the app can tell "subscription needed" from "not yours" (42501).

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
  my_role text;
begin
  if not private.has_access() then
    raise exception 'payment_required' using errcode = 'PT402';
  end if;

  my_role := private.project_role(p_id);
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
  my_role text;
begin
  if not private.has_access() then
    raise exception 'payment_required' using errcode = 'PT402';
  end if;

  my_role := private.project_role(p_id);
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

-- ------------------------------------------------------- sharing functions --
-- Same bodies as 0004, plus access. remove_member (leaving, or removing
-- someone) only ever narrows access, so it stays open; delete_my_account stays
-- open because the profile page does.

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
    and private.has_access()
    and private.project_role(p_id) is not null
  order by (m.role = 'owner') desc, lower(u.email);
$$;

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
  if not private.has_access() then
    raise exception 'payment_required' using errcode = 'PT402';
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
  if not private.has_access() then
    raise exception 'payment_required' using errcode = 'PT402';
  end if;
  if p_role not in ('editor', 'viewer') then
    raise exception 'role must be editor or viewer';
  end if;
  update public.project_members set role = p_role
  where project_id = p_id and user_id = p_user and role <> 'owner';
end;
$$;

-- create or replace keeps the grants from 0002 and 0004.

comment on column public.profiles.trial_ends_at is
  'End of the free trial: 30 days from account creation (existing accounts: from migration 0006). Service role only.';
comment on column public.profiles.subscription_status is
  'Stripe subscription status, copied by the webhook. Access: active, trialing, past_due. Service role only.';
