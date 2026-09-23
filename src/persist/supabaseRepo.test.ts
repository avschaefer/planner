import { describe, expect, it } from 'vitest';
import type { ProjectDoc } from '../engine/types';
import { lockIsFree } from './lock';
import { docToRow, rowToDoc, type ProjectRow } from './supabaseRepo';

const doc: ProjectDoc = {
  id: 'p1',
  name: 'Infusion Pump — DV build',
  dataDate: '2026-09-21',
  updatedAt: '2026-09-22T10:11:12.000Z',
  tasks: [
    { id: 'a', name: 'Design', type: 'task', duration: 10, parentId: null, order: 0 },
    { id: 'b', name: 'Gate', type: 'milestone', duration: 0, parentId: null, order: 1,
      constraint: { type: 'SNET', day: 6842 } },
  ],
  links: [{ id: 'l1', fromId: 'a', toId: 'b', type: 'FS', lag: 2 }],
};

describe('document <-> row', () => {
  it('round-trips a document with no loss', () => {
    const row = { ...docToRow(doc), client_id: 'c1', editor_id: null, editor_seen: null } as ProjectRow;
    expect(rowToDoc(row)).toEqual(doc);
  });

  it('maps the two names that differ between the app and the table', () => {
    const row = docToRow(doc);
    expect(row.data_date).toBe(doc.dataDate);
    expect(row.updated_at).toBe(doc.updatedAt);
  });

  it('survives a row whose json columns came back null', () => {
    const row = {
      id: 'p2', name: 'Empty', data_date: '2026-01-05', updated_at: '2026-01-05T00:00:00.000Z',
      tasks: null, links: null, client_id: null, editor_id: null, editor_seen: null,
    } as unknown as ProjectRow;
    expect(rowToDoc(row).tasks).toEqual([]);
    expect(rowToDoc(row).links).toEqual([]);
  });
});

describe('editor lock', () => {
  const now = () => new Date().toISOString();
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

  it('is free when nobody holds it', () => {
    expect(lockIsFree(null, null, 'me')).toBe(true);
  });

  it('is free when it is already ours', () => {
    expect(lockIsFree('me', now(), 'me')).toBe(true);
  });

  it('is held while someone else is still beating', () => {
    expect(lockIsFree('them', now(), 'me')).toBe(false);
    expect(lockIsFree('them', ago(45_000), 'me')).toBe(false);
  });

  it('goes stale after 90 seconds of silence — a closed laptop never releases it', () => {
    expect(lockIsFree('them', ago(120_000), 'me')).toBe(true);
  });

  it('treats a holder with no heartbeat at all as stale', () => {
    expect(lockIsFree('them', null, 'me')).toBe(true);
  });
});
