import { supabase } from './supabaseRepo';

/**
 * Call one of our own server functions (api/) as the signed-in user. The
 * server verifies the access token with Supabase, so this carries identity,
 * not authority. Never throws: network failure comes back as status 0.
 */
export async function callApi<T = Record<string, unknown>>(
  path: string,
  init: { method?: 'GET' | 'POST'; body?: unknown } = {},
): Promise<{ status: number; data: T & { error?: string } }> {
  const { data: session } = await supabase().auth.getSession();
  const token = session.session?.access_token;
  if (!token) return { status: 401, data: { error: 'Sign in first.' } as T & { error?: string } };
  try {
    const res = await fetch(path, {
      method: init.method ?? 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: init.method === 'GET' ? undefined : JSON.stringify(init.body ?? {}),
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    return { status: res.status, data };
  } catch {
    return { status: 0, data: { error: "Couldn't reach Marga. Check your connection." } as T & { error?: string } };
  }
}
