import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ProjectDoc, ProjectSummary } from '../engine/types';
import type { ScheduleRepo } from './repo';

export { lockIsFree, LOCK_STALE_MS } from './lock';

/**
 * The shared-database implementation of ScheduleRepo (EDD D-014). Everything
 * runs as the signed-in user; row-level security confines them to schedules
 * they are a member of. No call site in the store changes.
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

/**
 * Small POST bodies go out with `keepalive`, so a save made as the tab closes
 * still lands. The browser caps keepalive bodies at 64 kB, so larger documents
 * go without it rather than fail.
 */
const keepaliveFetch: typeof fetch = (input, init) => {
  const body = init?.body;
  const small = typeof body === 'string' && body.length < 60_000;
  return fetch(input, init?.method === 'POST' && small ? { ...init, keepalive: true } : init);
};

/**
 * The one Supabase client. It holds the signed-in user's session — persisted
 * in the browser and refreshed automatically, so people stay signed in without
 * an email code each visit — and every query runs as that user, so row-level
 * security decides what they can see and change.
 */
export function supabase(): SupabaseClient {
  if (!client) {
    if (!isShared) throw new Error('Supabase is not configured for this build.');
    client = createClient(url!, anonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
      global: { fetch: keepaliveFetch },
      realtime: { params: { eventsPerSecond: 20 } },
    });
  }
  return client;
}

export type RepoError = Error & { status?: number; editorId?: string };

/** Turn a Postgres error into the shape the store already handles. */
function repoError(error: { message: string; code?: string }): RepoError {
  const e = new Error(error.message) as RepoError;
  const locked = /^locked:(.*)$/.exec(error.message);
  if (locked) {
    e.status = 409;
    e.editorId = locked[1];
    e.message = 'Someone else is editing this schedule.';
  } else if (error.code === '42501' || /row-level security|permission denied/i.test(error.message)) {
    e.status = 403;
  }
  return e;
}

export function createSupabaseRepo(clientId: () => string): ScheduleRepo {
  return {
    async list(): Promise<ProjectSummary[]> {
      const { data, error } = await supabase()
        .from(TABLE)
        .select('id, name, updated_at, task_count')
        .order('updated_at', { ascending: false });
      if (error) throw repoError(error);
      return (data ?? []).map((row) => ({
        id: row.id as string,
        name: row.name as string,
        updatedAt: row.updated_at as string,
        taskCount: (row.task_count as number) ?? 0,
      }));
    },

    async load(id) {
      const { data, error } = await supabase().from(TABLE).select('*').eq('id', id).maybeSingle();
      if (error) throw repoError(error);
      return data ? rowToDoc(data as ProjectRow) : undefined;
    },

    /* The lock check and the write are one database call (save_project), so
       they cannot be split by another editor between them. */
    async save(doc) {
      const { error } = await supabase().rpc('save_project', {
        p_id: doc.id,
        p_name: doc.name,
        p_data_date: doc.dataDate,
        p_tasks: doc.tasks,
        p_links: doc.links,
        p_updated_at: doc.updatedAt,
        p_client_id: clientId(),
      });
      if (error) throw repoError(error);
    },

    async remove(id) {
      const { error } = await supabase().from(TABLE).delete().eq('id', id);
      if (error) throw repoError(error);
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
  const { data, error } = await supabase().rpc('claim_editor', {
    p_id: id,
    p_client_id: clientId,
    p_force: force,
  });
  if (error) throw repoError(error);
  const result = (data ?? {}) as { granted?: boolean; editorId?: string | null };
  return { granted: result.granted === true, editorId: result.editorId ?? null };
}
