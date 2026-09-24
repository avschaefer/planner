import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { formatWorkDay, parseDateInput, toIso, toWorkDay } from '../engine/calendar';
import { descendants } from '../engine/graph';
import { rowIds, tasksByRowId } from '../engine/ids';
import { formatPredecessors, parsePredecessors } from '../engine/predecessors';
import type { Iso, ScheduleResult } from '../engine/types';
import { useStore } from '../store/store';
import { hueClass } from './colors';
import { DateField } from './DateField';
import { dropPlan, INDENT, NAME_X, type DropPlan } from './reorder';
import { ROW_H, type Row } from './rows';

export type Field = 'name' | 'start' | 'finish' | 'duration' | 'pred';

/**
 * Shift / Cmd / Ctrl + click is a selection gesture, not an edit — without this
 * every modified click in the table opened a cell editor instead of extending
 * or toggling the selection.
 */
const selecting = (e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) =>
  e.shiftKey || e.metaKey || e.ctrlKey;
export interface Editing {
  taskId: string;
  field: Field;
}

export const COLUMNS: Array<{ key: Field | 'code' | 'float' | 'grip'; label: string; width: number }> = [
  { key: 'grip', label: '', width: 18 },
  { key: 'code', label: '#', width: 36 },
  { key: 'name', label: 'Activity', width: 0 },
  { key: 'start', label: 'Start', width: 84 },
  { key: 'finish', label: 'Finish', width: 84 },
  { key: 'duration', label: 'Dur', width: 48 },
  { key: 'float', label: 'Float', width: 54 },
  { key: 'pred', label: 'Predecessors', width: 122 },
];

const EDITABLE: Field[] = ['name', 'start', 'finish', 'duration', 'pred'];

interface Props {
  rows: Row[];
  hues: Map<string, number>;
  schedule: ScheduleResult;
  editing: Editing | null;
  setEditing(e: Editing | null): void;
  onAdd(): void;
}

export function TaskTableHead() {
  return (
    <div className="thead">
      {COLUMNS.map((c) => (
        <div
          key={c.key}
          className={`th${c.key === 'duration' || c.key === 'float' || c.key === 'code' ? ' num' : ''}`}
          style={c.width ? { width: c.width, flex: 'none' } : { flex: 1, minWidth: 160 }}
        >
          {c.label}
        </div>
      ))}
    </div>
  );
}

export function TaskTable({ rows, hues, schedule, editing, setEditing, onAdd }: Props) {
  const doc = useStore((s) => s.doc)!;
  const selection = useStore((s) => s.selection);
  const store = useStore();

  const fmt = useStore((s) => s.settings.dateFormat);
  const ids = useMemo(() => rowIds(doc.tasks), [doc.tasks]);
  const byRow = useMemo(() => tasksByRowId(doc.tasks), [doc.tasks]);

  /* Drag the grip to move rows up, down, and in and out of summaries. */
  const rootRef = useRef<HTMLDivElement>(null);
  type RowDrag = { ids: string[]; moving: Set<string>; plan: DropPlan | null };
  const [rowDrag, setRowDrag] = useState<RowDrag | null>(null);
  const rowDragRef = useRef<RowDrag | null>(null);
  rowDragRef.current = rowDrag;

  useEffect(() => {
    if (!rowDrag) return;
    const move = (e: PointerEvent) => {
      const box = rootRef.current?.getBoundingClientRect();
      if (!box) return;
      const wantDepth = Math.round((e.clientX - box.left - NAME_X) / INDENT);
      setRowDrag((cur) =>
        cur ? { ...cur, plan: dropPlan(rows, cur.moving, e.clientY - box.top, wantDepth) } : cur,
      );
    };
    const up = () => {
      const cur = rowDragRef.current;
      setRowDrag(null);
      if (cur?.plan) store.reparent(cur.ids, cur.plan.parentId, cur.plan.index);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setRowDrag(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', key, true);
    };
  }, [rowDrag, rows, store]);

  function startRowDrag(taskId: string, e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const multi = selection.taskIds.includes(taskId) && selection.taskIds.length > 1;
    const ids = multi ? [...selection.taskIds] : [taskId];
    if (!multi) store.selectTask(taskId, 'replace');
    const moving = new Set(ids);
    for (const id of ids) for (const t of descendants(doc.tasks, id)) moving.add(t.id);
    setRowDrag({ ids, moving, plan: null });
  }

  /* Press and drag across rows — from the # gutter or anywhere else — sweeps a range. */
  const [sweeping, setSweeping] = useState(false);
  useEffect(() => {
    if (!sweeping) return;
    const up = () => setSweeping(false);
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, [sweeping]);

  function commitField(taskId: string, field: Field, raw: string) {
    const s = schedule.byId.get(taskId);
    const task = doc.tasks.find((t) => t.id === taskId);
    if (!task || !s) return;

    switch (field) {
      case 'name':
        store.setName(taskId, raw.trim());
        break;
      case 'duration': {
        const n = Number(raw.replace(/[^\d.-]/g, ''));
        if (Number.isFinite(n)) store.setDuration(taskId, n);
        break;
      }
      case 'start':
      case 'finish': {
        const iso = parseDateInput(raw, toIso(s.start));
        if (iso) commitDate(taskId, field, iso);
        break;
      }
      case 'pred': {
        const parsed = parsePredecessors(raw, (n) => byRow.get(n));
        if (parsed.error) store.notify(parsed.error);
        else store.replacePredecessors(taskId, parsed.links);
        break;
      }
    }
  }

  function commitDate(taskId: string, field: 'start' | 'finish', iso: Iso) {
    if (field === 'start') store.setStart(taskId, toWorkDay(iso, 'forward'));
    else store.setFinish(taskId, toWorkDay(iso, 'back'));
  }

  function valueFor(taskId: string, field: Field): string {
    const s = schedule.byId.get(taskId);
    const task = doc.tasks.find((t) => t.id === taskId);
    if (!task || !s) return '';
    switch (field) {
      case 'name':
        return task.name;
      case 'start':
        return toIso(s.start);
      case 'finish':
        return toIso(Math.max(s.start, s.end - 1));
      case 'duration':
        return String(task.type === 'summary' ? Math.max(0, s.end - s.start) : task.duration);
      case 'pred':
        return formatPredecessors(
          doc.links.filter((l) => l.toId === taskId),
          (id) => ids.get(id),
        );
    }
  }

  /** Enter in the last row's name adds another activity — the quick-add loop. */
  function advance(taskId: string, field: Field) {
    const i = rows.findIndex((r) => r.task.id === taskId);
    if (field === 'name' && i === rows.length - 1) {
      setEditing(null);
      onAdd();
      return;
    }
    const next = rows[i + 1];
    if (next) setEditing({ taskId: next.task.id, field });
    else setEditing(null);
  }

  function nextField(taskId: string, field: Field, back: boolean) {
    const i = EDITABLE.indexOf(field) + (back ? -1 : 1);
    const f = EDITABLE[i];
    setEditing(f ? { taskId, field: f } : null);
  }

  function pick(taskId: string, e: React.PointerEvent | React.MouseEvent) {
    store.selectTask(taskId, e.shiftKey ? 'range' : e.metaKey || e.ctrlKey ? 'toggle' : 'replace');
  }

  return (
    <div className="tbody" ref={rootRef}>
      {rows.map((row) => {
        const { task } = row;
        const s = schedule.byId.get(task.id);
        const selected = selection.taskIds.includes(task.id);
        const isSummary = task.type === 'summary';
        const hue = hueClass(row, hues);

        return (
          <div
            key={task.id}
            className={
              `trow${selected ? ' sel' : ''}${isSummary ? ' summary' : ''}` +
              `${rowDrag?.moving.has(task.id) ? ' moving' : ''}` +
              `${task.type === 'milestone' ? ' milestone' : ''}${s?.critical ? ' critical' : ''}${hue}`
            }
            style={{ height: ROW_H }}
            onPointerDown={(e) => {
              pick(task.id, e);
              // Press and drag across rows selects the range. If the pointer
              // never leaves the cell, the click still lands and opens its
              // editor, so nothing is taken away by this.
              if (!selecting(e)) setSweeping(true);
            }}
            onPointerEnter={() => sweeping && store.selectTask(task.id, 'range')}
          >
            <div
              className="td grip"
              style={{ width: 18, flex: 'none' }}
              title="Drag to move the row — sideways to nest it"
              onPointerDown={(e) => startRowDrag(task.id, e)}
            >
              <Grip />
            </div>

            {/* Selection and sweeping are handled once, on the row. */}
            <div className="td code" style={{ width: 36, flex: 'none' }}>
              {ids.get(task.id)}
            </div>

            <div
              className={`td editable${editing?.taskId === task.id && editing.field === 'name' ? ' editing' : ''}`}
              style={{ flex: 1, minWidth: 160, paddingLeft: 8 + row.depth * 15 }}
              onClick={(e) => !selecting(e) && setEditing({ taskId: task.id, field: 'name' })}
            >
              <div className="tname">
                {isSummary ? (
                  <span
                    className={`twist${task.collapsed ? ' collapsed' : ''}`}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      store.toggleCollapsed(task.id);
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Chevron />
                  </span>
                ) : (
                  <span style={{ width: 15, flex: 'none' }} />
                )}
                {row.depth > 0 && <span className={`rail${hue}`} />}
                {editing?.taskId === task.id && editing.field === 'name' ? (
                  <CellInput
                    initial={task.name}
                    placeholder="Activity name"
                    onCommit={(v) => commitField(task.id, 'name', v)}
                    onDone={(how) => {
                      if (how === 'enter') advance(task.id, 'name');
                      else if (how === 'tab' || how === 'shift-tab')
                        nextField(task.id, 'name', how === 'shift-tab');
                      else {
                        setEditing(null);
                        // Backing out of a never-named activity removes it, so
                        // the quick-add loop doesn't leave a blank row behind.
                        if (how === 'escape' && !task.name) store.deleteTask(task.id);
                      }
                    }}
                  />
                ) : (
                  <span className={`label${task.name ? '' : ' untitled'}`}>
                    {task.name || 'Untitled activity'}
                  </span>
                )}
              </div>
            </div>

            {(['start', 'finish'] as const).map((field) => (
              <DateCell
                key={field}
                field={field}
                width={84}
                editable={!isSummary}
                editing={editing?.taskId === task.id && editing.field === field}
                pinned={field === 'start' && !!task.constraint && !isSummary}
                display={
                  s ? formatWorkDay(field === 'start' ? s.start : Math.max(s.start, s.end - 1), fmt) : ''
                }
                valueIso={valueFor(task.id, field)}
                hasConstraint={!!task.constraint}
                onOpen={() => setEditing({ taskId: task.id, field })}
                onCommit={(iso) => commitDate(task.id, field, iso)}
                onClear={() => store.clearConstraint(task.id)}
                onClose={() => setEditing(null)}
                onTab={(back) => nextField(task.id, field, back)}
              />
            ))}

            <EditCell
              className="dur"
              width={48}
              editable={!isSummary}
              editing={editing?.taskId === task.id && editing.field === 'duration'}
              display={isSummary ? '' : `${task.duration}d`}
              value={valueFor(task.id, 'duration')}
              onOpen={() => setEditing({ taskId: task.id, field: 'duration' })}
              onCommit={(v) => commitField(task.id, 'duration', v)}
              onDone={(how) => {
                if (how === 'enter') advance(task.id, 'duration');
                else if (how === 'tab' || how === 'shift-tab')
                  nextField(task.id, 'duration', how === 'shift-tab');
                else setEditing(null);
              }}
            />

            <div
              className={`td float${s?.critical && !isSummary ? ' zero' : ''}`}
              style={{ width: 54, flex: 'none' }}
              title={s?.critical ? 'On the critical path — no float' : 'Total float'}
            >
              {!s || isSummary ? '' : s.critical ? '—' : `${s.totalFloat}d`}
            </div>

            <EditCell
              className="pred"
              editable
              editing={editing?.taskId === task.id && editing.field === 'pred'}
              display={valueFor(task.id, 'pred')}
              value={valueFor(task.id, 'pred')}
              onOpen={() => setEditing({ taskId: task.id, field: 'pred' })}
              onCommit={(v) => commitField(task.id, 'pred', v)}
              onDone={(how) => {
                if (how === 'enter') advance(task.id, 'pred');
                else if (how === 'tab' || how === 'shift-tab')
                  nextField(task.id, 'pred', how === 'shift-tab');
                else setEditing(null);
              }}
            />
          </div>
        );
      })}

      {rowDrag?.plan && (
        <div
          className="dropline"
          style={{
            top: rowDrag.plan.slot * ROW_H - 1,
            left: NAME_X + rowDrag.plan.depth * INDENT,
          }}
        />
      )}

      <div className="addrow" onClick={onAdd}>
        <span style={{ fontSize: 15, lineHeight: 1 }}>+</span> Add activity
      </div>
    </div>
  );
}

/** A text cell that swaps to an input while it is being edited. */
function EditCell({
  className,
  width,
  editable,
  editing,
  display,
  value,
  onOpen,
  onCommit,
  onDone,
}: {
  className: string;
  width?: number;
  editable: boolean;
  editing: boolean;
  display: string;
  value: string;
  onOpen(): void;
  onCommit(v: string): void;
  onDone(how: 'enter' | 'tab' | 'shift-tab' | 'escape' | 'blur'): void;
}) {
  return (
    <div
      className={`td ${className}${editable ? ' editable' : ''}${editing ? ' editing' : ''}`}
      style={width ? { width, flex: 'none' } : { flex: '0 0 122px' }}
      onClick={(e) => editable && !selecting(e) && onOpen()}
    >
      {editing ? <CellInput initial={value} onCommit={onCommit} onDone={onDone} /> : display}
    </div>
  );
}

/** A date cell: shows a formatted date, opens the picker on click. */
function DateCell({
  field,
  width,
  editable,
  editing,
  pinned,
  display,
  valueIso,
  hasConstraint,
  onOpen,
  onCommit,
  onClear,
  onClose,
  onTab,
}: {
  field: 'start' | 'finish';
  width: number;
  editable: boolean;
  editing: boolean;
  pinned: boolean;
  display: string;
  valueIso: Iso;
  hasConstraint: boolean;
  onOpen(): void;
  onCommit(iso: Iso): void;
  onClear(): void;
  onClose(): void;
  onTab(back: boolean): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);

  useEffect(() => {
    setAnchor(editing && ref.current ? ref.current.getBoundingClientRect() : null);
  }, [editing]);

  return (
    <div
      ref={ref}
      className={`td date${editable ? ' editable' : ''}${editing ? ' editing' : ''}${
        pinned ? ' pinned' : ''
      }`}
      style={{ width, flex: 'none' }}
      title={
        pinned ? 'Start No Earlier Than (SNET) constraint. Click to change the date or remove it.' : undefined
      }
      onClick={(e) => editable && !selecting(e) && onOpen()}
    >
      {display}
      {editing && anchor && (
        <DateField
          anchor={anchor}
          valueIso={valueIso}
          field={field}
          hasConstraint={hasConstraint}
          onCommit={onCommit}
          onClear={onClear}
          onClose={onClose}
          onTab={onTab}
        />
      )}
    </div>
  );
}

function CellInput({
  initial,
  placeholder,
  onCommit,
  onDone,
}: {
  initial: string;
  placeholder?: string;
  onCommit(value: string): void;
  onDone(how: 'enter' | 'tab' | 'shift-tab' | 'escape' | 'blur'): void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useLayoutEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const finish = (how: 'enter' | 'tab' | 'shift-tab' | 'escape' | 'blur') => {
    if (done.current) return;
    done.current = true;
    if (how !== 'escape' && value !== initial) onCommit(value);
    onDone(how);
  };

  return (
    <input
      ref={ref}
      value={value}
      placeholder={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish('blur')}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          finish('enter');
        } else if (e.key === 'Tab') {
          e.preventDefault();
          finish(e.shiftKey ? 'shift-tab' : 'tab');
        } else if (e.key === 'Escape') {
          e.preventDefault();
          finish('escape');
        } else {
          e.stopPropagation();
        }
      }}
    />
  );
}

function Grip() {
  return (
    <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor">
      <circle cx="3.5" cy="2.5" r="1.05" />
      <circle cx="6.5" cy="2.5" r="1.05" />
      <circle cx="3.5" cy="6" r="1.05" />
      <circle cx="6.5" cy="6" r="1.05" />
      <circle cx="3.5" cy="9.5" r="1.05" />
      <circle cx="6.5" cy="9.5" r="1.05" />
    </svg>
  );
}

function Chevron() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
