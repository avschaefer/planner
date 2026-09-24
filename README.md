# Marga

Critical-path scheduling with a modern interface. The scheduling logic of Primavera P6 —
activities, dependencies, lag, float, critical path — without the enterprise suite around it.

Runs two ways: local-only against IndexedDB, or with accounts — Supabase Auth and one database,
where each person's schedules are theirs and changes appear live.

Deployed at **https://marga-planner.vercel.app** — sign up to use it.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
```

## What it does

- **Real CPM.** Forward and backward pass, early/late dates, total float, critical path.
  Verified against hand-computed reference networks.
- **Working-day calendar.** Mon–Fri. A 5-day activity starting Friday finishes the
  following Thursday.
- **All four relationship types** — FS, SS, FF, SF — with positive and negative lag.
- **Direct manipulation.** Drag a bar to move it, drag an edge to resize, drag a handle from
  either end of a bar onto any part of another row to link them — which handle you grab and
  which half you drop on decides FS, SS, FF or SF. Dragging an activity that has predecessors
  pins it with a visible, removable constraint rather than silently breaking the logic.
- **MS Project shorthand.** Activities are numbered 1, 2, 3 down the outline, and predecessors
  are typed the way a scheduler types them: `3`, `3FS+2d`, `4SS-1d`, `FS3`.
- **Date pickers** on Start and Finish that still accept typing.
- **Summary rows** that roll up their children, move their whole subtree together, and colour
  their group through the chart and the table.
- **Multi-select** by rubber band or gutter sweep; delete, indent, and drag the whole set at once.
- **Drag rows** by the grip to reorder them, and sideways to move them in and out of summaries.
- **Milestones**, undo/redo, keyboard-first editing, day/week/month zoom.
- **Accounts, if you want them.** Sign in with email and password; your schedules are yours, with live updates on
  every screen and one editor at a time with a take-over button.

Deliberately not built: resources, cost, earned value, WBS/OBS, progress tracking, baselines,
complex calendars, authentication.

## Accounts

Optional — without Supabase values the app runs entirely in your browser.

1. Apply `supabase/migrations/` to a Supabase project, in order.
2. Copy `.env.example` to `.env.local` and fill in the two `VITE_` values.
3. In the Supabase dashboard set the Site URL and redirect URLs (see `docs/ADMIN.md`).

Sign-in is email and password with a persistent session. Row-level security decides who can see
and change each schedule; `npm run verify:db` proves it against the live project.

## Commands

| | |
|---|---|
| `npm run dev` | Dev server |
| `npm test` | Engine + store tests (Vitest) |
| `npm run e2e` | Browser smoke tests (Playwright) |
| `npm run build` | Production build to `dist/` |

Browser tests need `npx playwright install chromium` and, on Debian/Ubuntu,
`sudo apt-get install -y libnss3 libnspr4 libasound2t64`.

## Architecture

`src/engine/` is pure TypeScript — no React, no DOM. It takes a document and returns a
schedule. Everything derived (dates, float, critical flags, summary extents) is recomputed on
every change and never stored, so the table and the Gantt cannot disagree.

Persistence sits behind one interface, `ScheduleRepo` — `idbRepo` locally, `supabaseRepo` when
the project is configured for it. Swapping them is a single line in the store; nothing else in
the app knows which one it is talking to.

Design decisions and their rejected alternatives are in [`docs/EDD.md`](docs/EDD.md);
requirements in [`docs/PRD.md`](docs/PRD.md); current state in [`docs/STATUS.md`](docs/STATUS.md).
