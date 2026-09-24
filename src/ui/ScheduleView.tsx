import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { formatWorkDay } from '../engine/calendar';
import { primaryTaskId, useStore, ZOOM_STEPS } from '../store/store';
import { groupHues } from './colors';
import { Button } from './Button';
import { exportGanttPng } from './exportPng';
import { Gantt } from './Gantt';
import * as Icon from './icons';
import { SettingsModal } from './Settings';
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
  const settings = useStore((s) => s.settings);
  const store = useStore();

  const [leftWidth, setLeftWidth] = useState(660);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [showKeys, setShowKeys] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(900);

  const ganttRef = useRef<HTMLDivElement>(null);
  const tableInnerRef = useRef<HTMLDivElement>(null);
  const headInnerRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => visibleRows(doc.tasks), [doc.tasks]);
  // Colour by type turns group hues off entirely; the chart and the table then
  // colour each shape by what it is (see .by-type in styles.css).
  const byType = settings.colorMode === 'type';
  const hues = useMemo(() => (byType ? new Map<string, number>() : groupHues(rows)), [rows, byType]);
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

  /** A clean snapshot: nothing selected, and the whole timeline, not the viewport. */
  async function exportPng() {
    const head = headInnerRef.current?.querySelector('svg') as SVGSVGElement | null;
    const chart = ganttRef.current?.querySelector('svg.gantt') as SVGSVGElement | null;
    if (!head || !chart) return;
    store.clearSelection();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      await exportGanttPng(head, chart, doc.name);
    } catch {
      store.notify('The chart could not be saved as an image.');
    }
  }

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
        <Button variant="ghost" icon onClick={() => store.closeProject()} title="All schedules">
          <Icon.Back />
        </Button>
        <span className="title">{doc.name}</span>

        <Button variant="primary" onClick={addTask} title="Add activity (Enter)">
          Add activity
        </Button>

        <div className="cluster">
          <Button variant="ghost" icon disabled={!canIndent} onClick={() => store.indent(selection.taskIds)} title="Indent (Alt+→)">
            <Icon.Indent />
          </Button>
          <Button variant="ghost" icon disabled={!canIndent} onClick={() => store.outdent(selection.taskIds)} title="Outdent (Alt+←)">
            <Icon.Outdent />
          </Button>
        </div>

        <div className="cluster">
          <Button variant="ghost" icon onClick={() => store.undo()} disabled={!store.undoStack.length} title="Undo (Cmd/Ctrl+Z)">
            <Icon.Undo />
          </Button>
          <Button variant="ghost" icon onClick={() => store.redo()} disabled={!store.redoStack.length} title="Redo (Shift+Cmd/Ctrl+Z)">
            <Icon.Redo />
          </Button>
        </div>

        <div className="cluster">
          <Button variant="ghost" icon onClick={() => store.zoom(-1)} disabled={pxPerDay <= ZOOM_STEPS[0]} title="Zoom out (−)">
            <Icon.Minus />
          </Button>
          <span className="zoomlabel">{tl.scale}</span>
          <Button variant="ghost" icon onClick={() => store.zoom(1)} disabled={pxPerDay >= ZOOM_STEPS.at(-1)!} title="Zoom in (+)">
            <Icon.Plus />
          </Button>
        </div>

        <div className="cluster">
          <Button
            variant="ghost"
            active={criticalOnly}
            onClick={() => store.toggleCriticalOnly()}
            title="Emphasise the critical path"
          >
            <Icon.Critical /> Critical path
          </Button>
        </div>

        <span className="spacer" />
        {selection.taskIds.length > 1 && (
          <span className="meta">{selection.taskIds.length} selected</span>
        )}
        <span className="finish" title="Project finish">
          <span className="k">Finish</span>
          <b>{formatWorkDay(finish, settings.dateFormat)}</b>
        </span>

        <div className="cluster">
          <Button
            variant="ghost"
            icon
            active={!settings.showTable}
            onClick={() => store.updateSettings({ showTable: !settings.showTable })}
            title={settings.showTable ? 'Hide the activity table' : 'Show the activity table'}
          >
            <Icon.PanelLeft />
          </Button>
          <Button variant="ghost" icon onClick={() => void exportPng()} title="Export the chart as a PNG">
            <Icon.Image />
          </Button>
          <Button variant="ghost" icon onClick={exportJson} title="Export JSON">
            <Icon.Export />
          </Button>
          <Button variant="ghost" icon active={showSettings} onClick={() => setShowSettings((v) => !v)} title="Settings">
            <Icon.Gear />
          </Button>
          <Button variant="ghost" icon onClick={() => setShowKeys((v) => !v)} title="Keyboard shortcuts (?)">
            <Icon.Keyboard />
          </Button>
        </div>
      </div>

      <div className={`schedule${byType ? ' by-type' : ''}`}>
        {settings.showTable && (
          <div className="pane-left" style={{ width: leftWidth }}>
            <div className="head" onPointerDown={() => store.clearSelection()}>
              <TaskTableHead />
            </div>
            <div
              className="body-viewport"
              onPointerDown={(e) => e.target === e.currentTarget && store.clearSelection()}
            >
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
        )}

        {settings.showTable && (
          <div
            className={`splitter${dragging ? ' active' : ''}`}
            onPointerDown={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
          />
        )}

        <div className="pane-right">
          <div className="head" onPointerDown={() => store.clearSelection()}>
            <div ref={headInnerRef} style={{ width: tl.width }}>
              <TimelineHead tl={tl} />
            </div>
          </div>
          <div
            className="gantt-viewport"
            ref={ganttRef}
            onPointerDown={(e) => e.target === e.currentTarget && store.clearSelection()}
          >
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
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
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
        ['Drag down the table', 'Select a range of rows'],
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
