import type { Link, Task } from './types';

/** Activities that participate in the dependency network. Summaries do not. */
export function schedulable(tasks: Task[]): Task[] {
  return tasks.filter((t) => t.type !== 'summary');
}

/**
 * Kahn topological sort. Returns null if the graph contains a cycle, which is
 * the only way an inconsistent schedule could arise — so every link is tested
 * against this before it is accepted.
 */
export function topoSort(ids: string[], links: Link[]): string[] | null {
  const present = new Set(ids);
  const indegree = new Map<string, number>(ids.map((id) => [id, 0]));
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));

  for (const l of links) {
    if (!present.has(l.fromId) || !present.has(l.toId)) continue;
    out.get(l.fromId)!.push(l.toId);
    indegree.set(l.toId, indegree.get(l.toId)! + 1);
  }

  const queue = ids.filter((id) => indegree.get(id) === 0);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of out.get(id)!) {
      const n = indegree.get(next)! - 1;
      indegree.set(next, n);
      if (n === 0) queue.push(next);
    }
  }
  return order.length === ids.length ? order : null;
}

/** The activities a link endpoint stands for: itself, or everything under a summary. */
export function leavesOf(tasks: Task[], id: string): string[] {
  const task = tasks.find((t) => t.id === id);
  if (!task) return [];
  if (task.type !== 'summary') return [id];
  return descendants(tasks, id)
    .filter((t) => t.type !== 'summary')
    .map((t) => t.id);
}

/**
 * A link resolved to activities. Summaries are containers, so a link that
 * touches one is carried by the activities inside it:
 *
 * - From a summary, the link reads the group's extent — its earliest start and
 *   latest finish across `from` — so "after s2" means after s2's last activity.
 * - Onto a summary, the link applies to every activity inside it, which is how
 *   MS Project treats a predecessor on a summary task.
 */
export interface LeafEdge {
  link: Link;
  from: string[];
  to: string;
}

export function resolveLinks(tasks: Task[], links: Link[]): LeafEdge[] {
  const cache = new Map<string, string[]>();
  const leaves = (id: string) => {
    let hit = cache.get(id);
    if (!hit) cache.set(id, (hit = leavesOf(tasks, id)));
    return hit;
  };
  const out: LeafEdge[] = [];
  for (const link of links) {
    const from = leaves(link.fromId);
    if (!from.length) continue;
    for (const to of leaves(link.toId)) out.push({ link, from, to });
  }
  return out;
}

/** Flatten resolved edges into activity-to-activity links for ordering. */
export function orderingLinks(edges: LeafEdge[]): Link[] {
  return edges.flatMap((e) =>
    e.from.map((f) => ({ ...e.link, id: `${e.link.id}:${f}:${e.to}`, fromId: f, toId: e.to })),
  );
}

/**
 * True if adding `candidate` would make the logic circular. A link between a
 * summary and anything inside it is circular by construction: the group
 * would have to finish before one of its own activities starts.
 */
export function wouldCycle(tasks: Task[], links: Link[], candidate: Link): boolean {
  if (candidate.fromId === candidate.toId) return true;
  const edges = resolveLinks(tasks, [...links, candidate]);
  if (edges.some((e) => e.from.includes(e.to))) return true;
  const ids = schedulable(tasks).map((t) => t.id);
  return topoSort(ids, orderingLinks(edges)) === null;
}

/** Descendants of `id`, deepest-last, excluding `id` itself. */
export function descendants(tasks: Task[], id: string): Task[] {
  const byParent = new Map<string | null, Task[]>();
  for (const t of tasks) {
    const list = byParent.get(t.parentId) ?? [];
    list.push(t);
    byParent.set(t.parentId, list);
  }
  const out: Task[] = [];
  const walk = (parent: string) => {
    for (const child of byParent.get(parent) ?? []) {
      out.push(child);
      walk(child.id);
    }
  };
  walk(id);
  return out;
}

/** Tasks in tree order (parents before their children, siblings by `order`). */
export function treeOrder(tasks: Task[]): Task[] {
  const byParent = new Map<string | null, Task[]>();
  for (const t of tasks) {
    const list = byParent.get(t.parentId) ?? [];
    list.push(t);
    byParent.set(t.parentId, list);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.order - b.order);

  const out: Task[] = [];
  const walk = (parent: string | null) => {
    for (const t of byParent.get(parent) ?? []) {
      out.push(t);
      walk(t.id);
    }
  };
  walk(null);
  // Anything orphaned by a bad parentId still gets rendered rather than vanishing.
  if (out.length !== tasks.length) {
    const seen = new Set(out.map((t) => t.id));
    for (const t of tasks) if (!seen.has(t.id)) out.push(t);
  }
  return out;
}

export function depthOf(tasks: Task[], id: string): number {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  let depth = 0;
  let cur = byId.get(id)?.parentId ?? null;
  while (cur) {
    depth++;
    cur = byId.get(cur)?.parentId ?? null;
  }
  return depth;
}

export interface OutlineRow {
  task: Task;
  depth: number;
  /** The nearest top-level summary this row belongs to, if any. Drives grouping colour. */
  groupId: string | null;
}

/**
 * The single ordered list the table and the Gantt both render, and the same
 * order `rowIds` numbers. `visible` drops rows hidden inside a collapsed
 * summary; the numbering does not, so a collapsed group leaves a gap.
 */
export function outline(tasks: Task[], visible = true): OutlineRow[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const chain = (t: Task): Task[] => {
    const out: Task[] = [];
    let p = t.parentId ? byId.get(t.parentId) : undefined;
    while (p) {
      out.unshift(p);
      p = p.parentId ? byId.get(p.parentId) : undefined;
    }
    return out;
  };

  return treeOrder(tasks)
    .map((task) => {
      const ancestors = chain(task);
      const root = ancestors[0] ?? (task.type === 'summary' ? task : null);
      return {
        task,
        depth: ancestors.length,
        groupId: root && root.type === 'summary' ? root.id : null,
        hidden: ancestors.some((a) => a.collapsed),
      };
    })
    .filter((r) => !visible || !r.hidden)
    .map(({ task, depth, groupId }) => ({ task, depth, groupId }));
}
