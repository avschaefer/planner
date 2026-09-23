import { describe, expect, it } from 'vitest';
import { rowIds, tasksByRowId } from './ids';
import { formatPredecessors, parsePredecessors, parseRelationship } from './predecessors';
import type { Link, Task } from './types';

/** Five flat activities, numbered 1…5. */
const tasks: Task[] = ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({
  id,
  name: id.toUpperCase(),
  type: 'task',
  duration: 1,
  parentId: null,
  order: i,
}));

const ids = rowIds(tasks);
const byRow = tasksByRowId(tasks);
const parse = (text: string) => parsePredecessors(text, (n) => byRow.get(n));

describe('predecessor shorthand', () => {
  it('reads a bare row number as FS with no lag', () => {
    expect(parse('3')).toEqual({ links: [{ fromId: 'c', type: 'FS', lag: 0 }], error: null });
  });

  it('reads number-first MS Project forms', () => {
    expect(parse('3FS').links[0]).toEqual({ fromId: 'c', type: 'FS', lag: 0 });
    expect(parse('3SS+2d').links[0]).toEqual({ fromId: 'c', type: 'SS', lag: 2 });
    expect(parse('4FF-1').links[0]).toEqual({ fromId: 'd', type: 'FF', lag: -1 });
    expect(parse('2+3d').links[0]).toEqual({ fromId: 'b', type: 'FS', lag: 3 });
  });

  it('reads type-first forms and is case-insensitive', () => {
    expect(parse('FS1').links[0]).toEqual({ fromId: 'a', type: 'FS', lag: 0 });
    expect(parse('ss2+1d').links[0]).toEqual({ fromId: 'b', type: 'SS', lag: 1 });
    expect(parse('sf5-2d').links[0]).toEqual({ fromId: 'e', type: 'SF', lag: -2 });
  });

  it('ignores whitespace inside a token and accepts several separators', () => {
    expect(parse('1, 2 SS +1d; 3').links).toEqual([
      { fromId: 'a', type: 'FS', lag: 0 },
      { fromId: 'b', type: 'SS', lag: 1 },
      { fromId: 'c', type: 'FS', lag: 0 },
    ]);
  });

  it('clears the list on an empty string', () => {
    expect(parse('')).toEqual({ links: [], error: null });
  });

  it('refuses nonsense and unknown rows without returning partial logic', () => {
    expect(parse('3, banana').error).toContain('banana');
    expect(parse('3, banana').links).toEqual([]);
    expect(parse('9').error).toContain('no activity 9');
    expect(parse('3XX+1').error).toBeTruthy();
  });

  it('round-trips through the canonical format', () => {
    const links: Link[] = [
      { id: 'l1', fromId: 'a', toId: 'e', type: 'FS', lag: 0 },
      { id: 'l2', fromId: 'b', toId: 'e', type: 'SS', lag: 2 },
      { id: 'l3', fromId: 'c', toId: 'e', type: 'FS', lag: -1 },
    ];
    const text = formatPredecessors(links, (id) => ids.get(id));
    expect(text).toBe('1, 2SS+2d, 3FS-1d');
    expect(parse(text).links).toEqual([
      { fromId: 'a', type: 'FS', lag: 0 },
      { fromId: 'b', type: 'SS', lag: 2 },
      { fromId: 'c', type: 'FS', lag: -1 },
    ]);
  });
});

describe('relationship shorthand', () => {
  it('parses the popover forms', () => {
    expect(parseRelationship('FS+2d')).toEqual({ type: 'FS', lag: 2 });
    expect(parseRelationship('ss-1')).toEqual({ type: 'SS', lag: -1 });
    expect(parseRelationship('+3')).toEqual({ type: 'FS', lag: 3 });
    expect(parseRelationship('nope')).toBeNull();
  });
});
