/**
 * Stored model. Everything a user typed lives here; nothing derived does.
 *
 * Positions are working-day indices (WorkDay), not dates. Index 0 is Monday
 * 2000-01-03. Weekends do not exist inside the engine, which is why "+5 days"
 * is literally `+ 5` and negative lag needs no special case.
 */

export type Iso = string; // 'YYYY-MM-DD'
export type WorkDay = number;

export type TaskType = 'task' | 'milestone' | 'summary';
export type LinkType = 'FS' | 'SS' | 'FF' | 'SF';

export interface Task {
  id: string;
  code: string;
  name: string;
  type: TaskType;
  /** Working days. 0 for a milestone. Ignored for a summary (derived). */
  duration: number;
  parentId: string | null;
  order: number;
  collapsed?: boolean;
  /** Start-no-earlier-than, set by dragging a task that has predecessors. */
  constraint?: { type: 'SNET'; day: WorkDay };
}

export interface Link {
  id: string;
  fromId: string;
  toId: string;
  type: LinkType;
  /** Working days. May be negative. */
  lag: number;
}

export interface ProjectDoc {
  id: string;
  name: string;
  /** Project start. No activity is scheduled before this day. */
  dataDate: Iso;
  tasks: Task[];
  links: Link[];
  updatedAt: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
  taskCount: number;
}

/** Derived per schedule run. Never stored. */
export interface Scheduled {
  /** Inclusive start. */
  start: WorkDay;
  /** Exclusive end boundary: start + duration. Display finish is end - 1. */
  end: WorkDay;
  lateStart: WorkDay;
  lateEnd: WorkDay;
  totalFloat: number;
  critical: boolean;
}

export interface ScheduleResult {
  byId: Map<string, Scheduled>;
  projectStart: WorkDay;
  projectEnd: WorkDay;
  /** Topological order of scheduled (non-summary) activities. */
  order: string[];
}
