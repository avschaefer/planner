import { formatWorkDay } from '../engine/calendar';
import { formatRelationship } from '../engine/predecessors';
import type { ScheduleResult } from '../engine/types';
import { useStore } from '../store/store';

/**
 * A compact read-out for the selected activity, anchored beside the table.
 * Deliberately not a full-height properties panel.
 */
export function Inspector({ schedule, anchor }: { schedule: ScheduleResult; anchor: DOMRect }) {
  const doc = useStore((s) => s.doc)!;
  const taskId = useStore((s) => s.selection.taskId)!;
  const select = useStore((s) => s.select);
  const clearConstraint = useStore((s) => s.clearConstraint);

  const task = doc.tasks.find((t) => t.id === taskId);
  const s = schedule.byId.get(taskId);
  if (!task || !s) return null;

  const codeOf = (id: string) => doc.tasks.find((t) => t.id === id)?.code ?? '?';
  const nameOf = (id: string) => doc.tasks.find((t) => t.id === id)?.name || 'Untitled';
  const preds = doc.links.filter((l) => l.toId === taskId);
  const succs = doc.links.filter((l) => l.fromId === taskId);

  return (
    <div className="pop" style={{ left: anchor.left + 12, bottom: window.innerHeight - anchor.bottom + 12 }}>
      <h4>
        {task.code} · {task.type === 'summary' ? 'Summary' : task.type === 'milestone' ? 'Milestone' : 'Activity'}
      </h4>
      <div className="kv">
        <span>Start</span>
        <b>{formatWorkDay(s.start)}</b>
      </div>
      <div className="kv">
        <span>Finish</span>
        <b>{formatWorkDay(Math.max(s.start, s.end - 1))}</b>
      </div>
      {task.type !== 'summary' && (
        <div className="kv">
          <span>Duration</span>
          <b>{task.duration}d</b>
        </div>
      )}
      <div className="kv">
        <span>Total float</span>
        <b className={s.critical ? 'crit' : undefined}>
          {s.critical ? 'Critical — drives the finish' : `${s.totalFloat}d`}
        </b>
      </div>

      {task.constraint && (
        <>
          <hr />
          <div className="kv">
            <span>Pinned to</span>
            <b>{formatWorkDay(task.constraint.day)}</b>
          </div>
          <div className="row">
            <button className="plain" onClick={() => clearConstraint(task.id)}>
              Release to logic
            </button>
          </div>
        </>
      )}

      {(preds.length > 0 || succs.length > 0) && <hr />}
      {preds.length > 0 && (
        <>
          <h4>Driven by</h4>
          {preds.map((l) => (
            <div key={l.id} className="link-line" onClick={() => select({ linkId: l.id, taskId: null })}>
              <b>{codeOf(l.fromId)}</b> {formatRelationship(l.type, l.lag)} · {nameOf(l.fromId)}
            </div>
          ))}
        </>
      )}
      {succs.length > 0 && (
        <>
          <h4 style={{ marginTop: 8 }}>Drives</h4>
          {succs.map((l) => (
            <div key={l.id} className="link-line" onClick={() => select({ linkId: l.id, taskId: null })}>
              <b>{codeOf(l.toId)}</b> {formatRelationship(l.type, l.lag)} · {nameOf(l.toId)}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
