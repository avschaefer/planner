import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  calIndexFromIso,
  dayOfWeek,
  isWeekendCalIndex,
  isoFromCalIndex,
  parseDateInput,
  todayIso,
} from '../engine/calendar';
import type { Iso } from '../engine/types';
import { Button } from './Button';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

interface Props {
  anchor: DOMRect;
  /** The date the cell currently shows. */
  valueIso: Iso;
  field: 'start' | 'finish';
  hasConstraint: boolean;
  onCommit(iso: Iso): void;
  onClear(): void;
  onClose(): void;
  onTab(back: boolean): void;
}

/**
 * Click a Start or Finish cell and pick a date. Typing still works — the field
 * at the top takes anything `parseDateInput` understands — so the picker adds a
 * way in without taking one away.
 *
 * Weekends are inert: the engine has no index for them (D-005), and a schedule
 * that starts on a Saturday is a lie.
 */
export function DateField({
  anchor,
  valueIso,
  field,
  hasConstraint,
  onCommit,
  onClear,
  onClose,
  onTab,
}: Props) {
  const [text, setText] = useState(valueIso);
  const [cursor, setCursor] = useState(() => calIndexFromIso(valueIso));
  const [month, setMonth] = useState(() => valueIso.slice(0, 7));
  const inputRef = useRef<HTMLInputElement>(null);
  const today = calIndexFromIso(todayIso());
  const selected = calIndexFromIso(valueIso);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  /* Keep the visible month with the cursor as the arrows walk out of it. */
  useEffect(() => {
    setMonth(isoFromCalIndex(cursor).slice(0, 7));
  }, [cursor]);

  const commitCal = (cal: number) => {
    if (isWeekendCalIndex(cal)) return;
    onCommit(isoFromCalIndex(cal));
    onClose();
  };

  /** Arrow keys walk working days: weekends are stepped over, not landed on. */
  const step = (days: number) => {
    let next = cursor + days;
    const dir = days > 0 ? 1 : -1;
    while (isWeekendCalIndex(next)) next += dir;
    setCursor(next);
  };

  const [y, m] = month.split('-').map(Number);
  const firstCal = calIndexFromIso(`${month}-01`);
  const gridStart = firstCal - dayOfWeek(firstCal);
  const cells = Array.from({ length: 42 }, (_, i) => gridStart + i);

  const shiftMonth = (delta: number) => {
    const nm = m - 1 + delta;
    const ny = y + Math.floor(nm / 12);
    const mm = ((nm % 12) + 12) % 12;
    setMonth(`${ny}-${String(mm + 1).padStart(2, '0')}`);
  };

  const onKey = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        onClose();
        return;
      case 'Enter': {
        e.preventDefault();
        // Whatever is in the text field wins if it parses; otherwise the grid.
        const typed = parseDateInput(text, valueIso);
        if (typed) {
          onCommit(typed);
          onClose();
        } else commitCal(cursor);
        return;
      }
      case 'ArrowLeft': e.preventDefault(); step(-1); return;
      case 'ArrowRight': e.preventDefault(); step(1); return;
      case 'ArrowUp': e.preventDefault(); step(-7); return;
      case 'ArrowDown': e.preventDefault(); step(7); return;
      case 'Tab': {
        e.preventDefault();
        const typed = parseDateInput(text, valueIso);
        if (typed) onCommit(typed);
        onTab(e.shiftKey);
        return;
      }
      case 'PageUp': e.preventDefault(); shiftMonth(-1); return;
      case 'PageDown': e.preventDefault(); shiftMonth(1); return;
    }
  };

  const left = Math.min(anchor.left, window.innerWidth - 262);
  const top =
    anchor.bottom + 330 > window.innerHeight ? Math.max(8, anchor.top - 330) : anchor.bottom + 4;

  /* Portalled to the body: the table's scroll container is transformed, and a
     transform makes position:fixed resolve against it instead of the viewport. */
  return createPortal(
    <>
      <div className="pop-backdrop" onPointerDown={onClose} />
      <div className="pop datepick" style={{ left, top }} onKeyDown={onKey}>
        <h4>{field === 'start' ? 'Start' : 'Finish'}</h4>
        <input
          ref={inputRef}
          value={text}
          placeholder="12 Mar 26"
          onChange={(e) => {
            setText(e.target.value);
            const iso = parseDateInput(e.target.value, valueIso);
            if (iso) setCursor(calIndexFromIso(iso));
          }}
        />

        <div className="dp-head">
          <Button variant="ghost" size="sm" icon onClick={() => shiftMonth(-1)} title="Previous month">‹</Button>
          <span className="m">{MONTHS[m - 1]} {y}</span>
          <Button variant="ghost" size="sm" icon onClick={() => shiftMonth(1)} title="Next month">›</Button>
        </div>

        <div className="dp-grid">
          {DOW.map((d, i) => (
            <div className="dp-dow" key={i}>{d}</div>
          ))}
          {cells.map((cal) => {
            const iso = isoFromCalIndex(cal);
            const weekend = isWeekendCalIndex(cal);
            const cls = [
              'dp-day',
              iso.slice(0, 7) !== month ? 'other' : '',
              weekend ? 'weekend' : '',
              cal === today ? 'today' : '',
              cal === cursor ? 'cursor' : '',
              cal === selected ? 'on' : '',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <div
                key={cal}
                className={cls}
                onPointerDown={(e) => {
                  e.preventDefault();
                  if (!weekend) commitCal(cal);
                }}
              >
                {Number(iso.slice(8, 10))}
              </div>
            );
          })}
        </div>

        <div className="dp-foot">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              let t = today;
              while (isWeekendCalIndex(t)) t += 1;
              commitCal(t);
            }}
          >
            Today
          </Button>
          {hasConstraint && (
            <Button
              variant="ghost"
              size="sm"
              title="Remove the Start No Earlier Than constraint so the links drive this activity again"
              onClick={() => {
                onClear();
                onClose();
              }}
            >
              Remove constraint
            </Button>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}
