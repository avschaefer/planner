import { authorised, json } from './_session';
import { admin, TABLE } from './_supabase';

/** POST { id } — deleting a schedule is not gated by the editor lock. */
export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!(await authorised(request))) return json({ error: 'Locked' }, 401);

  let id = '';
  try {
    const body = (await request.json()) as { id?: string };
    id = body.id ?? '';
  } catch {
    return json({ error: 'Expected JSON.' }, 400);
  }
  if (!id) return json({ error: 'id is required.' }, 400);

  const { error } = await admin().from(TABLE).delete().eq('id', id);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
}
