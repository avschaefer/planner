/**
 * Proves the database's access rules against the real Supabase project.
 *
 * Creates two throwaway, pre-confirmed accounts with the secret key, then acts
 * as each through the publishable key — exactly as the browser does — and
 * checks isolation, the editor lock, protected columns, realtime, sharing and
 * the billing lockout (trial expiry is simulated by moving trial_ends_at with
 * the secret key, exactly as only the webhook could). Deletes
 * both accounts (and so their data) at the end, pass or fail.
 *
 *   npm run verify:db      (reads .env.local; needs SUPABASE_SECRET_KEY)
 *
 * Exits non-zero if any check fails.
 */
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const PUB = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const admin = createClient(URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const results = [];
const check = (name, ok, detail = '') => { results.push([ok ? 'PASS' : 'FAIL', name, detail]); };
const pw = 'Verify-' + Math.random().toString(36).slice(2) + '!9';
const stamp = Date.now();
const emails = [`marga.verify.a.${stamp}@example.com`, `marga.verify.b.${stamp}@example.com`];
const ids = [];

async function as(email) {
  const c = createClient(URL, PUB, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: pw });
  if (error) throw new Error('sign in ' + email + ': ' + error.message);
  return c;
}

try {
  for (const [i, email] of emails.entries()) {
    const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true, user_metadata: { display_name: 'Verify ' + 'AB'[i] } });
    if (error) throw error;
    ids.push(data.user.id);
  }
  const A = await as(emails[0]);
  const B = await as(emails[1]);
  const pid = 'verify-' + stamp;
  const save = (c, client, name = 'Verify project') => c.rpc('save_project', { p_id: pid, p_name: name, p_data_date: '2026-09-24', p_tasks: [{ id: 't', name: 'x', type: 'task', duration: 3, parentId: null, order: 0 }], p_links: [], p_updated_at: new Date().toISOString(), p_client_id: client });

  const p = await A.from('profiles').select('display_name, plan, trial_ends_at, subscription_status').single();
  const trialDays = (new Date(p.data?.trial_ends_at).getTime() - Date.now()) / 86400000;
  check('profile row created on signup', p.data?.display_name === 'Verify A' && p.data?.plan === null, JSON.stringify(p.data));
  check('new account gets a 30-day trial', trialDays > 29.9 && trialDays < 30.01 && p.data?.subscription_status === null, trialDays.toFixed(3));

  let r = await save(A, 'a1');
  check('owner can create a project', !r.error, r.error?.message);
  r = await A.from('projects').select('id, owner_id, task_count');
  check('owner sees it', r.data?.length === 1 && r.data[0].owner_id === ids[0], JSON.stringify(r.data));
  r = await A.from('project_members').select('role').eq('project_id', pid);
  check('owner membership added', r.data?.[0]?.role === 'owner', JSON.stringify(r.data));

  r = await B.from('projects').select('id');
  check('other user sees nothing', r.data?.length === 0, JSON.stringify(r.data));
  r = await save(B, 'b1', 'Hijacked');
  check('other user cannot overwrite', !!r.error, r.error?.message);
  r = await B.from('projects').update({ name: 'Hijacked' }).eq('id', pid).select();
  check('other user cannot update directly', (r.data ?? []).length === 0, r.error?.message ?? JSON.stringify(r.data));
  r = await B.from('projects').delete().eq('id', pid).select();
  check('other user cannot delete', (r.data ?? []).length === 0, r.error?.message ?? JSON.stringify(r.data));
  r = await A.from('projects').select('name').eq('id', pid).single();
  check('project untouched by other user', r.data?.name === 'Verify project', r.data?.name);

  const anon = createClient(URL, PUB, { auth: { persistSession: false } });
  r = await anon.from('projects').select('id');
  check('signed-out client reads nothing', !!r.error || r.data?.length === 0, r.error?.message ?? JSON.stringify(r.data));

  r = await A.from('profiles').update({ plan: 'pro' }).eq('id', ids[0]).select();
  check('user cannot change own plan', !!r.error, r.error?.message);
  r = await A.from('profiles').update({ display_name: 'Renamed' }).eq('id', ids[0]).select();
  check('user can change own name', !r.error && r.data?.[0]?.display_name === 'Renamed', r.error?.message);
  r = await A.from('projects').update({ owner_id: ids[1] }).eq('id', pid).select();
  check('owner cannot hand ownership away client-side', !!r.error, r.error?.message);

  r = await save(A, 'a2');
  check('second tab is locked out while first edits', !!r.error && /locked:a1/.test(r.error.message), r.error?.message);
  r = await A.rpc('claim_editor', { p_id: pid, p_client_id: 'a2', p_force: false });
  check('claim refused while lock is fresh', r.data?.granted === false && r.data?.editorId === 'a1', JSON.stringify(r.data));
  r = await A.rpc('claim_editor', { p_id: pid, p_client_id: 'a2', p_force: true });
  check('take over grants the lock', r.data?.granted === true, JSON.stringify(r.data));
  r = await save(A, 'a1');
  check('previous editor now refused', !!r.error && /locked:a2/.test(r.error.message), r.error?.message);

  // Realtime: the owner hears changes; the other user does not.
  const heard = { A: 0, B: 0 };
  const sub = (c, key) => new Promise((res) => c.channel('v-' + key).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'projects', filter: `id=eq.${pid}` }, () => heard[key]++).subscribe((s) => s === 'SUBSCRIBED' && res()));
  await Promise.all([sub(A, 'A'), sub(B, 'B')]);
  await new Promise((res) => setTimeout(res, 1500));
  await save(A, 'a2', 'Live change');
  await new Promise((res) => setTimeout(res, 4000));
  check('owner receives live updates', heard.A > 0, 'events ' + heard.A);
  check('other user receives no live updates', heard.B === 0, 'events ' + heard.B);
  await A.removeAllChannels(); await B.removeAllChannels();

  // ---- sharing ----
  r = await B.rpc('share_project', { p_id: pid, p_email: emails[0], p_role: 'editor' });
  check('a non-member cannot share', !!r.error, r.error?.message);
  r = await A.rpc('share_project', { p_id: pid, p_email: 'nobody-' + stamp + '@example.com', p_role: 'viewer' });
  check('sharing with an unknown email says so', r.data?.ok === false && r.data?.reason === 'not_found', JSON.stringify(r.data));
  r = await A.rpc('share_project', { p_id: pid, p_email: emails[0], p_role: 'viewer' });
  check('sharing with yourself is refused', r.data?.ok === false && r.data?.reason === 'self', JSON.stringify(r.data));
  r = await A.rpc('share_project', { p_id: pid, p_email: emails[1].toUpperCase(), p_role: 'viewer' });
  check('owner shares as viewer (email case-insensitive)', r.data?.ok === true, JSON.stringify(r.data));
  r = await B.from('projects').select('name').eq('id', pid);
  check('viewer can now read it', r.data?.length === 1, JSON.stringify(r.data));
  r = await B.rpc('project_people', { p_id: pid });
  check('viewer sees who has access', r.data?.length === 2 && r.data[0].role === 'owner', JSON.stringify(r.data?.map((x) => x.role)));
  r = await save(B, 'b1', 'Viewer edit');
  check('viewer cannot save', !!r.error && r.error.code === '42501', r.error?.message);
  r = await B.rpc('claim_editor', { p_id: pid, p_client_id: 'b1', p_force: true });
  check('viewer cannot take the editor lock', !!r.error && r.error.code === '42501', JSON.stringify(r.data ?? r.error?.message));
  r = await B.rpc('set_member_role', { p_id: pid, p_user: ids[1], p_role: 'editor' });
  check('viewer cannot promote themselves', !!r.error, r.error?.message);
  r = await A.rpc('set_member_role', { p_id: pid, p_user: ids[1], p_role: 'editor' });
  check('owner promotes viewer to editor', !r.error, r.error?.message);
  r = await A.rpc('claim_editor', { p_id: pid, p_client_id: 'a3', p_force: true });
  await B.rpc('claim_editor', { p_id: pid, p_client_id: 'b1', p_force: true });
  r = await save(B, 'b1', 'Edited by collaborator');
  check('editor can save', !r.error, r.error?.message);
  r = await A.from('projects').select('name').eq('id', pid).single();
  check('owner sees the editor\'s change', r.data?.name === 'Edited by collaborator', r.data?.name);
  r = await B.from('projects').delete().eq('id', pid).select();
  check('editor cannot delete the schedule', (r.data ?? []).length === 0, r.error?.message);
  r = await B.rpc('remove_member', { p_id: pid, p_user: ids[0] });
  r = await A.from('project_members').select('user_id').eq('project_id', pid);
  check('editor cannot remove the owner', r.data?.some((x) => x.user_id === ids[0]), JSON.stringify(r.data));
  r = await A.rpc('remove_member', { p_id: pid, p_user: ids[0] });
  r = await A.from('project_members').select('user_id').eq('project_id', pid);
  check('the owner cannot be removed even by themselves', r.data?.some((x) => x.user_id === ids[0]), JSON.stringify(r.data));
  r = await B.rpc('remove_member', { p_id: pid, p_user: ids[1] });
  check('a collaborator can leave', !r.error, r.error?.message);
  r = await B.from('projects').select('id').eq('id', pid);
  check('and then sees nothing', r.data?.length === 0, JSON.stringify(r.data));
  await A.rpc('share_project', { p_id: pid, p_email: emails[1], p_role: 'editor' });
  r = await A.rpc('remove_member', { p_id: pid, p_user: ids[1] });
  r = await B.from('projects').select('id').eq('id', pid);
  check('owner can remove a collaborator', r.data?.length === 0, JSON.stringify(r.data));

  // ---- billing: the lockout is enforced by the database ----
  const setBilling = (id, fields) => admin.from('profiles').update(fields).eq('id', id);
  const PAST = new Date(Date.now() - 60_000).toISOString();
  const TRIAL = new Date(Date.now() + 30 * 86400000).toISOString();
  const is402 = (res) => res.error?.code === 'PT402';

  for (const col of [{ trial_ends_at: '2099-01-01T00:00:00Z' }, { subscription_status: 'active' }, { stripe_customer_id: 'cus_fake' }, { current_period_end: '2099-01-01T00:00:00Z' }]) {
    r = await A.from('profiles').update(col).eq('id', ids[0]).select();
    check(`user cannot write ${Object.keys(col)[0]}`, !!r.error, r.error?.message ?? JSON.stringify(r.data));
  }
  r = await A.from('stripe_events').select('id');
  check('webhook event log is invisible to users', !!r.error || r.data?.length === 0, r.error?.message ?? JSON.stringify(r.data));

  await A.rpc('share_project', { p_id: pid, p_email: emails[1], p_role: 'editor' });
  await setBilling(ids[0], { trial_ends_at: PAST, subscription_status: null });
  r = await A.from('projects').select('id');
  check('expired trial: reads nothing', r.data?.length === 0, JSON.stringify(r.data));
  r = await save(A, 'a3');
  check('expired trial: save refused with 402', is402(r), r.error?.code + ' ' + r.error?.message);
  r = await A.rpc('claim_editor', { p_id: pid, p_client_id: 'a3', p_force: true });
  check('expired trial: editor lock refused with 402', is402(r), r.error?.code + ' ' + r.error?.message);
  r = await A.from('projects').update({ name: 'Locked write' }).eq('id', pid).select();
  check('expired trial: direct update changes nothing', (r.data ?? []).length === 0, r.error?.message ?? JSON.stringify(r.data));
  r = await A.from('projects').delete().eq('id', pid).select();
  check('expired trial: cannot delete', (r.data ?? []).length === 0, r.error?.message ?? JSON.stringify(r.data));
  r = await A.rpc('save_project', { p_id: pid + '-new', p_name: 'New', p_data_date: '2026-09-24', p_tasks: [], p_links: [], p_updated_at: new Date().toISOString(), p_client_id: 'a3' });
  check('expired trial: cannot create a schedule', is402(r), r.error?.code + ' ' + r.error?.message);
  r = await A.rpc('share_project', { p_id: pid, p_email: emails[1], p_role: 'viewer' });
  check('expired trial: cannot share', is402(r), r.error?.code + ' ' + r.error?.message);
  r = await A.rpc('project_people', { p_id: pid });
  check('expired trial: sees no collaborators', (r.data ?? []).length === 0, JSON.stringify(r.data));
  r = await A.from('project_members').select('project_id');
  check('expired trial: sees no memberships', (r.data ?? []).length === 0, JSON.stringify(r.data));
  r = await A.from('profiles').select('trial_ends_at').single();
  check('expired trial: can still read own profile', !!r.data, r.error?.message);
  r = await A.from('profiles').update({ display_name: 'Still me' }).eq('id', ids[0]).select();
  check('expired trial: can still edit own name', !r.error && r.data?.length === 1, r.error?.message);

  r = await B.from('projects').select('name').eq('id', pid);
  check("a collaborator in trial keeps the lapsed owner's schedule", r.data?.length === 1, JSON.stringify(r.data));
  await B.rpc('claim_editor', { p_id: pid, p_client_id: 'b1', p_force: true });

  // Realtime: the locked owner hears nothing; the collaborator does.
  const heard2 = { A: 0, B: 0 };
  const sub2 = (c, key) => new Promise((res) => c.channel('b-' + key).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'projects', filter: `id=eq.${pid}` }, () => heard2[key]++).subscribe((st) => st === 'SUBSCRIBED' && res()));
  await Promise.all([sub2(A, 'A'), sub2(B, 'B')]);
  await new Promise((res) => setTimeout(res, 1500));
  r = await save(B, 'b1', 'Edited by collaborator');
  check('collaborator in trial can still save it', !r.error, r.error?.message);
  await new Promise((res) => setTimeout(res, 4000));
  check('expired trial: no live updates', heard2.A === 0, 'events ' + heard2.A);
  check('collaborator still receives live updates', heard2.B > 0, 'events ' + heard2.B);
  await A.removeAllChannels(); await B.removeAllChannels();

  await setBilling(ids[1], { trial_ends_at: PAST });
  r = await B.from('projects').select('id').eq('id', pid);
  check('a lapsed collaborator loses shared schedules too', r.data?.length === 0, JSON.stringify(r.data));
  await setBilling(ids[1], { trial_ends_at: TRIAL });

  await setBilling(ids[0], { subscription_status: 'active', plan: 'annual' });
  r = await A.from('projects').select('name').eq('id', pid);
  check('subscribing restores access, data intact', r.data?.[0]?.name === 'Edited by collaborator', JSON.stringify(r.data));
  await A.rpc('claim_editor', { p_id: pid, p_client_id: 'a4', p_force: true });
  r = await save(A, 'a4');
  check('subscribed: can save again', !r.error, r.error?.message);
  await setBilling(ids[0], { subscription_status: 'past_due' });
  r = await A.from('projects').select('id');
  check('past_due keeps access while Stripe retries', r.data?.length === 1, JSON.stringify(r.data));
  for (const status of ['canceled', 'unpaid', 'incomplete_expired']) {
    await setBilling(ids[0], { subscription_status: status });
    r = await A.from('projects').select('id');
    check(`${status} locks`, r.data?.length === 0, JSON.stringify(r.data));
  }
  await setBilling(ids[0], { trial_ends_at: TRIAL, subscription_status: null, plan: null });
  await A.rpc('remove_member', { p_id: pid, p_user: ids[1] });

  // ---- deleting an account ----
  await A.rpc('share_project', { p_id: pid, p_email: emails[1], p_role: 'editor' });
  const del = await B.rpc('delete_my_account');
  check('a user can delete their own account', !del.error, del.error?.message);
  const gone = await admin.auth.admin.getUserById(ids[1]);
  check('the account is gone', !gone.data?.user, JSON.stringify(gone.data?.user?.id));
  r = await A.from('projects').select('id').eq('id', pid);
  check('the other person\'s schedule is untouched', r.data?.length === 1, JSON.stringify(r.data));
  const anonDel = await anon.rpc('delete_my_account');
  check('signed out cannot call delete_my_account', !!anonDel.error, anonDel.error?.message);

  r = await A.from('projects').delete().eq('id', pid).select();
  check('owner can delete', r.data?.length === 1, r.error?.message);
} catch (e) {
  check('script', false, String(e));
} finally {
  for (const id of ids) await admin.auth.admin.deleteUser(id).catch(() => {});
  const left = await admin.from('profiles').select('id').in('id', ids);
  check('test users and their data cleaned up', (left.data ?? []).length === 0);
  for (const [s, n, d] of results) console.log(s, n, d ? '— ' + d : '');
  process.exit(results.some(([s]) => s === 'FAIL') ? 1 : 0);
}
