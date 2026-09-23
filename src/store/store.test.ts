import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { toWorkDay } from '../engine/calendar';
import { rowIds } from '../engine/ids';
import { scheduleProject } from '../engine/schedule';
import { useStore } from './store';

/**
 * Exercises the document layer end to end: edits, logic, constraints, undo.
 * The React components are covered by the Playwright smoke suite.
 */

const DATA_DATE = '2026-01-05'; // Monday
const s = () => useStore.getState();

/** Look an activity up by the name the fixture gave it. */
function codeId(name: string): string {
  return s().doc!.tasks.find((t) => t.name === name)!.id;
}

function startOf(name: string): number {
  return s().schedule!.byId.get(codeId(name))!.start - toWorkDay(DATA_DATE);
}

beforeEach(async () => {
  await s().createProject('test');
  // Pin the data date so fixtures read as offsets from a known Monday.
  const doc = { ...s().doc!, dataDate: DATA_DATE };
  useStore.setState({ doc, schedule: scheduleProject(doc), undoStack: [], redoStack: [], notice: null });
});

function addActivities(specs: Array<[string, number]>) {
  for (const [name, duration] of specs) {
    const id = s().addTask();
    if (!id) throw new Error('addTask failed');
    s().setName(id, name);
    s().setDuration(id, duration);
  }
}

describe('store', () => {
  it('numbers activities 1, 2, 3 down the outline', () => {
    addActivities([
      ['A', 5],
      ['B', 3],
      ['C', 2],
    ]);
    const ids = rowIds(s().doc!.tasks);
    expect([...ids.values()]).toEqual([1, 2, 3]);
    expect(startOf('A')).toBe(0);

    // Indenting changes depth, never the numbering.
    s().indent(codeId('B'));
    expect(rowIds(s().doc!.tasks).get(codeId('C'))).toBe(3);

    // Deleting a row renumbers everything below it, exactly as MSP does.
    s().deleteTask(codeId('A'));
    expect(rowIds(s().doc!.tasks).get(codeId('C'))).toBe(1);
  });

  it('propagates a link and reports the critical chain', () => {
    addActivities([
      ['A', 5],
      ['B', 3],
    ]);
    s().addLink(codeId('A'), codeId('B'));
    expect(startOf('B')).toBe(5);
    expect(s().schedule!.byId.get(codeId('B'))!.critical).toBe(true);
  });

  it('refuses a link that would close a loop and says so', () => {
    addActivities([
      ['A', 1],
      ['B', 1],
    ]);
    s().addLink(codeId('A'), codeId('B'));
    s().addLink(codeId('B'), codeId('A'));
    expect(s().doc!.links).toHaveLength(1);
    expect(s().notice).toMatch(/depend on itself/);
  });

  it('refuses a link onto a summary', () => {
    addActivities([
      ['Phase', 1],
      ['Child', 2],
      ['Other', 1],
    ]);
    s().indent(codeId('Child'));
    s().addLink(codeId('Other'), codeId('Phase'));
    expect(s().doc!.links).toHaveLength(0);
    expect(s().notice).toMatch(/carry no logic/);
  });

  it('pins a dragged activity instead of breaking its logic', () => {
    addActivities([
      ['A', 5],
      ['B', 3],
    ]);
    s().addLink(codeId('A'), codeId('B'));
    expect(startOf('B')).toBe(5);

    s().moveBy(codeId('B'), 4);
    expect(startOf('B')).toBe(9);
    expect(s().doc!.links).toHaveLength(1); // the link survived
    expect(s().doc!.tasks.find((t) => t.name === 'B')!.constraint).toBeTruthy();

    s().clearConstraint(codeId('B'));
    expect(startOf('B')).toBe(5);
  });

  it('moves a summary by shifting its whole subtree together', () => {
    addActivities([
      ['Phase', 1],
      ['One', 3],
      ['Two', 2],
    ]);
    s().indent(codeId('One'));
    s().indent(codeId('Two'));
    s().addLink(codeId('One'), codeId('Two'));
    const before = { one: startOf('One'), two: startOf('Two') };

    s().moveBy(codeId('Phase'), 5);
    expect(startOf('One')).toBe(before.one + 5);
    expect(startOf('Two')).toBe(before.two + 5); // relative offset preserved
  });

  it('rolls a summary up to span its children', () => {
    addActivities([
      ['Phase', 1],
      ['One', 3],
      ['Two', 4],
    ]);
    s().indent(codeId('One'));
    s().indent(codeId('Two'));
    const sum = s().schedule!.byId.get(codeId('Phase'))!;
    expect(sum.start - toWorkDay(DATA_DATE)).toBe(0);
    expect(sum.end - toWorkDay(DATA_DATE)).toBe(4); // the longer child
  });

  it('undoes and redoes every kind of edit', () => {
    addActivities([
      ['A', 5],
      ['B', 3],
    ]);
    s().addLink(codeId('A'), codeId('B'));
    const withLink = structuredClone(s().doc!);

    s().updateLink(s().doc!.links[0].id, { lag: 2 });
    expect(startOf('B')).toBe(7);
    s().undo();
    expect(startOf('B')).toBe(5);
    s().redo();
    expect(startOf('B')).toBe(7);

    s().undo(); // lag
    s().undo(); // link
    expect(s().doc!.links).toHaveLength(0);
    s().redo();
    expect(s().doc!.links.map((l) => l.fromId)).toEqual(withLink.links.map((l) => l.fromId));
  });

  it('deletes an activity together with its links and children', () => {
    addActivities([
      ['Phase', 1],
      ['Child', 2],
      ['Other', 1],
    ]);
    s().indent(codeId('Child'));
    s().addLink(codeId('Child'), codeId('Other'));
    expect(s().doc!.links).toHaveLength(1);

    s().deleteTask(codeId('Phase'));
    expect(s().doc!.tasks.map((t) => t.name)).toEqual(['Other']);
    expect(s().doc!.links).toHaveLength(0);
  });

  it('replaces predecessors from typed shorthand', () => {
    addActivities([
      ['A', 5],
      ['B', 3],
    ]);
    s().replacePredecessors(codeId('B'), [{ fromId: codeId('A'), type: 'SS', lag: 2 }]);
    expect(startOf('B')).toBe(2);
    s().replacePredecessors(codeId('B'), []);
    expect(startOf('B')).toBe(0);
  });

  it('turning an activity into a milestone zeroes its duration', () => {
    addActivities([['Gate', 4]]);
    s().setType(codeId('Gate'), 'milestone');
    const sch = s().schedule!.byId.get(codeId('Gate'))!;
    expect(sch.start).toBe(sch.end);
  });

  it('outdenting the last child turns the summary back into an activity', () => {
    addActivities([
      ['Phase', 2],
      ['Child', 2],
    ]);
    s().indent(codeId('Child'));
    expect(s().doc!.tasks.find((t) => t.name === 'Phase')!.type).toBe('summary');
    s().outdent(codeId('Child'));
    expect(s().doc!.tasks.find((t) => t.name === 'Phase')!.type).toBe('task');
  });
});
