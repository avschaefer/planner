# Marga

Critical-path scheduling with a modern interface. The scheduling logic of Primavera P6 —
activities, dependencies, lag, float, critical path — without the enterprise suite around it.

Runs two ways: local-only against IndexedDB, or shared — one Supabase database behind a single
passcode, with everyone watching the same schedule change live.

Deployed at **https://marga-planner.vercel.app** behind a shared passcode.

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
- **Shared, if you want it.** One passcode for the team, schedules in Supabase, live updates on
  every screen, and one editor at a time with a take-over button. No accounts.

Deliberately not built: resources, cost, earned value, WBS/OBS, progress tracking, baselines,
complex calendars, authentication.

## Sharing it with a team

Optional — without these the app runs entirely in your browser.

1. Apply `supabase/migrations/0001_init.sql` to a Supabase project.
2. Copy `.env.example` to `.env.local` and fill it in.
3. `npx vercel dev` for the full stack locally, or push to `main` to deploy.

One passcode gates everything, including the built bundle. The anon key is read-only by policy
and every write goes through a serverless function holding the service-role key, so a leaked key
can read but never corrupt. Details in [`docs/EDD.md`](docs/EDD.md) D-026…D-030.

## Commands

| | |
|---|---|
| `npm run dev` | Dev server |
| `npm test` | Engine + store tests (Vitest) |
| `npm run e2e` | Browser smoke tests (Playwright) |
| `npm run build` | Production build to `dist/` |
| `npx vercel dev` | Full stack locally: passcode gate, API functions, Supabase |

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
