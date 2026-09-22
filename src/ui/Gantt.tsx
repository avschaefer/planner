import { useCallback, useEffect, useRef, useState } from 'react';
import { calIndexFromWorkDay, formatWorkDay, workDayFromCalIndex } from '../engine/calendar';
import type { Link, ScheduleResult, Task, WorkDay } from '../engine/types';
import { useStore } from '../store/store';
import { anchorsFor, arrowPoints, routeLink, type Anchor } from './linkPath';
import { BAR_H, BAR_Y, ROW_H, type Row } from './rows';
import { majorTicks, todayX, weekendBands, type Timeline } from './timeline';

type Drag =
  | { kind: 'move'; id: string; x0: number; delta: number }
  | { kind: 'resize'; id: string; edge: 'start' | 'end'; x0: number; delta: number }
  | { kind: 'link'; fromId: string; x: number; y: number; overId: string | null };

interface Props {
  rows: Row[];
  schedule: ScheduleResult;
  links: Link[];
  timeline: Timeline;
  criticalOnly: boolean;
}

export function Gantt({ rows, schedule, links, timeline: tl, criticalOnly }: Props) {
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;

  const height = Math.max(rows.length * ROW_H + 40, 120);
  const rowIndex = new Map(rows.map((r, i) => [r.task.id, i]));
  const isDim = (id: string) => criticalOnly && !schedule.byId.get(id)?.critical;

  /* ---- gesture handling: track in pixels, commit once on release ---- */

  const begin = useCallback((d: Drag) => {
    setDrag(d);
    dragRef.current = d;
  }, []);

  const isDragging = drag !== null;
  useEffect(() => {
    if (!isDragging) return;

    const move = (e: PointerEvent) => {
      const cur = dragRef.current;
      if (!cur) return;
      if (cur.kind === 'link') {
        const rect = svgRef.current!.getBoundingClientRect();
        const over = taskIdAtPoint(e.clientX, e.clientY);
        setDrag({
          ...cur,
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
          overId: over && over !== cur.fromId ? over : null,
        });
      } else {
        setDrag({ ...cur, delta: Math.round((e.clientX - cur.x0) / tl.pxPerDay) });
      }
    };

    const up = () => {
      const cur = dragRef.current;
      setDrag(null);
      dragRef.current = null;
      if (!cur) return;
      const store = useStore.getState();

      if (cur.kind === 'link') {
        if (cur.overId) store.addLink(cur.fromId, cur.overId);
        return;
      }
      const s = schedule.byId.get(cur.id);
      if (!s || cur.delta === 0) return;

      if (cur.kind === 'move') {
        store.moveBy(cur.id, shiftWorkDays(s.start, cur.delta));
      } else if (cur.edge === 'end') {
        const end = shiftedEnd(s.end, cur.delta);
        store.setDuration(cur.id, Math.max(1, end - s.start));
      } else {
        const start = s.start + shiftWorkDays(s.start, cur.delta);
        if (start < s.end) store.resizeFromStart(cur.id, start);
      }
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [isDragging, tl.pxPerDay, schedule]);

  /* ---- preview geometry: show where the gesture will actually land ---- */

  function previewOf(task: Task): { start: WorkDay; end: WorkDay } | null {
    if (!drag || drag.kind === 'link' || drag.id !== task.id || drag.delta === 0) return null;
    const s = schedule.byId.get(task.id);
    if (!s) return null;
    if (drag.kind === 'move') {
      const d = shiftWorkDays(s.start, drag.delta);
      return { start: s.start + d, end: s.end + d };
    }
    if (drag.edge === 'end') {
      const end = Math.max(s.start + (task.type === 'milestone' ? 0 : 1), shiftedEnd(s.end, drag.delta));
      return { start: s.start, end };
    }
    const start = Math.min(s.end - 1, s.start + shiftWorkDays(s.start, drag.delta));
    return { start, end: s.end };
  }

  return (
    <svg
      ref={svgRef}
      className="gantt"
      width={tl.width}
      height={height}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) select({ taskId: null, linkId: null });
      }}
    >
      <g className="grid">
        {weekendBands(tl).map((b, i) => (
          <rect key={i} className="g-weekend" x={b.x} y={0} width={b.w} height={height} />
        ))}
        {majorTicks(tl).map((t, i) => (
          <line key={i} className="g-month" x1={t.x} x2={t.x} y1={0} y2={height} shapeRendering="crispEdges" />
        ))}
        {rows.map((_, i) => (
          <line
            key={i}
            className="g-rowline"
            x1={0}
            x2={tl.width}
            y1={(i + 1) * ROW_H - 0.5}
            y2={(i + 1) * ROW_H - 0.5}
            shapeRendering="crispEdges"
          />
        ))}
      </g>

      {selection.taskId && rowIndex.has(selection.taskId) && (
        <rect
          className="g-rowband"
          x={0}
          y={rowIndex.get(selection.taskId)! * ROW_H}
          width={tl.width}
          height={ROW_H}
        />
      )}

      <TodayLine tl={tl} height={height} />

      <g className="links">
        {links.map((l, i) => {
          const a = barAnchors(l, schedule, rowIndex, tl);
          if (!a) return null;
          const critical =
            !!schedule.byId.get(l.fromId)?.critical && !!schedule.byId.get(l.toId)?.critical;
          const sel = selection.linkId === l.id;
          const dim = isDim(l.fromId) || isDim(l.toId);
          const cls = `${critical ? ' critical' : ''}${sel ? ' sel' : ''}${dim ? ' dim' : ''}`;
          const d = routeLink(a.from, a.to, i % 3);
          return (
            <g key={l.id}>
              <path className={`link${cls}`} d={d} />
              <polygon className={`link-arrow${cls}`} points={arrowPoints(a.to)} />
              <path
                className="link-hit"
                d={d}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  select({ linkId: l.id, taskId: null });
                }}
              />
            </g>
          );
        })}
      </g>

      <g className="bars">
        {rows.map((row, i) => {
          const s = schedule.byId.get(row.task.id);
          if (!s) return null;
          const y = i * ROW_H;
          const preview = previewOf(row.task);
          return (
            <Bar
              key={row.task.id}
              task={row.task}
              y={y}
              start={s.start}
              end={s.end}
              critical={s.critical}
              totalFloat={s.totalFloat}
              selected={selection.taskId === row.task.id}
              dim={isDim(row.task.id)}
              hovered={hover === row.task.id}
              dragging={!!drag && drag.kind !== 'link' && drag.id === row.task.id}
              dropTarget={drag?.kind === 'link' && drag.overId === row.task.id}
              preview={preview}
              tl={tl}
              onHover={setHover}
              onSelect={() => select({ taskId: row.task.id, linkId: null })}
              onDrag={begin}
            />
          );
        })}
      </g>

      {drag?.kind === 'link' && (
        <g>
          <path
            className="rubber"
            d={`M${tl.x(schedule.byId.get(drag.fromId)?.end ?? 0)} ${
              (rowIndex.get(drag.fromId) ?? 0) * ROW_H + ROW_H / 2
            } L${drag.x} ${drag.y}`}
          />
          <circle className="knob" cx={drag.x} cy={drag.y} r={3} />
        </g>
      )}
    </svg>
  );
}

/* ---------------------------------------------------------------- bar ---- */

interface BarProps {
  task: Task;
  y: number;
  start: WorkDay;
  end: WorkDay;
  critical: boolean;
  totalFloat: number;
  selected: boolean;
  dim: boolean;
  hovered: boolean;
  dragging: boolean;
  dropTarget: boolean;
  preview: { start: WorkDay; end: WorkDay } | null;
  tl: Timeline;
  onHover(id: string | null): void;
  onSelect(): void;
  onDrag(d: Drag): void;
}

function Bar(p: BarProps) {
  const { task, y, tl } = p;
  const x = tl.x(p.start);
  const w = Math.max(tl.x(p.end) - x, 2);
  const cls = `${p.critical ? ' critical' : ''}${p.selected ? ' sel' : ''}${p.dim ? ' dim' : ''}`;
  const showKnob = (p.hovered || p.selected) && !p.dim && task.type !== 'summary';
  const mid = y + ROW_H / 2;

  const startDrag = (kind: 'move' | 'resize', edge?: 'start' | 'end') => (e: React.PointerEvent) => {
    e.stopPropagation();
    p.onSelect();
    p.onDrag(
      kind === 'move'
        ? { kind: 'move', id: task.id, x0: e.clientX, delta: 0 }
        : { kind: 'resize', id: task.id, edge: edge!, x0: e.clientX, delta: 0 },
    );
  };

  return (
    <g
      data-task-id={task.id}
      onPointerEnter={() => p.onHover(task.id)}
      onPointerLeave={() => p.onHover(null)}
    >
      {task.type === 'summary' ? (
        <SummaryBar x={x} w={w} y={y} dim={p.dim} onDown={startDrag('move')} />
      ) : task.type === 'milestone' ? (
        <path
          className={`ms${cls}`}
          d={diamond(x, mid, 7)}
          onPointerDown={startDrag('move')}
          onClick={p.onSelect}
        />
      ) : (
        <>
          <rect
            className={`bar${cls}`}
            x={x}
            y={y + BAR_Y}
            width={w}
            height={BAR_H}
            rx={2}
            onPointerDown={startDrag('move')}
          />
          <rect
            className="handle"
            x={x - 3}
            y={y + BAR_Y}
            width={6}
            height={BAR_H}
            onPointerDown={startDrag('resize', 'start')}
          />
          <rect
            className="handle"
            x={x + w - 3}
            y={y + BAR_Y}
            width={6}
            height={BAR_H}
            onPointerDown={startDrag('resize', 'end')}
          />
        </>
      )}

      {/* Float tail: how far this activity could slip without moving the finish. */}
      {!p.dim && !p.critical && p.totalFloat > 0 && task.type !== 'summary' && (
        <line
          className="g-rowline"
          x1={x + w}
          x2={tl.x(p.end + p.totalFloat)}
          y1={mid}
          y2={mid}
          strokeDasharray="2 2"
        />
      )}

      {/* Link handle. Dragging from it creates a finish-to-start relationship. */}
      {showKnob && !p.dragging && (
        <circle
          className="knob"
          cx={tl.x(p.end) + 5}
          cy={mid}
          r={3.5}
          onPointerDown={(e) => {
            e.stopPropagation();
            const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
            p.onDrag({
              kind: 'link',
              fromId: task.id,
              x: e.clientX - rect.left,
              y: e.clientY - rect.top,
              overId: null,
            });
          }}
        />
      )}

      {p.dropTarget && (
        <rect
          className="drop-target"
          x={x - 2}
          y={y + BAR_Y - 2}
          width={w + 4}
          height={BAR_H + 4}
          rx={3}
        />
      )}

      {p.preview && <Preview preview={p.preview} y={y} type={task.type} tl={tl} />}
    </g>
  );
}

function Preview({
  preview,
  y,
  type,
  tl,
}: {
  preview: { start: WorkDay; end: WorkDay };
  y: number;
  type: Task['type'];
  tl: Timeline;
}) {
  const px = tl.x(preview.start);
  const pw = Math.max(tl.x(preview.end) - px, 2);
  const finish = preview.end - (type === 'milestone' ? 0 : 1);
  return (
    <g>
      <rect className="ghost" x={px} y={y + BAR_Y} width={pw} height={BAR_H} rx={2} />
      <rect className="ghost-outline" x={px} y={y + BAR_Y} width={pw} height={BAR_H} rx={2} />
      <text className="drag-readout" x={px} y={y - 2}>
        {formatWorkDay(preview.start)}
        {type !== 'milestone' && ` → ${formatWorkDay(finish)}`}
      </text>
    </g>
  );
}

function SummaryBar({
  x,
  w,
  y,
  dim,
  onDown,
}: {
  x: number;
  w: number;
  y: number;
  dim: boolean;
  onDown(e: React.PointerEvent): void;
}) {
  const top = y + BAR_Y + 2;
  const h = 5;
  const cap = 5;
  return (
    <path
      className={`sumbar${dim ? ' dim' : ''}`}
      onPointerDown={onDown}
      d={
        `M${x} ${top} H${x + w} V${top + h} ` +
        `L${x + w - cap} ${top + h} L${x + w - cap} ${top + h + cap} L${x + w - cap * 2.2} ${top + h} ` +
        `H${x + cap * 2.2} L${x + cap} ${top + h + cap} L${x + cap} ${top + h} L${x} ${top + h} Z`
      }
    />
  );
}

function TodayLine({ tl, height }: { tl: Timeline; height: number }) {
  const x = todayX(tl);
  if (x === null) return null;
  return (
    <g>
      <line className="g-today" x1={x} x2={x} y1={0} y2={height} shapeRendering="crispEdges" />
      <polygon className="g-today-cap" points={`${x - 3.5},0 ${x + 3.5},0 ${x},5`} />
    </g>
  );
}

/* ------------------------------------------------------------ helpers ---- */

function diamond(cx: number, cy: number, r: number): string {
  return `M${cx} ${cy - r} L${cx + r} ${cy} L${cx} ${cy + r} L${cx - r} ${cy} Z`;
}

function barAnchors(
  l: Link,
  schedule: ScheduleResult,
  rowIndex: Map<string, number>,
  tl: Timeline,
): { from: Anchor; to: Anchor } | null {
  const fi = rowIndex.get(l.fromId);
  const ti = rowIndex.get(l.toId);
  const fs = schedule.byId.get(l.fromId);
  const ts = schedule.byId.get(l.toId);
  if (fi === undefined || ti === undefined || !fs || !ts) return null;

  const { from, to } = anchorsFor(l.type);
  return {
    from: {
      x: tl.x(from === 'end' ? fs.end : fs.start),
      y: fi * ROW_H + ROW_H / 2,
      dir: from === 'end' ? 1 : -1,
    },
    to: {
      x: tl.x(to === 'end' ? ts.end : ts.start),
      y: ti * ROW_H + ROW_H / 2,
      dir: to === 'end' ? -1 : 1,
    },
  };
}

/** Pixel delta is in calendar days; the schedule moves in working days. */
function shiftWorkDays(start: WorkDay, calDelta: number): number {
  const target = workDayFromCalIndex(calIndexFromWorkDay(start) + calDelta, calDelta >= 0 ? 'forward' : 'back');
  return target - start;
}

function shiftedEnd(end: WorkDay, calDelta: number): WorkDay {
  return workDayFromCalIndex(calIndexFromWorkDay(end) + calDelta, calDelta >= 0 ? 'forward' : 'back');
}

function taskIdAtPoint(clientX: number, clientY: number): string | null {
  let el = document.elementFromPoint(clientX, clientY) as Element | null;
  while (el) {
    const id = el.getAttribute?.('data-task-id');
    if (id) return id;
    el = el.parentElement;
  }
  return null;
}
