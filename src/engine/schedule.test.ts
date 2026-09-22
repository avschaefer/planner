import { describe, expect, it } from 'vitest';
import { toWorkDay } from './calendar';
import { wouldCycle } from './graph';
import { scheduleProject } from './schedule';
import type { Link, LinkType, ProjectDoc, Task } from './types';

const DATA_DATE = '2026-01-05'; // a Monday
const D0 = toWorkDay(DATA_DATE);

function task(id: string, duration: number, extra: Partial<Task> = {}): Task {
  return {
    id,
    code: id,
    name: id,
    type: duration === 0 ? 'milestone' : 'task',
    duration,
    parentId: null,
    order: 0,
    ...extra,
  };
}

function link(fromId: string, toId: string, type: LinkType = 'FS', lag = 0): Link {
  return { id: `${fromId}->${toId}`, fromId, toId, type, lag };
}

function doc(tasks: Task[], links: Link[] = []): ProjectDoc {
  return { id: 'p', name: 'p', dataDate: DATA_DATE, tasks, links, updatedAt: '' };
}

/** Positions relative to the data date, so fixtures read as plain arithmetic. */
function rel(d: ProjectDoc) {
  const s = scheduleProject(d);
  const out: Record<string, { s: number; e: number; ls: number; le: number; tf: number; cr: boolean }> = {};
  for (const [id, v] of s.byId) {
    out[id] = {
      s: v.start - D0,
      e: v.end - D0,
      ls: v.lateStart - D0,
      le: v.lateEnd - D0,
      tf: v.totalFloat,
      cr: v.critical,
    };
  }
  return out;
}

describe('forward and backward pass', () => {
  it('schedules a simple chain and makes all of it critical', () => {
    const r = rel(doc([task('A', 5), task('B', 3)], [link('A', 'B')]));
    expect(r.A).toMatchObject({ s: 0, e: 5, tf: 0, cr: true });
    expect(r.B).toMatchObject({ s: 5, e: 8, tf: 0, cr: true });
  });

  it('gives the slack branch of a diamond positive float', () => {
    // A -> {B(4), C(1)} -> D. B drives; C has 3 days of float.
    const r = rel(
      doc(
        [task('A', 2), task('B', 4), task('C', 1), task('D', 2)],
        [link('A', 'B'), link('A', 'C'), link('B', 'D'), link('C', 'D')],
      ),
    );
    expect(r.A).toMatchObject({ s: 0, e: 2, tf: 0, cr: true });
    expect(r.B).toMatchObject({ s: 2, e: 6, tf: 0, cr: true });
    expect(r.C).toMatchObject({ s: 2, e: 3, tf: 3, cr: false });
    expect(r.D).toMatchObject({ s: 6, e: 8, tf: 0, cr: true });
  });

  it('computes late dates from the project finish', () => {
    const r = rel(doc([task('A', 2), task('B', 4), task('C', 1)], [link('A', 'B'), link('A', 'C')]));
    // Project ends at 6 (A then B). C may finish as late as 6.
    expect(r.C).toMatchObject({ ls: 5, le: 6, tf: 3 });
  });

  it('floats an activity with no logic at all', () => {
    const r = rel(doc([task('A', 10), task('LOOSE', 1)]));
    expect(r.A.cr).toBe(true);
    expect(r.LOOSE).toMatchObject({ s: 0, tf: 9, cr: false });
  });
});

describe('relationship types', () => {
  const cases: Array<[LinkType, number, number]> = [
    // [type, lag, expected start of B relative to data date]; A is 5d at day 0.
    ['FS', 0, 5],
    ['FS', 2, 7],
    ['FS', -1, 4],
    ['SS', 0, 0],
    ['SS', 3, 3],
    ['SS', -2, 0], // clamped by the project start
  ];

  for (const [type, lag, expected] of cases) {
    it(`${type}${lag >= 0 ? '+' : ''}${lag}d starts B at ${expected}`, () => {
      const r = rel(doc([task('A', 5), task('B', 3)], [link('A', 'B', type, lag)]));
      expect(r.B.s).toBe(expected);
    });
  }

  it('FF aligns finishes', () => {
    const r = rel(doc([task('A', 5), task('B', 3)], [link('A', 'B', 'FF')]));
    expect(r.B).toMatchObject({ s: 2, e: 5 }); // B finishes when A does
  });

  it('FF with lag pushes the successor finish out', () => {
    const r = rel(doc([task('A', 5), task('B', 3)], [link('A', 'B', 'FF', 2)]));
    expect(r.B).toMatchObject({ s: 4, e: 7 });
  });

  it('SF ends the successor when the predecessor starts', () => {
    const r = rel(doc([task('A', 5), task('B', 3)], [link('A', 'B', 'SF', 4)]));
    expect(r.B).toMatchObject({ s: 1, e: 4 });
  });
});

describe('milestones', () => {
  it('occupies a single point and drives its successors', () => {
    const r = rel(doc([task('A', 3), task('M', 0), task('B', 2)], [link('A', 'M'), link('M', 'B')]));
    expect(r.M).toMatchObject({ s: 3, e: 3, cr: true });
    expect(r.B).toMatchObject({ s: 3, e: 5 });
  });
});

describe('constraints', () => {
  it('SNET pushes a driven activity later without breaking the link', () => {
    const d = doc(
      [task('A', 5), task('B', 3, { constraint: { type: 'SNET', day: D0 + 8 } })],
      [link('A', 'B')],
    );
    const r = rel(d);
    expect(r.B).toMatchObject({ s: 8, e: 11 });
    expect(r.A.tf).toBe(3); // A now has float; B pushed the finish out
  });

  it('is ignored when the logic already pushes the activity later', () => {
    const d = doc(
      [task('A', 5), task('B', 3, { constraint: { type: 'SNET', day: D0 + 2 } })],
      [link('A', 'B')],
    );
    expect(rel(d).B.s).toBe(5);
  });

  it('never schedules before the project start', () => {
    const d = doc([task('A', 3, { constraint: { type: 'SNET', day: D0 - 10 } })]);
    expect(rel(d).A.s).toBe(0);
  });
});

describe('propagation', () => {
  it('shifts every downstream activity when a duration changes', () => {
    const tasks = [task('A', 5), task('B', 3), task('C', 2)];
    const links = [link('A', 'B'), link('B', 'C')];
    const before = rel(doc(tasks, links));
    const after = rel(doc([task('A', 8), task('B', 3), task('C', 2)], links));
    expect(after.B.s - before.B.s).toBe(3);
    expect(after.C.s - before.C.s).toBe(3);
  });
});

describe('cycle rejection', () => {
  it('rejects a link that closes a loop', () => {
    const tasks = [task('A', 1), task('B', 1), task('C', 1)];
    const links = [link('A', 'B'), link('B', 'C')];
    expect(wouldCycle(tasks, links, link('C', 'A'))).toBe(true);
    expect(wouldCycle(tasks, links, link('A', 'C'))).toBe(false);
  });

  it('rejects a self-link', () => {
    expect(wouldCycle([task('A', 1)], [], link('A', 'A'))).toBe(true);
  });
});

describe('summary rollup', () => {
  const tree = (): Task[] => [
    { ...task('S', 0), type: 'summary', id: 'S', code: 'S', name: 'S' },
    task('A', 3, { parentId: 'S', order: 0 }),
    task('B', 2, { parentId: 'S', order: 1 }),
  ];

  it('spans its children and takes no part in the network', () => {
    const r = rel(doc(tree(), [link('A', 'B')]));
    expect(r.S).toMatchObject({ s: 0, e: 5 });
  });

  it('is critical when any descendant is', () => {
    const r = rel(doc(tree(), [link('A', 'B')]));
    expect(r.S.cr).toBe(true);
  });

  it('rolls up through nesting', () => {
    const tasks: Task[] = [
      { ...task('OUTER', 0), type: 'summary', id: 'OUTER', code: 'OUTER', name: 'OUTER' },
      { ...task('INNER', 0), type: 'summary', id: 'INNER', code: 'INNER', name: 'INNER', parentId: 'OUTER' },
      task('A', 4, { parentId: 'INNER' }),
      task('B', 2, { parentId: 'OUTER', order: 1 }),
    ];
    const r = rel(doc(tasks, [link('A', 'B')]));
    expect(r.INNER).toMatchObject({ s: 0, e: 4 });
    expect(r.OUTER).toMatchObject({ s: 0, e: 6 });
  });
});
