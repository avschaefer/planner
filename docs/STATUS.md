# STATUS — Marga

**Phase:** live at https://marga-planner.vercel.app with user accounts · subscriptions built in Stripe test mode, not yet shipped · all suites green
**Updated:** 2026-09-24

---

## Now

- [ ] **Ship billing** (owner): the code is on `main` and harmless until the migration. Stripe
      Dashboard setup in test mode (`docs/BILLING.md` §6) → the Vercel env vars (§5) → redeploy →
      apply `supabase/migrations/0006_billing.sql`. The migration starts every existing account's
      30-day trial and turns enforcement on, so run it when you mean it.
- [ ] Walk the billing paths with the Stripe CLI and test clocks (`docs/BILLING.md` §7.3), and run
      `npm run verify:db` against the migrated project.
- [ ] Go live: repeat the Stripe setup in live mode; live key, webhook secret and price IDs in
      Production only.
- [ ] **Supabase → Authentication → URL Configuration** (owner, dashboard only): Site URL
      `https://marga-planner.vercel.app`; Redirect URLs `https://marga-planner.vercel.app/**` and
      `http://localhost:5173/**`. Until this is set, confirmation and reset links point at localhost.
- [ ] **Custom SMTP** (Authentication → Emails → SMTP) before inviting real users. The built-in
      sender is for testing and allows only a few emails an hour.
- [ ] Remove `APP_PASSCODE` and `SESSION_SECRET` from Vercel — unused since accounts.
- [ ] **Plan a real program in it** and see what breaks.

## Recently completed

**2026-09-24 — subscription billing (R-069 – R-074).** A 30-day trial, then $12/year or $2/month on Stripe Checkout, with the Customer Portal for card changes, plan switches and cancellation. The lockout is enforced in the database (reads, writes, sharing and realtime; a direct write gets 402) and data is never deleted. A signed, idempotent webhook is the only writer. Unit and browser suites green; the live database checks and Stripe runbook wait on keys. Spec: `docs/BILLING.md`.

**2026-09-24 — sharing and account management.** Share by email as editor or viewer, live shared lists, leave a shared schedule, change email, delete account with typed confirmation, sign-up fits one screen. 43 database checks and a two-account browser walk pass live.

**2026-09-24 — user accounts.** Supabase Auth (email + password, persistent sessions), row-level
security per account with a membership table ready for sharing, the editor lock moved into the
database, profile page. The shared passcode, its gate and the `api/` functions are gone. Verified
live: 21 database checks (`npm run verify:db`) and a full browser walk (`npm run e2e:accounts`).

**2026-09-24 — scheduling conventions.** One-elbow FS lines, bracket summaries, standard SNET wording, lag offered after a drag (D-033, D-034).

**2026-09-24 — final touches before sharing.** Summaries take links (D-031, supersedes D-006), cleaner single-click cell editing with purple editable fields, one shared `Button` component (D-032), thick summary bars for inside text. Production is live on Vercel against Supabase.

**2026-09-23 — v4 shared backend.** Supabase persistence behind the existing `ScheduleRepo`,
a shared-passcode gate in Vercel Routing Middleware, Realtime viewing, and a soft one-editor
lock. Resolves PRD Q-1 and Q-6.

**2026-09-23 — v3 presentation pass.** Settings modal (palettes, bar/summary/milestone
formatting, date format), PNG export, hide-the-table, click-away to deselect. Float tails
redrawn with an end tick so they stop reading as stray dots. Autosave now flushes when the
tab is hidden.

**2026-09-22 — v2 interaction pass.** Date pickers, MS Project predecessor shorthand, outline
numbering, link dragging onto whole rows with the type from the gesture, multi-select by lasso
and sweep, row drag-and-drop re-nesting, group colours, light-only theme. The inspector card,
the stored `Task.code`, the dark theme and the pin glyph were removed. See `CHANGELOG.md`.

## Built

All 46 requirements have an implementation. Every row below is verified by a test that has run,
including the shared backend: the full chain — sign-in, per-account isolation, live sync, editor lock
hand-off — passed against the real Supabase project (`npm run e2e:stack`).

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
| Presentation settings, persisted (R-057) | Built · browser test incl. reload |
| PNG export of the whole chart (R-058) | Built · browser test |
| Hide the activity table (R-059) | Built · browser test |
| Click-away to clear the selection (R-060) | Built · browser test |
| Passcode gate, session cookie (R-061, R-065) | Built · 15 unit tests over the gate and the write guards |
| Editor lock rule (R-064) | Built · unit tested · hand-off verified live across two browsers |
| Supabase document mapping (R-062) | Built · round-trip unit tested · verified live |
| Realtime subscription (R-063) | Built · verified live in the browser |
| IndexedDB persistence, JSON import/export | Built · reload test |

**Test suites:** 68 unit tests (Vitest) · 21 browser tests (Playwright). Both pass as of
2026-09-23. The browser suite runs against the IndexedDB fallback, which is deliberate: it
proves the local path still works and keeps the suite runnable without a network.

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

| 4 | Pending invitations, so a schedule can be shared with someone who has not signed up yet | R-068 |

## Blocked

Nothing.

## Decisions log

`docs/EDD.md` §6, D-001 … D-043. The four that shaped the build:

- **D-006** — summary rows are containers and carry no dependencies
- **D-007** — dragging an activity with predecessors pins it (visible, removable) rather than
  breaking the link
- **D-015** — dragging a summary applies one offset to its whole subtree
- **D-016** — the Gantt draws a calendar axis with weekends shaded while the engine stays in
  working-day integers

Resolved at kickoff: local-only storage now with Supabase later (Q-1, D-014), summary drag moves
the subtree (Q-3), no holidays (Q-2), concurrent editing is the eventual goal (Q-6).
