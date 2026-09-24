/**
 * Proves the database's access rules against the real Supabase project.
 *
 * Creates two throwaway, pre-confirmed accounts with the secret key, then acts
 * as each through the publishable key — exactly as the browser does — and
 * checks isolation, the editor lock, protected columns and realtime. Deletes
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

  const p = await A.from('profiles').select('display_name, plan').single();
  check('profile row created on signup', p.data?.display_name === 'Verify A' && p.data?.plan === 'free', JSON.stringify(p.data));

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

  r = await A.from('projects').delete().eq('id', pid).select();
  check('owner can delete', r.data?.length === 1, r.error?.message);
} catch (e) {
  check('script', false, String(e));
} finally {
  for (const id of ids) await admin.auth.admin.deleteUser(id);
  const left = await admin.from('profiles').select('id').in('id', ids);
  check('test users and their data cleaned up', (left.data ?? []).length === 0);
  for (const [s, n, d] of results) console.log(s, n, d ? '— ' + d : '');
  process.exit(results.some(([s]) => s === 'FAIL') ? 1 : 0);
}
