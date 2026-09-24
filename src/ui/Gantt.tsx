import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  calIndexFromWorkDay,
  formatWorkDay,
  workDayFromCalIndex,
  type DateFormat,
} from '../engine/calendar';
import type { Link, LinkType, ScheduleResult, Task, WorkDay } from '../engine/types';
import { useStore } from '../store/store';
import { hueClass } from './colors';
import { textWidth } from './measure';
import type { Settings, TextPos } from './settings';
import { Button } from './Button';
import { LinkPopover } from './LinkPopover';
import { anchorsFor, routeDependency, type Anchor } from './linkPath';
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

/* Memoised: opening a cell editor in the table changes nothing the chart
   draws, and re-rendering the whole SVG for it was what made editing lag. */
export const Gantt = memo(function Gantt({ rows, hues, schedule, links, timeline: tl, criticalOnly }: Props) {
  const selection = useStore((s) => s.selection);
  const settings = useStore((s) => s.settings);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [tip, setTip] = useState<{ id: string; x: number; y: number } | null>(null);
  /* Where the dependency popover opens: the point the arrow was clicked. */
  const [linkAt, setLinkAt] = useState<{ x: number; y: number } | null>(null);
  /* After dragging an activity that has predecessors: record it as a
     constraint (applied) or as lag on the link (offered). */
  const [prompt, setPrompt] = useState<{ id: string; delta: number; x: number; y: number } | null>(null);
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
        const bad = !row || id === cur.fromId;
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

    const up = (e: PointerEvent) => {
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
        const id = cur.ids[0];
        const s = schedule.byId.get(id);
        if (!s || cur.delta === 0) return;
        const target = s.start + shiftWorkDays(s.start, cur.delta);
        const task = rows.find((r) => r.task.id === id)?.task;
        const driven =
          cur.ids.length === 1 && task?.type !== 'summary' && store.hasDirectPredecessors(id);
        const logic = driven ? store.logicStart(id) : null;

        store.moveBy(cur.ids, target - s.start);
        if (!driven || logic === null) return;

        if (target < logic) {
          // A Start No Earlier Than date cannot pull an activity ahead of its
          // predecessor. Lag can, so that is the only way to honour the drag.
          const lag = store.constraintToLag(id, true);
          if (lag !== null) store.notify(`Moved earlier by setting the link's lag to ${lag}d.`);
        } else if (target === logic) {
          // Dropped exactly where the logic puts it: nothing to record.
          store.clearConstraint(id);
        } else {
          setPrompt({ id, delta: target - logic, x: e.clientX, y: e.clientY });
        }
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
      <svg
        ref={svgRef}
        className={`gantt${settings.colorMode === 'type' ? ' by-type' : ''}`}
        width={tl.width}
        height={height}
      >
        {/* Catches everything past the last row, so clicking empty space
            clears the selection and a rubber band can start out there. */}
        <rect
          x={0}
          y={0}
          width={tl.width}
          height={height}
          fill="transparent"
          onPointerDown={(e) => {
            const pt = local(e);
            begin({ kind: 'marquee', x0: pt.x, y0: pt.y, x: pt.x, y: pt.y, additive: false });
          }}
        />

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
            const target = rows[rowIndex.get(l.toId)!]?.task;
            const { d, arrow } = routeDependency(
              a.from,
              a.to,
              shapeHalfHeight(target?.type, settings.summaryText === 'inside'),
              target?.type === 'milestone',
              i % 3,
            );
            return (
              <g key={l.id}>
                <path className={`link${cls}`} d={d} />
                <polygon className={`link-arrow${cls}`} points={arrow} />
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
                settings={settings}
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

      {tip && !drag && (
        <BarTip tip={tip} schedule={schedule} rows={rows} links={links} fmt={settings.dateFormat} />
      )}
      {selection.linkId && linkAt && <LinkPopover at={linkAt} />}
      {prompt && <ConstraintPrompt prompt={prompt} fmt={settings.dateFormat} onClose={() => setPrompt(null)} />}
    </>
  );
});

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
  settings: Settings;
  onDown(e: React.PointerEvent): void;
  onResize(edge: End, e: React.PointerEvent): void;
  onLink(end: End, e: React.PointerEvent): void;
  onHover(id: string): void;
  onTip(e: React.PointerEvent): void;
  onTipOut(): void;
}

function Bar(p: BarProps) {
  const task = p.row.task;
  const { tl, settings: st } = p;
  const x = tl.x(p.start);
  const w = Math.max(tl.x(p.end) - x, 2);
  const isMilestone = task.type === 'milestone';
  const isSummary = task.type === 'summary';
  const cls =
    `${p.critical ? ' critical' : p.hue}${p.selected ? ' sel' : ''}${p.dim ? ' dim' : ''}`;
  const mid = p.y + ROW_H / 2;
  const showKnobs = p.active && !p.dim && !p.dragging;
  const tail =
    st.floatTails && !p.critical && p.totalFloat > 0 && !isSummary ? tl.x(p.end + p.totalFloat) : null;

  const label = labelFor(task, p.start, st);
  const place = isMilestone
    ? milestonePlacement(x, label, st)
    : labelPlacement(x, w, tail, label, isSummary ? st.summaryText : st.barText);

  return (
    <g
      onPointerEnter={() => p.onHover(task.id)}
      onPointerMove={p.onTip}
      onPointerLeave={p.onTipOut}
    >
      {/* Float tail: how far this activity could slip without moving the finish.
          Drawn with an end tick so it reads as a span, not as stray dots. */}
      {!p.dim && tail !== null && tail > x + w && (
        <g className="floattail">
          <line x1={x + w} x2={tail} y1={mid} y2={mid} />
          <line className="cap" x1={tail} x2={tail} y1={mid - 3.5} y2={mid + 3.5} />
        </g>
      )}

      {isSummary ? (
        <SummaryBar
          x={x}
          w={w}
          y={p.y}
          shape={st.summaryShape}
          // Text inside a summary needs a full-height bar; otherwise it keeps
          // the thin bracket profile.
          thick={st.summaryText === 'inside'}
          cls={`${p.hue}${p.dim ? ' dim' : ''}${p.selected ? ' sel' : ''}`}
          onDown={p.onDown}
        />
      ) : isMilestone ? (
        <path className={`ms${cls}`} d={milestonePath(st.milestoneShape, x, mid, 7.5)} onPointerDown={p.onDown} />
      ) : (
        <rect
          className={`bar${cls}`}
          x={x}
          y={p.y + BAR_Y}
          width={w}
          height={BAR_H}
          rx={st.barShape === 'rounded' ? 4 : 0}
          onPointerDown={p.onDown}
        />
      )}

      {!p.dim && label && place && (
        <g>
          {/* A backing plate exactly as wide as the text. Without it, a
              dependency line crossing the label shows through the spaces
              between words and reads as stray dots. */}
          {!place.inside && (
            <rect
              className={`label-bg${p.selected ? ' sel' : ''}`}
              x={(place.anchor === 'end' ? place.x - place.width : place.x) - 3}
              y={mid - 8}
              width={place.width + 6}
              height={16}
            />
          )}
          <text
            className={`bar-label${place.inside ? ' inside' : ''}${
              place.inside && (p.critical || isSummary) ? ' on-fill' : ''
            }${isSummary ? ' summary' : ''}`}
            x={place.x}
            y={place.inside && isSummary ? mid + SUMMARY_THICK.top + SUMMARY_THICK.band / 2 + 0.5 : mid}
            textAnchor={place.anchor}
          >
            {label}
          </text>
        </g>
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
        <circle className="drop-target" cx={p.dropEnd === 'start' ? x : x + w} cy={mid} r={7} />
      )}

      {p.preview && <Preview preview={p.preview} y={p.y} type={task.type} tl={tl} fmt={st.dateFormat} />}
    </g>
  );
}

/* ---- what a bar says, and where it says it ---- */

function labelFor(task: Task, start: WorkDay, st: Settings): string {
  if (task.type !== 'milestone') {
    const pos = task.type === 'summary' ? st.summaryText : st.barText;
    return pos === 'none' ? '' : task.name;
  }
  const date = formatWorkDay(start, st.dateFormat);
  switch (st.milestoneLabel) {
    case 'name':
      return task.name;
    case 'date':
      return date;
    case 'both':
      return task.name ? `${task.name} · ${date}` : date;
    default:
      return '';
  }
}

interface Placement {
  x: number;
  anchor: 'start' | 'end';
  inside: boolean;
  width: number;
}

const GAP = KNOB_OUT + 8;

function labelPlacement(
  x: number,
  w: number,
  tail: number | null,
  label: string,
  pos: TextPos,
): Placement | null {
  if (!label || pos === 'none') return null;
  const width = textWidth(label);
  if (pos === 'left') return { x: x - GAP, anchor: 'end', inside: false, width };
  // Inside only when it actually fits; otherwise fall through to the right,
  // which is what you wanted to see rather than a clipped word.
  if (pos === 'inside' && w > width + 16) {
    return { x: x + 8, anchor: 'start', inside: true, width };
  }
  // Past the float tail, so the two never draw through each other.
  return { x: Math.max(x + w, tail ?? 0) + GAP, anchor: 'start', inside: false, width };
}

function milestonePlacement(x: number, label: string, st: Settings): Placement | null {
  if (st.milestoneLabel === 'none' || !label) return null;
  const width = textWidth(label);
  return st.milestoneSide === 'left'
    ? { x: x - 13, anchor: 'end', inside: false, width }
    : { x: x + 13, anchor: 'start', inside: false, width };
}

function Preview({
  preview,
  y,
  type,
  tl,
  fmt,
}: {
  preview: { start: WorkDay; end: WorkDay };
  y: number;
  type: Task['type'];
  tl: Timeline;
  fmt: DateFormat;
}) {
  const px = tl.x(preview.start);
  const pw = Math.max(tl.x(preview.end) - px, 2);
  const finish = preview.end - (type === 'milestone' ? 0 : 1);
  return (
    <g>
      <rect className="ghost" x={px} y={y + BAR_Y} width={pw} height={BAR_H} rx={4} />
      <rect className="ghost-outline" x={px} y={y + BAR_Y} width={pw} height={BAR_H} rx={4} />
      <text className="drag-readout" x={px} y={y - 1}>
        {formatWorkDay(preview.start, fmt)}
        {type !== 'milestone' && ` → ${formatWorkDay(finish, fmt)}`}
      </text>
    </g>
  );
}

/**
 * Summary geometry. Both forms are the scheduling-tool bracket — a band with a
 * downward leg at each end — so a summary never reads as a task bar. The thick
 * form exists only to hold a label inside it.
 */
const SUMMARY_THIN = { top: -6, band: 5, cap: 5, half: 6 };
const SUMMARY_THICK = { top: -8, band: 11, cap: 5, half: 8 };

function bracketPath(x: number, w: number, top: number, band: number, cap: number): string {
  const c = Math.min(cap, w / 2);
  const bottom = top + band;
  return (
    `M${x} ${top} H${x + w} V${bottom + c} L${x + w - c} ${bottom} ` +
    `H${x + c} L${x} ${bottom + c} Z`
  );
}

function SummaryBar({
  x,
  w,
  y,
  shape,
  thick,
  cls,
  onDown,
}: {
  x: number;
  w: number;
  y: number;
  shape: Settings['summaryShape'];
  thick: boolean;
  cls: string;
  onDown(e: React.PointerEvent): void;
}) {
  const mid = y + ROW_H / 2;
  if (!thick && shape === 'bar') {
    return (
      <rect
        className={`sumbar solid${cls}`}
        x={x}
        y={y + BAR_Y + 4}
        width={w}
        height={BAR_H - 8}
        rx={2}
        onPointerDown={onDown}
      />
    );
  }
  const g = thick ? SUMMARY_THICK : SUMMARY_THIN;
  return (
    <path
      className={`sumbar${thick ? ' thick' : ''}${cls}`}
      onPointerDown={onDown}
      d={bracketPath(x, w, mid + g.top, g.band, g.cap)}
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

/* ---- after dragging a driven activity: constraint or lag ---- */

/**
 * Dragging an activity that has a predecessor has two honest readings, and
 * scheduling tools make you pick. The move is applied as a Start No Earlier
 * Than constraint straight away, so the chart never waits on a question; this
 * offers to record it as lag on the driving link instead, which keeps the
 * activity moving with its predecessor.
 */
function ConstraintPrompt({
  prompt,
  fmt,
  onClose,
}: {
  prompt: { id: string; delta: number; x: number; y: number };
  fmt: DateFormat;
  onClose(): void;
}) {
  const task = useStore((s) => s.doc?.tasks.find((t) => t.id === prompt.id));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', key);
    };
  }, [onClose]);

  // The constraint may already be gone — an undo, or a remote edit.
  if (!task?.constraint) return null;
  const name = task.name || 'This activity';

  return (
    <div
      ref={ref}
      className="pop constraint-prompt"
      style={{
        left: Math.min(prompt.x + 12, window.innerWidth - 340),
        top: Math.min(prompt.y + 14, window.innerHeight - 150),
      }}
    >
      <div className="cp-title">
        {name} → Start No Earlier Than {formatWorkDay(task.constraint.day, fmt)}
      </div>
      <div className="hint">
        Or keep it driven by its predecessor, with {prompt.delta}d more lag on the link.
      </div>
      <div className="row">
        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            const lag = useStore.getState().constraintToLag(prompt.id);
            if (lag !== null) useStore.getState().notify(`Link lag set to ${lag}d.`);
            onClose();
          }}
        >
          Add {prompt.delta}d lag instead
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Keep constraint
        </Button>
      </div>
    </div>
  );
}

/* ---- hover read-out, replacing the old selection card ---- */

function BarTip({
  tip,
  schedule,
  rows,
  links,
  fmt,
}: {
  tip: { id: string; x: number; y: number };
  schedule: ScheduleResult;
  rows: Row[];
  links: Link[];
  fmt: DateFormat;
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
        <b>{formatWorkDay(s.start, fmt)}</b> → <b>{formatWorkDay(Math.max(s.start, s.end - 1), fmt)}</b>
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
        <div className="t-row">Start No Earlier Than {formatWorkDay(row.task.constraint.day, fmt)}</div>
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

/** Half the drawn height of a row's shape, so an arrow stops at its edge. */
function shapeHalfHeight(type: Task['type'] | undefined, thickSummary: boolean): number {
  if (type === 'milestone') return 7.5;
  if (type === 'summary') return thickSummary ? SUMMARY_THICK.half : 6;
  return BAR_H / 2;
}

/** Grabbed end × released end → relationship type. All four come from the mouse. */
function relationship(from: End, to: End): LinkType {
  return `${from === 'end' ? 'F' : 'S'}${to === 'start' ? 'S' : 'F'}` as LinkType;
}

function milestonePath(shape: Settings['milestoneShape'], cx: number, cy: number, r: number): string {
  switch (shape) {
    case 'triangle':
      return `M${cx} ${cy - r} L${cx + r} ${cy + r * 0.8} L${cx - r} ${cy + r * 0.8} Z`;
    case 'square':
      return `M${cx - r * 0.82} ${cy - r * 0.82} h${r * 1.64} v${r * 1.64} h${-r * 1.64} Z`;
    case 'circle': {
      const k = r * 0.92;
      return `M${cx - k} ${cy} a${k} ${k} 0 1 0 ${k * 2} 0 a${k} ${k} 0 1 0 ${-k * 2} 0 Z`;
    }
    default:
      return `M${cx} ${cy - r} L${cx + r} ${cy} L${cx} ${cy + r} L${cx - r} ${cy} Z`;
  }
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
