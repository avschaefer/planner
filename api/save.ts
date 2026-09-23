import { authorised, json } from './_session.js';
import { admin, mayEdit, TABLE, type LockRow } from './_supabase.js';

interface Doc {
  id: string;
  name: string;
  dataDate: string;
  tasks: unknown[];
  links: unknown[];
  updatedAt: string;
}

/**
 * POST { doc, clientId } — the whole document, as the store has always saved it
 * (EDD D-008). Writing is editing, so a successful save also refreshes the
 * editor lock; a save from anyone else while a live editor holds it is refused
 * with 409 and the caller drops to read-only.
 */
export async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!(await authorised(request))) return json({ error: 'Locked' }, 401);

  let doc: Doc;
  let clientId = '';
  try {
    const body = (await request.json()) as { doc?: Doc; clientId?: string };
    if (!body.doc?.id) return json({ error: 'doc.id is required.' }, 400);
    doc = body.doc;
    clientId = body.clientId ?? '';
  } catch {
    return json({ error: 'Expected JSON.' }, 400);
  }
  if (!clientId) return json({ error: 'clientId is required.' }, 400);

  const db = admin();
  const { data: row, error } = await db
    .from(TABLE)
    .select('editor_id, editor_seen')
    .eq('id', doc.id)
    .maybeSingle<LockRow>();
  if (error) return json({ error: error.message }, 500);

  if (!mayEdit(row, clientId)) {
    return json({ error: 'Someone else is editing this schedule.', editorId: row?.editor_id }, 409);
  }

  const now = new Date().toISOString();
  const { error: writeError } = await db.from(TABLE).upsert({
    id: doc.id,
    name: doc.name,
    data_date: doc.dataDate,
    tasks: doc.tasks ?? [],
    links: doc.links ?? [],
    updated_at: doc.updatedAt || now,
    client_id: clientId,
    editor_id: clientId,
    editor_seen: now,
  });
  if (writeError) return json({ error: writeError.message }, 500);

  return json({ ok: true });
}

/* Vercel reads a bare default-exported function as the legacy (req, res) Node
   handler and ignores anything it returns. The fetch object is the web-standard
   form, which is what these are written against. */
export default { fetch: handler };
