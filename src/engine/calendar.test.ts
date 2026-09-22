import { describe, expect, it } from 'vitest';
import {
  calIndexFromWorkDay,
  formatWorkDay,
  isWeekend,
  isWeekendCalIndex,
  parseDateInput,
  toIso,
  toWorkDay,
  workDayFromCalIndex,
} from './calendar';

describe('working-day calendar', () => {
  it('indexes weekdays contiguously across a weekend', () => {
    expect(toIso(0)).toBe('2000-01-03'); // Monday, the epoch
    expect(toIso(4)).toBe('2000-01-07'); // Friday
    expect(toIso(5)).toBe('2000-01-10'); // next Monday, not Saturday
  });

  it('round-trips weekdays', () => {
    for (const iso of ['2026-03-12', '2026-01-01', '2000-01-03', '2030-12-31']) {
      if (isWeekend(iso)) continue;
      expect(toIso(toWorkDay(iso))).toBe(iso);
    }
  });

  it('handles dates before the epoch', () => {
    expect(toIso(-1)).toBe('1999-12-31'); // Friday
    expect(toWorkDay('1999-12-31')).toBe(-1);
  });

  it('snaps weekend dates in the direction asked for', () => {
    expect(toIso(toWorkDay('2026-03-14', 'forward'))).toBe('2026-03-16'); // Sat -> Mon
    expect(toIso(toWorkDay('2026-03-14', 'back'))).toBe('2026-03-13'); // Sat -> Fri
    expect(toIso(toWorkDay('2026-03-15', 'forward'))).toBe('2026-03-16'); // Sun -> Mon
  });

  it('a 5-day activity starting Friday finishes the following Thursday', () => {
    const start = toWorkDay('2026-03-13'); // Friday
    expect(toIso(start + 5 - 1)).toBe('2026-03-19'); // Thursday
  });

  it('parses the date formats a user would actually type', () => {
    const near = '2026-03-01';
    expect(parseDateInput('2026-03-12', near)).toBe('2026-03-12');
    expect(parseDateInput('12 Mar 26', near)).toBe('2026-03-12');
    expect(parseDateInput('12 March', near)).toBe('2026-03-12');
    expect(parseDateInput('3/12/26', near)).toBe('2026-03-12');
    expect(parseDateInput('gibberish', near)).toBeNull();
  });

  it('formats compactly', () => {
    expect(formatWorkDay(toWorkDay('2026-03-12'))).toBe('12 Mar 26');
  });
});

describe('calendar-index helpers', () => {
  it('maps working days onto the calendar with weekends in place', () => {
    expect(calIndexFromWorkDay(4) - calIndexFromWorkDay(0)).toBe(4); // Mon..Fri
    expect(calIndexFromWorkDay(5) - calIndexFromWorkDay(4)).toBe(3); // Fri -> Mon skips 2
    expect(isWeekendCalIndex(calIndexFromWorkDay(4) + 1)).toBe(true); // Saturday
    expect(workDayFromCalIndex(calIndexFromWorkDay(7))).toBe(7);
  });
});
