import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { lockIsFree } from '../src/persist/lock';

/**
 * The service-role client. Server-only: RLS gives the anon key read access and
 * nothing else, so every write in the app arrives through one of these
 * functions. Never import this from src/.
 */
export function admin(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  return createClient(url, key, { auth: { persistSession: false } });
}

export const TABLE = 'projects';

/** The soft editor lock (PRD Q-6). The rule itself is shared with the browser. */
export interface LockRow {
  editor_id: string | null;
  editor_seen: string | null;
}

export function mayEdit(row: LockRow | null, clientId: string): boolean {
  return lockIsFree(row?.editor_id ?? null, row?.editor_seen ?? null, clientId);
}
