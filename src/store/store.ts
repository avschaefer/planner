import { create } from 'zustand';
import {
  descendants,
  durationOf,
  scheduleProject,
  todayIso,
  toWorkDay,
  treeOrder,
  wouldCycle,
} from '../engine';
import type {
  Link,
  LinkType,
  ProjectDoc,
  ProjectSummary,
  ScheduleResult,
  Task,
  TaskType,
  WorkDay,
} from '../engine/types';
import { idbRepo } from '../persist/idbRepo';
import type { ScheduleRepo } from '../persist/repo';

const repo: ScheduleRepo = idbRepo;
const UNDO_LIMIT = 100;

const uid = () => Math.random().toString(36).slice(2, 10);

export interface Selection {
  taskId: string | null;
  linkId: string | null;
}

interface State {
  view: 'projects' | 'schedule';
  projects: ProjectSummary[];
  doc: ProjectDoc | null;
  schedule: ScheduleResult | null;
  undoStack: ProjectDoc[];
  redoStack: ProjectDoc[];
  selection: Selection;
  pxPerDay: number;
  criticalOnly: boolean;
  notice: string | null;
  loading: boolean;

  init(): Promise<void>;
  createProject(name: string): Promise<void>;
  openProject(id: string): Promise<void>;
  closeProject(): void;
  deleteProject(id: string): Promise<void>;
  renameProject(name: string): void;
  importDoc(doc: ProjectDoc): Promise<void>;

  addTask(afterId?: string | null): string | null;
  setName(id: string, name: string): void;
  setDuration(id: string, days: number): void;
  setType(id: string, type: TaskType): void;
  setStart(id: string, day: WorkDay): void;
  setFinish(id: string, day: WorkDay): void;
  clearConstraint(id: string): void;
  resizeFromStart(id: string, newStart: WorkDay): void;
  moveBy(id: string, deltaDays: number): void;
  deleteTask(id: string): void;
  indent(id: string): void;
  outdent(id: string): void;
  toggleCollapsed(id: string): void;

  addLink(fromId: string, toId: string, type?: LinkType, lag?: number): void;
  updateLink(id: string, patch: Partial<Pick<Link, 'type' | 'lag'>>): void;
  deleteLink(id: string): void;
  replacePredecessors(toId: string, next: Array<{ fromId: string; type: LinkType; lag: number }>): void;

  undo(): void;
  redo(): void;
  select(sel: Partial<Selection>): void;
  setPxPerDay(px: number): void;
  zoom(direction: 1 | -1): void;
  toggleCriticalOnly(): void;
  notify(message: string | null): void;
}

export const ZOOM_STEPS = [2, 3, 4.5, 7, 11, 16, 24, 34];

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(doc: ProjectDoc) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void repo.save(doc), 200);
}

/** Next code in the A1000, A1010, A1020 … series. */
function nextCode(tasks: Task[]): string {
  const nums = tasks
    .map((t) => /^A(\d+)$/.exec(t.code)?.[1])
    .filter(Boolean)
    .map(Number);
  const next = nums.length ? Math.max(...nums) + 10 : 1000;
  return `A${next}`;
}

function blankDoc(name: string): ProjectDoc {
  return {
    id: uid(),
    name,
    dataDate: todayIso(),
    tasks: [],
    links: [],
    updatedAt: new Date().toISOString(),
  };
}

export const useStore = create<State>((set, get) => {
  /**
   * The one way the document changes: snapshot, mutate a clone, reschedule,
   * persist. Undo is a stack of whole documents (EDD D-008) — at this size that
   * is a few kB and it is trivially correct for compound edits.
   */
  function commit(mutate: (draft: ProjectDoc) => void | false) {
    const { doc, undoStack } = get();
    if (!doc) return;
    const draft: ProjectDoc = structuredClone(doc);
    if (mutate(draft) === false) return;
    draft.updatedAt = new Date().toISOString();
    set({
      doc: draft,
      schedule: scheduleProject(draft),
      undoStack: [...undoStack, doc].slice(-UNDO_LIMIT),
      redoStack: [],
    });
    scheduleSave(draft);
  }

  function apply(doc: ProjectDoc) {
    set({ doc, schedule: scheduleProject(doc) });
    scheduleSave(doc);
  }

  /** Where an activity currently sits, so a drag can be expressed as a delta. */
  function startOf(id: string): WorkDay {
    return get().schedule?.byId.get(id)?.start ?? 0;
  }

  return {
    view: 'projects',
    projects: [],
    doc: null,
    schedule: null,
    undoStack: [],
    redoStack: [],
    selection: { taskId: null, linkId: null },
    pxPerDay: 16,
    criticalOnly: false,
    notice: null,
    loading: true,

    async init() {
      set({ projects: await repo.list(), loading: false });
    },

    async createProject(name) {
      const doc = blankDoc(name.trim() || 'Untitled schedule');
      await repo.save(doc);
      set({
        doc,
        schedule: scheduleProject(doc),
        view: 'schedule',
        undoStack: [],
        redoStack: [],
        selection: { taskId: null, linkId: null },
        projects: await repo.list(),
      });
    },

    async openProject(id) {
      const doc = await repo.load(id);
      if (!doc) return;
      set({
        doc,
        schedule: scheduleProject(doc),
        view: 'schedule',
        undoStack: [],
        redoStack: [],
        selection: { taskId: null, linkId: null },
      });
    },

    closeProject() {
      set({ view: 'projects', doc: null, schedule: null });
      void repo.list().then((projects) => set({ projects }));
    },

    async deleteProject(id) {
      await repo.remove(id);
      set({ projects: await repo.list() });
    },

    renameProject(name) {
      commit((d) => {
        d.name = name;
      });
    },

    async importDoc(doc) {
      const fresh: ProjectDoc = { ...doc, id: uid(), updatedAt: new Date().toISOString() };
      await repo.save(fresh);
      set({
        doc: fresh,
        schedule: scheduleProject(fresh),
        view: 'schedule',
        undoStack: [],
        redoStack: [],
        projects: await repo.list(),
      });
    },

    addTask(afterId) {
      const { doc } = get();
      if (!doc) return null;
      const ordered = treeOrder(doc.tasks);
      const anchor = afterId ? doc.tasks.find((t) => t.id === afterId) : ordered.at(-1);
      const id = uid();

      commit((d) => {
        const parentId = anchor ? (anchor.type === 'summary' ? anchor.id : anchor.parentId) : null;
        const baseOrder = anchor && anchor.type !== 'summary' ? anchor.order : -1;
        for (const t of d.tasks) {
          if (t.parentId === parentId && t.order > baseOrder) t.order += 1;
        }
        d.tasks.push({
          id,
          code: nextCode(d.tasks),
          name: '',
          type: 'task',
          duration: 1,
          parentId,
          order: baseOrder + 1,
        });
      });
      set({ selection: { taskId: id, linkId: null } });
      return id;
    },

    setName(id, name) {
      commit((d) => {
        const t = d.tasks.find((x) => x.id === id);
        if (t) t.name = name;
      });
    },

    setDuration(id, days) {
      commit((d) => {
        const t = d.tasks.find((x) => x.id === id);
        if (!t || t.type === 'summary') return false;
        const clamped = Math.max(0, Math.round(days));
        t.duration = clamped;
        t.type = clamped === 0 ? 'milestone' : 'task';
      });
    },

    setType(id, type) {
      commit((d) => {
        const t = d.tasks.find((x) => x.id === id);
        if (!t) return false;
        t.type = type;
        if (type === 'milestone') t.duration = 0;
        if (type === 'task' && t.duration === 0) t.duration = 1;
      });
    },

    setStart(id, day) {
      commit((d) => {
        const t = d.tasks.find((x) => x.id === id);
        if (!t || t.type === 'summary') return false;
        t.constraint = { type: 'SNET', day };
      });
    },

    setFinish(id, day) {
      const { doc } = get();
      const t = doc?.tasks.find((x) => x.id === id);
      if (!t) return;
      const next = Math.max(t.type === 'milestone' ? 0 : 1, day - startOf(id) + 1);
      get().setDuration(id, next);
    },

    /** Dragging the left edge pins the start and shortens the bar in one action. */
    resizeFromStart(id, newStart) {
      const { schedule } = get();
      const end = schedule?.byId.get(id)?.end;
      if (end === undefined) return;
      commit((d) => {
        const t = d.tasks.find((x) => x.id === id);
        if (!t || t.type === 'summary' || t.type === 'milestone') return false;
        t.duration = Math.max(1, end - newStart);
        t.constraint = { type: 'SNET', day: newStart };
      });
    },

    clearConstraint(id) {
      commit((d) => {
        const t = d.tasks.find((x) => x.id === id);
        if (!t?.constraint) return false;
        delete t.constraint;
      });
    },

    /**
     * Dragging. A summary moves its whole subtree by the same offset, which
     * preserves every relative position inside the group (EDD D-015). Anything
     * dragged gets a start-no-earlier-than constraint rather than having its
     * logic broken (D-007).
     */
    moveBy(id, deltaDays) {
      if (!deltaDays) return;
      const { doc, schedule } = get();
      if (!doc || !schedule) return;
      const task = doc.tasks.find((t) => t.id === id);
      if (!task) return;

      const targets =
        task.type === 'summary'
          ? descendants(doc.tasks, id).filter((t) => t.type !== 'summary')
          : [task];
      if (!targets.length) return;

      const starts = new Map(targets.map((t) => [t.id, schedule.byId.get(t.id)?.start ?? 0]));
      commit((d) => {
        for (const t of d.tasks) {
          if (!starts.has(t.id)) continue;
          t.constraint = { type: 'SNET', day: starts.get(t.id)! + deltaDays };
        }
      });
    },

    deleteTask(id) {
      commit((d) => {
        const doomed = new Set([id, ...descendants(d.tasks, id).map((t) => t.id)]);
        d.tasks = d.tasks.filter((t) => !doomed.has(t.id));
        d.links = d.links.filter((l) => !doomed.has(l.fromId) && !doomed.has(l.toId));
      });
      set({ selection: { taskId: null, linkId: null } });
    },

    /** The previous sibling becomes the parent, and becomes a summary. */
    indent(id) {
      commit((d) => {
        const ordered = treeOrder(d.tasks);
        const i = ordered.findIndex((t) => t.id === id);
        const task = ordered[i];
        if (!task) return false;
        const prev = [...ordered.slice(0, i)].reverse().find((t) => t.parentId === task.parentId);
        if (!prev) return false;

        const target = d.tasks.find((t) => t.id === prev.id)!;
        if (target.type !== 'summary') {
          target.type = 'summary';
          // A summary carries no logic of its own, so its links go with it.
          d.links = d.links.filter((l) => l.fromId !== target.id && l.toId !== target.id);
        }
        const self = d.tasks.find((t) => t.id === id)!;
        self.parentId = target.id;
        self.order = Math.max(-1, ...d.tasks.filter((t) => t.parentId === target.id).map((t) => t.order)) + 1;
      });
    },

    outdent(id) {
      commit((d) => {
        const self = d.tasks.find((t) => t.id === id);
        if (!self?.parentId) return false;
        const parent = d.tasks.find((t) => t.id === self.parentId)!;
        self.parentId = parent.parentId;
        self.order = parent.order + 0.5;
        normalizeOrder(d.tasks);
        // A summary with nothing left under it is just a task again.
        if (!d.tasks.some((t) => t.parentId === parent.id)) {
          parent.type = parent.duration === 0 ? 'milestone' : 'task';
        }
      });
    },

    toggleCollapsed(id) {
      commit((d) => {
        const t = d.tasks.find((x) => x.id === id);
        if (!t) return false;
        t.collapsed = !t.collapsed;
      });
    },

    addLink(fromId, toId, type = 'FS', lag = 0) {
      const { doc } = get();
      if (!doc || fromId === toId) return;
      const from = doc.tasks.find((t) => t.id === fromId);
      const to = doc.tasks.find((t) => t.id === toId);
      if (!from || !to) return;
      if (from.type === 'summary' || to.type === 'summary') {
        get().notify('Summary rows organise the schedule; they carry no logic.');
        return;
      }
      if (doc.links.some((l) => l.fromId === fromId && l.toId === toId)) {
        get().notify(`${from.code} already drives ${to.code}.`);
        return;
      }
      const candidate: Link = { id: uid(), fromId, toId, type, lag };
      if (wouldCycle(doc.tasks, doc.links, candidate)) {
        get().notify(`That would make ${to.code} depend on itself.`);
        return;
      }
      commit((d) => {
        d.links.push(candidate);
      });
      set({ selection: { taskId: null, linkId: candidate.id } });
    },

    updateLink(id, patch) {
      commit((d) => {
        const l = d.links.find((x) => x.id === id);
        if (!l) return false;
        Object.assign(l, patch);
      });
    },

    deleteLink(id) {
      commit((d) => {
        d.links = d.links.filter((l) => l.id !== id);
      });
      set({ selection: { taskId: null, linkId: null } });
    },

    replacePredecessors(toId, next) {
      const { doc } = get();
      if (!doc) return;
      const kept = doc.links.filter((l) => l.toId !== toId);
      const rebuilt: Link[] = [];
      for (const p of next) {
        const candidate: Link = { id: uid(), fromId: p.fromId, toId, type: p.type, lag: p.lag };
        if (p.fromId === toId || wouldCycle(doc.tasks, [...kept, ...rebuilt], candidate)) {
          const code = doc.tasks.find((t) => t.id === p.fromId)?.code ?? '?';
          get().notify(`${code} would make the logic circular.`);
          return;
        }
        rebuilt.push(candidate);
      }
      commit((d) => {
        d.links = [...kept, ...rebuilt];
      });
    },

    undo() {
      const { undoStack, redoStack, doc } = get();
      const prev = undoStack.at(-1);
      if (!prev || !doc) return;
      set({ undoStack: undoStack.slice(0, -1), redoStack: [...redoStack, doc] });
      apply(prev);
    },

    redo() {
      const { undoStack, redoStack, doc } = get();
      const next = redoStack.at(-1);
      if (!next || !doc) return;
      set({ redoStack: redoStack.slice(0, -1), undoStack: [...undoStack, doc] });
      apply(next);
    },

    select(sel) {
      set({ selection: { ...get().selection, ...sel } });
    },

    setPxPerDay(px) {
      set({ pxPerDay: px });
    },

    zoom(direction) {
      const current = get().pxPerDay;
      const i = ZOOM_STEPS.reduce(
        (best, v, idx) => (Math.abs(v - current) < Math.abs(ZOOM_STEPS[best] - current) ? idx : best),
        0,
      );
      const next = Math.min(ZOOM_STEPS.length - 1, Math.max(0, i + direction));
      set({ pxPerDay: ZOOM_STEPS[next] });
    },

    toggleCriticalOnly() {
      set({ criticalOnly: !get().criticalOnly });
    },

    notify(message) {
      set({ notice: message });
      if (message) setTimeout(() => set((s) => (s.notice === message ? { notice: null } : s)), 3200);
    },
  };
});

/** Rewrite sibling `order` to 0,1,2… after a fractional insert. */
function normalizeOrder(tasks: Task[]): void {
  const groups = new Map<string | null, Task[]>();
  for (const t of tasks) {
    const list = groups.get(t.parentId) ?? [];
    list.push(t);
    groups.set(t.parentId, list);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => a.order - b.order).forEach((t, i) => (t.order = i));
  }
}

export { durationOf, toWorkDay };
