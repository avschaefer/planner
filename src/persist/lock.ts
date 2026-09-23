/**
 * The soft editor lock rule, in one place.
 *
 * Both the browser and the API functions have to agree on who may write, so
 * the rule lives in a module with no Vite and no Supabase imports and is used
 * by `src/persist/supabaseRepo.ts` and `api/_supabase.ts` alike. Two copies of
 * this would drift, and the drift would look like a bug in the lock.
 */

/** How long after its last heartbeat an editor lock is treated as abandoned. */
export const LOCK_STALE_MS = 90_000;

export interface LockState {
  editorId: string | null;
  editorSeen: string | null;
}

/**
 * True when `clientId` may write: nobody holds the lock, it is already theirs,
 * or its holder has gone quiet. There is no explicit release, because a closed
 * laptop never sends one.
 */
export function lockIsFree(editorId: string | null, editorSeen: string | null, clientId: string): boolean {
  if (!editorId || editorId === clientId) return true;
  const seen = editorSeen ? Date.parse(editorSeen) : 0;
  return !Number.isFinite(seen) || seen === 0 || Date.now() - seen > LOCK_STALE_MS;
}
