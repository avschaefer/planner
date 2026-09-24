/**
 * The soft editor lock rule, as the browser sees it — for showing the
 * read-only banner. The database enforces the same rule on every write
 * (save_project / claim_editor in supabase/migrations); the 90 seconds here
 * must match the interval there.
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
