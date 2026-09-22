import type { Iso, WorkDay } from './types';

/** Monday, 3 January 2000. Working-day index 0. */
const EPOCH_MS = Date.UTC(2000, 0, 3);
const DAY_MS = 86_400_000;

const floorDiv = (a: number, b: number) => Math.floor(a / b);

function calendarDaysFromIso(iso: Iso): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - EPOCH_MS) / DAY_MS);
}

function isoFromCalendarDays(days: number): Iso {
  const d = new Date(EPOCH_MS + days * DAY_MS);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/** 0 = Monday … 6 = Sunday. Correct for dates before the epoch too. */
export function dayOfWeek(days: number): number {
  return days - floorDiv(days, 7) * 7;
}

export function isWeekend(iso: Iso): boolean {
  return dayOfWeek(calendarDaysFromIso(iso)) > 4;
}

/**
 * Calendar date -> working-day index. Weekend dates have no index of their own,
 * so they snap: 'forward' to the next Monday (what you want for a start date),
 * 'back' to the previous Friday (what you want for a finish date).
 */
export function toWorkDay(iso: Iso, snap: 'forward' | 'back' = 'forward'): WorkDay {
  let days = calendarDaysFromIso(iso);
  const dow = dayOfWeek(days);
  if (dow > 4) days += snap === 'forward' ? 7 - dow : 4 - dow;
  const week = floorDiv(days, 7);
  return week * 5 + (days - week * 7);
}

/** Working-day index -> calendar date. Always lands on a weekday. */
export function toIso(n: WorkDay): Iso {
  const week = floorDiv(n, 5);
  return isoFromCalendarDays(week * 7 + (n - week * 5));
}

export function todayIso(): Iso {
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '12 Mar 26' — compact enough for a dense table. */
export function formatWorkDay(n: WorkDay): string {
  const iso = toIso(n);
  const [y, m, d] = iso.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y.slice(2)}`;
}

export function monthLabel(iso: Iso): string {
  const [y, m] = iso.split('-');
  return `${MONTHS[Number(m) - 1]} ${y.slice(2)}`;
}

/** Accepts '2026-03-12', '12 Mar 26', '3/12/26'. Returns null if unparseable. */
export function parseDateInput(text: string, nearIso: Iso): Iso | null {
  const s = text.trim();
  if (!s) return null;

  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  const named = /^(\d{1,2})\s+([a-z]{3,})\.?\s*(\d{2,4})?$/i.exec(s);
  if (named) {
    const mi = MONTHS.findIndex((x) => x.toLowerCase() === named[2].slice(0, 3).toLowerCase());
    if (mi < 0) return null;
    const y = resolveYear(named[3], nearIso);
    return `${y}-${String(mi + 1).padStart(2, '0')}-${named[1].padStart(2, '0')}`;
  }

  const slash = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(s);
  if (slash) {
    const y = resolveYear(slash[3], nearIso);
    return `${y}-${slash[1].padStart(2, '0')}-${slash[2].padStart(2, '0')}`;
  }

  return null;
}

function resolveYear(raw: string | undefined, nearIso: Iso): string {
  if (!raw) return nearIso.slice(0, 4);
  return raw.length <= 2 ? `20${raw.padStart(2, '0')}` : raw;
}

/* ---------------------------------------------------------------------------
 * Calendar-index helpers.
 *
 * The engine works in working days; the Gantt draws a calendar axis so that
 * weekends are visible where they fall. These convert between the two. A
 * calendar index is a count of days from the same epoch.
 * ------------------------------------------------------------------------- */

export function calIndexFromIso(iso: Iso): number {
  return calendarDaysFromIso(iso);
}

export function isoFromCalIndex(c: number): Iso {
  return isoFromCalendarDays(c);
}

export function calIndexFromWorkDay(n: WorkDay): number {
  const week = floorDiv(n, 5);
  return week * 7 + (n - week * 5);
}

export function isWeekendCalIndex(c: number): boolean {
  return dayOfWeek(c) > 4;
}

/** Calendar index -> working day, snapping off weekends in the given direction. */
export function workDayFromCalIndex(c: number, snap: 'forward' | 'back' = 'forward'): WorkDay {
  return toWorkDay(isoFromCalendarDays(c), snap);
}
