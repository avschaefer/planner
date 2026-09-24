import type { LinkType } from '../engine/types';
import { ROW_H } from './rows';

export interface Anchor {
  x: number;
  y: number;
  /** +1 leaves/enters on the right, -1 on the left. */
  dir: 1 | -1;
}

/** Which end of each bar a relationship type connects. */
export function anchorsFor(type: LinkType): { from: 'start' | 'end'; to: 'start' | 'end' } {
  switch (type) {
    case 'FS':
      return { from: 'end', to: 'start' };
    case 'SS':
      return { from: 'start', to: 'start' };
    case 'FF':
      return { from: 'end', to: 'end' };
    case 'SF':
      return { from: 'start', to: 'end' };
  }
}

/**
 * Orthogonal routing. Right angles read as logic; curves read as decoration and
 * tangle faster. `lane` nudges the vertical run so parallel links don't stack
 * on the same pixel column.
 */
export function routeLink(from: Anchor, to: Anchor, lane = 0): string {
  const g = 9 + lane * 4;
  const p: Array<[number, number]> = [[from.x, from.y]];
  const exit: [number, number] = [from.x + from.dir * g, from.y];
  const entry: [number, number] = [to.x - to.dir * g, to.y];
  p.push(exit);

  const canGoDirect = to.dir > 0 ? entry[0] >= exit[0] : entry[0] <= exit[0];
  if (canGoDirect) {
    p.push([entry[0], from.y]);
  } else {
    // Detour through the gap between rows, where no bar is ever drawn.
    const lanY = from.y + (to.y > from.y ? ROW_H / 2 : -ROW_H / 2);
    p.push([exit[0], lanY], [entry[0], lanY]);
  }
  p.push(entry, [to.x, to.y]);

  return p.map(([x, y], i) => `${i ? 'L' : 'M'}${round(x)} ${round(y)}`).join(' ');
}

export function arrowPoints(to: Anchor): string {
  const s = 3.5;
  const tipX = to.x;
  const backX = to.x - to.dir * (s + 1.5);
  return `${round(tipX)},${round(to.y)} ${round(backX)},${round(to.y - s)} ${round(backX)},${round(to.y + s)}`;
}

const round = (n: number) => Math.round(n * 10) / 10;

export interface Route {
  d: string;
  arrow: string;
}

/** How far into a successor bar the elbow drops, so the arrow lands on the bar, not its edge. */
const ELBOW_INSET = 6;

/**
 * A dependency line as scheduling tools draw it.
 *
 * Finish-to-start onto a successor that starts at or after the link leaves:
 * one elbow — right along the predecessor's row, then straight down (or up)
 * onto the successor, arrowhead pointing into it. Lag needs no special case:
 * it moves the successor right, so the horizontal run grows by itself.
 *
 * Anything else — start-anchored sources, finish-anchored successors, a
 * successor that begins before the link leaves (negative lag) — cannot be one
 * elbow without doubling back, and takes the stepped route.
 *
 * `targetHalf` is half the drawn height of the successor's shape, so the arrow
 * stops at its edge; `targetPoint` is true for a milestone, which is entered at
 * its centre rather than inset from its start.
 */
export function routeDependency(
  from: Anchor,
  to: Anchor,
  targetHalf: number,
  targetPoint: boolean,
  lane = 0,
): Route {
  const turnX = targetPoint ? to.x : to.x + ELBOW_INSET;
  const elbow = from.dir === 1 && to.dir === 1 && from.y !== to.y && turnX >= from.x + 3;

  if (!elbow) {
    return { d: routeLink(from, to, lane), arrow: arrowPoints(to) };
  }

  const down = to.y > from.y ? 1 : -1;
  const edgeY = to.y - down * targetHalf;
  const d = `M${round(from.x)} ${round(from.y)} H${round(turnX)} V${round(edgeY)}`;
  const s = 3.5;
  const backY = edgeY - down * (s + 1.5);
  const arrow = `${round(turnX)},${round(edgeY)} ${round(turnX - s)},${round(backY)} ${round(turnX + s)},${round(backY)}`;
  return { d, arrow };
}
