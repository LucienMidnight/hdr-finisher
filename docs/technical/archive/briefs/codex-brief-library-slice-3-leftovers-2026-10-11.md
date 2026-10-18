# Codex Brief — Photo Library: Slice 3 Leftovers
## HDR Finisher

**Date:** October 11, 2026
**Branch:** `photo-library` only. Check with `git branch --show-current`
before changing anything.
**Read first:** `AGENTS.md`, then `docs/technical/photo-library.md`
(the slice 3 Stage C and Stage D sections and the messages table), then
sections 5.13 and 5.14 of
`docs/product/archive/Photo_Library_PRD_2026-10-09.md`. The mock-up in
`docs/product/library-wireframes` shows the virtual-copy windows and the
right-click menu.

## Goal

Slice 3 is built and Steve has used it; it works. Three small things were
left unfinished. When this brief is done, a virtual copy can be renamed,
several copies can be created or removed in one go, and "Revert to
original" works on every photo that has a saved grade without a detour
through Grade.

## Context

- Virtual copies live in the photo's one `.hdrf` settings file and are
  owned by the copy service in the backend. Create and remove exist as
  backend commands, each acting on one copy and each one undo step.
- The Library right-click menu, the create and remove windows and the
  Details panel already follow the mock-up. The Stage D notes record what
  is missing as "Not built, needs backend commands: Rename copy, and
  creating or removing several copies in one undo step."
- Revert to original needs to know a photo's starting grade. Settings
  files saved before that was recorded do not hold it, so today the app
  answers "Open this photo once before reverting to its starting grade."
- Steve is not a coder. He judges this by using it on real photos.

## Outcome spec

### 1. Rename a virtual copy

- A virtual copy can be renamed from the Library right-click menu and
  from wherever its name is shown in the Details panel.
- The new name follows the same rules as a name given at creation. The
  existing message for a name that is too long or blank is reused.
- The name changes everywhere it shows: the strip under the thumbnail,
  Details, and beside the file name in Grade if that copy is open.
- Renaming never touches the copy's grade, marks, albums, history or
  kept picture, and never counts as unsaved work in Grade. It is allowed
  on the copy that is open in Grade.
- It is one undo step.
- The original cannot be renamed this way; the menu item is not offered
  for it. (Renaming the photo file itself is slice 5.)
- Two copies of one photo may share a name. If the code makes that
  awkward, say so and ask; do not invent a rule.

### 2. Several copies in one step

- With several photos selected, Create virtual copy makes one copy of
  each. The window asks its two questions once (start from the current
  grade or a clean start, and an optional name) and says how many copies
  will be made. A typed name is given to every new copy; with no name
  each takes its photo's next "Copy N".
- With several virtual copies selected, Remove virtual copy removes them
  all after one confirmation that states the number, and that the photos
  stay and nothing is deleted from disk.
- A selection that mixes originals and copies: Remove acts only on the
  copies and the window says how many that is. If no copy is selected
  the item is not offered.
- Each of these is one undo step for the whole selection.
- The existing rule stands: a copy open in Grade is not removed. In a
  multi-selection it is skipped, the rest are removed, and the result
  line says which one was left and why.
- If one photo's settings file cannot be changed (unreadable, or changed
  elsewhere), nothing is overwritten. Propose whether the whole command
  stops or the others go ahead, in line with how counted reverts on a
  selection behave today, and report which you chose.

### 3. Revert to original without opening the photo first

- "Revert to original" works from the Library on any photo that has a
  saved grade, including settings files that predate the recorded
  starting grade. The user is not sent to Grade first.
- The result must be the grade that photo would get if opened fresh with
  no settings file: the same defaults, for that kind of file, that Grade
  applies today. Reuse whatever produces those defaults now; do not
  write a second set.
- If that cannot be done without opening the source, or would slow the
  command noticeably on a large selection, stop and tell Steve what it
  costs before building it.
- Once this works, the "Open this photo once…" message is retired if
  nothing else can reach it.

## Not part of this brief

- The slow first picture after "Check for new photos", and any other
  performance or UI polish. Steve has set those aside for a later pass.
- Lens names missing for some camera brands. That waits on the choice of
  metadata reader (PRD open decision 15).
- Bringing detected conflict copies in as virtual copies (slice 10).
- Paste, sync, look presets, compare, overlays, file and folder
  controls.

## Constraints

- Do not change Grade's rendering, export, Proof, any shader, or any
  pinned tolerance, limit or budget. None of this work should need to.
- Originals are never written, renamed, moved or deleted.
- A settings file the app cannot read is never overwritten; unknown
  fields are kept; a file is never left half-written.
- Every new action is a backend command first (PRD rule F5).
- Keep slice 3's existing behaviour and its checks intact, including
  the background writer, recovery and the leave gate.
- Pre-1.0: no migration code. If the settings file or database gains a
  field, say in one line what happens to existing `.hdrf` files and to
  an existing `library.sqlite3`.
- Follow `docs/design/HDR_Finisher_Design_Guidelines.md` and the
  mock-up. Keep new controls simple; Claude refines the look afterwards.
- Keep each source file's existing line endings.
- Small local commits, each undoable alone. Do not push. Do not rebuild
  the installer.

## Testing

Follow `AGENTS.md`: the fast checks on every change, and one focused
Electron check for the visible parts, on disposable copies only. No
broad sweeps. Add fast data checks in the style of the existing copy
and history tests, covering at least: rename and its undo, with grade,
marks, albums and unknown fields untouched; bulk create and bulk remove
as one undo step each; the skipped open copy; an unwritable or
externally changed settings file in the middle of a bulk command; and
revert to original on a settings file without a recorded starting
grade, compared with a fresh open of the same photo.

## Documentation

In the same change as the code, update the Stage C and Stage D sections
and the messages table in `docs/technical/photo-library.md`, and the
"Not built" sentence in the Stage D notes.

## Report to Steve

Plain language, short: what now works and what to try; anything that
differs from this brief and why; any decision he needs to make, one at a
time, each with its trade-off and what could break; the new messages;
what was run and anything that failed.

## Questions protocol

You have the code; this brief describes outcomes, not how to reach
them. If an outcome here conflicts with how the code works, stop and
ask before building. Do not invent a new product behaviour to resolve
it. If something would take much longer than its value suggests, say so
and propose the smaller version.
