import {
  calIndexFromIso,
  calIndexFromWorkDay,
  isoFromCalIndex,
  isWeekendCalIndex,
  monthLabel,
  todayIso,
} from '../engine/calendar';
import type { ScheduleResult, WorkDay } from '../engine/types';

export type Scale = 'day' | 'week' | 'month';

export interface Timeline {
  origin: number; // calendar index at x = 0
  days: number; // calendar days drawn
  pxPerDay: number;
  width: number;
  scale: Scale;
  x(day: WorkDay): number;
  xCal(cal: number): number;
  calAtX(x: number): number;
}

const PAD_BEFORE = 4;
const PAD_AFTER = 12;

/** A label drawn left of a bar: the bar's start, and the pixels it needs before it. */
export interface LeftReach {
  start: WorkDay;
  px: number;
}

export function buildTimeline(
  schedule: ScheduleResult | null,
  pxPerDay: number,
  minWidth: number,
  leftLabels: readonly LeftReach[] = [],
): Timeline {
  const startWork = schedule?.projectStart ?? 0;
  const endWork = Math.max(schedule?.projectEnd ?? startWork, startWork + 20);
  const todayCal = calIndexFromIso(todayIso());

  // Start early enough that every left-side label fits, not just the bars:
  // a long name left of an early bar would otherwise run off the chart.
  let origin = Math.min(calIndexFromWorkDay(startWork) - PAD_BEFORE, todayCal - 2);
  for (const l of leftLabels) {
    origin = Math.min(origin, calIndexFromWorkDay(l.start) - Math.ceil(l.px / pxPerDay));
  }
  const last = Math.max(calIndexFromWorkDay(endWork) + PAD_AFTER, todayCal + 2);
  const days = Math.max(last - origin, Math.ceil(minWidth / pxPerDay));

  const scale: Scale = pxPerDay >= 14 ? 'day' : pxPerDay >= 5 ? 'week' : 'month';

  return {
    origin,
    days,
    pxPerDay,
    width: days * pxPerDay,
    scale,
    x: (day) => (calIndexFromWorkDay(day) - origin) * pxPerDay,
    xCal: (cal) => (cal - origin) * pxPerDay,
    calAtX: (x) => origin + x / pxPerDay,
  };
}

export interface Tick {
  x: number;
  label: string;
  cal: number;
}

/** Weekend bands, in calendar-index runs, so the Gantt draws one rect per weekend. */
export function weekendBands(tl: Timeline): Array<{ x: number; w: number }> {
  if (tl.scale === 'month') return [];
  const out: Array<{ x: number; w: number }> = [];
  for (let c = tl.origin; c < tl.origin + tl.days; c++) {
    if (!isWeekendCalIndex(c)) continue;
    const prev = out.at(-1);
    const x = tl.xCal(c);
    if (prev && Math.abs(prev.x + prev.w - x) < 0.01) prev.w += tl.pxPerDay;
    else out.push({ x, w: tl.pxPerDay });
  }
  return out;
}

export function minorTicks(tl: Timeline): Tick[] {
  const out: Tick[] = [];
  for (let c = tl.origin; c <= tl.origin + tl.days; c++) {
    const iso = isoFromCalIndex(c);
    const dom = Number(iso.slice(8, 10));
    if (tl.scale === 'day') {
      out.push({ x: tl.xCal(c), label: String(dom), cal: c });
    } else if (tl.scale === 'week') {
      if (isMonday(c)) out.push({ x: tl.xCal(c), label: String(dom), cal: c });
    } else if (dom === 1) {
      out.push({ x: tl.xCal(c), label: monthLabel(iso).slice(0, 3), cal: c });
    }
  }
  return out;
}

export function majorTicks(tl: Timeline): Tick[] {
  const out: Tick[] = [];
  for (let c = tl.origin; c <= tl.origin + tl.days; c++) {
    const iso = isoFromCalIndex(c);
    if (tl.scale === 'month') {
      if (iso.slice(5) === '01-01') out.push({ x: tl.xCal(c), label: iso.slice(0, 4), cal: c });
    } else if (iso.slice(8, 10) === '01') {
      out.push({ x: tl.xCal(c), label: monthLabel(iso), cal: c });
    }
  }
  // Always label the leftmost span, even when its boundary is off-screen.
  const first = out[0];
  if (!first || first.x > 4) {
    const iso = isoFromCalIndex(tl.origin);
    out.unshift({
      x: 0,
      label: tl.scale === 'month' ? iso.slice(0, 4) : monthLabel(iso),
      cal: tl.origin,
    });
  }
  return out;
}

export function todayX(tl: Timeline): number | null {
  const c = calIndexFromIso(todayIso());
  if (c < tl.origin || c > tl.origin + tl.days) return null;
  return tl.xCal(c);
}

function isMonday(cal: number): boolean {
  const d = cal - Math.floor(cal / 7) * 7;
  return d === 0;
}
