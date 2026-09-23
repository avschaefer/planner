import { authorised, json } from './_session';
import { admin, mayEdit, TABLE, type LockRow } from './_supabase';

/**
 * POST { id, clientId, force? } — claim the editor slot, or refresh it.
 *
 * Called on the first edit of a session and then on a heartbeat. `force` is the
 * "Take over editing" button: the schedule is more valuable than the lock, so
 * anyone behind the passcode can take it.
 */
export async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!(await authorised(request))) return json({ error: 'Locked' }, 401);

  let id = '';
  let clientId = '';
  let force = false;
  try {
    const body = (await request.json()) as { id?: string; clientId?: string; force?: boolean };
    id = body.id ?? '';
    clientId = body.clientId ?? '';
    force = body.force === true;
  } catch {
    return json({ error: 'Expected JSON.' }, 400);
  }
  if (!id || !clientId) return json({ error: 'id and clientId are required.' }, 400);

  const db = admin();
  const { data: row, error } = await db
    .from(TABLE)
    .select('editor_id, editor_seen')
    .eq('id', id)
    .maybeSingle<LockRow>();
  if (error) return json({ error: error.message }, 500);

  if (!force && !mayEdit(row, clientId)) {
    return json({ granted: false, editorId: row?.editor_id ?? null });
  }

  // A project that has never been saved has no row yet; the claim lands with
  // the first save instead.
  if (row) {
    const { error: writeError } = await db
      .from(TABLE)
      .update({ editor_id: clientId, editor_seen: new Date().toISOString() })
      .eq('id', id);
    if (writeError) return json({ error: writeError.message }, 500);
  }

  return json({ granted: true, editorId: clientId });
}

/* Vercel reads a bare default-exported function as the legacy (req, res) Node
   handler and ignores anything it returns. The fetch object is the web-standard
   form, which is what these are written against. */
export default { fetch: handler };
