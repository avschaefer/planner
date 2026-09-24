import type { ProjectDoc, ProjectRole, ProjectSummary } from '../engine/types';

/**
 * Every method is async even though IndexedDB is local, so that swapping in a
 * networked implementation later changes no call site. See EDD D-014.
 */
export interface ScheduleRepo {
  list(): Promise<ProjectSummary[]>;
  load(id: string): Promise<ProjectDoc | undefined>;
  save(doc: ProjectDoc): Promise<void>;
  remove(id: string): Promise<void>;
  /** The caller's role on a schedule. Local builds are always the owner. */
  roleOf?(id: string): Promise<ProjectRole | null>;
}
