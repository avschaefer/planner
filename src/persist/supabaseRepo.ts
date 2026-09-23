import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ProjectDoc, ProjectSummary } from '../engine/types';
import type { ScheduleRepo } from './repo';

export { lockIsFree, LOCK_STALE_MS } from './lock';

/**
 * The shared-database implementation of ScheduleRepo (EDD D-014). Reads come
 * straight from Supabase on the anon key, which RLS limits to SELECT; writes
 * go through the passcode-gated functions in api/, which hold the service-role
 * key. No call site in the store changes.
 */

export const TABLE = 'projects';

export interface ProjectRow {
  id: string;
  name: string;
  data_date: string;
  tasks: ProjectDoc['tasks'];
  links: ProjectDoc['links'];
  updated_at: string;
  client_id: string | null;
  editor_id: string | null;
  editor_seen: string | null;
  task_count?: number;
}

export function rowToDoc(row: ProjectRow): ProjectDoc {
  return {
    id: row.id,
    name: row.name,
    dataDate: row.data_date,
    tasks: row.tasks ?? [],
    links: row.links ?? [],
    updatedAt: row.updated_at,
  };
}

export function docToRow(doc: ProjectDoc): Omit<ProjectRow, 'client_id' | 'editor_id' | 'editor_seen'> {
  return {
    id: doc.id,
    name: doc.name,
    data_date: doc.dataDate,
    tasks: doc.tasks,
    links: doc.links,
    updated_at: doc.updatedAt,
  };
}

/* ------------------------------------------------------------- client ---- */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
// Publishable key (sb_publishable_...) is the current name; the legacy anon
// key variable is accepted too. Both map to the anon role, which RLS limits
// to SELECT.
const anonKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined;

/**
 * True when this build is pointed at a shared database rather than IndexedDB.
 *
 * VITE_FORCE_LOCAL pins it to IndexedDB regardless. The browser suite sets it,
 * so the local path is tested deterministically whether or not the machine
 * running the tests happens to have a .env.local pointing at a real project.
 */
export const isShared =
  Boolean(url && anonKey) && import.meta.env.VITE_FORCE_LOCAL !== '1';

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!client) {
    if (!isShared) throw new Error('Supabase is not configured for this build.');
    client = createClient(url!, anonKey!, {
      auth: { persistSession: false },
      realtime: { params: { eventsPerSecond: 20 } },
    });
  }
  return client;
}

/** Writes are POSTs to our own functions; the session cookie rides along. */
async function post(path: string, body: unknown): Promise<unknown> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    // So a save in flight when the tab closes still lands.
    keepalive: true,
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string; editorId?: string };
  if (!response.ok) {
    const error = new Error(payload.error ?? `Request failed (${response.status})`) as Error & {
      status?: number;
      editorId?: string;
    };
    error.status = response.status;
    error.editorId = payload.editorId;
    throw error;
  }
  return payload;
}

export function createSupabaseRepo(clientId: () => string): ScheduleRepo {
  return {
    async list(): Promise<ProjectSummary[]> {
      const { data, error } = await supabase()
        .from(TABLE)
        .select('id, name, updated_at, task_count')
        .order('updated_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []).map((row) => ({
        id: row.id as string,
        name: row.name as string,
        updatedAt: row.updated_at as string,
        taskCount: (row.task_count as number) ?? 0,
      }));
    },

    async load(id) {
      const { data, error } = await supabase().from(TABLE).select('*').eq('id', id).maybeSingle();
      if (error) throw new Error(error.message);
      return data ? rowToDoc(data as ProjectRow) : undefined;
    },

    async save(doc) {
      await post('/api/save', { doc, clientId: clientId() });
    },

    async remove(id) {
      await post('/api/delete', { id });
    },
  };
}

/** Who, if anyone, is editing — read straight from the row on open. */
export async function readEditor(
  id: string,
): Promise<{ editorId: string | null; editorSeen: string | null }> {
  if (!isShared) return { editorId: null, editorSeen: null };
  const { data } = await supabase().from(TABLE).select('editor_id, editor_seen').eq('id', id).maybeSingle();
  return {
    editorId: (data?.editor_id as string | null) ?? null,
    editorSeen: (data?.editor_seen as string | null) ?? null,
  };
}

/** Claim or refresh the editor lock. `force` is the take-over button. */
export async function claimEditor(
  id: string,
  clientId: string,
  force = false,
): Promise<{ granted: boolean; editorId: string | null }> {
  const result = (await post('/api/claim', { id, clientId, force })) as {
    granted?: boolean;
    editorId?: string | null;
  };
  return { granted: result.granted === true, editorId: result.editorId ?? null };
}
