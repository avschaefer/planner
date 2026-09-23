# Changelog

Notable changes to Planner. Format follows [Keep a Changelog](https://keepachangelog.com);
requirement IDs refer to [`docs/PRD.md`](docs/PRD.md).

## [Unreleased]

### Added

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

- New light theme: warm neutral canvas, indigo accent, segmented toolbar clusters with icons,
  a month band in the timeline header, activity names beside their bars. [R-052]
- Table columns rebalanced so the Activity name is never crushed by the fixed columns. [R-020]
- A start date held by a drag is marked on the Start cell it constrains and released from the
  date picker that opens there. [R-017]
- Popovers opened from the task table are portalled to `document.body`, past the scroll
  transform that was displacing them by the height of the header.

### Fixed

- Shift and Cmd/Ctrl click in the table opened a cell editor instead of changing the
  selection; a modified click is now always a selection gesture. [R-053]
- The `#` cell handled selection a second time after the row had already handled it, so
  Cmd/Ctrl-clicking a row number toggled twice and did nothing. [R-053]
- Three Playwright helpers committed edits with `Escape`, which discards them — the browser
  suite had never been run, so this had gone unnoticed. All 16 tests pass.

### Removed

- The selection inspector card; its content moved to the Float column and the bar tooltip.
- The stored `Task.code` field, replaced by derived outline numbering.
- The dark theme. Light only.
- The critical-activity count in the toolbar, and the pin glyph beside the activity name.

## [0.1.0] — 2026-09-21

Initial build: CPM engine, working-day calendar, all four relationship types with lag, summary
rollup, milestones, task table, SVG Gantt, undo/redo, IndexedDB persistence. [R-001…R-052]
