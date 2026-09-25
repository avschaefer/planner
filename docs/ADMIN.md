# ADMIN — Marga

**Last updated:** 2026-09-25

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
| Local, no backend | localhost:5173 | `npm run dev` with no `.env.local` — IndexedDB, no accounts |
| Local, shared | localhost:5173 | `npm run dev` with `.env.local` — real Supabase, sign-in required |
| Prod | https://marga-planner.vercel.app | push to `main` |

`npm run dev` reads `.env.local`: with Supabase values it runs signed-in against the real project;
without them it runs against IndexedDB with no accounts. The browser test suite always forces the
local path (`VITE_FORCE_LOCAL=1`).

| Check | Command |
|---|---|
| Database access rules, live | `npm run verify:db` — two throwaway accounts, ~65 checks (isolation, sharing, roles, lock, billing lockout, deletion), cleaned up after |
| Billing, end to end | `stripe listen --forward-to localhost:5173/api/billing/webhook` + `npm run dev` — runbook in `docs/BILLING.md` §7 |
| Accounts and sharing in a browser, live | `npm run dev`, then `npm run e2e:accounts` (stop the dev server before `npm run e2e`, which needs its own local-mode server) |

Both need `SUPABASE_SECRET_KEY` in `.env.local` to create and delete their test accounts.

`npm run dev` also serves the functions in `api/` (a Vite plugin in `vite.config.ts`), reading the
server-only variables from `.env.local`. Every variable, and which Vercel environments need it, is
in `docs/BILLING.md` §5.

### Supabase settings that live only in the dashboard

Authentication → URL Configuration: Site URL `https://marga-planner.vercel.app`, Redirect URLs
`https://marga-planner.vercel.app/**` and `http://localhost:5173/**`. Authentication → Emails →
SMTP: a real sender before real users. Schema changes are migrations in `supabase/migrations/`.

### Stripe settings that live only in the dashboard

Product and prices, the webhook endpoint and its events, Customer Portal, failed-payment retries and
receipts — the full checklist is `docs/BILLING.md` §6. The live object IDs (product, prices, Portal configuration, webhook
endpoint) are in §6.1. Production uses live mode; Preview and Development have no Stripe variables.

### Admin panel and free accounts

`ADMIN_EMAIL` (Vercel Production; `.env.local` for local) names the admin account. Signed in as it,
Account → Admin → **Manage free accounts** grants or revokes complimentary access by email.
Details: `docs/BILLING.md` §9. Deleting an account cancels its Stripe subscription first
(`api/account/delete.ts`).

### Legal page

`public/legal.html` — Terms (section 6 is cancellation and refunds, anchor `#refunds`) and Privacy on
one static page at `/legal.html`. One "Terms & Privacy" link on every page outside the chart
(`GlassPage`), plus links at sign-up and beside the subscribe buttons. It names no prices or trial
length, so pricing changes don't touch it; changes to cancellation, refunds or data handling do.
Bump its "Effective" date with any text change.

## Layout

```
docs/            PRD.md, EDD.md, ADMIN.md, STATUS.md, BILLING.md
public/          legal.html (Terms, Privacy, Refunds), fonts/
api/             Vercel functions: billing/checkout.ts  billing/portal.ts  billing/webhook.ts
                 _billing.ts (pure rules)  _stripe.ts  _supabase.ts (service role)  + tests
scripts/         verify-rls.mjs — live check of the database's access rules
supabase/        migrations/
e2e/             Playwright browser smoke tests
src/
  engine/        calendar.ts  graph.ts  ids.ts  schedule.ts  predecessors.ts  types.ts
                 calendar.test.ts  schedule.test.ts  predecessors.test.ts
  store/         store.ts (document, undo stack, transient UI state)  store.test.ts
  persist/       repo.ts (ScheduleRepo interface)  idbRepo.ts  supabaseRepo.ts
                 realtime.ts  lock.ts  auth.ts  sharing.ts  access.ts  billing.ts
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
| Accounts, sign-in, sessions | `src/persist/auth.ts`, `src/ui/AuthScreen.tsx`, `src/ui/ProfilePage.tsx` |
| Who has access (trial / active / expired) | `private.has_access()` in `supabase/migrations/0006_billing.sql`; mirrored in `src/persist/access.ts` |
| Checkout, Portal, webhook | `api/billing/*.ts`, `api/_stripe.ts` (`syncCustomer`) |
| Billing UI, lockout screen | `src/ui/BillingSection.tsx`, `src/ui/LockoutScreen.tsx` |
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
| Scopes | `engine`, `store`, `ui`, `persist`, `billing`, `docs` |
| Docs | Markdown. `STATUS.md` updated whenever Now/Next changes |
| Requirements | New requirement → new `R-` ID in PRD.md → new row in the EDD traceability table |
| Tests | Engine and store changes land with their tests in the same commit |

## Repo state

Git, trunk-based on `main`, pushed to `github.com/avschaefer/planner`. History starts at the
v1 build; `CHANGELOG.md` tracks what has landed since.
