import type { Row } from './rows';

/**
 * Summary groups are colour-coded. A top-level summary takes the next hue in
 * the palette by the order it appears in the outline; everything inside it —
 * nested summaries included — inherits that hue. The palette itself lives in
 * styles.css as --grp-N-*; this module only decides who gets which index.
 *
 * Critical activities ignore the group hue and are drawn in the critical
 * colour, so the critical path stays unmistakable (R-037).
 */
export const GROUP_HUES = 6;

export function groupHues(rows: Row[]): Map<string, number> {
  const hue = new Map<string, number>();
  for (const r of rows) {
    if (!r.groupId || hue.has(r.groupId)) continue;
    hue.set(r.groupId, hue.size % GROUP_HUES);
  }
  return hue;
}

/** ' g3' — the class suffix carrying a row's group colour, or '' when ungrouped. */
export function hueClass(row: Row, hues: Map<string, number>): string {
  const h = row.groupId === null ? undefined : hues.get(row.groupId);
  return h === undefined ? '' : ` g${h}`;
}
