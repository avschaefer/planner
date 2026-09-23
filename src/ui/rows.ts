import { outline, type OutlineRow } from '../engine/graph';
import type { Task } from '../engine/types';

export const ROW_H = 30;
export const HEAD_H = 48;
export const BAR_H = 16;
export const BAR_Y = (ROW_H - BAR_H) / 2;

export type Row = OutlineRow;

/**
 * The single ordered list both the table and the Gantt render. Sharing it is
 * the whole synchronisation mechanism — there is no scroll-syncing of two
 * independently built lists.
 */
export function visibleRows(tasks: Task[]): Row[] {
  return outline(tasks, true);
}
