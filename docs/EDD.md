# EDD — Marga

**Status:** v5 subscriptions · **Last updated:** 2026-09-24

---

## 1. Architecture

Client-only single-page app. No server, no network calls at runtime.

```
┌─ ui/ ──────────────────────────────────────────────┐
│  ProjectList          TaskTable      GanttChart    │
│                       (DOM rows)     (SVG)         │
│                          └──── shared scroll ──────┤
└────────────────────┬───────────────────────────────┘
                     │  actions in / derived schedule out
┌────────────────────▼───────────────────────────────┐
│  store/  (Zustand)                                 │
│    document: { project, tasks[], links[] }         │
│    undo/redo: snapshot stack                       │
│    selection, zoom, filters  (transient, not saved)│
└────────────────────┬───────────────────────────────┘
                     │  pure call, synchronous
┌────────────────────▼───────────────────────────────┐
│  engine/   ← no React, no DOM, no dates-as-strings  │
│    calendar.ts   working-day index ↔ calendar date  │
│    schedule.ts   topo sort, forward/backward pass   │
│    validate.ts   cycle detection                    │
│    rollup.ts     summary date derivation            │
└────────────────────┬───────────────────────────────┘
                     │
┌────────────────────▼───────────────────────────────┐
│  persist/  ScheduleRepo  →  IdbRepo (later: Supabase) │
└────────────────────────────────────────────────────┘
```

**The load-bearing idea:** the document holds only what the user typed. Every scheduled date —
ES, EF, LS, LF, float, critical, summary bar extents — is derived by the engine on each change and
never stored. There is exactly one source of truth and no possibility of the table and the Gantt
disagreeing.

*Satisfies: R-015, R-024*

## 2. Stack

| Layer | Choice | Version | Why |
|---|---|---|---|
| Runtime | Node | 24.21.0 | Installed |
| Language | TypeScript | 7.0.2 | Latest stable (native compiler). Pin exactly; it is a new major |
| UI | React | 19.3.0 | Boring default, and the app is one dense stateful screen |
| Build | Vite + @vitejs/plugin-react | 8.3.0 / 6.1.1 | Static output, fast HMR, no SSR to fight during drag work |
| State | Zustand | 5.0.15 | ~1 kB, no provider tree, no boilerplate. Redux-scale ceremony is unwarranted at this size |
| Dates | none | — | Dropped. The engine works in integer indices and needs only UTC arithmetic; a date library would have earned its keep only at the display edge |
| Storage | idb | 8.0.3 | Thin promise wrapper over IndexedDB |
| Tests | Vitest | 5.0.1 | Same config as Vite; the engine is plain TypeScript |
| Styling | One global stylesheet + custom properties | built in | Design tokens in one file; no utility-class soup in dense markup. **Deviates from D-013:** at this size CSS Modules added a layer without removing one. Revisit if the stylesheet passes ~600 lines |
| E2E | Playwright | 1.x | Browser smoke tests for the drag gestures, which cannot be unit tested |
| Test shim | fake-indexeddb | latest | Lets the store layer be tested in Node without a browser |

No Gantt library, no UI component library, no CSS framework.

## 3. Data model

Stored. Everything else is computed.

```ts
type Iso = string;          // 'YYYY-MM-DD'
type WorkDay = number;      // working-day index; 0 = project start day

interface ProjectDoc {
  id: string;
  name: string;
  dataDate: Iso;            // project start; the origin of the working-day index
  tasks: Task[];
  links: Link[];
  updatedAt: Iso;
}

interface Task {
  id: string;               // uuid, stable across renames and reorders
  code: string;             // display ID, e.g. 'A1010'
  name: string;
  type: 'task' | 'milestone' | 'summary';
  duration: number;         // working days. 0 for milestone. ignored for summary
  parentId: string | null;
  order: number;            // sort key among siblings
  collapsed?: boolean;
  constraint?: { type: 'SNET'; day: WorkDay };   // set by dragging a driven task (R-017)
}

interface Link {
  id: string;
  fromId: string;           // predecessor
  toId: string;             // successor
  type: 'FS' | 'SS' | 'FF' | 'SF';
  lag: number;              // working days, may be negative
}
```

Derived per schedule run, held in a parallel map keyed by task id:

```ts
interface Scheduled {
  es: WorkDay; ef: WorkDay; ls: WorkDay; lf: WorkDay;
  totalFloat: number;
  critical: boolean;
}
```

*Satisfies: R-002, R-003, R-004, R-012, R-013, R-017*

### 3.1 Persistence interface

```ts
interface ScheduleRepo {
  list(): Promise<ProjectSummary[]>;
  load(id: string): Promise<ProjectDoc>;
  save(doc: ProjectDoc): Promise<void>;
  delete(id: string): Promise<void>;
}
```

`IdbRepo` implements it today. `SupabaseRepo` implements it later. The store knows only the
interface, and every method is async now so that adding a network never changes a call site.
Whole-document reads and writes are correct at 50 activities and are what makes both backends
interchangeable.

*Satisfies: R-005, R-006 · See D-014*

## 4. The engine

### 4.1 Calendar

All scheduling arithmetic happens in **integer working-day indices**, never in `Date` objects.
`toWorkDay(iso)` and `toDate(workDay)` convert at the boundary — table cells, the timeline axis,
persistence. Inside the engine, "5 days later" is `+ 5`.

This is why a 5-day activity starting Friday finishes the following Thursday without any special
case, and why negative lag needs no separate code path.

*Satisfies: R-014*

### 4.2 Passes

1. Build the activity graph from `links`, excluding summaries.
2. Topological sort. A cycle here is a bug — cycles are rejected at link creation (§4.3).
3. **Forward pass** in topo order → `es`, `ef`, honouring FS/SS/FF/SF + lag and any SNET constraint.
4. **Backward pass** in reverse topo order → `ls`, `lf`, seeded from project finish.
5. `totalFloat = ls - es`; `critical = totalFloat <= 0`.
6. Roll summary extents up from children (§4.4).

Full recompute on every change (D-009). At 50 activities this is microseconds.

*Satisfies: R-010, R-011, R-012, R-013, R-015*

### 4.3 Validation

A proposed link is applied to a copy of the graph and topologically sorted. If the sort fails, the
link is rejected and the UI says why. This is the only guard against inconsistent state that the
engine cannot otherwise express.

*Satisfies: R-016*

### 4.4 Summary rollup

Summaries are **containers, not activities**. They have no duration of their own, cannot appear in
`links`, and are skipped by the graph. Their bar spans `min(child.es) … max(child.ef)` recursively.
A summary is critical iff any descendant is.

Dragging a summary bar is therefore not a scheduling operation on the summary — it is one bulk
edit applying the same working-day delta to every descendant leaf, in a single undoable action.
Leaves that have predecessors gain an SNET constraint per D-007, exactly as if each had been
dragged individually.

*Satisfies: R-041 · See D-015*

*Satisfies: R-003, R-018*

## 5. UI

| Module | Responsibility | Satisfies |
|---|---|---|
| `ProjectList` | Project CRUD, opens a schedule | R-001 |
| `ScheduleView` | Splitter, shared vertical scroll container, keyboard root | R-024, R-051 |
| `TaskTable` | Six columns, inline editors, quick-add row, row keyboard nav | R-020, R-021, R-022, R-023 |
| `Timeline` | Header axis at day/week/month, zoom state, today marker | R-030, R-031 |
| `GanttCanvas` | One SVG: bars, milestone diamonds, dependency paths, drag affordances | R-004, R-032, R-033, R-034, R-035, R-037, R-040 |
| `LinkPopover` | Type + lag shorthand parser (`FS+2d`) | R-036 |
| `Inspector` | Compact selection popover: dates, float, predecessors, successors | R-039 |
| `FilterBar` | Critical-path-only toggle | R-038 |
| `theme.css` | Tokens: colour, spacing, type scale, row height | R-052 |

Row height is a single token shared by `TaskTable` and `GanttCanvas`; both render the same
flattened, visibility-filtered task list in the same order. That is the entire synchronisation
mechanism — no scroll listeners syncing two panes.

### 5.1 Drag model

All four drags (move, resize, link, rubber-band select) are one pointer-event state machine over the SVG:
`pointerdown` on a hit target → track in pixels → convert to working days → render a **preview**
→ `pointerup` commits one undoable action. Nothing touches the document until release, so the
engine runs once per gesture, not once per frame.

Escape abandons a gesture without committing it. Row reordering is a fifth, separate machine in
the table (`ui/reorder.ts`), because its target is an outline position, not a date.

*Satisfies: R-032, R-033, R-034, R-040, R-041, R-050, R-053, R-054*

## 6. Design decisions

| ID | Decision | Rejected alternative | Why |
|---|---|---|---|
| D-001 | Vite + React SPA | Next.js | No server data, no SEO, no auth. SSR would only add hydration complexity to pointer-heavy interactions |
| D-002 | Hand-built SVG Gantt | Canvas; an off-the-shelf Gantt library | SVG gives free hit-testing and CSS theming, which is most of the interaction work. Canvas pays for scale not needed under 50 rows. A library would fight exactly the interactions that are the point of the product |
| D-003 | IndexedDB now, one record per project | Supabase from the start | Sharing is the stated destination, but auth, network state, and sync are not worth building before the scheduling experience has proved itself. Local storage defers that cost without foreclosing it — see D-014 |
| D-004 | Zustand, single store | Redux Toolkit; useReducer + context | One screen, one document. Redux ceremony buys nothing; context re-render behaviour is a hazard during drag |
| D-005 | Schedule in integer working-day indices | `Date` arithmetic with date-fns throughout | Weekend skipping and negative lag become ordinary integer math. Date objects in the engine invite timezone and DST bugs that are miserable to find |
| D-006 | ~~Summaries are containers, cannot have links~~ **Superseded by D-031** | P6-style WBS elements that can be scheduled and linked | Linkable summaries make the CPM graph two-level and the semantics of "parent finishes before child" genuinely ambiguous. Containers keep the network flat and the engine honest. **This narrows the brief's hierarchy scope on purpose** |
| D-007 | Dragging a driven activity sets an SNET constraint | Silently breaking the predecessor link; refusing the drag | The brief asks for both "drag any bar" and "successors follow predecessors" — for a driven activity these conflict. A visible, removable constraint is the only answer that keeps the logic intact and the drag meaningful. It is also what P6 does |
| D-008 | Undo = full document snapshots | Inverse-command stack | A 50-task document is a few kB. Snapshots are trivially correct for compound operations like "delete a task and its links"; inverse commands are where undo bugs live |
| D-009 | Full recompute on every change | Incremental/dirty-subgraph propagation | At this size the whole pass is far under a frame. Incremental scheduling is a well-known source of stale-state bugs |
| D-010 | No auth, no accounts | Any identity provider | Nothing to protect; storage is local |
| D-011 | Orthogonal dependency routing with per-row lane offsets *(FS now one elbow — D-033)* | Bezier curves | Right-angle routing reads as logic; curves read as decoration and tangle faster |
| D-012 | Vitest on the engine, manual smoke on the UI | Playwright interaction suite | Engine errors are silent and expensive; UI errors are visible immediately. Revisit if drag regressions start recurring |
| D-013 | CSS Modules + custom properties | Tailwind | The design is bespoke and restrained; utility classes obscure dense markup and make a token-driven theme harder, not easier |
| D-014 | All persistence behind an async `ScheduleRepo` interface (§3.1) | Calling `idb` directly from the store | Supabase is where this is going. A whole-document async interface is satisfiable by IndexedDB today and Postgres later with no call-site changes; direct storage calls would spread persistence assumptions through the store and turn the migration into a rewrite. The cost today is one small file |
| D-015 | Dragging a summary applies one offset to every descendant leaf | Recomputing children from the summary's new extent | Applying a uniform working-day delta preserves every relative offset inside the group for free, including links between children. Deriving children from the parent's span is ambiguous the moment the group contains float |
| D-016 | Gantt axis is a calendar with weekends shaded; the engine stays in working days | A compressed working-day axis with weekends removed | A working-day axis makes bars contiguous and the maths trivial, but month boundaries land at irregular pixel positions and the chart stops looking like a calendar. Converting at the drawing layer costs two small functions and keeps both properties |
| D-017 | Drag previews commit on release, not on every frame | Applying each pointer move to the document | One engine run and one undo entry per gesture instead of dozens. The preview is computed through the same conversion the commit uses, so what is shown is what lands |
| D-018 | Activity numbers are derived from outline position (`engine/ids.ts`), never stored | A stored `code` field per task | A number you can see in the table and type into a predecessor cell has to match the row in front of you. Deriving it makes that true by construction; a stored code drifts from the outline the first time a row moves. The cost is MSP's cost: inserting or deleting a row renumbers everything below it. Links are stored by internal id, so renumbering never changes the logic |
| D-019 | Link drop targets are resolved arithmetically — row = `floor(y / ROW_H)`, end = which half of the bar — over the row's whole width | Hit-testing the bar element via `elementFromPoint` | The bar is a small target in a wide row, and at month zoom it can be two pixels wide. Making the row the target and inferring the relationship from which handle was grabbed and which half was released on turns "aim at a 3px dot" into "drag roughly there", and gets all four of FS/SS/FF/SF out of the mouse with no modal |
| D-020 | Light theme only; no `prefers-color-scheme` block | Dual light/dark palettes | Two palettes double the cost of every colour decision — six group hues, critical red, float tails, weekend bands — for a tool used in one room. Decided with the user, 2026-09-22 |
| D-021 | Outline drag-and-drop takes its depth from the pointer's x, bounded by the neighbouring rows | Drop-on-row-to-nest; indent only via Alt+arrow | Dragging sideways to choose the level is what every outliner does, and it makes "into and out of a summary" one gesture instead of two. Bounding the depth by the row above (+1) and the row below stops the drop landing somewhere the outline cannot represent |
| D-031 | Summaries take links; the engine resolves each link to the activities it stands for (`graph.ts` `resolveLinks`) | Keeping D-006; scheduling summaries as real nodes | In real use a link from a summary ("after all of design") was the first thing reached for, and D-006 silently ignored it — the link saved and nothing moved. Resolving to activities keeps the network flat, which was D-006's point: a link *from* a group reads its extent (earliest start, latest finish), which is exact for every relationship type; a link *onto* a group binds each activity inside, as MS Project does. A summary linked to its own contents is a cycle by construction and is refused |
| D-032 | One `Button` component with variants (`ui/Button.tsx`) | Per-screen `<button className=…>` | Styling had drifted: Create on the project list rendered as a blank box because a global disabled-hover rule painted a white background under white text. Every button now comes from one component, and a bare `<button>` is only a reset, so the variants cannot diverge again. Colour swatches are the one exception — they are chips, not buttons |
| D-033 | Finish-to-start lines are one elbow (right, then down into the successor); everything else keeps the stepped route | Stepped routing for every link (D-011's lane offsets) | The stepped route turned a plain FS link into right-down-left-down-right. One elbow is what MS Project and P6 draw, and it makes lag legible for free: lag moves the successor, so the horizontal run grows. Links that cannot be one elbow without doubling back — start-anchored sources, finish-anchored successors, negative lag — still step |
| D-034 | A drag of a driven activity applies SNET immediately and *offers* lag | Asking before applying; always converting to lag | The chart never waits on a question, and the default is the one that never changes other data. Lag is offered because it keeps the activity moving with its predecessor, which is usually what a drag meant. A drag earlier than the logic allows goes straight to lag, since a constraint cannot pull an activity ahead of its predecessor. The lag goes on the driving link only — the one with the latest bound |
| D-035 | Wordmark typeface (Outfit, SIL OFL) self-hosted from `public/fonts/` | A font CDN; bundling through the app's module graph | The passcode page runs before anyone can load the app bundle, and it needs the same face as the home page. A fixed public path serves both from one copy with no third-party request. The gate opens only `/fonts/` — static type files, nothing sensitive — and a test pins that no other path slips through with it |
| D-036 | Supabase Auth, email + password, persistent refreshing sessions | Magic links / email OTP; a shared passcode | Email codes on every visit were ruled out by the brief, and a shared passcode is exactly the shareable secret subscriptions cannot survive. A password session per person, per device, refreshed silently, is the conventional answer; email is used once to confirm and again only to reset |
| D-037 | Row-level security is the access boundary; the passcode gate and the `api/` functions are removed | Keeping server functions with a service-role key in front of the data | With real users the database can decide access itself, per row, for every query — the browser, a script, anything. A server hop would duplicate that check and be the thing to get wrong. The publishable key is public by design; RLS, not secrecy, protects the data. `npm run verify:db` proves the rules against the live project with two throwaway accounts |
| D-038 | Ownership via `project_members` from day one, holding only the owner today | An `owner_id` check alone | Sharing between accounts is the next feature. Membership rows make it data, not a schema change and a rewrite of every policy. `owner_id` stays on the row as the record of who created it; a trigger writes the owner's membership |
| D-039 | Editor lock and save are one database function (`save_project`), running as the caller | Enforcing the lock in a server function; in the client only | Check-then-write in one statement cannot be split by another editor. SECURITY INVOKER keeps RLS in force inside it. Plain insert-or-update, not ON CONFLICT: an upsert also checks the new row against the read policy, which rests on the membership the insert trigger has not written yet (migration 0003) |
| D-040 | Plan lives on `profiles`, column-granted so users can edit only `display_name` | A plan flag in user metadata | User metadata is writable by the user. A column users cannot update is the smallest correct place for an entitlement a billing webhook will own |
| D-041 | Sharing by email through SECURITY DEFINER functions that check the caller first (`share_project`, `set_member_role`, `remove_member`, `project_people`) | Client-side inserts into `project_members`; an invitations table with email tokens | Looking someone up by email needs `auth.users`, which the API rightly does not expose, so the lookup has to run with elevated rights — and therefore must check who is asking before doing anything. Verified by `npm run verify:db` (non-members, viewers and editors refused). Trade-off, accepted: an owner can learn whether an address has an account. Pending invitations for people who have not signed up yet are the next step, not this one |
| D-042 | A viewer is refused by role check up front, not by RLS silence | Relying on the update policy | Under RLS a viewer's UPDATE matches zero rows and "succeeds" — worse than an error. `SELECT … FOR UPDATE` also needs update rights, so for a viewer it matched nothing and fell through to the insert branch with a misleading duplicate-key error. Both functions now test the role first and raise 42501 (migration 0005) |
| D-043 | Account deletion is one database function that cascades; the app warns and requires the typed email | A server function with the service key; soft delete | Deleting `auth.users` cascades through profile, memberships and owned schedules by foreign key, so there is no second place to forget something. Owned schedules that were shared vanish for collaborators, and the confirmation dialog says how many. Soft delete is a billing-era concern (retention), not needed yet |
| D-044 | Billing access is enforced in the database: `private.has_access()` in every `projects`/`project_members` policy, and a `PT402` (HTTP 402) refusal first thing in each write function (migration 0006) | A gate in a server function or middleware; hiding the UI | The browser reads and writes Supabase directly (D-037), so the database is the only place a check holds for every path: page data, direct REST calls, RPC writes and Realtime, which applies the same `select` policy to each subscriber. A distinct 402 lets the app tell "subscription needed" from "not yours" (42501). The lockout screen is presentation only. Verified by `npm run verify:db` |
| D-045 | The webhook re-reads the customer's subscriptions from Stripe on every handled event and writes the one in effect; events are deduped by id, and each write carries when its read began (`billing_synced_at`) so a stale read cannot overwrite a newer one | Applying each event's payload in arrival order | Stripe doesn't guarantee order and does redeliver. A full sync from current state is idempotent and order-proof by construction, and the timestamp guard closes the one gap: two deliveries whose reads interleave. The cost is one Stripe API call per event, trivial at this volume |
| D-046 | Billing state is columns on `profiles`, written only by the service role | A separate `subscriptions` table | One subscription per account. `profiles` already has read-own RLS and a column grant that lets users write `display_name` alone (D-040), so every new column is protected with no new policy. `stripe_events` is the only new table, with no grants to the public roles |
| D-047 | Access is checked per caller, not per schedule owner | An owner's subscription covering everyone they share with | Decided with the user, 2026-09-24. "Every account subscribes" is the business rule; tying a collaborator's access to someone else's card would make one subscription serve many, which R-067 set out to prevent |
| D-048 | Subscribing mid-trial carries the remaining trial into Stripe (`subscription_data.trial_end`); under Stripe's 48-hour minimum, charge now | Charging at checkout and forfeiting the trial | Decided with the user, 2026-09-24. Nobody should lose days they were promised by subscribing early. Stripe reports `trialing`, which counts as live |
| D-049 | Checkout, Portal and webhook are Vercel functions in `api/billing/`, authenticated by the caller's Supabase access token (verified with `auth.getUser`); `npm run dev` serves them through a Vite plugin | Supabase Edge Functions; requiring `vercel dev` locally | Same repo, deploy and env-var store as the app, and the web-standard handler shape `api/` used before (D-026). Verifying the token with Supabase, rather than decoding it, refuses revoked sessions and deleted accounts. The dev plugin lets `stripe listen` forward to the ordinary dev server |
| D-050 | The browser sends an interval (`monthly`/`annual`), never a price ID; price IDs live in server env vars. Display prices are constants in `persist/access.ts` | `VITE_` price IDs chosen by the client | The client can't pick what it's charged. The displayed $2/$12 must be kept in step with Stripe by hand, which is noted in BILLING.md §8 |
| D-051 | Terms, privacy and refunds are one static page, `public/legal.html`, served as-is by Vite and Vercel | A React route inside the SPA; a hosted policy generator | Stripe, the card networks and the Customer Portal need a stable public URL that works signed out and without JavaScript. The SPA has no router and a static file needs none. It deliberately states no prices, trial length or retry schedule: those are shown in the app and at Checkout, where auto-renewal laws want them, so they can change without a legal edit, and a specific number that drifts is worse than none. Refunds are a section of the Terms, not a separate policy; plain-language summaries were left out because a summary that differs from the clause beside it creates ambiguity, which is read against the drafter. What it does promise (cancel at period end, deletion scope, annual renewal reminder) must stay true by hand. Operator: Andrew Schaefer, individual, Maryland law; no refunds, cancel any time (decided with the user, 2026-09-25) |
| D-052 | Account deletion runs on the server (`api/account/delete`): cancel every live Stripe subscription, then delete the auth user; `delete_my_account` refuses (`PT409`) while a subscription is live | Deleting the Stripe customer (which also cancels); cancelling from the webhook after the fact; telling users to cancel first | Only the server holds the Stripe key, and the order is the whole point: Stripe first, so a failure leaves the account (retryable) rather than a deleted user still being billed. The customer is kept, marked `account_deleted_at`, for payment history and disputes. Cancellation is immediate and unprorated, matching the Terms. The RPC guard closes the path that would skip Stripe (decided with the user, 2026-09-25) |
| D-053 | Complimentary access is `profiles.comp_until` inside `has_access()`, set from an admin panel backed by `api/admin/comp` and service-role-only functions; the admin is `ADMIN_EMAIL`, server-side | A Stripe 100%-off coupon; a `VITE_ADMIN_EMAIL` the client checks; a roles table | Free access isn't a billing event: no card, no $0 invoices, no fake MRR. One nullable column joins the one access rule, so every enforcement path (RLS, 402s, realtime) honours it with no new policy. The admin check lives on the server; the browser learns it only from a 200 vs 403, so the admin's email isn't in the bundle and hiding the panel is presentation, not protection. One admin doesn't need a roles table |
| D-054 | Left-side bar and milestone labels widen the timeline: `buildTimeline` starts early enough for the widest one (`leftLabelReach` measures them) | Flipping a label to the right when it won't fit; clipping | The label side is the user's choice in Settings, so it should hold; a fixed 4-day lead clipped any name longer than ~4 days of pixels on an early bar. Measuring uses the same `textWidth` the labels already draw with, so the reach matches what's drawn |
| D-022a | A modified click (Shift / Cmd / Ctrl) in the table is always a selection, never a cell edit | Letting the editor open and the selection change together | Every cell in a dense table opens an editor on click, so the two gestures collide. Selection wins under a modifier because that is the only thing a modified click means anywhere else. Plain clicks keep spreadsheet behaviour: press, drag across rows to sweep a range, or release in place to edit |
| D-026 | *(Superseded by D-037 — gate removed)* Vercel Routing Middleware (`proxy.entrypoint`) + `api/` functions on the existing Vite SPA | Migrating to Next.js for `middleware.ts`; the root `middleware.ts` file convention | The brief asked for a Next.js middleware gate, but this is a Vite SPA and Next.js would restructure the file layout the same brief rules out. Vercel's Routing Middleware is framework-agnostic, so the gate covers every route — including the built bundle — with no change to the app. It is registered as a `proxy` entrypoint rather than by the `middleware.ts` file convention, because that convention defaults to the deprecated Edge runtime while a proxy entrypoint runs on Node.js |
| D-027 | One row per project, `tasks` and `links` as `jsonb` | Normalised `tasks` and `links` tables | The app's unit of persistence has always been the whole document: `commit()` clones, mutates, reschedules and writes it, and undo is a stack of whole documents (D-008). Normalising would mean rewriting the store, not just the schema. It also makes live sync trivial — one row change carries the entire new state, so there is nothing to merge and "no conflict resolution" is a design rather than a gap. The cost is no server-side querying inside a schedule, which nothing needs |
| D-028 | *(Superseded by D-037)* Anon key is read-only by RLS **and by grant**; every write goes through a service-role function | Anon key with insert/update rights; or minting per-session Supabase JWTs | The middleware means the anon key is never served to someone who has not unlocked, so read access is already behind the passcode. Making writes server-only means even a leaked key cannot corrupt a schedule — the realistic failure is someone keeping read access until the key is rotated. Minting short-lived JWTs would close that too, and is the upgrade path if access widens; it was not worth the extra moving part for one passcode and a handful of people. Supabase grants the public roles full DML on new tables and leans on RLS alone to stop them, so the migration also revokes insert/update/delete: a permissive policy added later by accident still cannot write |
| D-029 | Soft editor lock, enforced in `commit()` and again on write | A hard lock; last-write-wins with no lock at all | `commit()` is the single choke point for every document mutation, so read-only is one guard covering drags, typing and undo alike. Checking again in `api/save.ts` means the rule holds even if the UI is bypassed. The lock goes stale after 90s of silence because a closed laptop never releases one, and anyone can take it over — the schedule matters more than the lock |
| D-030 | IndexedDB stays as the fallback when Supabase is not configured | Deleting `idbRepo` outright | Not offline support: there is no queue and no sync. It is what lets `npm run dev` and the 21-test browser suite run with no project behind them, and it is three lines because both sides already implement `ScheduleRepo` |
| D-023 | Presentation settings live in `localStorage`, outside the document and outside undo | Storing them on the `ProjectDoc` | How a chart is drawn is a property of the person reading it, not of the schedule. Keeping them out of the document means changing a colour is not an undoable edit, does not dirty the save, and does not have to survive JSON round-trips. The cost: the formatting does not travel with an exported project |
| D-024 | PNG export clones the live SVG and inlines the stylesheet | Re-rendering the chart to a canvas; a server-side renderer | The chart is already SVG and already styled by class, so a clone plus the page's own CSS rules is the whole job, and what exports is by construction what is on screen. A second canvas renderer would be a second implementation of the chart to keep in sync. `:root` custom properties survive because in a standalone SVG the `<svg>` element is the root |
| D-025 | SVG text labels are measured with a 2D canvas context and given a backing plate | A stroke halo (`paint-order`) | A stroke halo only covers where there is ink, so a dependency line crossing a label shows through the spaces between words and reads as a row of stray dots. A measured rectangle covers the whole label. The measurement is cached; the same names redraw on every frame of a drag |
| D-022 | Popovers that open from the task table are portalled to `document.body` | Rendering them in place | The table body is translated to follow the Gantt's scroll, and a CSS transform makes `position: fixed` resolve against the transformed element instead of the viewport. The portal is the fix; the alternative is re-deriving offsets on every scroll |

## 7. Traceability

| Req | Design section |
|---|---|
| R-001 | §5 `ProjectList`, §3 `ProjectDoc` |
| R-002 | §3 `Task`, `engine/ids.ts`, D-018 |
| R-002a | `engine/ids.ts`, D-018 |
| R-057 | `ui/settings.ts`, `ui/Settings.tsx`, D-023 |
| R-078 | `Task.assignee` (engine/types.ts), `store.setAssignee`, `ui/TaskTable.tsx` `assignee` column; stored in the existing `tasks` jsonb, so no migration |
| R-058 | `ui/exportPng.ts`, D-024 |
| R-061 | `persist/auth.ts`, `ui/AuthScreen.tsx`, D-036 |
| R-062 | `supabase/migrations/0001_init.sql`, `persist/supabaseRepo.ts`, §3.1, D-027 |
| R-063 | `persist/realtime.ts`, `store.ts` `watch()`, D-027 |
| R-064 | `persist/lock.ts`, `save_project`/`claim_editor` (migrations 0002–0003), `store.ts` `commit()`, D-039 |
| R-065 | `supabase/migrations/0002_accounts.sql`, `scripts/verify-rls.mjs`, D-037, D-038 |
| R-066 | `ui/ProfilePage.tsx`, `ui/DeleteAccountModal.tsx`, D-043 |
| R-068 | `persist/sharing.ts`, `ui/ShareModal.tsx`, migrations 0004–0005, D-041, D-042 |
| R-067 | `profiles.plan`, D-040; fulfilled by R-069 – R-074 |
| R-069 | `profiles.trial_ends_at` (migration 0006), D-046 |
| R-070 | `api/billing/checkout.ts`, `api/_billing.ts` `checkoutTrialEnd`, `ui/BillingSection.tsx`, D-048, D-049, D-050 |
| R-071 | `api/billing/portal.ts`, D-049 |
| R-072 | `private.has_access()` + policies (migration 0006), `persist/access.ts`, `ui/LockoutScreen.tsx`, `App.tsx`, D-044, D-047 |
| R-073 | `api/billing/webhook.ts`, `api/_stripe.ts` `syncCustomer`/`ensureCustomer`, `stripe_events`, D-045 |
| R-074 | `ui/BillingSection.tsx`, `store.ts` `refreshAccount`/`billingReturn` |
| R-075 | `public/legal.html`, `ui/GlassPage.tsx` `LegalLinks`, `ui/AuthScreen.tsx`, `ui/BillingSection.tsx` `UpgradeButtons`, D-051 |
| R-076 | `api/account/delete.ts`, `api/_stripe.ts` `cancelEverything`, `api/_billing.ts` `cancellableSubscriptionIds`, `delete_my_account` guard (migration 0007), `ui/DeleteAccountModal.tsx`, D-052 |
| R-077 | `profiles.comp_until`, `admin_set_comp`/`admin_comp_accounts` (0007), `api/admin/comp.ts`, `api/_billing.ts` `isAdminEmail`/`compUntilFrom`, `persist/admin.ts`, `ui/AdminSection.tsx`, `persist/access.ts` `comp`, D-053 |
| R-003 | §3 `Task.parentId/order/collapsed`, §4.4, D-006 |
| R-004 | §3 `Task.type`, §5 `GanttCanvas` |
| R-005 | §3.1, D-003, D-014 |
| R-006 | §3.1, §3 (`ProjectDoc` is the serialization format) |
| R-007–R-009 | *unused* |
| R-010 | §4.2 steps 3–5 |
| R-011 | §4.2 step 5 |
| R-012 | §3 `Link.type`, §4.2 step 3 |
| R-013 | §3 `Link.lag`, §4.1, D-005 |
| R-014 | §4.1, D-005 |
| R-015 | §1, §4.2, D-009 |
| R-016 | §4.3 |
| R-017 | §3 `Task.constraint`, §4.2 step 3, D-007 · shown on the Start cell, released from its date picker |
| R-018 | §4.4, `graph.ts` `resolveLinks`, D-031 |
| R-019 | *unused* |
| R-020 | §5 `TaskTable` |
| R-021 | §5 `TaskTable` |
| R-022 | §5 `TaskTable` |
| R-023 | §5 `TaskTable`, §5 `ScheduleView` |
| R-024 | §1, §5 (shared flattened list + row-height token) |
| R-025–R-029 | *unused* |
| R-030 | §5 `Timeline` |
| R-031 | §5 `Timeline` |
| R-032 | §5.1, D-007 |
| R-033 | §5.1 |
| R-034 | §5.1, §4.3 |
| R-035 | §5 `GanttCanvas`, D-011 |
| R-036 | §5 `LinkPopover` |
| R-037 | §4.2 step 5, §5 `GanttCanvas` |
| R-038 | §5 `FilterBar` |
| R-039 | §5 `Inspector` |
| R-040 | §5.1 |
| R-041 | §4.4, §5.1, D-015, D-007 |
| R-042–R-049 | *unused* |
| R-050 | §1 store, §5.1, D-008 |
| R-051 | §5 `ScheduleView` |
| R-052 | §5 `theme.css`, D-013 |

## 8. Verification plan

| What | How | Covers |
|---|---|---|
| Calendar | Unit: Friday + 5d = following Thursday; weekend starts normalize; negative lag crosses a weekend correctly | R-014 |
| CPM correctness | Unit: fixture networks with hand-computed ES/EF/LS/LF/float, including a chain, a diamond, and a network with parallel near-critical paths | R-010, R-011 |
| Relationship types | Unit: one fixture per type (FS/SS/FF/SF) × {+lag, 0, −lag} | R-012, R-013 |
| Cycle rejection | Unit: A→B→C, then C→A is rejected and the document is byte-identical afterward | R-016 |
| Propagation | Unit: change A's duration, assert every downstream ES shifts by the right amount | R-015 |
| Rollup | Unit: summary spans children; nested summaries; summary critical iff a descendant is | R-003, R-018 |
| Summary drag | Unit: offset applied to every leaf in a nested subtree; intra-group relative offsets unchanged; one undo reverts the whole move | R-041, R-050 |
| Constraints | Unit: SNET on a driven task pushes ES and only ES | R-017 |
| Undo/redo | Unit against the store: each of the nine listed actions, then undo, assert document equality | R-050 |
| Store layer | Vitest against the real store with `fake-indexeddb`: add/edit/delete, link rejection, constraint pinning, summary subtree move, undo/redo of each action type | R-001–R-006, R-015–R-018, R-041, R-050 |
| Billing rules | Unit: `persist/access.test.ts` (state model), `api/_billing.test.ts` (which subscription counts, column mapping, trial carry-over, price mapping), `api/_webhook.test.ts` (signature, dedupe, retry on failure) | R-069 – R-073 |
| Billing lockout, live | `npm run verify:db`: expired trial reads nothing, gets 402 on every write, hears no realtime; billing columns unwritable; `active`/`past_due` restore; `canceled`/`unpaid` lock | R-072, R-073 |
| Stripe end to end | Manual runbook with the Stripe CLI, test cards and test clocks, BILLING.md §7 | R-069 – R-074 |
| Deletion and admin | Unit: `api/_account.test.ts` (cancel before delete; Stripe failure keeps the account; admin 403 unless `ADMIN_EMAIL`; grant/revoke/validation), `api/_billing.test.ts`, `persist/access.test.ts` (comp). Live: `npm run verify:db` (users can't write `comp_until` or call the admin functions; comp forever/dated/ended; delete refused while subscribed) | R-076, R-077 |
| UI gestures | Playwright: quick-add, inline edit, bar drag, edge resize, link drag, cycle refusal, milestone toggle, reload persistence, critical filter | R-020–R-040, R-052 |

**The reference bar:** the fixture networks are the definition of correct. If a fixture and the app
disagree, the app is wrong.

## 9. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| ~~Summary-row semantics (D-006) turn out to be too restrictive~~ **Happened, 2026-09-24** | — | It was: summary links were the first thing a real user tried. Loosening it was additive, as predicted — one resolver in `graph.ts`, no change to the passes' shape (D-031) |
| Drag interactions feel mediocre despite correct logic | The product's whole premise fails | Preview-then-commit model (§5.1) keeps gesture rendering independent of the engine, so feel can be tuned without touching correctness |
| Local-only storage loses a real schedule | Actual work lost | Ship R-006 export before the tool is trusted with a real program |
| The eventual Supabase migration turns out to need a different document shape | D-014's interface doesn't actually contain the change | `ProjectDoc` is already a single serializable document with stable uuids — it maps to one row or to normalized tables without restructuring |
| ~~Concurrent editing (PRD Q-6)~~ **Resolved 2026-09-23** | — | One editor at a time shipped as D-029: a soft lock plus the existing whole-document save, exactly as this row predicted. True concurrent editing is still a rewrite of the store and is not planned |
| A viewer's screen is replaced mid-read when the editor saves | Mildly disorienting; no data loss, since viewers cannot write | Accepted, and explicitly out of scope per the brief. The banner tells a blocked editor why their keystrokes do nothing; a passive viewer simply sees the bars move |
| The shared passcode leaks | Anyone with the link can read every schedule, and could take over editing | Rotate `APP_PASSCODE`, and `SESSION_SECRET` to sign out existing sessions. Writes still cannot bypass the service-role functions. Real accounts are the answer if the audience ever widens beyond a team that trusts each other |
| A webhook is missed or misconfigured | A payer stays locked, or a lapsed account keeps access | Stripe retries failed deliveries for three days, and any later event for the customer re-syncs its full state (D-045). Resending one event from the Dashboard fixes a stuck account. Watch the endpoint's failure rate in the Dashboard |
| TypeScript 7 is a new major with a rewritten compiler | Tooling friction | Pin the exact version; the fallback to 6.x is mechanical |
| Dependency arrows tangle before 30 activities | R-035 unmet, Gantt reads as spaghetti | Lane-offset routing from the start; do not defer routing to "polish" |
