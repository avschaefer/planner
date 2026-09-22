import { toWorkDay } from './calendar';
import { descendants, schedulable, topoSort, treeOrder } from './graph';
import type { Link, ProjectDoc, Scheduled, ScheduleResult, Task, WorkDay } from './types';

/**
 * Positions use an exclusive end boundary: a 5-day activity starting on
 * Monday has start=M, end=M+5, and displays a finish of M+4 (Friday). A
 * milestone has duration 0, so start === end and it is a point in time.
 *
 * Every relationship type then reduces to one inequality on those boundaries,
 * with no weekend or milestone special cases.
 */

export function durationOf(t: Task): number {
  if (t.type === 'milestone') return 0;
  return Math.max(0, Math.round(t.duration));
}

/** Earliest start `to` may take given `from`'s scheduled position. */
function earliestStart(link: Link, from: Scheduled, toDuration: number): WorkDay {
  switch (link.type) {
    case 'FS':
      return from.end + link.lag;
    case 'SS':
      return from.start + link.lag;
    case 'FF':
      return from.end + link.lag - toDuration;
    case 'SF':
      return from.start + link.lag - toDuration;
  }
}

/** Latest end `from` may take given `to`'s late dates. */
function latestEnd(link: Link, to: Scheduled, fromDuration: number): WorkDay {
  switch (link.type) {
    case 'FS':
      return to.lateStart - link.lag;
    case 'SS':
      return to.lateStart - link.lag + fromDuration;
    case 'FF':
      return to.lateEnd - link.lag;
    case 'SF':
      return to.lateEnd - link.lag + fromDuration;
  }
}

export function scheduleProject(doc: ProjectDoc): ScheduleResult {
  const activities = schedulable(doc.tasks);
  const ids = activities.map((t) => t.id);
  const byId = new Map(activities.map((t) => [t.id, t]));
  const projectStart = toWorkDay(doc.dataDate, 'forward');

  const links = doc.links.filter((l) => byId.has(l.fromId) && byId.has(l.toId));
  const preds = new Map<string, Link[]>();
  const succs = new Map<string, Link[]>();
  const push = (m: Map<string, Link[]>, key: string, l: Link) => {
    const list = m.get(key);
    if (list) list.push(l);
    else m.set(key, [l]);
  };
  for (const l of links) {
    push(preds, l.toId, l);
    push(succs, l.fromId, l);
  }

  // A cycle here means a link slipped past validation; fall back to tree order
  // so the app still renders something rather than throwing at the user.
  const order = topoSort(ids, links) ?? ids;
  const out = new Map<string, Scheduled>();

  // Forward pass.
  for (const id of order) {
    const task = byId.get(id)!;
    const dur = durationOf(task);
    let start = task.constraint ? Math.max(projectStart, task.constraint.day) : projectStart;
    for (const l of preds.get(id) ?? []) {
      const from = out.get(l.fromId);
      if (from) start = Math.max(start, earliestStart(l, from, dur));
    }
    out.set(id, {
      start,
      end: start + dur,
      lateStart: 0,
      lateEnd: 0,
      totalFloat: 0,
      critical: false,
    });
  }

  const projectEnd = out.size
    ? Math.max(...[...out.values()].map((s) => s.end))
    : projectStart;

  // Backward pass.
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i];
    const task = byId.get(id)!;
    const dur = durationOf(task);
    const self = out.get(id)!;
    let lateEnd = projectEnd;
    for (const l of succs.get(id) ?? []) {
      const to = out.get(l.toId);
      if (to) lateEnd = Math.min(lateEnd, latestEnd(l, to, dur));
    }
    self.lateEnd = lateEnd;
    self.lateStart = lateEnd - dur;
    self.totalFloat = self.lateStart - self.start;
    self.critical = self.totalFloat <= 0;
  }

  rollUpSummaries(doc.tasks, out, projectStart);

  return { byId: out, projectStart, projectEnd, order };
}

/**
 * Summaries are containers, not activities: they carry no logic of their own and
 * their bar is simply the extent of everything beneath them.
 */
function rollUpSummaries(
  tasks: Task[],
  out: Map<string, Scheduled>,
  projectStart: WorkDay,
): void {
  const summaries = treeOrder(tasks).filter((t) => t.type === 'summary');
  // Deepest first, so a nested summary is resolved before its parent reads it.
  for (let i = summaries.length - 1; i >= 0; i--) {
    const s = summaries[i];
    const kids = descendants(tasks, s.id)
      .map((d) => out.get(d.id))
      .filter((x): x is Scheduled => !!x);
    if (!kids.length) {
      out.set(s.id, {
        start: projectStart,
        end: projectStart,
        lateStart: projectStart,
        lateEnd: projectStart,
        totalFloat: 0,
        critical: false,
      });
      continue;
    }
    out.set(s.id, {
      start: Math.min(...kids.map((k) => k.start)),
      end: Math.max(...kids.map((k) => k.end)),
      lateStart: Math.min(...kids.map((k) => k.lateStart)),
      lateEnd: Math.max(...kids.map((k) => k.lateEnd)),
      totalFloat: Math.min(...kids.map((k) => k.totalFloat)),
      critical: kids.some((k) => k.critical),
    });
  }
}
