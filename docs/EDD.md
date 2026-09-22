# EDD — Planner

**Status:** Kickoff complete · **Last updated:** 2026-09-21

---

## 1. Architecture

Client-only single-page app. No server, no network calls at runtime.

```
┌─ ui/ ──────────────────────────────────────────────┐
│  ProjectList          TaskTable      GanttChart    │
│                       (DOM rows)     (SVG)         │
│                          └──── shared scroll ──────┤
└────────────────────┬───────────────────────────────┘
                     │  actions in / derived schedule out
┌────────────────────▼───────────────────────────────┐
│  store/  (Zustand)                                 │
│    document: { project, tasks[], links[] }         │
│    undo/redo: snapshot stack                       │
│    selection, zoom, filters  (transient, not saved)│
└────────────────────┬───────────────────────────────┘
                     │  pure call, synchronous
┌────────────────────▼───────────────────────────────┐
│  engine/   ← no React, no DOM, no dates-as-strings  │
│    calendar.ts   working-day index ↔ calendar date  │
│    schedule.ts   topo sort, forward/backward pass   │
│    validate.ts   cycle detection                    │
│    rollup.ts     summary date derivation            │
└────────────────────┬───────────────────────────────┘
                     │
┌────────────────────▼───────────────────────────────┐
│  persist/  ScheduleRepo  →  IdbRepo (later: Supabase) │
└────────────────────────────────────────────────────┘
```

**The load-bearing idea:** the document holds only what the user typed. Every scheduled date —
ES, EF, LS, LF, float, critical, summary bar extents — is derived by the engine on each change and
never stored. There is exactly one source of truth and no possibility of the table and the Gantt
disagreeing.

*Satisfies: R-015, R-024*

## 2. Stack

| Layer | Choice | Version | Why |
|---|---|---|---|
| Runtime | Node | 24.21.0 | Installed |
| Language | TypeScript | 7.0.2 | Latest stable (native compiler). Pin exactly; it is a new major |
| UI | React | 19.3.0 | Boring default, and the app is one dense stateful screen |
| Build | Vite + @vitejs/plugin-react | 8.3.0 / 6.1.1 | Static output, fast HMR, no SSR to fight during drag work |
| State | Zustand | 5.0.15 | ~1 kB, no provider tree, no boilerplate. Redux-scale ceremony is unwarranted at this size |
| Dates | none | — | Dropped. The engine works in integer indices and needs only UTC arithmetic; a date library would have earned its keep only at the display edge |
| Storage | idb | 8.0.3 | Thin promise wrapper over IndexedDB |
| Tests | Vitest | 5.0.1 | Same config as Vite; the engine is plain TypeScript |
| Styling | One global stylesheet + custom properties | built in | Design tokens in one file; no utility-class soup in dense markup. **Deviates from D-013:** at this size CSS Modules added a layer without removing one. Revisit if the stylesheet passes ~600 lines |
| E2E | Playwright | 1.x | Browser smoke tests for the drag gestures, which cannot be unit tested |
| Test shim | fake-indexeddb | latest | Lets the store layer be tested in Node without a browser |

No Gantt library, no UI component library, no CSS framework.

## 3. Data model

Stored. Everything else is computed.

```ts
type Iso = string;          // 'YYYY-MM-DD'
type WorkDay = number;      // working-day index; 0 = project start day

interface ProjectDoc {
  id: string;
  name: string;
  dataDate: Iso;            // project start; the origin of the working-day index
  tasks: Task[];
  links: Link[];
  updatedAt: Iso;
}

interface Task {
  id: string;               // uuid, stable across renames and reorders
  code: string;             // display ID, e.g. 'A1010'
  name: string;
  type: 'task' | 'milestone' | 'summary';
  duration: number;         // working days. 0 for milestone. ignored for summary
  parentId: string | null;
  order: number;            // sort key among siblings
  collapsed?: boolean;
  constraint?: { type: 'SNET'; day: WorkDay };   // set by dragging a driven task (R-017)
}

interface Link {
  id: string;
  fromId: string;           // predecessor
  toId: string;             // successor
  type: 'FS' | 'SS' | 'FF' | 'SF';
  lag: number;              // working days, may be negative
}
```

Derived per schedule run, held in a parallel map keyed by task id:

```ts
interface Scheduled {
  es: WorkDay; ef: WorkDay; ls: WorkDay; lf: WorkDay;
  totalFloat: number;
  critical: boolean;
}
```

*Satisfies: R-002, R-003, R-004, R-012, R-013, R-017*

### 3.1 Persistence interface

```ts
interface ScheduleRepo {
  list(): Promise<ProjectSummary[]>;
  load(id: string): Promise<ProjectDoc>;
  save(doc: ProjectDoc): Promise<void>;
  delete(id: string): Promise<void>;
}
```

`IdbRepo` implements it today. `SupabaseRepo` implements it later. The store knows only the
interface, and every method is async now so that adding a network never changes a call site.
Whole-document reads and writes are correct at 50 activities and are what makes both backends
interchangeable.

*Satisfies: R-005, R-006 · See D-014*

## 4. The engine

### 4.1 Calendar

All scheduling arithmetic happens in **integer working-day indices**, never in `Date` objects.
`toWorkDay(iso)` and `toDate(workDay)` convert at the boundary — table cells, the timeline axis,
persistence. Inside the engine, "5 days later" is `+ 5`.

This is why a 5-day activity starting Friday finishes the following Thursday without any special
case, and why negative lag needs no separate code path.

*Satisfies: R-014*

### 4.2 Passes

1. Build the activity graph from `links`, excluding summaries.
2. Topological sort. A cycle here is a bug — cycles are rejected at link creation (§4.3).
3. **Forward pass** in topo order → `es`, `ef`, honouring FS/SS/FF/SF + lag and any SNET constraint.
4. **Backward pass** in reverse topo order → `ls`, `lf`, seeded from project finish.
5. `totalFloat = ls - es`; `critical = totalFloat <= 0`.
6. Roll summary extents up from children (§4.4).

Full recompute on every change (D-009). At 50 activities this is microseconds.

*Satisfies: R-010, R-011, R-012, R-013, R-015*

### 4.3 Validation

A proposed link is applied to a copy of the graph and topologically sorted. If the sort fails, the
link is rejected and the UI says why. This is the only guard against inconsistent state that the
engine cannot otherwise express.

*Satisfies: R-016*

### 4.4 Summary rollup

Summaries are **containers, not activities**. They have no duration of their own, cannot appear in
`links`, and are skipped by the graph. Their bar spans `min(child.es) … max(child.ef)` recursively.
A summary is critical iff any descendant is.

Dragging a summary bar is therefore not a scheduling operation on the summary — it is one bulk
edit applying the same working-day delta to every descendant leaf, in a single undoable action.
Leaves that have predecessors gain an SNET constraint per D-007, exactly as if each had been
dragged individually.

*Satisfies: R-041 · See D-015*

*Satisfies: R-003, R-018*

## 5. UI

| Module | Responsibility | Satisfies |
|---|---|---|
| `ProjectList` | Project CRUD, opens a schedule | R-001 |
| `ScheduleView` | Splitter, shared vertical scroll container, keyboard root | R-024, R-051 |
| `TaskTable` | Six columns, inline editors, quick-add row, row keyboard nav | R-020, R-021, R-022, R-023 |
| `Timeline` | Header axis at day/week/month, zoom state, today marker | R-030, R-031 |
| `GanttCanvas` | One SVG: bars, milestone diamonds, dependency paths, drag affordances | R-004, R-032, R-033, R-034, R-035, R-037, R-040 |
| `LinkPopover` | Type + lag shorthand parser (`FS+2d`) | R-036 |
| `Inspector` | Compact selection popover: dates, float, predecessors, successors | R-039 |
| `FilterBar` | Critical-path-only toggle | R-038 |
| `theme.css` | Tokens: colour, spacing, type scale, row height | R-052 |

Row height is a single token shared by `TaskTable` and `GanttCanvas`; both render the same
flattened, visibility-filtered task list in the same order. That is the entire synchronisation
mechanism — no scroll listeners syncing two panes.

### 5.1 Drag model

All three drags (move, resize, link) are one pointer-event state machine over the SVG:
`pointerdown` on a hit target → track in pixels → convert to working days → render a **preview**
→ `pointerup` commits one undoable action. Nothing touches the document until release, so the
engine runs once per gesture, not once per frame.

*Satisfies: R-032, R-033, R-034, R-040, R-041, R-050*

## 6. Design decisions

| ID | Decision | Rejected alternative | Why |
|---|---|---|---|
| D-001 | Vite + React SPA | Next.js | No server data, no SEO, no auth. SSR would only add hydration complexity to pointer-heavy interactions |
| D-002 | Hand-built SVG Gantt | Canvas; an off-the-shelf Gantt library | SVG gives free hit-testing and CSS theming, which is most of the interaction work. Canvas pays for scale not needed under 50 rows. A library would fight exactly the interactions that are the point of the product |
| D-003 | IndexedDB now, one record per project | Supabase from the start | Sharing is the stated destination, but auth, network state, and sync are not worth building before the scheduling experience has proved itself. Local storage defers that cost without foreclosing it — see D-014 |
| D-004 | Zustand, single store | Redux Toolkit; useReducer + context | One screen, one document. Redux ceremony buys nothing; context re-render behaviour is a hazard during drag |
| D-005 | Schedule in integer working-day indices | `Date` arithmetic with date-fns throughout | Weekend skipping and negative lag become ordinary integer math. Date objects in the engine invite timezone and DST bugs that are miserable to find |
| D-006 | Summaries are containers, cannot have links | P6-style WBS elements that can be scheduled and linked | Linkable summaries make the CPM graph two-level and the semantics of "parent finishes before child" genuinely ambiguous. Containers keep the network flat and the engine honest. **This narrows the brief's hierarchy scope on purpose** |
| D-007 | Dragging a driven activity sets an SNET constraint | Silently breaking the predecessor link; refusing the drag | The brief asks for both "drag any bar" and "successors follow predecessors" — for a driven activity these conflict. A visible, removable constraint is the only answer that keeps the logic intact and the drag meaningful. It is also what P6 does |
| D-008 | Undo = full document snapshots | Inverse-command stack | A 50-task document is a few kB. Snapshots are trivially correct for compound operations like "delete a task and its links"; inverse commands are where undo bugs live |
| D-009 | Full recompute on every change | Incremental/dirty-subgraph propagation | At this size the whole pass is far under a frame. Incremental scheduling is a well-known source of stale-state bugs |
| D-010 | No auth, no accounts | Any identity provider | Nothing to protect; storage is local |
| D-011 | Orthogonal dependency routing with per-row lane offsets | Bezier curves | Right-angle routing reads as logic; curves read as decoration and tangle faster |
| D-012 | Vitest on the engine, manual smoke on the UI | Playwright interaction suite | Engine errors are silent and expensive; UI errors are visible immediately. Revisit if drag regressions start recurring |
| D-013 | CSS Modules + custom properties | Tailwind | The design is bespoke and restrained; utility classes obscure dense markup and make a token-driven theme harder, not easier |
| D-014 | All persistence behind an async `ScheduleRepo` interface (§3.1) | Calling `idb` directly from the store | Supabase is where this is going. A whole-document async interface is satisfiable by IndexedDB today and Postgres later with no call-site changes; direct storage calls would spread persistence assumptions through the store and turn the migration into a rewrite. The cost today is one small file |
| D-015 | Dragging a summary applies one offset to every descendant leaf | Recomputing children from the summary's new extent | Applying a uniform working-day delta preserves every relative offset inside the group for free, including links between children. Deriving children from the parent's span is ambiguous the moment the group contains float |
| D-016 | Gantt axis is a calendar with weekends shaded; the engine stays in working days | A compressed working-day axis with weekends removed | A working-day axis makes bars contiguous and the maths trivial, but month boundaries land at irregular pixel positions and the chart stops looking like a calendar. Converting at the drawing layer costs two small functions and keeps both properties |
| D-017 | Drag previews commit on release, not on every frame | Applying each pointer move to the document | One engine run and one undo entry per gesture instead of dozens. The preview is computed through the same conversion the commit uses, so what is shown is what lands |

## 7. Traceability

| Req | Design section |
|---|---|
| R-001 | §5 `ProjectList`, §3 `ProjectDoc` |
| R-002 | §3 `Task` |
| R-003 | §3 `Task.parentId/order/collapsed`, §4.4, D-006 |
| R-004 | §3 `Task.type`, §5 `GanttCanvas` |
| R-005 | §3.1, D-003, D-014 |
| R-006 | §3.1, §3 (`ProjectDoc` is the serialization format) |
| R-007–R-009 | *unused* |
| R-010 | §4.2 steps 3–5 |
| R-011 | §4.2 step 5 |
| R-012 | §3 `Link.type`, §4.2 step 3 |
| R-013 | §3 `Link.lag`, §4.1, D-005 |
| R-014 | §4.1, D-005 |
| R-015 | §1, §4.2, D-009 |
| R-016 | §4.3 |
| R-017 | §3 `Task.constraint`, §4.2 step 3, D-007 |
| R-018 | §4.4, D-006 |
| R-019 | *unused* |
| R-020 | §5 `TaskTable` |
| R-021 | §5 `TaskTable` |
| R-022 | §5 `TaskTable` |
| R-023 | §5 `TaskTable`, §5 `ScheduleView` |
| R-024 | §1, §5 (shared flattened list + row-height token) |
| R-025–R-029 | *unused* |
| R-030 | §5 `Timeline` |
| R-031 | §5 `Timeline` |
| R-032 | §5.1, D-007 |
| R-033 | §5.1 |
| R-034 | §5.1, §4.3 |
| R-035 | §5 `GanttCanvas`, D-011 |
| R-036 | §5 `LinkPopover` |
| R-037 | §4.2 step 5, §5 `GanttCanvas` |
| R-038 | §5 `FilterBar` |
| R-039 | §5 `Inspector` |
| R-040 | §5.1 |
| R-041 | §4.4, §5.1, D-015, D-007 |
| R-042–R-049 | *unused* |
| R-050 | §1 store, §5.1, D-008 |
| R-051 | §5 `ScheduleView` |
| R-052 | §5 `theme.css`, D-013 |

## 8. Verification plan

| What | How | Covers |
|---|---|---|
| Calendar | Unit: Friday + 5d = following Thursday; weekend starts normalize; negative lag crosses a weekend correctly | R-014 |
| CPM correctness | Unit: fixture networks with hand-computed ES/EF/LS/LF/float, including a chain, a diamond, and a network with parallel near-critical paths | R-010, R-011 |
| Relationship types | Unit: one fixture per type (FS/SS/FF/SF) × {+lag, 0, −lag} | R-012, R-013 |
| Cycle rejection | Unit: A→B→C, then C→A is rejected and the document is byte-identical afterward | R-016 |
| Propagation | Unit: change A's duration, assert every downstream ES shifts by the right amount | R-015 |
| Rollup | Unit: summary spans children; nested summaries; summary critical iff a descendant is | R-003, R-018 |
| Summary drag | Unit: offset applied to every leaf in a nested subtree; intra-group relative offsets unchanged; one undo reverts the whole move | R-041, R-050 |
| Constraints | Unit: SNET on a driven task pushes ES and only ES | R-017 |
| Undo/redo | Unit against the store: each of the nine listed actions, then undo, assert document equality | R-050 |
| Store layer | Vitest against the real store with `fake-indexeddb`: add/edit/delete, link rejection, constraint pinning, summary subtree move, undo/redo of each action type | R-001–R-006, R-015–R-018, R-041, R-050 |
| UI gestures | Playwright: quick-add, inline edit, bar drag, edge resize, link drag, cycle refusal, milestone toggle, reload persistence, critical filter | R-020–R-040, R-052 |

**The reference bar:** the fixture networks are the definition of correct. If a fixture and the app
disagree, the app is wrong.

## 9. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Summary-row semantics (D-006, PRD Q-3) turn out to be too restrictive in real use | Rework of the hierarchy layer | Build the flat engine first; summaries are a layer above it, so loosening the rule is additive |
| Drag interactions feel mediocre despite correct logic | The product's whole premise fails | Preview-then-commit model (§5.1) keeps gesture rendering independent of the engine, so feel can be tuned without touching correctness |
| Local-only storage loses a real schedule | Actual work lost | Ship R-006 export before the tool is trusted with a real program |
| The eventual Supabase migration turns out to need a different document shape | D-014's interface doesn't actually contain the change | `ProjectDoc` is already a single serializable document with stable uuids — it maps to one row or to normalized tables without restructuring |
| **Concurrent editing (PRD Q-6) is the stated destination** | Whole-document saves and snapshot undo (D-008, D-009) do not survive two simultaneous editors | One-editor-at-a-time is reachable from here: add a lock and keep everything else. True concurrent editing needs per-field operations and conflict resolution, and would be a rewrite of the store, not of the engine. Decide which one is actually wanted before the Supabase schema is written |
| TypeScript 7 is a new major with a rewritten compiler | Tooling friction | Pin the exact version; the fallback to 6.x is mechanical |
| Dependency arrows tangle before 30 activities | R-035 unmet, Gantt reads as spaghetti | Lane-offset routing from the start; do not defer routing to "polish" |
