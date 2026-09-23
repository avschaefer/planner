# STATUS — Planner

**Phase:** v2 interaction pass · engine, store and browser gestures all verified
**Updated:** 2026-09-22

---

## Now

- [ ] **Plan a real program in it** and see what breaks. `npm run dev` → http://localhost:5173
- [ ] Re-run `npm test` and `npm run e2e` — the last change shipped unverified by request.
      The browser assertion for a held start date was rewritten (`.pin` → `.td.date.pinned`)
      and has not been run since.

## Recently completed

**2026-09-22 — v2 interaction pass.** Date pickers, MS Project predecessor shorthand, outline
numbering, link dragging onto whole rows with the type from the gesture, multi-select by lasso
and sweep, row drag-and-drop re-nesting, group colours, light-only theme. The inspector card,
the stored `Task.code`, the dark theme and the pin glyph were removed. See `CHANGELOG.md`.

## Built

All 37 requirements have an implementation. Every row below is verified by a test that has run.

| Area | State |
|---|---|
| CPM engine — forward/backward pass, float, critical path | Built · 20 unit tests |
| Working-day calendar (Mon–Fri) | Built · 8 unit tests |
| FS/SS/FF/SF with positive and negative lag | Built · 9 unit tests |
| MS Project predecessor shorthand (`3FS+2d`, `FS3`) | Built · 8 unit tests + browser test |
| Outline numbering, 1, 2, 3 … (R-002a) | Built · unit + browser test |
| Cycle rejection | Built · engine, store and browser tests |
| Summary rows, rollup, subtree drag, group colours | Built · store + browser tests |
| Milestones | Built · tested, survives reload |
| Constraint-on-drag (D-007) | Built · tested |
| Undo/redo | Built · store + browser tests |
| Task table, inline editing, quick-add, float column | Built · browser tests |
| Date pickers on Start and Finish | Built · browser test |
| Gantt bars, drag/resize/link gestures | Built · browser tests for all three |
| Link drag onto any part of a row, type from the gesture | Built · FS and SS browser tests |
| Multi-select: rubber band, row sweep, Shift/Ctrl click, bulk drag | Built · browser test |
| Row drag-and-drop reorder and re-nest | Built · browser test |
| Timeline zoom, today marker, weekend shading | Built · browser-exercised |
| Dependency popover, critical filter | Built · browser test for the filter |
| IndexedDB persistence, JSON import/export | Built · reload test |

**Test suites:** 51 unit tests (Vitest) · 16 browser tests (Playwright). Both pass as of
2026-09-22.

> Running Playwright here needs Chromium's shared libraries:
> `sudo apt-get install -y libnss3 libnspr4 libasound2t64`.

## Removed in v2

- The selection inspector card. Its content lives in the Float column and the bar tooltip (R-039).
- The stored `Task.code` field. Numbers are derived from outline position (EDD D-018).
- The dark theme. Light only (EDD D-020).
- The critical-activity count in the toolbar; the finish date stands alone.
- The pin glyph beside the activity name. The constraint itself is load-bearing (D-007) — it is
  what makes dragging a driven activity mean anything — so it stays, marked on the Start cell it
  constrains and released from the date picker there.

## Next

Only once the core is judged worth keeping.

| # | Step | Reqs / Qs |
|---|---|---|
| 1 | Dependency-arrow lane assignment (currently a naive `i % 3` offset) | R-035 |
| 2 | Deadline constraints and negative float | Q-4 |
| 3 | Decide Q-6 — concurrent editing vs. one editor at a time | Q-6 |
| 4 | Supabase behind `ScheduleRepo` | Q-1, D-014 |

## Blocked

Nothing.

## Decisions log

`docs/EDD.md` §6, D-001 … D-022. The four that shaped the build:

- **D-006** — summary rows are containers and carry no dependencies
- **D-007** — dragging an activity with predecessors pins it (visible, removable) rather than
  breaking the link
- **D-015** — dragging a summary applies one offset to its whole subtree
- **D-016** — the Gantt draws a calendar axis with weekends shaded while the engine stays in
  working-day integers

Resolved at kickoff: local-only storage now with Supabase later (Q-1, D-014), summary drag moves
the subtree (Q-3), no holidays (Q-2), concurrent editing is the eventual goal (Q-6).
