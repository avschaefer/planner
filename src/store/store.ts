import { create } from 'zustand';
import {
  descendants,
  durationOf,
  earliestStart,
  outline,
  rowIds,
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
import { subscribeProject, subscribeProjects } from '../persist/realtime';
import type { ScheduleRepo } from '../persist/repo';
import {
  claimEditor,
  createSupabaseRepo,
  isShared,
  lockIsFree,
  readEditor,
} from '../persist/supabaseRepo';
import { applyTheme, loadSettings, saveSettings, type Settings } from '../ui/settings';

const uid = () => Math.random().toString(36).slice(2, 10);

/**
 * Which browser tab this is. Used to recognise our own writes coming back over
 * Realtime, and to hold the editor lock. Per tab, not per person — two tabs are
 * two editors, which is the honest reading of "one editor at a time".
 */
export const clientId = (() => {
  const KEY = 'planner.clientId';
  try {
    const existing = sessionStorage.getItem(KEY);
    if (existing) return existing;
    const fresh = `c_${uid()}${uid()}`;
    sessionStorage.setItem(KEY, fresh);
    return fresh;
  } catch {
    return `c_${uid()}${uid()}`;
  }
})();

/**
 * The shared database when this build is configured for one, local IndexedDB
 * when it is not (EDD D-014). The fallback is not offline support — there is no
 * queue and no sync — it is what lets `npm run dev` and the browser tests run
 * without a project behind them.
 */
const repo: ScheduleRepo = isShared ? createSupabaseRepo(() => clientId) : idbRepo;

const UNDO_LIMIT = 100;
/** How often the editor lock is refreshed while someone is editing. */
const HEARTBEAT_MS = 30_000;

export interface Selection {
  /** Ordered by outline position. The last one clicked is the primary. */
  taskIds: string[];
  linkId: string | null;
  /** Where a shift-click range extends from. */
  anchorId: string | null;
}

export type SelectMode = 'replace' | 'toggle' | 'range';

const EMPTY_SELECTION: Selection = { taskIds: [], linkId: null, anchorId: null };

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
  settings: Settings;
  /** True when someone else holds the editor lock. Every edit is refused. */
  readOnly: boolean;
  /** Who holds it, when that is not us. */
  editorId: string | null;
  /** False for a local-only build; the editor banner only matters when shared. */
  shared: boolean;

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
  setType(ids: string | string[], type: TaskType): void;
  setStart(id: string, day: WorkDay): void;
  setFinish(id: string, day: WorkDay): void;
  clearConstraint(ids: string | string[]): void;
  logicStart(id: string): WorkDay | null;
  hasDirectPredecessors(id: string): boolean;
  constraintToLag(id: string, merge?: boolean): number | null;
  resizeFromStart(id: string, newStart: WorkDay): void;
  moveBy(ids: string | string[], deltaDays: number): void;
  deleteTask(ids: string | string[]): void;
  indent(ids: string | string[]): void;
  outdent(ids: string | string[]): void;
  toggleCollapsed(id: string): void;
  reparent(ids: string[], parentId: string | null, index: number): void;

  addLink(fromId: string, toId: string, type?: LinkType, lag?: number): void;
  updateLink(id: string, patch: Partial<Pick<Link, 'type' | 'lag'>>): void;
  deleteLink(id: string): void;
  replacePredecessors(toId: string, next: Array<{ fromId: string; type: LinkType; lag: number }>): void;

  undo(): void;
  redo(): void;
  select(sel: Partial<Selection>): void;
  selectTask(id: string, mode?: SelectMode): void;
  selectAll(): void;
  clearSelection(): void;
  setPxPerDay(px: number): void;
  zoom(direction: 1 | -1): void;
  toggleCriticalOnly(): void;
  updateSettings(patch: Partial<Settings>): void;
  takeOverEditing(): Promise<void>;
  notify(message: string | null): void;
}

export const ZOOM_STEPS = [2, 3, 4.5, 7, 11, 16, 24, 34];

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pending: ProjectDoc | null = null;
/** Set by the store below, so a rejected write can reach it. */
let onSaveError: ((error: Error & { status?: number; editorId?: string }) => void) | null = null;

function scheduleSave(doc: ProjectDoc) {
  pending = doc;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 200);
}

/** Write whatever the debounce is still holding. */
function flushSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  const doc = pending;
  pending = null;
  if (doc) void repo.save(doc).catch((error: Error) => onSaveError?.(error));
}

/* An edit made in the last 200ms would otherwise be lost to a reload or a
   closed tab. The write itself is async, so this narrows the window rather
   than closing it — but it turns "usually fine" into "almost always fine". */
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushSave);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSave();
  });
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

const asArray = (ids: string | string[]): string[] => (Array.isArray(ids) ? ids : [ids]);

export const useStore = create<State>((set, get) => {
  /* ---------------- live sync and the soft editor lock (PRD Q-6) ----------
     One editor at a time, claimed on the first edit and kept alive by a
     heartbeat. Nothing here runs in a local-only build. */

  let detachProject: (() => void) | null = null;
  let detachList: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let holdsLock = false;
  let claiming: Promise<boolean> | null = null;

  function releaseLocally() {
    holdsLock = false;
    claiming = null;
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
  }

  function lose(editorId: string | null) {
    releaseLocally();
    set({ readOnly: true, editorId });
  }

  /** Pull the row back down after a refused write, so the screen tells the truth. */
  async function resync(): Promise<void> {
    const { doc } = get();
    if (!doc || !isShared) return;
    const fresh = await repo.load(doc.id).catch(() => undefined);
    if (fresh && get().doc?.id === fresh.id) set({ doc: fresh, schedule: scheduleProject(fresh) });
  }

  /**
   * Take the editor lock, or keep it alive. Called on every commit; cheap
   * after the first because the lock is already held.
   */
  function ensureEditor(force = false): Promise<boolean> {
    const { doc } = get();
    if (!isShared || !doc) return Promise.resolve(true);
    if (holdsLock && !force) return Promise.resolve(true);
    if (claiming && !force) return claiming;

    const attempt = claimEditor(doc.id, clientId, force)
      .then(({ granted, editorId }) => {
        claiming = null;
        if (!granted) {
          lose(editorId);
          get().notify('Someone else is editing this schedule.');
          void resync();
          return false;
        }
        holdsLock = true;
        set({ readOnly: false, editorId: clientId });
        heartbeat ??= setInterval(() => {
          const open = get().doc;
          if (open) void claimEditor(open.id, clientId).catch(() => {});
        }, HEARTBEAT_MS);
        return true;
      })
      .catch(() => {
        // A flaky network must not lock someone out of their own schedule.
        claiming = null;
        return true;
      });

    claiming = attempt;
    return attempt;
  }

  /** Live updates for the open schedule. The whole document arrives at once. */
  function watch(id: string) {
    detachProject?.();
    detachProject = subscribeProject(id, (change) => {
      if (change.clientId === clientId) return; // our own write, echoed back
      const free = lockIsFree(change.editorId, change.editorSeen, clientId);
      if (!free) releaseLocally();
      set({
        doc: change.doc,
        schedule: scheduleProject(change.doc),
        editorId: change.editorId,
        readOnly: !free,
      });
    });
  }

  onSaveError = (error) => {
    if (error.status === 409) {
      lose(error.editorId ?? null);
      get().notify('Someone else is editing this schedule. Your last change was not saved.');
      void resync();
    } else if (error.status === 401) {
      // The session expired behind the passcode gate; a reload shows the unlock page.
      get().notify('Your session expired. Reload to sign back in.');
    } else {
      get().notify(`Could not save: ${error.message}`);
    }
  };

  /**
   * The one way the document changes: snapshot, mutate a clone, reschedule,
   * persist. Undo is a stack of whole documents (EDD D-008) — at this size that
   * is a few kB and it is trivially correct for compound edits. Everything
   * plural goes through a single commit, so a multi-row edit is one undo step.
   *
   * It is also the only gate read-only mode needs: every edit in the app, from
   * a drag to an undo, arrives here.
   */
  function commit(mutate: (draft: ProjectDoc) => void | boolean, opts: { merge?: boolean } = {}) {
    const { doc, undoStack, readOnly } = get();
    if (!doc) return;
    if (readOnly) {
      get().notify('Someone else is editing. Take over to make changes.');
      return;
    }
    const draft: ProjectDoc = structuredClone(doc);
    if (mutate(draft) === false) return;
    draft.updatedAt = new Date().toISOString();
    set({
      doc: draft,
      schedule: scheduleProject(draft),
      // `merge` folds a follow-up into the edit just made, so one gesture stays one undo.
      undoStack: opts.merge && undoStack.length ? undoStack : [...undoStack, doc].slice(-UNDO_LIMIT),
      redoStack: [],
    });
    scheduleSave(draft);
    void ensureEditor();
  }

  function apply(doc: ProjectDoc) {
    set({ doc, schedule: scheduleProject(doc) });
    scheduleSave(doc);
    void ensureEditor();
  }

  function rowLabel(doc: ProjectDoc, id: string): string {
    const n = rowIds(doc.tasks).get(id);
    const name = doc.tasks.find((t) => t.id === id)?.name;
    return name ? `${n} ${name}` : `activity ${n}`;
  }

  return {
    view: 'projects',
    projects: [],
    doc: null,
    schedule: null,
    undoStack: [],
    redoStack: [],
    selection: EMPTY_SELECTION,
    pxPerDay: 16,
    criticalOnly: false,
    notice: null,
    loading: true,
    settings: loadSettings(),
    readOnly: false,
    editorId: null,
    shared: isShared,

    async init() {
      set({ projects: await repo.list(), loading: false });
      // A schedule someone else creates or deletes just appears, or goes.
      detachList ??= subscribeProjects(() => {
        if (get().view === 'projects') void repo.list().then((projects) => set({ projects }));
      });
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
        selection: EMPTY_SELECTION,
        readOnly: false,
        editorId: null,
        projects: await repo.list(),
      });
      watch(doc.id);
    },

    async openProject(id) {
      const doc = await repo.load(id);
      if (!doc) return;
      releaseLocally();
      // Opening is not editing: the lock is claimed on the first change, so
      // twenty people can watch without any of them taking it.
      const { editorId, editorSeen } = await readEditor(id).catch(() => ({
        editorId: null,
        editorSeen: null,
      }));
      const free = lockIsFree(editorId, editorSeen, clientId);
      set({
        doc,
        schedule: scheduleProject(doc),
        view: 'schedule',
        undoStack: [],
        redoStack: [],
        selection: EMPTY_SELECTION,
        editorId: free ? null : editorId,
        readOnly: !free,
      });
      watch(id);
    },

    closeProject() {
      detachProject?.();
      detachProject = null;
      releaseLocally();
      set({
        view: 'projects',
        doc: null,
        schedule: null,
        selection: EMPTY_SELECTION,
        readOnly: false,
        editorId: null,
      });
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
        selection: EMPTY_SELECTION,
        readOnly: false,
        editorId: null,
        projects: await repo.list(),
      });
      watch(fresh.id);
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
          name: '',
          type: 'task',
          duration: 1,
          parentId,
          order: baseOrder + 1,
        });
      });
      set({ selection: { taskIds: [id], linkId: null, anchorId: id } });
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

    setType(ids, type) {
      const list = asArray(ids);
      commit((d) => {
        let touched = false;
        for (const id of list) {
          const t = d.tasks.find((x) => x.id === id);
          if (!t || t.type === 'summary') continue;
          t.type = type;
          if (type === 'milestone') t.duration = 0;
          if (type === 'task' && t.duration === 0) t.duration = 1;
          touched = true;
        }
        return touched || false;
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
      const { doc, schedule } = get();
      const t = doc?.tasks.find((x) => x.id === id);
      if (!t) return;
      const start = schedule?.byId.get(id)?.start ?? 0;
      const next = Math.max(t.type === 'milestone' ? 0 : 1, day - start + 1);
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

    /** Where the links alone would put an activity, ignoring its own constraint. */
    logicStart(id) {
      const { doc } = get();
      const task = doc?.tasks.find((t) => t.id === id);
      if (!doc || !task) return null;
      const free: ProjectDoc = {
        ...doc,
        tasks: doc.tasks.map((t) => (t.id === id ? { ...t, constraint: undefined } : t)),
      };
      return scheduleProject(free).byId.get(id)?.start ?? null;
    },

    hasDirectPredecessors(id) {
      return !!get().doc?.links.some((l) => l.toId === id);
    },

    /**
     * Turn a Start No Earlier Than date into lag on the link that drives the
     * activity, so it sits at the same date but stays logic-driven: move the
     * predecessor and it follows. Also the only way to move a driven activity
     * *earlier* than its logic allows, which a constraint cannot do.
     *
     * Returns the new lag, or null when there is no direct link to adjust.
     */
    constraintToLag(id, merge = false) {
      const { doc } = get();
      const task = doc?.tasks.find((t) => t.id === id);
      if (!doc || !task?.constraint) return null;
      const incoming = doc.links.filter((l) => l.toId === id);
      if (!incoming.length) return null;

      const target = task.constraint.day;
      const free: ProjectDoc = {
        ...doc,
        tasks: doc.tasks.map((t) => (t.id === id ? { ...t, constraint: undefined } : t)),
      };
      const sched = scheduleProject(free);
      const dur = durationOf(task);

      // The driving link is the one whose bound is latest; moving its lag by
      // the gap puts the activity exactly on the dragged date.
      let driver: Link | null = null;
      let bound = -Infinity;
      for (const l of incoming) {
        const from = sched.byId.get(l.fromId);
        if (!from) continue;
        const b = earliestStart(l, from, dur);
        if (b > bound) {
          bound = b;
          driver = l;
        }
      }
      if (!driver) return null;
      const lag = driver.lag + (target - bound);
      const linkId = driver.id;

      commit((d) => {
        const t = d.tasks.find((x) => x.id === id);
        const l = d.links.find((x) => x.id === linkId);
        if (!t || !l) return false;
        delete t.constraint;
        l.lag = lag;
      }, { merge });
      return lag;
    },

    clearConstraint(ids) {
      const list = asArray(ids);
      commit((d) => {
        let touched = false;
        for (const id of list) {
          const t = d.tasks.find((x) => x.id === id);
          if (!t?.constraint) continue;
          delete t.constraint;
          touched = true;
        }
        return touched || false;
      });
    },

    /**
     * Dragging. A summary moves its whole subtree by the same offset, which
     * preserves every relative position inside the group (EDD D-015). Anything
     * dragged gets a start-no-earlier-than constraint rather than having its
     * logic broken (D-007). Dragging one bar of a multi-row selection moves the
     * whole selection by the same working-day offset, in one undo step.
     */
    moveBy(ids, deltaDays) {
      if (!deltaDays) return;
      const { doc, schedule } = get();
      if (!doc || !schedule) return;

      const targets = new Map<string, Task>();
      for (const id of asArray(ids)) {
        const task = doc.tasks.find((t) => t.id === id);
        if (!task) continue;
        const leaves =
          task.type === 'summary'
            ? descendants(doc.tasks, id).filter((t) => t.type !== 'summary')
            : [task];
        for (const t of leaves) targets.set(t.id, t);
      }
      if (!targets.size) return;

      const starts = new Map([...targets.keys()].map((id) => [id, schedule.byId.get(id)?.start ?? 0]));
      commit((d) => {
        for (const t of d.tasks) {
          if (!starts.has(t.id)) continue;
          t.constraint = { type: 'SNET', day: starts.get(t.id)! + deltaDays };
        }
      });
    },

    deleteTask(ids) {
      const list = asArray(ids);
      commit((d) => {
        const doomed = new Set<string>();
        for (const id of list) {
          doomed.add(id);
          for (const t of descendants(d.tasks, id)) doomed.add(t.id);
        }
        if (!doomed.size) return false;
        d.tasks = d.tasks.filter((t) => !doomed.has(t.id));
        d.links = d.links.filter((l) => !doomed.has(l.fromId) && !doomed.has(l.toId));
      });
      set({ selection: EMPTY_SELECTION });
    },

    /** The previous sibling becomes the parent, and becomes a summary. */
    indent(ids) {
      const list = asArray(ids);
      commit((d) => {
        let touched = false;
        // Outline order matters: each row looks for the sibling above it, which
        // may itself have just been re-parented.
        const order = new Map(treeOrder(d.tasks).map((t, i) => [t.id, i]));
        for (const id of [...list].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))) {
          const ordered = treeOrder(d.tasks);
          const i = ordered.findIndex((t) => t.id === id);
          const task = ordered[i];
          if (!task) continue;
          const prev = [...ordered.slice(0, i)].reverse().find((t) => t.parentId === task.parentId);
          if (!prev) continue;

          const target = d.tasks.find((t) => t.id === prev.id)!;
          // Its links stay: on a summary they are carried by the activities inside it.
          if (target.type !== 'summary') target.type = 'summary';
          const self = d.tasks.find((t) => t.id === id)!;
          self.parentId = target.id;
          self.order =
            Math.max(-1, ...d.tasks.filter((t) => t.parentId === target.id).map((t) => t.order)) + 1;
          touched = true;
        }
        return touched || false;
      });
    },

    outdent(ids) {
      const list = asArray(ids);
      commit((d) => {
        let touched = false;
        const order = new Map(treeOrder(d.tasks).map((t, i) => [t.id, i]));
        const sorted = [...list].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
        sorted.forEach((id, n) => {
          const self = d.tasks.find((t) => t.id === id);
          if (!self?.parentId) return;
          const parent = d.tasks.find((t) => t.id === self.parentId)!;
          self.parentId = parent.parentId;
          // Fractional offsets keep a multi-row outdent in its original order.
          self.order = parent.order + (n + 1) / (sorted.length + 1);
          normalizeOrder(d.tasks);
          // A summary with nothing left under it is just a task again.
          if (!d.tasks.some((t) => t.parentId === parent.id)) {
            parent.type = parent.duration === 0 ? 'milestone' : 'task';
          }
          touched = true;
        });
        return touched || false;
      });
    },

    toggleCollapsed(id) {
      commit((d) => {
        const t = d.tasks.find((x) => x.id === id);
        if (!t) return false;
        t.collapsed = !t.collapsed;
      });
    },

    /**
     * Drag-and-drop reordering: move `ids` (with their subtrees) to sit at
     * `index` among `parentId`'s children. One commit, so a drag is one undo.
     */
    reparent(ids, parentId, index) {
      commit((d) => {
        const moving = new Set(ids);
        for (const id of ids) for (const t of descendants(d.tasks, id)) moving.add(t.id);
        if (parentId && moving.has(parentId)) return false;

        const ordered = treeOrder(d.tasks);
        // Only the topmost of each moved subtree is re-parented; children follow.
        const block = ordered.filter((t) => ids.includes(t.id) && !ids.includes(t.parentId ?? ''));
        if (!block.length) return false;
        const blockIds = new Set(block.map((t) => t.id));

        const sibs = ordered.filter((t) => t.parentId === parentId && !blockIds.has(t.id));
        sibs.splice(Math.max(0, Math.min(index, sibs.length)), 0, ...block);
        sibs.forEach((t, i) => {
          const task = d.tasks.find((x) => x.id === t.id)!;
          task.parentId = parentId;
          task.order = i;
        });

        // Whatever you dropped into becomes a container; its links now apply to its contents.
        if (parentId) {
          const p = d.tasks.find((t) => t.id === parentId)!;
          if (p.type !== 'summary') p.type = 'summary';
        }
        // A summary left with nothing under it is just a task again.
        for (const t of d.tasks) {
          if (t.type === 'summary' && !d.tasks.some((x) => x.parentId === t.id)) {
            t.type = t.duration === 0 ? 'milestone' : 'task';
          }
        }
        normalizeOrder(d.tasks);
      });
    },

    addLink(fromId, toId, type = 'FS', lag = 0) {
      const { doc } = get();
      if (!doc || fromId === toId) return;
      const from = doc.tasks.find((t) => t.id === fromId);
      const to = doc.tasks.find((t) => t.id === toId);
      if (!from || !to) return;
      const existing = doc.links.find((l) => l.fromId === fromId && l.toId === toId);
      if (existing) {
        // Re-dragging an existing pair retypes it instead of refusing.
        get().updateLink(existing.id, { type, lag });
        set({ selection: { taskIds: [], linkId: existing.id, anchorId: null } });
        return;
      }
      const candidate: Link = { id: uid(), fromId, toId, type, lag };
      if (wouldCycle(doc.tasks, doc.links, candidate)) {
        get().notify(`That would make ${rowLabel(doc, toId)} depend on itself.`);
        return;
      }
      commit((d) => {
        d.links.push(candidate);
      });
      set({ selection: { taskIds: [], linkId: candidate.id, anchorId: null } });
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
      set({ selection: EMPTY_SELECTION });
    },

    replacePredecessors(toId, next) {
      const { doc } = get();
      if (!doc) return;
      const kept = doc.links.filter((l) => l.toId !== toId);
      const rebuilt: Link[] = [];
      for (const p of next) {
        const candidate: Link = { id: uid(), fromId: p.fromId, toId, type: p.type, lag: p.lag };
        if (p.fromId === toId || wouldCycle(doc.tasks, [...kept, ...rebuilt], candidate)) {
          get().notify(`${rowLabel(doc, p.fromId)} would make the logic circular.`);
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

    /**
     * One entry point for every way a row gets picked: plain click replaces,
     * Cmd/Ctrl-click toggles, Shift-click extends from the anchor over the
     * rows you can actually see.
     */
    selectTask(id, mode = 'replace') {
      const { doc, selection } = get();
      if (!doc) return;

      if (mode === 'toggle') {
        const has = selection.taskIds.includes(id);
        const taskIds = has ? selection.taskIds.filter((x) => x !== id) : [...selection.taskIds, id];
        set({ selection: { taskIds, linkId: null, anchorId: has ? selection.anchorId : id } });
        return;
      }

      if (mode === 'range' && selection.anchorId) {
        const visible = outline(doc.tasks).map((r) => r.task.id);
        const a = visible.indexOf(selection.anchorId);
        const b = visible.indexOf(id);
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          set({
            selection: { taskIds: visible.slice(lo, hi + 1), linkId: null, anchorId: selection.anchorId },
          });
          return;
        }
      }

      set({ selection: { taskIds: [id], linkId: null, anchorId: id } });
    },

    selectAll() {
      const { doc } = get();
      if (!doc) return;
      const visible = outline(doc.tasks).map((r) => r.task.id);
      set({ selection: { taskIds: visible, linkId: null, anchorId: visible[0] ?? null } });
    },

    clearSelection() {
      set({ selection: EMPTY_SELECTION });
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

    /** Presentation only — outside the document, so outside undo. */
    updateSettings(patch) {
      const settings = { ...get().settings, ...patch };
      set({ settings });
      applyTheme(settings);
      saveSettings(settings);
    },

    /** The take-over button: the schedule matters more than the lock. */
    async takeOverEditing() {
      const granted = await ensureEditor(true);
      if (granted) get().notify('You are editing now.');
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

/** The primary (most recently clicked) selected activity, or null. */
export function primaryTaskId(selection: Selection): string | null {
  return selection.anchorId && selection.taskIds.includes(selection.anchorId)
    ? selection.anchorId
    : (selection.taskIds.at(-1) ?? null);
}

export { durationOf, toWorkDay };
