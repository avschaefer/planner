# ADMIN — Planner

**Last updated:** 2026-09-23

---

## Commands

| Task | Command |
|---|---|
| Dev server | `npm run dev` → http://localhost:5173 |
| Unit + store tests | `npm test` |
| Tests, watch | `npm run test:watch` |
| Single test file | `npm test -- src/engine/schedule.test.ts` |
| Browser smoke tests | `npm run e2e` (starts the dev server itself) |
| One browser test | `npm run e2e -- -g "dragging a bar"` |
| Type check | `npm run typecheck` |
| Production build | `npm run build` → `dist/` |
| Preview the build | `npm run preview` |

### One-time setup for the browser tests

```bash
npx playwright install chromium
sudo apt-get install -y libnss3 libnspr4 libasound2t64   # Chromium's shared libraries
```

## Environments

| Env | Where | How |
|---|---|---|
| Local, no backend | localhost:5173 | `npm run dev` — IndexedDB, no passcode |
| Local, full stack | localhost:3000 | `npx vercel dev` with `.env.local` — Supabase + passcode |
| Prod | Vercel | push to `main` |

`npm run dev` runs the app against IndexedDB, which is what the browser test suite uses. The
passcode gate and the shared database only exist under `vercel dev` and on Vercel, because both
need the serverless functions.

Environment variables are listed in `.env.example`. `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS and
must never appear in anything `VITE_`-prefixed — that prefix compiles a value into the public
bundle.

### Rotating the passcode

Change `APP_PASSCODE` in Vercel and redeploy. Existing sessions stay valid until their cookie
expires; to sign everyone out immediately, change `SESSION_SECRET` as well.

## Layout

```
api/             Vercel serverless functions (passcode, writes, editor lock)
docs/            PRD.md, EDD.md, ADMIN.md, STATUS.md
proxy.ts         Vercel Routing Middleware — the passcode gate
supabase/        migrations/
e2e/             Playwright browser smoke tests
src/
  engine/        calendar.ts  graph.ts  ids.ts  schedule.ts  predecessors.ts  types.ts
                 calendar.test.ts  schedule.test.ts  predecessors.test.ts
  store/         store.ts (document, undo stack, transient UI state)  store.test.ts
  persist/       repo.ts (ScheduleRepo interface)  idbRepo.ts  supabaseRepo.ts
                 realtime.ts  lock.ts
  ui/            ScheduleView  TaskTable  Gantt  DateField  LinkPopover  Settings  ProjectList
                 colors.ts  exportPng.ts  icons.tsx  linkPath.ts  measure.ts  reorder.ts
                 rows.ts  settings.ts  timeline.ts
  styles.css     design tokens + all styling (light theme only)
```

**Rule:** `src/engine/` imports nothing from React, the DOM, or the store. It takes a document
and returns a schedule. That constraint is what makes its tests meaningful.

**Rule:** `src/ui/rows.ts` produces the one ordered row list that both the table and the Gantt
render. Neither builds its own.

## Where things are

| Looking for | File |
|---|---|
| Forward/backward pass, float, critical | `src/engine/schedule.ts` |
| Working-day ↔ calendar conversion | `src/engine/calendar.ts` |
| Cycle detection | `src/engine/graph.ts` (`wouldCycle`) |
| `3FS+2d` / predecessor shorthand parsing | `src/engine/predecessors.ts` |
| Activity numbering (1, 2, 3 down the outline) | `src/engine/ids.ts` |
| Every document mutation, undo stack | `src/store/store.ts` (`commit`) |
| Bar drag, resize, link drag, rubber-band select | `src/ui/Gantt.tsx` (the `Drag` state machine) |
| Row drag-and-drop, drop depth | `src/ui/reorder.ts` (`dropPlan`) + `src/ui/TaskTable.tsx` |
| Summary group hue assignment | `src/ui/colors.ts` |
| Palettes, bar/milestone formatting, persistence | `src/ui/settings.ts` |
| PNG export of the chart | `src/ui/exportPng.ts` |
| Passcode gate, session cookie | `proxy.ts`, `api/_session.ts` |
| Shared persistence and live sync | `src/persist/supabaseRepo.ts`, `src/persist/realtime.ts` |
| Editor lock rule (shared by client and API) | `src/persist/lock.ts` |
| Database schema | `supabase/migrations/0001_init.sql` |
| Timeline ticks, zoom scales | `src/ui/timeline.ts` |
| Dependency arrow routing | `src/ui/linkPath.ts` |
| Colours, spacing, row height | `src/styles.css` (`:root`) |

## Conventions

| | |
|---|---|
| Git | Trunk-based. Commit and push directly to `main`. No feature branches, no PRs |
| Commits | Conventional commits with requirement IDs — `feat(engine): backward pass and total float (R-010)` |
| Scopes | `engine`, `store`, `ui`, `persist`, `docs` |
| Docs | Markdown. `STATUS.md` updated whenever Now/Next changes |
| Requirements | New requirement → new `R-` ID in PRD.md → new row in the EDD traceability table |
| Tests | Engine and store changes land with their tests in the same commit |

## Repo state

Git, trunk-based on `main`, pushed to `github.com/avschaefer/planner`. History starts at the
v1 build; `CHANGELOG.md` tracks what has landed since.
