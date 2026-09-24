# Changelog

Notable changes to Marga. Format follows [Keep a Changelog](https://keepachangelog.com);
requirement IDs refer to [`docs/PRD.md`](docs/PRD.md).

## [Unreleased]

### Added

- **Subscriptions.** A 30-day free trial for every account (existing accounts start theirs when billing ships), then $12/year or $2/month through Stripe Checkout. Subscribers manage their card, plan and cancellation in the Stripe Customer Portal. [R-069] [R-070] [R-071]
- **Lockout.** After the trial, with no live subscription, schedules can't be read, saved, shared or watched live. The database refuses them (402), not just the interface. The account page and sign-out stay open, nothing is deleted, and subscribing restores access at once. A failed payment keeps access while Stripe retries. [R-072]
- Stripe webhook (`/api/billing/webhook`): signature-verified, idempotent, and the only thing that changes billing state. [R-073]
- Billing section on the account page: trial days left, plan and renewal date, a past-due warning, upgrade buttons, Manage subscription. [R-074]
- `docs/BILLING.md`: rules, state model, events, env vars, Stripe setup and test runbook. `npm run verify:db` covers the lockout.
- **Sharing.** A Share button on every schedule: invite another account by email as *Can edit* or *View only*, change or remove anyone's access, see who has it. Shared schedules appear live in the collaborator's list with a tag, and they can leave. Viewers get a "View only" banner and cannot change anything — enforced in the database, not just the interface. [R-068]
- Account page: change your email (confirmed by link before it takes effect) and delete your account, behind a warning that names what will be lost and a typed-email confirmation. [R-066]
- `npm run verify:db` now also covers sharing, roles and account deletion (43 checks); `npm run e2e:accounts` walks two accounts through sharing.
- Rename a schedule in place: click its title in the toolbar. Enter or clicking away saves, Escape cancels; it undoes like any edit. [R-021]
- **User accounts** on Supabase Auth: sign up, confirm by email once, then sign in with a password and stay signed in on that device. Forgotten passwords reset by email. [R-061]
- Every schedule belongs to an account; the database enforces who can see and change it (row-level security), with a membership table ready for sharing. [R-065]
- Profile page: name, email, plan, change password, sign out. An initials avatar on the project list opens it. [R-066]
- `profiles.plan`, owned by the server, for subscriptions later. [R-067]
- `npm run verify:db` proves the access rules against the live project with two throwaway accounts; `npm run e2e:accounts` walks sign-in to sign-out in a browser.
- Settings → Colour by: *Summary group* (as before) or *Type* — every summary one colour, every activity a second, every milestone a third, each picked from its own row of swatches. Critical still overrides. Applies to the chart, the table and PNG export. [R-057]
- After dragging an activity that has a predecessor, a prompt offers to record the move as lag on the driving link instead of a Start No Earlier Than constraint. Dragging a driven activity *earlier* than its logic now works, by reducing the lag. [R-017]
- Summaries can be linked. A link from a summary reads the group's extent — FS from `s2` starts the successor after `s2`'s last activity — and a link onto a summary holds back everything inside it. Links can be dragged onto summary rows and typed into their predecessor cells. [R-018]
- **Shared backend.** Schedules live in Supabase Postgres, one row per project mirroring
  `ProjectDoc`, reached through a new `ScheduleRepo` implementation. No call site changed. [R-062]
- **Passcode gate.** One shared passcode, checked in Vercel Routing Middleware (`proxy.ts`) ahead of
  every route including the built bundle, and again in each API function. Signed HttpOnly session
  cookie; no accounts, no roles. [R-061] [R-065]
- **Live viewing.** A Supabase Realtime subscription on the open schedule's row; a change made
  anywhere appears everywhere in about a second. [R-063]
- **One editor at a time.** A soft lock claimed on the first edit and kept by a heartbeat,
  enforced in `commit()` and again server-side on write. Everyone else sees a read-only banner
  with a take-over button. Abandoned 90s after its holder goes quiet. [R-064]
- `vercel.json`, `.env.example` and `supabase/migrations/0001_init.sql`.

- Settings modal: accent / summary-group / critical-path palettes, activity and summary bar
  shape and name position (left, inside, right, none), milestone shape, label and side, the
  date format used everywhere, and a float-tail switch. Persists across sessions. [R-057]
- Export the chart as a PNG — the whole timeline with its header, at 2×. [R-058]
- A toggle that hides the activity table and gives the chart the whole window. [R-059]
- Clicking the chart below the last bar, either header, or the table's empty area clears the
  selection, so a snapshot carries no highlight. [R-060]

- Date pickers on the Start and Finish cells — month grid, weekends inert, today ringed,
  arrow keys walking working days. Typing still works. [R-021]
- MS Project predecessor shorthand: `3`, `3FS`, `3FS+2d`, `3+2`, and the reversed `FS3+2d`,
  any case, separated by commas, semicolons or spaces. [R-055]
- Activity numbering 1, 2, 3 down the outline, independent of indent level and derived from
  position rather than stored. [R-002a]
- Link handles at both ends of every bar, an 18px target, and the whole target row as a drop
  zone. The relationship type follows the gesture — grabbed end × released half gives FS, SS,
  FF or SF — and is previewed at the cursor. Escape abandons. [R-034]
- Multi-select: rubber-band drag in the chart, press-and-drag across table rows, Shift-click,
  Cmd/Ctrl-click, Cmd/Ctrl+A. Delete, indent/outdent, milestone toggle and bar drag act on the
  whole selection in one undo step. [R-053]
- Row drag-and-drop by a grip in the leftmost column: up and down to reorder, sideways to move
  in and out of summaries, with the insertion point and depth previewed. [R-054]
- Summary group colour-coding through the chart and the table; critical red overrides the
  group hue. [R-056]
- A Float column in the table and a bar hover tooltip carrying dates, duration, float,
  critical status and link counts. [R-039]

### Changed

- `profiles.plan` is now `monthly`, `annual` or empty, written by the webhook; the `'free'` placeholder is gone. The account page's Plan row is replaced by the billing section.
- `npm run dev` also serves the Vercel functions in `api/`.
- Account page: one wide two-column card that fits without scrolling, a proper back control, sign-out top right, and a small logotype top-left instead of the hero title. [R-066]
- The editor lock and save are one database function, so the lock holds however the client behaves. [R-064]
- The hero title is 15% smaller.
- Wordmark: "MARGA" as spaced capitals in Outfit beside the mark, and a large hairline hero "MARGA" above the card on both the home and passcode pages, sized to the window so it is never clipped. The passcode page now matches — still aurora, frosted card, same logotype and hero word.
- The home page background is a living aurora — flowing ribbons and soft colour fields in the accent with lilac, rose, peach and sky — behind a frosted-glass card. Seeded afresh each visit, drawn on a tiny canvas that CSS scales and blurs, and still under reduced-motion settings.
- Dependency lines use one elbow — right along the predecessor's row, then down into the successor — as scheduling tools draw them. Lag lengthens the horizontal run. [R-035]
- Summaries are drawn as brackets with a downward leg at each end in both profiles, so they never read as task bars.
- Constraint wording is standard: "Start No Earlier Than", and "Remove constraint" in place of "Release to logic". [R-017]
- Predecessor text matches duration text exactly.
- Cell editing: the cell itself becomes the field — borderless input, an accent ring, no text shift. One click anywhere in a cell opens it, including the empty part of the name box. The chart no longer re-renders when an editor opens, which was the lag.
- Duration and predecessors are purple, marking what you type; dates and float stay grey as computed values. Every editable cell shows a pointer.
- One `Button` component for every button in the app. [R-052]
- Summary text set to "Inside" draws a full-height summary bar; otherwise summaries keep the thin profile.
- Float tails are drawn with an end tick and the bar name is placed past them, so the two no
  longer overlap. They were previously reading as stray dots where a label crossed them.
- The project finish date is now a read-out in the toolbar rather than a run of muted text.
- SVG labels get a measured backing plate instead of a stroke halo, so a dependency line
  crossing a name no longer shows through the gaps between words.
- New light theme: warm neutral canvas, indigo accent, segmented toolbar clusters with icons,
  a month band in the timeline header, activity names beside their bars. [R-052]
- Table columns rebalanced so the Activity name is never crushed by the fixed columns. [R-020]
- A start date held by a drag is marked on the Start cell it constrains and released from the
  date picker that opens there. [R-017]
- Popovers opened from the task table are portalled to `document.body`, past the scroll
  transform that was displacing them by the height of the header.

### Fixed

- Sign-up needed a small scroll on short windows. The hero title now also scales with window height, and the form is tighter. [R-061]
- (Caught before release) A viewer's save failed with a misleading duplicate-key error, and their lock request answered "granted"; both are now refused up front. The interface also briefly mistook a viewer for the owner because a role lookup returned every member's row. [R-068]
- A link from a summary was saved but ignored — the successor did not move. [R-018]
- The project list's Create button rendered blank: a disabled-hover rule painted white under white text. It is now the same component as Add activity. [R-052]
- Summary text "Inside" was unreadable on the thin summary bar.
- A label on a selected row showed a pale box behind it.
- Deployed middleware and API functions crashed at load: `package.json` is `type: module`, so relative imports in `api/` and `proxy.ts` need `.js` extensions. `vercel dev` hid it. [R-061]
- A save in flight when the tab closes now uses `keepalive`, so it still lands.
- Shift and Cmd/Ctrl click in the table opened a cell editor instead of changing the
  selection; a modified click is now always a selection gesture. [R-053]
- The `#` cell handled selection a second time after the row had already handled it, so
  Cmd/Ctrl-clicking a row number toggled twice and did nothing. [R-053]
- Three Playwright helpers committed edits with `Escape`, which discards them — the browser
  suite had never been run, so this had gone unnoticed. All 21 tests pass.
- A pending autosave is now flushed when the tab is hidden or closed. An edit made within
  200ms of a reload was being dropped.

### Removed

- The shared passcode, its gate (`proxy.ts`) and the Vercel API functions (`api/`). Row-level security replaces them. `APP_PASSCODE` and `SESSION_SECRET` are no longer used.
- The selection inspector card; its content moved to the Float column and the bar tooltip.
- The stored `Task.code` field, replaced by derived outline numbering.
- The dark theme. Light only.
- The critical-activity count in the toolbar, and the pin glyph beside the activity name.

## [0.1.0] — 2026-09-21

Initial build: CPM engine, working-day calendar, all four relationship types with lag, summary
rollup, milestones, task table, SVG Gantt, undo/redo, IndexedDB persistence. [R-001…R-052]
