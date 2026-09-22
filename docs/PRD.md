# PRD — Planner

**Status:** Kickoff complete · **Last updated:** 2026-09-21 · **Owner:** av

---

## 1. Problem

Real critical-path scheduling is locked inside MS Project and Primavera P6 — tools that are
expensive, slow, visually dated, and built for an enterprise workflow most planners never use.
The alternatives people reach for (Excel Gantts, Asana/Monday timelines) draw bars but have no
scheduling engine: dates don't propagate, lag doesn't exist, and there is no float or critical path.

**Planner is the scheduling logic of P6 with the interaction quality of a modern design tool.**
Nothing else.

## 2. Users

| | Who | What they need |
|---|---|---|
| **Primary** | Project managers and planners who need real CPM but not an enterprise suite | Build a dependency network fast, see what drives the end date, change one thing and watch the schedule respond |
| **Secondary** | The author, scheduling medical-device development programs | A tool good enough to replace MSP/P6 for an actual program |

**Today they use:** MS Project or P6 — the logic works, the experience doesn't.

## 3. Jobs to be done

1. Get a plan's activities into the tool in minutes, not an afternoon.
2. Express real logic — predecessors, relationship types, lag — without opening a form.
3. See immediately which activities drive the completion date.
4. Change a duration or a link and understand the downstream consequence at a glance.

## 4. Scale

Typical schedule is **under 50 activities**. This is a deliberate constraint: it rules out
virtualization, incremental scheduling, and canvas rendering as v1 concerns.

---

## 5. Requirements

Priority: **P0** = the app is pointless without it · **P1** = needed before it's genuinely usable ·
**P2** = wanted, not blocking.

### 5.1 Data model and projects

| ID | Requirement | Acceptance criteria | Pri |
|---|---|---|---|
| R-001 | Multiple projects with a project list | A list screen shows all projects with name and date range; selecting one opens its schedule; create, rename, delete | P1 |
| R-002 | Activities with ID, name, start, finish, duration, type | Every activity has a stable internal id and a human-visible code; type is task, milestone, or summary | P0 |
| R-003 | Task hierarchy via summary rows | Indent/outdent changes parentage; collapse/expand hides children; summary bar spans its children's date range | P1 |
| R-004 | Milestones as a first-class type | Zero duration, drawn as a diamond, can be predecessor or successor of any activity | P1 |
| R-005 | Work survives a reload | All projects persist locally; edits autosave without an explicit save action | P0 |
| R-006 | JSON import/export | A project round-trips through an exported file with no data loss | P2 |

### 5.2 Scheduling engine

| ID | Requirement | Acceptance criteria | Pri |
|---|---|---|---|
| R-010 | CPM forward and backward pass | Every activity has early start, early finish, late start, late finish, and total float; values match a hand-computed reference network | P0 |
| R-011 | Critical path identification | Activities with total float ≤ 0 are flagged critical; the critical chain is continuous from project start to finish | P0 |
| R-012 | All four relationship types | FS, SS, FF, SF each schedule correctly; FS is the default on every new link | P0 |
| R-013 | Lag, positive and negative | Lag is entered in working days, may be negative, and is applied per relationship type | P0 |
| R-014 | Working-day calendar (Mon–Fri) | Durations and lag count working days only; no activity starts or finishes on a Saturday or Sunday; a 5d activity starting Friday finishes the following Thursday | P0 |
| R-015 | Automatic propagation | Changing a date, duration, link, or lag reschedules all affected successors immediately, with no explicit "schedule" action | P0 |
| R-016 | Circular logic is impossible | A link that would create a cycle is rejected at creation with a clear message; the existing schedule is unchanged | P0 |
| R-017 | Dragging a driven activity is meaningful | Dragging an activity that has predecessors applies a start-no-earlier-than constraint rather than silently breaking or ignoring the logic; the constraint is visible and removable | P1 |
| R-018 | Summary rows roll up, they don't schedule | A summary's dates are derived from its children; summaries cannot have predecessors or successors and do not appear in the dependency network | P1 |

### 5.3 Task table

| ID | Requirement | Acceptance criteria | Pri |
|---|---|---|---|
| R-020 | Compact table: ID, name, start, finish, duration, predecessors | All six columns visible without horizontal scrolling at a normal window width | P0 |
| R-021 | Inline cell editing | Name, start, finish, duration, and predecessors are edited in place; no modal | P0 |
| R-022 | Quick-add | One action creates a row with the name field focused; Enter commits and opens another row | P0 |
| R-023 | Keyboard navigation | Arrow keys move between rows, Tab moves between cells, Enter commits, Escape cancels | P1 |
| R-024 | Table and Gantt stay in lockstep | Vertical scroll and row heights are shared; row N in the table is always row N in the Gantt | P0 |

### 5.4 Gantt

| ID | Requirement | Acceptance criteria | Pri |
|---|---|---|---|
| R-030 | Timeline with day/week/month scales | Zoom in/out switches scale; horizontal scroll is smooth; the full project range is reachable | P0 |
| R-031 | Today indicator | A single subtle vertical marker at the current date | P1 |
| R-032 | Drag a bar to move it | Horizontal drag reschedules the activity; dates in the table update on release | P0 |
| R-033 | Drag a bar edge to change duration | Either edge resizes; opposite edge stays fixed; duration updates | P0 |
| R-034 | Drag from a bar endpoint to create a dependency | Dragging from an activity's end onto another activity creates an FS link with no modal | P0 |
| R-035 | Readable dependency arrows | Orthogonal routing with lane offsets; arrows do not overlap bars or each other in a 30-activity network | P1 |
| R-036 | Click a dependency to edit type and lag | A lightweight popover accepts shorthand such as `FS+2d`, `SS-1d`; the schedule updates on commit | P0 |
| R-037 | Critical path is visually obvious | Critical bars and the links between them are distinguishable at a glance without a legend | P0 |
| R-038 | Critical-path filter | A single toggle de-emphasizes or hides non-critical activities | P2 |
| R-039 | Selection inspector | Selecting an activity shows its dates, duration, predecessors, successors, total float, and critical status in a compact popover — not a full-height panel | P1 |
| R-040 | Drag snapping | Dragging snaps to day boundaries with a visible preview of the resulting dates | P1 |
| R-041 | Dragging a summary moves its whole subtree | Dragging a summary bar shifts every descendant activity by the same number of working days; relative offsets inside the group are preserved | P1 |

### 5.5 Editing safety and interaction

| ID | Requirement | Acceptance criteria | Pri |
|---|---|---|---|
| R-050 | Undo/redo | Move, resize, add link, remove link, change lag, add activity, delete activity, rename, indent/outdent are all reversible and re-appliable | P1 |
| R-051 | Keyboard shortcuts | Add, edit, delete, indent/outdent, navigate, zoom, undo/redo. No shortcut exists without a reason | P1 |
| R-052 | Restrained visual design | No cards, gradients, badges, status lights, large headers, or heavy shadows; the Gantt occupies the majority of the viewport; typography and spacing carry the hierarchy | P1 |

**Totals: 32 requirements — P0: 17 · P1: 13 · P2: 2**

---

## 6. Key flows

### 6.1 Build a schedule from nothing
New project → quick-add activities by name, Enter between each → set durations in the table →
drag from bar end to bar to link them → critical path appears without being asked for.

### 6.2 Change something and see the effect
Drag an activity's edge to extend it → successors shift immediately → the critical path
re-renders → if the end date moved, that is visible on the timeline.

### 6.3 Fix a relationship
Click the arrow between two bars → popover shows `FS+0d` → type `SS+3d` → Enter →
schedule recomputes.

---

## 7. Out of scope

Explicitly not built, at any priority:

| Excluded | |
|---|---|
| Resource planning, loading, leveling | Cost management, earned value |
| Procurement | WBS/OBS management screens |
| Complex calendar rules (shift patterns, per-activity calendars) | Administrative/configuration screens |
| Baselines and planned-vs-actual variance | Progress tracking / percent complete |
| Authentication, accounts, billing, marketing pages | Multi-user editing or sharing *(deferred, not abandoned — see Q-1)* |
| Reporting, exports to PDF/XER/MPP | Mobile layout |

Holidays are out entirely — the calendar is Mon–Fri with no exception list.

---

## 8. Success metrics

| Metric | Target |
|---|---|
| Real use | The author plans an actual device program in it instead of MSP/P6 |
| Engine correctness | CPM results match reference networks exactly — ES, EF, LS, LF, total float, critical set |
| Speed of edit | 20 activities added, linked, and durations set in under two minutes, no forms |
| Interaction quality | Drag, resize, link, and zoom feel smooth and obvious without instruction |

---

## 9. Open questions

### Open

| # | Question | Why it matters |
|---|---|---|
| Q-4 | Deadline / finish constraints | The engine supports start-no-earlier-than for R-017. Whether users can set a project or activity deadline — and see genuine negative float — is undecided |
| Q-5 | Multi-select and bulk edit | Not requested. Likely wanted the first time a whole phase needs to shift by a week |

### Resolved

| # | Question | Answer (2026-09-21) |
|---|---|---|
| Q-1 | Local-only storage vs. the "general PMs" audience | **Local-only for now.** Supabase is the intended destination once the tool proves worth building. Persistence sits behind a repository interface (EDD D-014) so the swap is contained rather than a rewrite. Accepted cost meanwhile: one browser, one machine, no recovery if site data is cleared |
| Q-2 | Holidays | **Out.** Mon–Fri only, no exception list. Schedules crossing a holiday period will drift from reality; accepted |
| Q-3 | Should dragging a summary bar move its children? | **Yes — the entire subtree**, all nesting levels, by the same working-day offset (R-041) |
| Q-6 | What does "shared" mean when Q-1 lands? | **Concurrent editing, or at minimum one editor at a time.** Single-editor-at-a-time is compatible with today's architecture (a lock plus the existing whole-document save). Genuine concurrent editing is not: it breaks snapshot undo (D-008) and whole-document writes. Flagged as the main thing that would force a rewrite — see EDD §9 |
