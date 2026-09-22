import { useEffect, useRef, useState } from 'react';
import { formatWorkDay, parseDateInput, toIso, toWorkDay } from '../engine/calendar';
import { formatPredecessors, parsePredecessors } from '../engine/predecessors';
import type { ScheduleResult } from '../engine/types';
import { useStore } from '../store/store';
import { ROW_H, type Row } from './rows';

export type Field = 'name' | 'start' | 'finish' | 'duration' | 'pred';
export interface Editing {
  taskId: string;
  field: Field;
}

export const COLUMNS: Array<{ key: Field | 'code'; label: string; width: number }> = [
  { key: 'code', label: 'ID', width: 58 },
  { key: 'name', label: 'Activity', width: 0 },
  { key: 'start', label: 'Start', width: 86 },
  { key: 'finish', label: 'Finish', width: 86 },
  { key: 'duration', label: 'Dur', width: 46 },
  { key: 'pred', label: 'Predecessors', width: 120 },
];

interface Props {
  rows: Row[];
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
          className="th"
          style={c.width ? { width: c.width, flex: 'none' } : { flex: 1, minWidth: 0 }}
        >
          {c.label}
        </div>
      ))}
    </div>
  );
}

export function TaskTable({ rows, schedule, editing, setEditing, onAdd }: Props) {
  const doc = useStore((s) => s.doc)!;
  const selection = useStore((s) => s.selection);
  const store = useStore();

  const codeOf = (id: string) => doc.tasks.find((t) => t.id === id)?.code ?? '?';

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
      case 'start': {
        const iso = parseDateInput(raw, toIso(s.start));
        if (iso) store.setStart(taskId, toWorkDay(iso, 'forward'));
        break;
      }
      case 'finish': {
        const iso = parseDateInput(raw, toIso(s.start));
        if (iso) store.setFinish(taskId, toWorkDay(iso, 'back'));
        break;
      }
      case 'pred': {
        const parsed = parsePredecessors(raw, doc.tasks);
        if (parsed.error) store.notify(parsed.error);
        else store.replacePredecessors(taskId, parsed.links);
        break;
      }
    }
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
          codeOf,
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

  function nextField(field: Field, back: boolean): Field | null {
    const editable: Field[] = ['name', 'start', 'finish', 'duration', 'pred'];
    const i = editable.indexOf(field) + (back ? -1 : 1);
    return editable[i] ?? null;
  }

  return (
    <div>
      {rows.map((row) => {
        const { task } = row;
        const s = schedule.byId.get(task.id);
        const selected = selection.taskId === task.id;
        const isSummary = task.type === 'summary';

        return (
          <div
            key={task.id}
            className={`trow${selected ? ' sel' : ''}${isSummary ? ' summary' : ''}${
              s?.critical ? ' critical' : ''
            }`}
            style={{ height: ROW_H }}
            onPointerDown={() => store.select({ taskId: task.id, linkId: null })}
          >
            <div className="td code" style={{ width: 58, flex: 'none' }}>
              {task.code}
            </div>

            <div
              className={`td editable${editing?.taskId === task.id && editing.field === 'name' ? ' editing' : ''}`}
              style={{ flex: 1, minWidth: 0, paddingLeft: 7 + row.depth * 14 }}
              onDoubleClick={() => setEditing({ taskId: task.id, field: 'name' })}
            >
              <div className="tname">
                {isSummary ? (
                  <span
                    className={`twist${task.collapsed ? ' collapsed' : ''}`}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      store.toggleCollapsed(task.id);
                    }}
                  >
                    <Chevron />
                  </span>
                ) : (
                  <span style={{ width: 13, flex: 'none' }} />
                )}
                {editing?.taskId === task.id && editing.field === 'name' ? (
                  <CellInput
                    initial={task.name}
                    placeholder="Activity name"
                    onCommit={(v) => commitField(task.id, 'name', v)}
                    onDone={(how) => {
                      if (how === 'enter') advance(task.id, 'name');
                      else if (how === 'tab' || how === 'shift-tab') {
                        const f = nextField('name', how === 'shift-tab');
                        setEditing(f ? { taskId: task.id, field: f } : null);
                      } else {
                        setEditing(null);
                        // Backing out of a never-named activity removes it, so
                        // the quick-add loop doesn't leave a blank row behind.
                        if (how === 'escape' && !task.name) store.deleteTask(task.id);
                      }
                    }}
                  />
                ) : (
                  <span
                    className={`label${task.name ? '' : ' untitled'}`}
                    onClick={() => setEditing({ taskId: task.id, field: 'name' })}
                  >
                    {task.name || 'Untitled activity'}
                  </span>
                )}
                {task.constraint && !isSummary && (
                  <span
                    className="pin"
                    title="Pinned by dragging. Click to release it back to its logic."
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      store.clearConstraint(task.id);
                    }}
                  >
                    <PinIcon />
                  </span>
                )}
              </div>
            </div>

            {(['start', 'finish', 'duration', 'pred'] as Field[]).map((field) => {
              const col = COLUMNS.find((c) => c.key === field)!;
              const editable = !isSummary; // a summary has no dates of its own
              const isEditing = editing?.taskId === task.id && editing.field === field;
              const display =
                field === 'start'
                  ? s
                    ? formatWorkDay(s.start)
                    : ''
                  : field === 'finish'
                    ? s
                      ? formatWorkDay(Math.max(s.start, s.end - 1))
                      : ''
                    : field === 'duration'
                      ? isSummary
                        ? ''
                        : `${task.duration}d`
                      : valueFor(task.id, 'pred');

              return (
                <div
                  key={field}
                  className={`td ${field === 'duration' ? 'num' : field === 'pred' ? 'pred' : 'date'}${
                    editable ? ' editable' : ''
                  }${isEditing ? ' editing' : ''}`}
                  style={
                    field === 'pred'
                      ? { flex: 1, minWidth: 120 }
                      : { width: col.width, flex: 'none' }
                  }
                  onClick={() => editable && setEditing({ taskId: task.id, field })}
                >
                  {isEditing ? (
                    <CellInput
                      initial={valueFor(task.id, field)}
                      onCommit={(v) => commitField(task.id, field, v)}
                      onDone={(how) => {
                        if (how === 'enter') advance(task.id, field);
                        else if (how === 'tab' || how === 'shift-tab') {
                          const f = nextField(field, how === 'shift-tab');
                          setEditing(f ? { taskId: task.id, field: f } : null);
                        } else setEditing(null);
                      }}
                    />
                  ) : (
                    display
                  )}
                </div>
              );
            })}
          </div>
        );
      })}

      <div className="addrow" onClick={onAdd}>
        <span style={{ fontSize: 14, lineHeight: 1 }}>+</span> Add activity
      </div>
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

  useEffect(() => {
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

function Chevron() {
  return (
    <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
      <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
      <path
        d="M4.5 1.5h3l-.5 3 2 1.5v1h-6v-1l2-1.5-.5-3z M6 7.5v3"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
