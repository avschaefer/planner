import { compUntilFrom, isAdminEmail } from '../_billing.js';
import { admin, json, requireUser } from '../_supabase.js';

/**
 * Complimentary access, for the admin only (ADMIN_EMAIL, server-side).
 *
 *   GET                         → { accounts: [...] } everyone with a grant
 *   POST { email, until }       → grant or revoke; until is 'forever', a
 *                                 YYYY-MM-DD date, or null to revoke
 *
 * Anyone else gets 403, which is also how the account page decides whether to
 * draw the admin panel at all. The database functions it calls are
 * executable by the service role only (migration 0007).
 */
export async function handler(request: Request): Promise<Response> {
  const user = await requireUser(request);
  if (!user) return json({ error: 'Sign in first.' }, 401);
  if (!user.email_confirmed_at || !isAdminEmail(user.email)) return json({ error: 'Not allowed.' }, 403);

  const db = admin();
  if (request.method === 'GET') {
    const { data, error } = await db.rpc('admin_comp_accounts');
    if (error) {
      console.error('admin/comp list', error);
      return json({ error: 'Could not load complimentary accounts.' }, 500);
    }
    return json({ accounts: data ?? [] });
  }

  if (request.method === 'POST') {
    const body = (await request.json().catch(() => ({}))) as { email?: unknown; until?: unknown };
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    if (!/^\S+@\S+\.\S+$/.test(email)) return json({ error: 'Enter a valid email.' }, 400);
    const until = compUntilFrom(body.until ?? null, new Date());
    if (until === undefined) return json({ error: 'Choose "forever" or a date in the future.' }, 400);

    const { error } = await db.rpc('admin_set_comp', { p_email: email, p_until: until });
    if (error) {
      if (error.code === 'P0002') return json({ error: `No account uses ${email}. They need to sign up first.` }, 404);
      console.error('admin/comp set', error);
      return json({ error: 'Could not save that. Try again.' }, 500);
    }
    return json({ ok: true });
  }

  return json({ error: 'Method not allowed' }, 405);
}

export default { fetch: handler };
