import { ROW_H, type Row } from './rows';

export interface DropPlan {
  /** Gap index in the visible outline the block lands in: 0 … rows.length. */
  slot: number;
  /** Outline depth the block will sit at — what the pointer's x chooses. */
  depth: number;
  parentId: string | null;
  /** Position among the destination parent's remaining children. */
  index: number;
}

/** Where the name column's text starts, and one indent step. Mirrors TaskTable. */
export const NAME_X = 62;
export const INDENT = 15;

/**
 * Turn a pointer position into a drop: which gap, and how deeply nested.
 *
 * Depth is chosen by the pointer's x, bounded by what the outline allows —
 * never deeper than one level inside the row above, never shallower than the
 * row below (which would orphan it from its own parent). Returns null when the
 * drop is impossible, which is only ever "into its own subtree".
 */
export function dropPlan(
  rows: Row[],
  moving: Set<string>,
  y: number,
  wantDepth: number,
): DropPlan | null {
  const slot = Math.max(0, Math.min(rows.length, Math.round(y / ROW_H)));

  // The neighbours that decide the legal depth range are the ones staying put.
  let above: Row | null = null;
  for (let i = slot - 1; i >= 0; i--) {
    if (!moving.has(rows[i].task.id)) {
      above = rows[i];
      break;
    }
  }
  let below: Row | null = null;
  for (let i = slot; i < rows.length; i++) {
    if (!moving.has(rows[i].task.id)) {
      below = rows[i];
      break;
    }
  }

  const maxDepth = above ? above.depth + 1 : 0;
  const minDepth = below ? Math.min(below.depth, maxDepth) : 0;
  const depth = Math.max(minDepth, Math.min(maxDepth, wantDepth));

  let parentId: string | null = null;
  if (depth > 0 && above) {
    if (depth > above.depth) {
      parentId = above.task.id;
    } else {
      // Walk up the ancestors of `above` to the row sitting at this depth.
      let cur: Row | null = above;
      while (cur && cur.depth > depth) cur = parentRow(rows, cur);
      parentId = cur ? cur.task.parentId : null;
    }
  }
  if (parentId && moving.has(parentId)) return null;

  const index = rows
    .slice(0, slot)
    .filter((r) => !moving.has(r.task.id) && r.task.parentId === parentId).length;

  return { slot, depth, parentId, index };
}

function parentRow(rows: Row[], row: Row): Row | null {
  return rows.find((r) => r.task.id === row.task.parentId) ?? null;
}
