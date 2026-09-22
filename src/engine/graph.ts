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

/** True if adding `candidate` would make the logic circular. */
export function wouldCycle(tasks: Task[], links: Link[], candidate: Link): boolean {
  if (candidate.fromId === candidate.toId) return true;
  const ids = schedulable(tasks).map((t) => t.id);
  return topoSort(ids, [...links, candidate]) === null;
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
