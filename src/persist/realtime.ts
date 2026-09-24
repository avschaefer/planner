import type { ProjectDoc } from '../engine/types';
import { isShared, rowToDoc, supabase, TABLE, type ProjectRow } from './supabaseRepo';

/**
 * Live updates. One subscription per open schedule, over postgres_changes on
 * its row. Because the whole document is one row, a single event carries the
 * entire new state — there is nothing to merge, which is what makes
 * "no conflict resolution" an honest design rather than a gap.
 */

export interface RemoteChange {
  doc: ProjectDoc;
  clientId: string | null;
  editorId: string | null;
  editorSeen: string | null;
}

export function subscribeProject(id: string, onChange: (change: RemoteChange) => void): () => void {
  if (!isShared) return () => {};

  const channel = supabase()
    .channel(`project:${id}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: TABLE, filter: `id=eq.${id}` },
      (payload) => {
        const row = payload.new as ProjectRow;
        onChange({
          doc: rowToDoc(row),
          clientId: row.client_id ?? null,
          editorId: row.editor_id ?? null,
          editorSeen: row.editor_seen ?? null,
        });
      },
    )
    .subscribe();

  return () => {
    void supabase().removeChannel(channel);
  };
}

/** The project list, live — so a schedule someone else creates just appears. */
export function subscribeProjects(onChange: () => void): () => void {
  if (!isShared) return () => {};

  // Schedules changing, and access changing: something shared with you appears
  // (or is taken away) without a refresh.
  const channel = supabase()
    .channel('projects:list')
    .on('postgres_changes', { event: '*', schema: 'public', table: TABLE }, () => onChange())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'project_members' }, () => onChange())
    .subscribe();

  return () => {
    void supabase().removeChannel(channel);
  };
}
