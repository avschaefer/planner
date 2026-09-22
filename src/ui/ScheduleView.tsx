import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { formatWorkDay } from '../engine/calendar';
import { useStore, ZOOM_STEPS } from '../store/store';
import { Gantt } from './Gantt';
import { Inspector } from './Inspector';
import { LinkPopover } from './LinkPopover';
import { HEAD_H, ROW_H, visibleRows } from './rows';
import { TaskTable, TaskTableHead, type Editing } from './TaskTable';
import { majorTicks, minorTicks, buildTimeline, todayX } from './timeline';

const MIN_LEFT = 260;
const MAX_LEFT = 780;

export function ScheduleView() {
  const doc = useStore((s) => s.doc)!;
  const schedule = useStore((s) => s.schedule)!;
  const pxPerDay = useStore((s) => s.pxPerDay);
  const criticalOnly = useStore((s) => s.criticalOnly);
  const selection = useStore((s) => s.selection);
  const store = useStore();

  const [leftWidth, setLeftWidth] = useState(420);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [showKeys, setShowKeys] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(900);

  const ganttRef = useRef<HTMLDivElement>(null);
  const tableInnerRef = useRef<HTMLDivElement>(null);
  const headInnerRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => visibleRows(doc.tasks), [doc.tasks]);
  const tl = useMemo(
    () => buildTimeline(schedule, pxPerDay, viewportWidth),
    [schedule, pxPerDay, viewportWidth],
  );

  /* The Gantt pane is the single scroll master; the table body and the timeline
     header are translated to follow it. No two-way scroll syncing. */
  useLayoutEffect(() => {
    const el = ganttRef.current;
    if (!el) return;
    const onScroll = () => {
      if (tableInnerRef.current) {
        tableInnerRef.current.style.transform = `translateY(${-el.scrollTop}px)`;
      }
      if (headInnerRef.current) {
        headInnerRef.current.style.transform = `translateX(${-el.scrollLeft}px)`;
      }
    };
    const onResize = () => setViewportWidth(el.clientWidth);
    onResize();
    el.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(onResize);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro.disconnect();
    };
  }, []);

  /* Open on the project start rather than at day zero of the padded timeline. */
  const scrolledOnce = useRef(false);
  useEffect(() => {
    if (scrolledOnce.current || !ganttRef.current) return;
    scrolledOnce.current = true;
    ganttRef.current.scrollLeft = Math.max(0, tl.x(schedule.projectStart) - 60);
  }, [tl, schedule.projectStart]);

  /* ---- keyboard ---- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el?.tagName === 'INPUT' || el?.isContentEditable) return;
      const s = useStore.getState();
      const sel = s.selection.taskId;
      const meta = e.metaKey || e.ctrlKey;

      if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? s.redo() : s.undo();
        return;
      }
      if (meta && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        s.redo();
        return;
      }

      switch (e.key) {
        case 'Enter': {
          e.preventDefault();
          if (sel) setEditing({ taskId: sel, field: 'name' });
          else addTask();
          return;
        }
        case 'Delete':
        case 'Backspace': {
          e.preventDefault();
          if (s.selection.linkId) s.deleteLink(s.selection.linkId);
          else if (sel) s.deleteTask(sel);
          return;
        }
        case 'Escape':
          s.select({ taskId: null, linkId: null });
          return;
        case 'ArrowDown':
        case 'ArrowUp': {
          e.preventDefault();
          const i = rows.findIndex((r) => r.task.id === sel);
          const next = rows[Math.min(rows.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))];
          if (next) s.select({ taskId: next.task.id, linkId: null });
          return;
        }
        case 'ArrowRight':
          if (e.altKey && sel) {
            e.preventDefault();
            s.indent(sel);
          }
          return;
        case 'ArrowLeft':
          if (e.altKey && sel) {
            e.preventDefault();
            s.outdent(sel);
          }
          return;
        case '=':
        case '+':
          e.preventDefault();
          s.zoom(1);
          return;
        case '-':
        case '_':
          e.preventDefault();
          s.zoom(-1);
          return;
        case '?':
          setShowKeys((v) => !v);
          return;
      }

      if (e.key.toLowerCase() === 'm' && sel) {
        const t = s.doc?.tasks.find((x) => x.id === sel);
        if (t && t.type !== 'summary') s.setType(sel, t.type === 'milestone' ? 'task' : 'milestone');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rows]);

  function addTask() {
    const id = store.addTask(useStore.getState().selection.taskId);
    if (id) setEditing({ taskId: id, field: 'name' });
  }

  /* ---- splitter ---- */
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) =>
      setLeftWidth(Math.min(MAX_LEFT, Math.max(MIN_LEFT, e.clientX)));
    const up = () => setDragging(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [dragging]);

  const finish = schedule.projectEnd > schedule.projectStart ? schedule.projectEnd - 1 : schedule.projectStart;
  const criticalCount = [...schedule.byId.entries()].filter(
    ([id, v]) => v.critical && doc.tasks.find((t) => t.id === id)?.type !== 'summary',
  ).length;

  function exportJson() {
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${doc.name.replace(/[^\w -]/g, '')|| 'schedule'}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <>
      <div className="toolbar">
        <button className="plain" onClick={() => store.closeProject()} title="All schedules">
          ←
        </button>
        <span className="title">{doc.name}</span>
        <span className="sep" />
        <button onClick={addTask} title="Add activity (Enter)">
          + Activity
        </button>
        <button
          className="plain"
          disabled={!selection.taskId}
          onClick={() => selection.taskId && store.indent(selection.taskId)}
          title="Indent (Alt+→)"
        >
          →|
        </button>
        <button
          className="plain"
          disabled={!selection.taskId}
          onClick={() => selection.taskId && store.outdent(selection.taskId)}
          title="Outdent (Alt+←)"
        >
          |←
        </button>
        <span className="sep" />
        <button
          className="plain"
          onClick={() => store.undo()}
          disabled={!store.undoStack.length}
          title="Undo (Cmd/Ctrl+Z)"
        >
          ↶
        </button>
        <button
          className="plain"
          onClick={() => store.redo()}
          disabled={!store.redoStack.length}
          title="Redo (Shift+Cmd/Ctrl+Z)"
        >
          ↷
        </button>
        <span className="sep" />
        <button className="plain" onClick={() => store.zoom(-1)} disabled={pxPerDay <= ZOOM_STEPS[0]}>
          −
        </button>
        <span className="meta" style={{ width: 44, textAlign: 'center' }}>
          {tl.scale}
        </span>
        <button
          className="plain"
          onClick={() => store.zoom(1)}
          disabled={pxPerDay >= ZOOM_STEPS.at(-1)!}
        >
          +
        </button>
        <button
          className={criticalOnly ? 'on' : 'plain'}
          onClick={() => store.toggleCriticalOnly()}
          title="Emphasise the critical path"
        >
          Critical path
        </button>

        <span className="spacer" />
        <span className="meta">
          Finish <b>{formatWorkDay(finish)}</b> · {criticalCount} critical
        </span>
        <span className="sep" />
        <button className="plain" onClick={exportJson} title="Export JSON">
          Export
        </button>
        <button className="plain" onClick={() => setShowKeys((v) => !v)} title="Keyboard shortcuts (?)">
          ?
        </button>
      </div>

      <div className="schedule">
        <div className="pane-left" style={{ width: leftWidth }} ref={anchorRef}>
          <div className="head">
            <TaskTableHead />
          </div>
          <div className="body-viewport">
            <div ref={tableInnerRef}>
              <TaskTable
                rows={rows}
                schedule={schedule}
                editing={editing}
                setEditing={setEditing}
                onAdd={addTask}
              />
            </div>
          </div>
        </div>

        <div
          className={`splitter${dragging ? ' active' : ''}`}
          onPointerDown={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
        />

        <div className="pane-right">
          <div className="head">
            <div ref={headInnerRef} style={{ width: tl.width }}>
              <TimelineHead tl={tl} />
            </div>
          </div>
          <div className="gantt-viewport" ref={ganttRef}>
            <Gantt
              rows={rows}
              schedule={schedule}
              links={doc.links}
              timeline={tl}
              criticalOnly={criticalOnly}
            />
          </div>
        </div>
      </div>

      {selection.taskId && anchorRef.current && (
        <Inspector schedule={schedule} anchor={anchorRef.current.getBoundingClientRect()} />
      )}
      {selection.linkId && anchorRef.current && (
        <LinkPopover anchor={anchorRef.current.getBoundingClientRect()} />
      )}
      {showKeys && <Shortcuts onClose={() => setShowKeys(false)} />}
    </>
  );
}

function TimelineHead({ tl }: { tl: ReturnType<typeof buildTimeline> }) {
  const major = majorTicks(tl);
  const minor = minorTicks(tl);
  const showMinorLabels = tl.scale !== 'week' || tl.pxPerDay >= 7;
  const today = todayX(tl);

  return (
    <svg width={tl.width} height={HEAD_H} className="gantt">
      {major.map((t, i) => (
        <g key={`M${i}`}>
          {t.x > 0 && (
            <line
              className="tl-line-strong"
              x1={t.x}
              x2={t.x}
              y1={0}
              y2={HEAD_H}
              shapeRendering="crispEdges"
            />
          )}
          <text className="tl-major" x={t.x + 6} y={15}>
            {t.label}
          </text>
        </g>
      ))}
      {minor.map((t, i) => (
        <g key={`m${i}`}>
          <line className="tl-line" x1={t.x} x2={t.x} y1={24} y2={HEAD_H} shapeRendering="crispEdges" />
          {showMinorLabels && (
            <text className="tl-minor" x={t.x + 3} y={38}>
              {t.label}
            </text>
          )}
        </g>
      ))}
      {today !== null && (
        <polygon className="g-today-cap" points={`${today - 4},${HEAD_H} ${today + 4},${HEAD_H} ${today},${HEAD_H - 6}`} />
      )}
    </svg>
  );
}

function Shortcuts({ onClose }: { onClose(): void }) {
  const keys: Array<[string, string]> = [
    ['Enter', 'Add activity / edit name'],
    ['Tab', 'Next field'],
    ['↑ ↓', 'Move between activities'],
    ['Alt + → ←', 'Indent / outdent'],
    ['M', 'Toggle milestone'],
    ['Delete', 'Delete activity or link'],
    ['+ −', 'Zoom'],
    ['Cmd/Ctrl + Z', 'Undo'],
    ['⇧ Cmd/Ctrl + Z', 'Redo'],
    ['Esc', 'Clear selection'],
  ];
  return (
    <div
      className="pop"
      style={{ right: 12, top: 46, minWidth: 260 }}
      onPointerLeave={onClose}
    >
      <h4>Keyboard</h4>
      <div className="shortcuts">
        {keys.map(([k, d]) => (
          <div key={k} style={{ display: 'contents' }}>
            <kbd>{k}</kbd>
            <span className="d">{d}</span>
          </div>
        ))}
      </div>
      <div className="hint">Drag a bar to move it · drag its edge to resize · drag the dot to link.</div>
    </div>
  );
}

export { ROW_H };
