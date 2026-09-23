import { useCallback, useEffect, useRef, useState } from 'react';
import { calIndexFromWorkDay, formatWorkDay, workDayFromCalIndex } from '../engine/calendar';
import type { Link, LinkType, ScheduleResult, Task, WorkDay } from '../engine/types';
import { useStore } from '../store/store';
import { hueClass } from './colors';
import { LinkPopover } from './LinkPopover';
import { anchorsFor, arrowPoints, routeLink, type Anchor } from './linkPath';
import { BAR_H, BAR_Y, ROW_H, type Row } from './rows';
import { majorTicks, todayX, weekendBands, type Timeline } from './timeline';

/** How far outside a bar's end its link handle sits, and how big its target is. */
const KNOB_OUT = 10;
const KNOB_HIT = 9;

type End = 'start' | 'end';

type Drag =
  | { kind: 'move'; ids: string[]; x0: number; delta: number }
  | { kind: 'resize'; id: string; edge: End; x0: number; delta: number }
  | {
      kind: 'link';
      fromId: string;
      fromEnd: End;
      x: number;
      y: number;
      target: { id: string; end: End } | null;
      invalid: boolean;
    }
  | { kind: 'marquee'; x0: number; y0: number; x: number; y: number; additive: boolean };

interface Props {
  rows: Row[];
  hues: Map<string, number>;
  schedule: ScheduleResult;
  links: Link[];
  timeline: Timeline;
  criticalOnly: boolean;
}

export function Gantt({ rows, hues, schedule, links, timeline: tl, criticalOnly }: Props) {
  const selection = useStore((s) => s.selection);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [tip, setTip] = useState<{ id: string; x: number; y: number } | null>(null);
  /* Where the dependency popover opens: the point the arrow was clicked. */
  const [linkAt, setLinkAt] = useState<{ x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;

  const height = Math.max(rows.length * ROW_H + 40, 160);
  const rowIndex = new Map(rows.map((r, i) => [r.task.id, i]));
  const isDim = (id: string) => criticalOnly && !schedule.byId.get(id)?.critical;
  const selected = new Set(selection.taskIds);

  /* ---- geometry helpers: every hit test is arithmetic, not elementFromPoint ---- */

  const local = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  /** Which row a y coordinate falls in — the whole row width is a target. */
  const rowAt = (y: number): Row | null => rows[Math.floor(y / ROW_H)] ?? null;

  /** Which end of a bar a drop at x means: left half starts it, right half finishes it. */
  const endAt = (taskId: string, x: number): End => {
    const s = schedule.byId.get(taskId);
    if (!s) return 'start';
    const x0 = tl.x(s.start);
    const x1 = tl.x(s.end);
    return x < (x0 + x1) / 2 ? 'start' : 'end';
  };

  const begin = useCallback((d: Drag) => {
    setDrag(d);
    dragRef.current = d;
    setTip(null);
  }, []);

  /* ---- gesture handling: track in pixels, commit once on release ---- */

  const isDragging = drag !== null;
  useEffect(() => {
    if (!isDragging) return;

    const move = (e: PointerEvent) => {
      const cur = dragRef.current;
      if (!cur) return;
      const p = local(e);

      if (cur.kind === 'link') {
        const row = rowAt(p.y);
        const id = row?.task.id;
        const bad = !row || row.task.type === 'summary' || id === cur.fromId;
        setDrag({
          ...cur,
          x: p.x,
          y: p.y,
          target: !bad && id ? { id, end: endAt(id, p.x) } : null,
          invalid: !!row && bad,
        });
      } else if (cur.kind === 'marquee') {
        setDrag({ ...cur, x: p.x, y: p.y });
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
        if (cur.target) {
          const type = relationship(cur.fromEnd, cur.target.end);
          store.addLink(cur.fromId, cur.target.id, type);
        }
        return;
      }

      if (cur.kind === 'marquee') {
        const hit = marqueeHits(cur);
        if (hit.length) {
          const keep = cur.additive ? selection.taskIds : [];
          store.select({
            taskIds: [...new Set([...keep, ...hit])],
            linkId: null,
            anchorId: hit[0],
          });
        } else if (!cur.additive && Math.abs(cur.x - cur.x0) < 3 && Math.abs(cur.y - cur.y0) < 3) {
          store.clearSelection();
        }
        return;
      }

      if (cur.kind === 'move') {
        const s = schedule.byId.get(cur.ids[0]);
        if (!s || cur.delta === 0) return;
        store.moveBy(cur.ids, shiftWorkDays(s.start, cur.delta));
        return;
      }

      const s = schedule.byId.get(cur.id);
      if (!s || cur.delta === 0) return;
      if (cur.edge === 'end') {
        const end = shiftedEnd(s.end, cur.delta);
        store.setDuration(cur.id, Math.max(1, end - s.start));
      } else {
        const start = s.start + shiftWorkDays(s.start, cur.delta);
        if (start < s.end) store.resizeFromStart(cur.id, start);
      }
    };

    /** Esc abandons a gesture rather than committing whatever is under the cursor. */
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setDrag(null);
      dragRef.current = null;
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', key, true);
    };
  }, [isDragging, tl, schedule, rows, selection.taskIds]);

  /** Every non-summary bar the rubber-band rectangle touches. */
  function marqueeHits(m: Extract<Drag, { kind: 'marquee' }>): string[] {
    const [xa, xb] = m.x0 < m.x ? [m.x0, m.x] : [m.x, m.x0];
    const [ya, yb] = m.y0 < m.y ? [m.y0, m.y] : [m.y, m.y0];
    return rows
      .filter((row, i) => {
        if (row.task.type === 'summary') return false;
        const top = i * ROW_H;
        if (top + ROW_H < ya || top > yb) return false;
        const s = schedule.byId.get(row.task.id);
        if (!s) return false;
        const bx0 = tl.x(s.start) - 4;
        const bx1 = tl.x(s.end) + 4;
        return bx1 >= xa && bx0 <= xb;
      })
      .map((r) => r.task.id);
  }

  /* ---- preview geometry: show where the gesture will actually land ---- */

  function previewOf(task: Task): { start: WorkDay; end: WorkDay } | null {
    if (!drag || drag.kind === 'link' || drag.kind === 'marquee' || drag.delta === 0) return null;
    const mine = drag.kind === 'move' ? drag.ids.includes(task.id) : drag.id === task.id;
    if (!mine) return null;
    const s = schedule.byId.get(task.id);
    if (!s) return null;
    if (drag.kind === 'move') {
      const anchorStart = schedule.byId.get(drag.ids[0])!.start;
      const d = shiftWorkDays(anchorStart, drag.delta);
      return { start: s.start + d, end: s.end + d };
    }
    if (drag.edge === 'end') {
      const end = Math.max(s.start + (task.type === 'milestone' ? 0 : 1), shiftedEnd(s.end, drag.delta));
      return { start: s.start, end };
    }
    const start = Math.min(s.end - 1, s.start + shiftWorkDays(s.start, drag.delta));
    return { start, end: s.end };
  }

  function onRowDown(row: Row, e: React.PointerEvent) {
    const p = local(e);
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      useStore
        .getState()
        .selectTask(row.task.id, e.shiftKey ? 'range' : 'toggle');
      return;
    }
    begin({ kind: 'marquee', x0: p.x, y0: p.y, x: p.x, y: p.y, additive: false });
  }

  function onBarDown(row: Row, e: React.PointerEvent) {
    e.stopPropagation();
    const store = useStore.getState();
    const id = row.task.id;

    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      store.selectTask(id, e.shiftKey ? 'range' : 'toggle');
      return;
    }
    // Dragging a bar that is part of a multi-row selection moves the whole set.
    const ids = selected.has(id) && selected.size > 1 ? [...selection.taskIds] : [id];
    if (ids.length === 1) store.selectTask(id, 'replace');
    begin({ kind: 'move', ids: [id, ...ids.filter((x) => x !== id)], x0: e.clientX, delta: 0 });
  }

  useEffect(() => {
    if (!selection.linkId) setLinkAt(null);
  }, [selection.linkId]);

  const linkDrag = drag?.kind === 'link' ? drag : null;

  return (
    <>
      <svg ref={svgRef} className="gantt" width={tl.width} height={height}>
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

        {/* Selection bands sit under everything; the whole row reads as picked. */}
        {rows.map((row, i) =>
          selected.has(row.task.id) ? (
            <rect key={row.task.id} className="g-rowband" x={0} y={i * ROW_H} width={tl.width} height={ROW_H} />
          ) : null,
        )}

        {/* The drop zone while a dependency is being dragged: a whole row, not a bar. */}
        {linkDrag?.target && (
          <rect
            className="droprow"
            x={0}
            y={(rowIndex.get(linkDrag.target.id) ?? 0) * ROW_H}
            width={tl.width}
            height={ROW_H}
          />
        )}

        {/* Full-width row catchers: hovering anywhere in a row reveals its link
            handles, and pressing empty space starts a rubber-band selection. */}
        <g className="rowhits">
          {rows.map((row, i) => (
            <rect
              key={row.task.id}
              x={0}
              y={i * ROW_H}
              width={tl.width}
              height={ROW_H}
              fill="transparent"
              onPointerEnter={() => setHover(row.task.id)}
              onPointerLeave={() => setHover((h) => (h === row.task.id ? null : h))}
              onPointerDown={(e) => onRowDown(row, e)}
            />
          ))}
        </g>

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
                    setLinkAt({ x: e.clientX, y: e.clientY });
                    useStore.getState().select({ linkId: l.id, taskIds: [], anchorId: null });
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
            return (
              <Bar
                key={row.task.id}
                row={row}
                hue={hueClass(row, hues)}
                y={i * ROW_H}
                start={s.start}
                end={s.end}
                critical={s.critical}
                totalFloat={s.totalFloat}
                selected={selected.has(row.task.id)}
                dim={isDim(row.task.id)}
                active={
                  hover === row.task.id ||
                  linkDrag?.fromId === row.task.id ||
                  linkDrag?.target?.id === row.task.id
                }
                dragging={!!drag && (drag.kind === 'move' || drag.kind === 'resize')}
                dropEnd={linkDrag?.target?.id === row.task.id ? linkDrag.target.end : null}
                preview={previewOf(row.task)}
                tl={tl}
                onDown={(e) => onBarDown(row, e)}
                onResize={(edge, e) => {
                  e.stopPropagation();
                  useStore.getState().selectTask(row.task.id, 'replace');
                  begin({ kind: 'resize', id: row.task.id, edge, x0: e.clientX, delta: 0 });
                }}
                onLink={(end, e) => {
                  e.stopPropagation();
                  const p = local(e);
                  begin({
                    kind: 'link',
                    fromId: row.task.id,
                    fromEnd: end,
                    x: p.x,
                    y: p.y,
                    target: null,
                    invalid: false,
                  });
                }}
                onHover={setHover}
                onTip={(e) =>
                  !drag && setTip({ id: row.task.id, x: e.clientX, y: e.clientY })
                }
                onTipOut={() => setTip(null)}
              />
            );
          })}
        </g>

        {linkDrag && <Rubber drag={linkDrag} schedule={schedule} rowIndex={rowIndex} tl={tl} />}

        {drag?.kind === 'marquee' && (
          <rect
            className="marquee"
            x={Math.min(drag.x0, drag.x)}
            y={Math.min(drag.y0, drag.y)}
            width={Math.abs(drag.x - drag.x0)}
            height={Math.abs(drag.y - drag.y0)}
          />
        )}
      </svg>

      {tip && !drag && <BarTip tip={tip} schedule={schedule} rows={rows} links={links} />}
      {selection.linkId && linkAt && <LinkPopover at={linkAt} />}
    </>
  );
}

/* ---------------------------------------------------------------- bar ---- */

interface BarProps {
  row: Row;
  hue: string;
  y: number;
  start: WorkDay;
  end: WorkDay;
  critical: boolean;
  totalFloat: number;
  selected: boolean;
  dim: boolean;
  active: boolean;
  dragging: boolean;
  dropEnd: End | null;
  preview: { start: WorkDay; end: WorkDay } | null;
  tl: Timeline;
  onDown(e: React.PointerEvent): void;
  onResize(edge: End, e: React.PointerEvent): void;
  onLink(end: End, e: React.PointerEvent): void;
  onHover(id: string): void;
  onTip(e: React.PointerEvent): void;
  onTipOut(): void;
}

function Bar(p: BarProps) {
  const task = p.row.task;
  const { tl } = p;
  const x = tl.x(p.start);
  const w = Math.max(tl.x(p.end) - x, 2);
  const isMilestone = task.type === 'milestone';
  const isSummary = task.type === 'summary';
  const cls =
    `${p.critical ? ' critical' : p.hue}${p.selected ? ' sel' : ''}${p.dim ? ' dim' : ''}`;
  const mid = p.y + ROW_H / 2;
  const showKnobs = p.active && !p.dim && !isSummary && !p.dragging;
  const tailEnd = !p.critical && p.totalFloat > 0 && !isSummary ? tl.x(p.end + p.totalFloat) : x + w;

  return (
    <g
      onPointerEnter={() => p.onHover(task.id)}
      onPointerMove={p.onTip}
      onPointerLeave={p.onTipOut}
    >
      {/* Float tail: how far this activity could slip without moving the finish. */}
      {!p.dim && tailEnd > x + w && (
        <line className="floattail" x1={x + w} x2={tailEnd} y1={mid} y2={mid} />
      )}

      {isSummary ? (
        <SummaryBar x={x} w={w} y={p.y} cls={`${p.hue}${p.dim ? ' dim' : ''}${p.selected ? ' sel' : ''}`} onDown={p.onDown} />
      ) : isMilestone ? (
        <path className={`ms${cls}`} d={diamond(x, mid, 7.5)} onPointerDown={p.onDown} />
      ) : (
        <rect className={`bar${cls}`} x={x} y={p.y + BAR_Y} width={w} height={BAR_H} rx={4} onPointerDown={p.onDown} />
      )}

      {!p.dim && !isSummary && (
        <text className="bar-label" x={x + w + KNOB_OUT + 8} y={mid}>
          {task.name}
        </text>
      )}

      {/* Link handles, one per end. The dot is small; its target is not, which
          is the whole difference between linking being easy and being fiddly. */}
      {showKnobs &&
        (['start', 'end'] as End[]).map((end) => {
          const cx = end === 'start' ? x - KNOB_OUT : x + w + KNOB_OUT;
          const hot = p.dropEnd === end;
          return (
            <g key={end}>
              <circle
                className="knob-hit"
                cx={cx}
                cy={mid}
                r={KNOB_HIT}
                onPointerDown={(e) => p.onLink(end, e)}
              />
              <circle className={`knob${hot ? ' hot' : ''}`} cx={cx} cy={mid} r={4} />
            </g>
          );
        })}

      {/* Resize handles are drawn last so they win the overlap with the knobs. */}
      {!isMilestone && !isSummary && !p.dim && (
        <>
          <rect
            className="handle"
            x={x - 3}
            y={p.y + BAR_Y}
            width={6}
            height={BAR_H}
            onPointerDown={(e) => p.onResize('start', e)}
          />
          <rect
            className="handle"
            x={x + w - 3}
            y={p.y + BAR_Y}
            width={6}
            height={BAR_H}
            onPointerDown={(e) => p.onResize('end', e)}
          />
        </>
      )}

      {p.dropEnd && (
        <circle
          className="drop-target"
          cx={p.dropEnd === 'start' ? x : x + w}
          cy={mid}
          r={7}
        />
      )}

      {p.preview && <Preview preview={p.preview} y={p.y} type={task.type} tl={tl} />}
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
      <rect className="ghost" x={px} y={y + BAR_Y} width={pw} height={BAR_H} rx={4} />
      <rect className="ghost-outline" x={px} y={y + BAR_Y} width={pw} height={BAR_H} rx={4} />
      <text className="drag-readout" x={px} y={y - 1}>
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
  cls,
  onDown,
}: {
  x: number;
  w: number;
  y: number;
  cls: string;
  onDown(e: React.PointerEvent): void;
}) {
  const top = y + BAR_Y + 2;
  const h = 6;
  const cap = 5;
  return (
    <path
      className={`sumbar${cls}`}
      onPointerDown={onDown}
      d={
        `M${x} ${top} H${x + w} V${top + h} ` +
        `L${x + w - cap} ${top + h} L${x + w - cap} ${top + h + cap} L${x + w - cap * 2.2} ${top + h} ` +
        `H${x + cap * 2.2} L${x + cap} ${top + h + cap} L${x + cap} ${top + h} L${x} ${top + h} Z`
      }
    />
  );
}

/* ---- the rubber band, and the relationship it is about to create ---- */

function Rubber({
  drag,
  schedule,
  rowIndex,
  tl,
}: {
  drag: Extract<Drag, { kind: 'link' }>;
  schedule: ScheduleResult;
  rowIndex: Map<string, number>;
  tl: Timeline;
}) {
  const s = schedule.byId.get(drag.fromId);
  if (!s) return null;
  const sx = tl.x(drag.fromEnd === 'end' ? s.end : s.start) + (drag.fromEnd === 'end' ? KNOB_OUT : -KNOB_OUT);
  const sy = (rowIndex.get(drag.fromId) ?? 0) * ROW_H + ROW_H / 2;
  const bad = drag.invalid || !drag.target;
  const bow = Math.max(24, Math.abs(drag.x - sx) / 2);
  const dir = drag.fromEnd === 'end' ? 1 : -1;
  const d = `M${sx} ${sy} C${sx + dir * bow} ${sy}, ${drag.x - dir * bow} ${drag.y}, ${drag.x} ${drag.y}`;

  return (
    <g>
      <path className={`rubber${bad ? ' bad' : ''}`} d={d} />
      <circle className={`rubber-dot${bad ? ' bad' : ''}`} cx={drag.x} cy={drag.y} r={3.5} />
      {drag.target && (
        <g>
          <rect className="relbadge" x={drag.x + 10} y={drag.y - 20} width={26} height={15} rx={3} />
          <text className="relbadge-text" x={drag.x + 23} y={drag.y - 12}>
            {relationship(drag.fromEnd, drag.target.end)}
          </text>
        </g>
      )}
    </g>
  );
}

/* ---- hover read-out, replacing the old selection card ---- */

function BarTip({
  tip,
  schedule,
  rows,
  links,
}: {
  tip: { id: string; x: number; y: number };
  schedule: ScheduleResult;
  rows: Row[];
  links: Link[];
}) {
  const row = rows.find((r) => r.task.id === tip.id);
  const s = schedule.byId.get(tip.id);
  if (!row || !s) return null;
  const preds = links.filter((l) => l.toId === tip.id).length;
  const succs = links.filter((l) => l.fromId === tip.id).length;
  const isSummary = row.task.type === 'summary';

  return (
    <div
      className="tip"
      style={{
        left: Math.min(tip.x + 14, window.innerWidth - 270),
        top: Math.min(tip.y + 18, window.innerHeight - 110),
      }}
    >
      <div className="t-name">{row.task.name || 'Untitled activity'}</div>
      <div className="t-row">
        <b>{formatWorkDay(s.start)}</b> → <b>{formatWorkDay(Math.max(s.start, s.end - 1))}</b>
      </div>
      {!isSummary && (
        <div className="t-row">
          {row.task.type === 'milestone' ? 'Milestone' : `${row.task.duration}d`} ·{' '}
          {s.critical ? <span className="t-crit">critical</span> : `${s.totalFloat}d float`}
        </div>
      )}
      {(preds > 0 || succs > 0) && (
        <div className="t-row">
          {preds} in · {succs} out
        </div>
      )}
      {row.task.constraint && (
        <div className="t-row">Held on {formatWorkDay(row.task.constraint.day)}</div>
      )}
    </div>
  );
}

function TodayLine({ tl, height }: { tl: Timeline; height: number }) {
  const x = todayX(tl);
  if (x === null) return null;
  return (
    <g>
      <line className="g-today" x1={x} x2={x} y1={0} y2={height} shapeRendering="crispEdges" />
    </g>
  );
}

/* ------------------------------------------------------------ helpers ---- */

/** Grabbed end × released end → relationship type. All four come from the mouse. */
function relationship(from: End, to: End): LinkType {
  return `${from === 'end' ? 'F' : 'S'}${to === 'start' ? 'S' : 'F'}` as LinkType;
}

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
