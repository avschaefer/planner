import { treeOrder } from '../engine/graph';
import type { Task } from '../engine/types';

export const ROW_H = 28;
export const HEAD_H = 44;
export const BAR_H = 15;
export const BAR_Y = (ROW_H - BAR_H) / 2;

export interface Row {
  task: Task;
  depth: number;
}

/**
 * The single ordered list both the table and the Gantt render. Sharing it is
 * the whole synchronisation mechanism — there is no scroll-syncing of two
 * independently built lists.
 */
export function visibleRows(tasks: Task[]): Row[] {
  const ordered = treeOrder(tasks);
  const byId = new Map(tasks.map((t) => [t.id, t]));

  const hidden = (t: Task): boolean => {
    let p = t.parentId ? byId.get(t.parentId) : undefined;
    while (p) {
      if (p.collapsed) return true;
      p = p.parentId ? byId.get(p.parentId) : undefined;
    }
    return false;
  };

  const depthOf = (t: Task): number => {
    let d = 0;
    let p = t.parentId ? byId.get(t.parentId) : undefined;
    while (p) {
      d++;
      p = p.parentId ? byId.get(p.parentId) : undefined;
    }
    return d;
  };

  return ordered.filter((t) => !hidden(t)).map((t) => ({ task: t, depth: depthOf(t) }));
}
