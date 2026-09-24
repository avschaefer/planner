import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

/**
 * The service-role client. Server-only — it bypasses row-level security, and
 * is used for exactly one thing: writing the billing columns on profiles,
 * which no signed-in user can write. Never import this from src/.
 */
export function admin(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  // SUPABASE_SECRET_KEY is the current name (sb_secret_...); the older
  // SUPABASE_SERVICE_ROLE_KEY is accepted so an older environment still works.
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY are required.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/**
 * The signed-in caller, from the `Authorization: Bearer <access token>` the
 * browser sends. Verified by Supabase Auth, not decoded locally, so a revoked
 * session or a deleted account is refused. Null means 401.
 */
export async function requireUser(request: Request): Promise<User | null> {
  const token = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!token) return null;
  const { data, error } = await admin().auth.getUser(token);
  return error || !data.user ? null : data.user;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
