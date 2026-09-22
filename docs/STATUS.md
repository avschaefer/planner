# STATUS — Planner

**Phase:** v1 built · engine and store verified · browser gestures unverified
**Updated:** 2026-09-21

---

## Now

- [ ] **Run it and judge whether it's worth pursuing.** `npm run dev` → http://localhost:5173
- [ ] Install Chromium's shared libraries so the browser smoke tests can run:
      `sudo apt-get install -y libnss3 libnspr4 libasound2t64`, then `npm run e2e`

## Built

All 32 requirements have an implementation. Verified by test where noted.

| Area | State |
|---|---|
| CPM engine — forward/backward pass, float, critical path | Built · 20 unit tests |
| Working-day calendar (Mon–Fri) | Built · 8 unit tests |
| FS/SS/FF/SF with positive and negative lag | Built · 9 unit tests |
| Cycle rejection | Built · tested at engine and store level |
| Summary rows, rollup, subtree drag | Built · tested at engine and store level |
| Milestones | Built · tested |
| Constraint-on-drag (D-007) | Built · tested |
| Undo/redo | Built · tested at store level |
| Task table, inline editing, quick-add | Built · **browser-unverified** |
| Gantt bars, drag/resize/link gestures | Built · **browser-unverified** |
| Timeline zoom, today marker, weekend shading | Built · **browser-unverified** |
| Dependency popover, inspector, critical filter | Built · **browser-unverified** |
| IndexedDB persistence, JSON import/export | Built · **browser-unverified** |

"Browser-unverified" means the code compiles, type-checks, and is served correctly by Vite,
and the Playwright suite covering it is written but has not run. Do not treat those rows as
working until `npm run e2e` passes.

## Next

Only once the core is judged worth keeping.

| # | Step | Reqs / Qs |
|---|---|---|
| 1 | Run the browser suite; fix whatever it catches | — |
| 2 | Decide Q-6 — concurrent editing vs. one editor at a time | Q-6 |
| 3 | Dependency-arrow lane assignment (currently a naive `i % 3` offset) | R-035 |
| 4 | Deadline constraints and negative float | Q-4 |
| 5 | Multi-select and bulk shift | Q-5 |
| 6 | Supabase behind `ScheduleRepo` | Q-1, D-014 |

## Blocked

Browser smoke tests — Chromium is downloaded but four shared libraries need a `sudo apt-get`.

## Decisions log

`docs/EDD.md` §6, D-001 … D-017. The four that shaped the build:

- **D-006** — summary rows are containers and carry no dependencies
- **D-007** — dragging an activity with predecessors pins it (visible, removable) rather than
  breaking the link
- **D-015** — dragging a summary applies one offset to its whole subtree
- **D-016** — the Gantt draws a calendar axis with weekends shaded while the engine stays in
  working-day integers

Resolved at kickoff: local-only storage now with Supabase later (Q-1, D-014), summary drag moves
the subtree (Q-3), no holidays (Q-2), concurrent editing is the eventual goal (Q-6).
