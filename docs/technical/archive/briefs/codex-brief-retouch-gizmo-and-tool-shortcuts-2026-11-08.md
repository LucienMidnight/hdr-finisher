# Codex Brief — Retouch gizmo, click-click repairs and tool shortcut hints
## HDR Finisher

**Date:** November 8, 2026 (agreed with Steve in conversation the same day)

## Goal

Make Heal and Clone quick to use with two clicks: one for the source and one
for the repair. After each repair the tool is immediately ready for the next
source. The user can still go back to any repair and move its source or
destination, either with the mouse or with Alt and Ctrl. The on-photo circles
must show clearly which is the source and which is the destination. Inpaint
gets the same clean overlay. The status bar shows the keys for whatever tool
the user is working with.

## Context

- Retouch lives in the Grade workflow's Retouch tab: one brush with Inpaint,
  Heal and Clone modes and a shared repairs list. The front end is mainly
  `codebase/frontend/retouch-ui.js` (overlay drawing, pointer handling, list),
  with the panel markup in `index.html` and the overlay cursor in
  `control-panel.css`.
- Today Heal and Clone paint strokes from a fixed source chosen by Alt-click
  or "Set source". The selected repair draws its stroke and source in the same
  yellow. The live cursor is a white ring, plus a cyan ring for the source.
- The overlay uses the system `crosshair` cursor on top of the brush ring.
- The panel has "Resume painting" (play) and "Stop painting" (pause) buttons.
- The status bar's bottom-right shortcut hint is fixed text in `index.html`
  (`.slider-key-legend`: Ctrl fine · Shift snap · Double-click reset · Click
  value to type).
- Module PRD: `docs/product/modules/grade.md`. Read the Retouch decisions
  there before starting. Existing focused drivers include
  `tests/retouch-interaction.js` and `tests/retouch-transfer-interaction.js`.

## Outcome spec

### Heal and Clone: the two-click flow

| Step | What the user does | What happens |
|---|---|---|
| 1. Waiting for source | Click the photo | The source is set there. The tool now waits for the destination. |
| 2. Waiting for destination | Click | A round repair the size of the brush is made at that spot from the source. The tool returns to step 1. |
| 2. Waiting for destination | Click and drag | Paints a stroke repair from the source, as strokes work today. On release the tool returns to step 1. |
| 2. Waiting for destination | Shift-click (or Shift-drag) | Makes the repair but **keeps the same source**. The tool stays at step 2, so the next click is another repair from the same spot. The source does not shift with each destination: it is the same spot every time. |
| Any step | Escape | Steps back one level: cancels a source that has not been used yet, then clears the selected repair, then leaves the tool. |

- After a repair, the new repair is selected and its two circles stay visible
  (see "Selected repair"). A **plain click always starts a new source**, even
  on top of one of those circles.
- There is no "Keep source" switch. Shift-click is the only way to keep it.

### Adjusting a repair afterwards

- **Hover:** when the pointer is over a circle of the selected repair, that
  circle shows a clear hover state, so the user knows it can be grabbed.
- **Drag a circle:** press on a circle and drag it to move it. Moving the
  destination moves the whole repair (a stroke moves as one piece). The
  movement only counts as a drag after a few screen pixels, so a slightly
  shaky click still counts as a click and starts a new source.
- **Alt (hold):** the selected repair's source circle follows the mouse while
  the destination stays put. A click sets the new source without moving the
  destination. Releasing Alt without clicking puts the source back where it
  was.
- **Ctrl (hold):** the same, but for the destination circle; the source stays
  put. On macOS use Cmd instead of Ctrl.
- Alt and Ctrl act on the selected repair. When none is selected, Alt behaves
  as "set source" for the next repair, as it does now.
- Circles move live during the drag or while Alt or Ctrl is held. The repair
  is recomputed once, when the user clicks or lets go, not continuously.
- Inpaint repairs have only a destination; dragging it or holding Ctrl moves
  the repair.
- Each move is one undo step.

### Circles, labels and line

- Source and destination are drawn in two different colours that are easy to
  tell apart on any photo (for example cyan for source and amber for
  destination). Use existing colour tokens if suitable ones exist; otherwise
  ask.
- Each circle has a small text label, **"Source"** or **"Destination"**,
  placed just outside the circle. The label grows and shrinks with zoom, but
  is clamped to roughly 10–16 px on screen, so it stays readable at Fit and
  does not become huge at high zoom.
- Labels show on the selected repair and on the live source and destination
  while placing a repair.
- The line joining source and destination runs only **between the circle
  edges**; no part of it is drawn inside either circle. When the circles
  touch or overlap, no line is drawn.

### Cursor

- Remove the system crosshair cursor over the photo for all three Retouch
  modes. The brush ring is the cursor.
- Do not add a centre dot (Steve's decision). If small brushes at Fit prove
  hard to aim, Steve will raise it.

### Repairs list

- When the list has keyboard focus, Up and Down select the previous or next
  repair one at a time, rather than scrolling the list. The selected row
  scrolls into view and its circles are shown, labelled, on the photo.
- Delete or Backspace removes the selected repair (one undo step).
- Escape clears the selection.

### Brush size keys

- `[` and `]` shrink and grow the brush while a Retouch tool is active and
  the pointer is over the photo. Steps should feel even across the 1–1,024 px
  range (for example about 10% per press, at least 1 px). The size slider
  follows. Ask if these keys are already used anywhere in the app.

### Inpaint default method

- **Standard inpaint** is the selected method whenever a photo is opened,
  including a new project. Today "Preserve original texture" is pre-selected.
  This reverses the October 23 default; record that in the module PRD.
- This only affects the brush setting for new repairs. Saved repairs keep the
  method they were made with and replay unchanged.

### Removing Play and Pause

- Remove the "Resume painting" and "Stop painting" buttons.
- Choosing Inpaint, Heal or Clone starts that tool. Clicking the lit tool
  button again stops it. Leaving the Retouch tab, or pressing Escape at the
  top level, also stops it.
- While no tool is active, clicks on the photo go to the normal viewer, as
  they do today when painting is stopped.

### Status bar shortcut hints

The right side of the status bar shows the keys for what the user is doing.

- **Over the photo with a tool active** (Retouch, or the Local adjustment
  brush): show that tool's keys for its current step.
- **Over the control panel:** show the slider keys (today's text).
- **Anywhere else:** keep the last hint, so the text does not flicker as the
  pointer crosses gaps.
- At most four items. When space is short (minimum window width is 1100 px),
  drop the least important items first rather than wrapping or clipping text.
- Build it as one small shared mechanism: each tool supplies its own short
  lists, chosen by step. Later tools (curve editor, exposure bands, crop) will
  plug into it; they are **not** part of this brief.

Suggested Retouch hints (wording can be tightened to fit):

| State | Hint |
|---|---|
| Heal/Clone, waiting for source | Click: source · Alt: move source · Ctrl: move destination · ↑↓: repairs |
| Heal/Clone, waiting for destination | Click: repair · Shift-click: keep source · Drag: paint · Esc: cancel |
| Inpaint | Click or drag: repair · [ ]: size · ↑↓: repairs · Esc: stop |
| Repair selected, pointer over one of its circles | Drag: move · Del: remove · ↑↓: repairs · Esc: deselect |

For the Local adjustment brush, show its existing keys (for example Alt to
erase, which is already in the code) plus `[ ]` only if this work adds them
there. Do not invent new Local shortcuts.

## Constraints

- No new saved fields and no change to how saved repairs replay. Moving a
  circle rewrites the repair's existing points and source point. If that turns
  out to need a format change, stop and ask.
- Repair pixels, methods and GPU/CPU routes do not change. Export and Proof
  output must be unchanged for existing projects.
- Do not change the slider keys themselves, only where their hint is shown.
- No compatibility code for old projects (pre-1.0 rule).
- Keep each file's existing line endings.

## Docs to update in the same work

- `docs/product/modules/grade.md`: Retouch interaction decisions (dated
  November 8, 2026), the Standard default and the removed Play/Pause buttons.
- `docs/user-guide/local-adjustments.md` (or wherever Retouch is described in
  the manual) and `docs/user-guide/application-settings-and-shortcuts.md`:
  the new flow and keys.
- When finished, move this brief to `docs/technical/archive/briefs/` and
  update the map in `AGENTS.md`.

## Testing

Follow `AGENTS.md` "How much to test". This is interaction work, not export or
Proof work:

- Fast checks: `node --test tests/*.test.js` and the `.venv` pytest suite.
- The one or two focused Retouch interaction drivers that cover clicking,
  moving and undo (update them for the new flow; replace any that only check
  the removed buttons).
- Steve judges how it looks and feels. Leave a few small screenshots (circles
  and labels at Fit and at 100%, and the status hint) in one review folder
  under `codebase/output/review/`.

## Questions protocol

If anything here conflicts with the existing code, or a key is already taken,
ask before implementing. Do not invent new colour tokens or saved fields
without checking first.
