import { treeOrder } from './graph';
import type { Task } from './types';

/**
 * Human-visible activity numbers: 1, 2, 3 … down the outline, ignoring depth.
 *
 * Numbering covers every task, not just the visible ones, so collapsing a group
 * leaves a gap rather than renumbering everything below it. That is what MS
 * Project does, and it is what makes typed predecessors ("3FS+2d") stable while
 * you browse. The number is derived, never stored — insert or delete a row and
 * everything below renumbers, exactly as in MSP.
 */
export function rowIds(tasks: Task[]): Map<string, number> {
  return new Map(treeOrder(tasks).map((t, i) => [t.id, i + 1]));
}

/** Reverse lookup for parsing typed predecessors. */
export function tasksByRowId(tasks: Task[]): Map<number, string> {
  return new Map(treeOrder(tasks).map((t, i) => [i + 1, t.id]));
}
