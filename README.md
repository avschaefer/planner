# Planner

Critical-path scheduling with a modern interface. The scheduling logic of Primavera P6 —
activities, dependencies, lag, float, critical path — without the enterprise suite around it.

Client-only: no server, no accounts, no network calls. Schedules live in the browser.

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
- **Direct manipulation.** Drag a bar to move it, drag an edge to resize, drag from a bar's
  end onto another to link them. Dragging an activity that has predecessors pins it with a
  visible, removable constraint rather than silently breaking the logic.
- **Summary rows** that roll up their children and move their whole subtree together.
- **Milestones**, undo/redo, keyboard-first editing, day/week/month zoom.

Deliberately not built: resources, cost, earned value, WBS/OBS, progress tracking, baselines,
complex calendars, authentication.

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

Design decisions and their rejected alternatives are in [`docs/EDD.md`](docs/EDD.md);
requirements in [`docs/PRD.md`](docs/PRD.md); current state in [`docs/STATUS.md`](docs/STATUS.md).
