import { openDB, type IDBPDatabase } from 'idb';
import type { ProjectDoc, ProjectSummary } from '../engine/types';
import type { ScheduleRepo } from './repo';

const DB_NAME = 'planner';
const STORE = 'projects';

let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(DB_NAME, 1, {
    upgrade(database) {
      database.createObjectStore(STORE, { keyPath: 'id' });
    },
  });
  return dbPromise;
}

export const idbRepo: ScheduleRepo = {
  async list(): Promise<ProjectSummary[]> {
    const docs = (await (await db()).getAll(STORE)) as ProjectDoc[];
    return docs
      .map((d) => ({
        id: d.id,
        name: d.name,
        updatedAt: d.updatedAt,
        taskCount: d.tasks.length,
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  async load(id) {
    return (await (await db()).get(STORE, id)) as ProjectDoc | undefined;
  },

  async save(doc) {
    await (await db()).put(STORE, doc);
  },

  async remove(id) {
    await (await db()).delete(STORE, id);
  },
};
