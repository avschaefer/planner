import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { formatWorkDay } from '../engine/calendar';
import { primaryTaskId, useStore, ZOOM_STEPS } from '../store/store';
import { groupHues } from './colors';
import { Gantt } from './Gantt';
import * as Icon from './icons';
import { HEAD_H, ROW_H, visibleRows } from './rows';
import { TaskTable, TaskTableHead, type Editing } from './TaskTable';
import { majorTicks, minorTicks, buildTimeline, todayX } from './timeline';

const MIN_LEFT = 460;
const MAX_LEFT = 900;

export function ScheduleView() {
  const doc = useStore((s) => s.doc)!;
  const schedule = useStore((s) => s.schedule)!;
  const pxPerDay = useStore((s) => s.pxPerDay);
  const criticalOnly = useStore((s) => s.criticalOnly);
  const selection = useStore((s) => s.selection);
  const store = useStore();

  const [leftWidth, setLeftWidth] = useState(660);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [showKeys, setShowKeys] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(900);

  const ganttRef = useRef<HTMLDivElement>(null);
  const tableInnerRef = useRef<HTMLDivElement>(null);
  const headInnerRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => visibleRows(doc.tasks), [doc.tasks]);
  const hues = useMemo(() => groupHues(rows), [rows]);
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
      const sel = primaryTaskId(s.selection);
      const all = s.selection.taskIds;
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
      if (meta && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        s.selectAll();
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
          else if (all.length) s.deleteTask(all);
          return;
        }
        case 'Escape':
          s.clearSelection();
          return;
        case 'ArrowDown':
        case 'ArrowUp': {
          e.preventDefault();
          const i = rows.findIndex((r) => r.task.id === sel);
          const next = rows[Math.min(rows.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))];
          if (next) s.selectTask(next.task.id, e.shiftKey ? 'range' : 'replace');
          return;
        }
        case 'ArrowRight':
          if (e.altKey && all.length) {
            e.preventDefault();
            s.indent(all);
          }
          return;
        case 'ArrowLeft':
          if (e.altKey && all.length) {
            e.preventDefault();
            s.outdent(all);
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

      if (e.key.toLowerCase() === 'm' && all.length) {
        const first = s.doc?.tasks.find((x) => x.id === sel);
        if (first && first.type !== 'summary') {
          s.setType(all, first.type === 'milestone' ? 'task' : 'milestone');
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rows]);

  function addTask() {
    const id = store.addTask(primaryTaskId(useStore.getState().selection));
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
  const canIndent = selection.taskIds.length > 0;

  function exportJson() {
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${doc.name.replace(/[^\w -]/g, '') || 'schedule'}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <>
      <div className="toolbar">
        <button className="plain" onClick={() => store.closeProject()} title="All schedules">
          <Icon.Back />
        </button>
        <span className="title">{doc.name}</span>

        <button className="primary" onClick={addTask} title="Add activity (Enter)">
          Add activity
        </button>

        <div className="cluster">
          <button disabled={!canIndent} onClick={() => store.indent(selection.taskIds)} title="Indent (Alt+→)">
            <Icon.Indent />
          </button>
          <button disabled={!canIndent} onClick={() => store.outdent(selection.taskIds)} title="Outdent (Alt+←)">
            <Icon.Outdent />
          </button>
        </div>

        <div className="cluster">
          <button onClick={() => store.undo()} disabled={!store.undoStack.length} title="Undo (Cmd/Ctrl+Z)">
            <Icon.Undo />
          </button>
          <button onClick={() => store.redo()} disabled={!store.redoStack.length} title="Redo (Shift+Cmd/Ctrl+Z)">
            <Icon.Redo />
          </button>
        </div>

        <div className="cluster">
          <button onClick={() => store.zoom(-1)} disabled={pxPerDay <= ZOOM_STEPS[0]} title="Zoom out (−)">
            <Icon.Minus />
          </button>
          <span className="zoomlabel">{tl.scale}</span>
          <button onClick={() => store.zoom(1)} disabled={pxPerDay >= ZOOM_STEPS.at(-1)!} title="Zoom in (+)">
            <Icon.Plus />
          </button>
        </div>

        <div className="cluster">
          <button
            className={criticalOnly ? 'on' : ''}
            onClick={() => store.toggleCriticalOnly()}
            title="Emphasise the critical path"
            style={{ padding: '0 10px', gap: 6, display: 'flex', alignItems: 'center' }}
          >
            <Icon.Critical /> Critical path
          </button>
        </div>

        <span className="spacer" />
        <span className="meta">
          {selection.taskIds.length > 1 && <>{selection.taskIds.length} selected · </>}
          Finish <b>{formatWorkDay(finish)}</b>
        </span>

        <div className="cluster">
          <button onClick={exportJson} title="Export JSON">
            <Icon.Export />
          </button>
          <button onClick={() => setShowKeys((v) => !v)} title="Keyboard shortcuts (?)">
            <Icon.Keyboard />
          </button>
        </div>
      </div>

      <div className="schedule">
        <div className="pane-left" style={{ width: leftWidth }}>
          <div className="head">
            <TaskTableHead />
          </div>
          <div className="body-viewport">
            <div ref={tableInnerRef}>
              <TaskTable
                rows={rows}
                hues={hues}
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
              hues={hues}
              schedule={schedule}
              links={doc.links}
              timeline={tl}
              criticalOnly={criticalOnly}
            />
          </div>
        </div>
      </div>

      {showKeys && <Shortcuts onClose={() => setShowKeys(false)} />}
    </>
  );
}

function TimelineHead({ tl }: { tl: ReturnType<typeof buildTimeline> }) {
  const major = majorTicks(tl);
  const minor = minorTicks(tl);
  const showMinorLabels = tl.scale !== 'week' || tl.pxPerDay >= 7;
  const today = todayX(tl);
  const BAND = 22;

  return (
    <svg width={tl.width} height={HEAD_H} className="gantt">
      <rect className="tl-band" x={0} y={0} width={tl.width} height={BAND} />
      <line className="tl-line" x1={0} x2={tl.width} y1={BAND - 0.5} y2={BAND - 0.5} shapeRendering="crispEdges" />

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
          <text className="tl-month" x={t.x + 7} y={15}>
            {t.label}
          </text>
        </g>
      ))}

      {minor.map((t, i) => (
        <g key={`m${i}`}>
          <line className="tl-line" x1={t.x} x2={t.x} y1={BAND} y2={HEAD_H} shapeRendering="crispEdges" />
          {showMinorLabels && (
            <text className="tl-minor" x={t.x + 4} y={HEAD_H - 8}>
              {t.label}
            </text>
          )}
        </g>
      ))}

      {today !== null && (
        <polygon
          className="g-today-cap"
          points={`${today - 4},${HEAD_H} ${today + 4},${HEAD_H} ${today},${HEAD_H - 6}`}
        />
      )}
    </svg>
  );
}

function Shortcuts({ onClose }: { onClose(): void }) {
  const groups: Array<[string, Array<[string, string]>]> = [
    [
      'Editing',
      [
        ['Enter', 'Add activity · edit the name'],
        ['Tab', 'Next field'],
        ['M', 'Toggle milestone'],
        ['Delete', 'Delete activity or link'],
        ['Cmd/Ctrl + Z', 'Undo'],
        ['⇧ Cmd/Ctrl + Z', 'Redo'],
      ],
    ],
    [
      'Selection',
      [
        ['↑ ↓', 'Move between activities'],
        ['⇧ ↑ ↓ · ⇧ click', 'Extend the selection'],
        ['Cmd/Ctrl + click', 'Add or remove one'],
        ['Cmd/Ctrl + A', 'Select all'],
        ['Drag in the chart', 'Rubber-band select'],
        ['Alt + → ←', 'Indent / outdent'],
        ['Esc', 'Clear the selection'],
      ],
    ],
    ['View', [['+ −', 'Zoom the timeline']]],
  ];

  return (
    <div className="pop" style={{ right: 14, top: 54, minWidth: 300 }} onPointerLeave={onClose}>
      <div className="shortcuts">
        {groups.map(([title, keys]) => (
          <div key={title} style={{ display: 'contents' }}>
            <div className="sect">{title}</div>
            {keys.map(([k, d]) => (
              <div key={k} style={{ display: 'contents' }}>
                <kbd>{k}</kbd>
                <span className="d">{d}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="hint">
        Drag a bar to move it · drag an edge to resize · drag a dot onto any row to link.
        Which dot you grab and which half of the target you drop on decides FS, SS, FF or SF.
      </div>
    </div>
  );
}

export { ROW_H };
