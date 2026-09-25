-- Marga: complimentary access, and account deletion that can't strand a
-- paying subscription.
--
-- 1. profiles.comp_until — free access granted by the admin, until a moment
--    or 'infinity'. Null means none. It joins the one access rule, so the
--    database honours it everywhere the trial and subscriptions are honoured.
--    Users can't write it: their column grant is display_name only (0006).
-- 2. admin_comp_accounts / admin_set_comp — the admin panel's two operations.
--    Callable by the service role only; the API checks ADMIN_EMAIL before
--    calling them (api/admin/comp.ts).
-- 3. delete_my_account refuses while a subscription is live. The app deletes
--    through api/account/delete, which cancels the subscription in Stripe
--    first; this closes the direct-RPC path that would skip that.
--
-- Safe to apply before or after the code that uses it. Idempotent.

-- ------------------------------------------------------ complimentary access --

alter table public.profiles add column if not exists comp_until timestamptz;

-- The one rule, as in 0006, plus comp. Mirrored for display in
-- src/persist/access.ts.
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
        or p.comp_until > now()
    from public.profiles p
    where p.id = (select auth.uid())
  ), false);
$$;
revoke all on function private.has_access() from public, anon;
grant execute on function private.has_access() to authenticated;

-- Everyone with a grant, current or lapsed, newest ending last.
create or replace function public.admin_comp_accounts()
returns table (user_id uuid, email text, display_name text, comp_until timestamptz, subscription_status text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, u.email::text, p.display_name, p.comp_until, p.subscription_status
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.comp_until is not null
  order by p.comp_until desc, lower(u.email);
$$;

-- Grant (a future moment or 'infinity') or revoke (null) by email. Raises
-- no_data_found when no account has that email.
create or replace function public.admin_set_comp(p_email text, p_until timestamptz)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid;
begin
  select id into target from auth.users where lower(email) = lower(trim(p_email));
  if target is null then
    raise exception 'no_account' using errcode = 'P0002';
  end if;
  update public.profiles set comp_until = p_until where id = target;
  return target;
end;
$$;

revoke all on function public.admin_comp_accounts() from public, anon, authenticated;
revoke all on function public.admin_set_comp(text, timestamptz) from public, anon, authenticated;
grant execute on function public.admin_comp_accounts() to service_role;
grant execute on function public.admin_set_comp(text, timestamptz) to service_role;

-- -------------------------------------------------------- account deletion --

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
  -- A live subscription must be cancelled in Stripe first, which only the
  -- server can do (api/account/delete). Deleting here would leave it billing.
  if exists (
    select 1 from public.profiles
    where id = auth.uid() and subscription_status in ('active', 'trialing', 'past_due')
  ) then
    raise exception 'subscription_live' using errcode = 'PT409';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
