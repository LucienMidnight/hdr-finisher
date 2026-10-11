# Codex Brief — Photo Library Slice 3: Grades Saved Beside the Photo
## HDR Finisher

**Date:** October 11, 2026
**Branch:** `photo-library` only. Check with `git branch --show-current`
before changing anything.
**Read first:** `AGENTS.md`, then all of
`docs/technical/photo-library.md`, then these parts of
`docs/product/Photo_Library_PRD_2026-10-09.md`: sections 3, 5.9, 5.12,
5.13, 5.14, 12 and Appendix B. The mock-up in
`docs/product/library-wireframes` shows the save state, the prompt, the
revert menu items and the virtual-copy windows. Where this brief and
those pages disagree, ask.

## Goal

Steve stops using Save and Save As for everyday work. A photo opened from
the Library carries its grade in the `.hdrf` settings file beside it, next
to the marks that file already holds. Reopening the photo brings the
grade back exactly. Autosave can be on or off and its state is always
visible. The Library shows each photo with its saved grade, not the
default look. Bulk changes can be taken back, and one photo can hold
several independent grades (virtual copies) without duplicating the image
file.

## Context

- Today a grade is kept only by saving a `.hdrfinisher` project through
  Save or Save As. The `.hdrf` settings file holds a photo ID, marks, tags
  and albums, and no grade.
- The project document already holds only settings and points at its
  photo. The PRD proposes that the settings file carries the same kind of
  grade document. Reuse what exists; do not design a second grade format.
- Every route that replaces or closes the open photo already goes through
  one gate (`leaveCurrentPhoto`, foundation item F2). Autosave and the
  save prompt attach there.
- The backend is the only writer of the database and of settings files.
  Settings files are written whole, in one step, keeping unknown fields,
  and a background writer already brings them up to date, recovers after
  an interruption and reports what it could not write. The helper reads
  only.
- Library pictures are drawn by the graphics card from a reduced quick
  scene picture that has no lens correction, highlight reconstruction or
  denoise. Today they all use the default starting look.
- Steve is not a coder. He judges this by grading his real photos.

## Decisions already made (do not reopen)

From the PRD, agreed by Steve:

- The settings file is the lasting record of a photo's grade. The
  database is an index that can be rebuilt from settings files.
- Autosave is a user option, quick to reach, with its state always
  visible.
- Only one photo is open in Grade at a time, so only one photo can have
  unsaved work.
- Browsing, culling and comparing never prompt and never change a grade.
- Marks, tags and albums save at once whatever the autosave setting, and
  never count as unsaved work, including on the photo open in Grade.
- The prompt has the title "Unsaved changes", the body "Save changes to
  <file> before opening <file>?" with no further text, and the buttons
  Cancel, Don't save, Save. Escape is Cancel.
- Reverts: to original, to last saved, to last session, and restore
  previous grade.
- Virtual copies are included.

Defaults chosen by Claude for this build. Steve has been told each one
and can change it; build to them unless he says otherwise:

| Question | Default for this build |
|---|---|
| Autosave scope and starting state (open decision 6) | One setting for the whole app, kept between launches, on at first run. |
| Save, Save As and Open Project | Ctrl+S and File > Save write the settings file beside the photo. Saving a `.hdrfinisher` project and opening one stay available and behave as they do today, until portable projects (slice 10) replace them. |
| Existing `.hdrfinisher` projects in the Library (open decision 19) | They do not appear in the Library. They open through File > Open Project as today. |
| How many "before" states (open decision 4) | One per photo, or per virtual copy. |
| The session-start grade after the app closes (open decision 5) | Kept until a later session changes that photo. |
| Where virtual copies are stored (open decision 2) | All in the photo's one settings file. |
| What a new virtual copy starts with (open decision 26) | The original's stars, pick status, label and tags. |
| SDR-only grading (PRD section 12) | Not designed yet. Do not build it, and do not make it harder to add one field for it later. |

## Outcome spec

Work in four stages. Each ends with the app usable, the fast checks
passing and a short plain report to Steve.

### Stage A — the grade is saved beside the photo

**Saving and opening**

- Opening a photo from the Library that has a saved grade shows that
  grade in Grade, identical to how it was left: every panel, HDR and SDR,
  crop, lens corrections, RAW development, local adjustments and masks.
- A photo with no saved grade opens with today's defaults. Opening and
  looking, without changing anything, writes nothing.
- A save writes the grade into the photo's settings file without
  disturbing its marks, tags, albums, photo ID or any field the app does
  not recognise. A mark made in the Library while the photo is open in
  Grade is never undone by a later grade save, and the reverse.
- Export and Proof of a photo opened this way give the same result as
  the same grade opened from a project file today.

**Autosave**

- On: the grade is saved a moment after the last change, and always on
  leaving the photo or closing the app. No prompt is ever shown for
  saving.
- Off: nothing is written until the user saves.
- Turning it on while there is unsaved work saves at once.
- The control is quick to reach on Grade and its state is always visible.

**Save state on Grade**

Beside the photo name, as in the mock-up: "All changes saved", "Saving…",
"Unsaved changes" or "No unsaved changes". With autosave off and unsaved
work, Save and Revert to last saved appear there, and the Grade tab
carries a small dot that stays visible from the Library.

**The prompt, with autosave off**

- Asking Grade to switch photos while there is unsaved work holds the
  switch and shows the prompt above. The same prompt covers closing the
  app and closing the main window.
- Going to the Library tab and back never asks. Opening the photo that is
  already open never asks. Browsing never asks.

**When the file cannot be written**

A grade is never lost because its folder is read-only, its drive was
unplugged, the disk is full or the file is locked. It is kept safely,
written when that becomes possible, and reported through Activity and
Needs attention, in line with how marks behave today. The save state
must not say "All changes saved" in a way that hides this; propose the
wording.

**When the settings file changed elsewhere**

If the file was changed by something else (a sync tool, another machine)
while the photo is open with unsaved work, nothing is overwritten
silently and no winner is picked silently. Follow the existing rules and
Appendix B; if they do not cover the case, ask.

**After a crash, with autosave off**

Unsaved work on the open photo is offered back at the next start. It is
not applied without asking.

### Stage B — the Library shows the saved grade

- Grid, filmstrip, single view, review and native zoom show each photo
  with its saved grade, in SDR and with the HDR switch on. A photo with
  no saved grade keeps the default look.
- An unsaved change in Grade is not shown in the Library until saved.
  After a save, the photo's Library picture updates without the user
  doing anything.
- The Library still makes its picture from the quick scene picture. It
  does not have to match Grade exactly. **Before building, list for Steve
  which parts of a grade the Library picture will show faithfully, which
  only roughly, and which not at all** (crop, lens corrections, local
  adjustments and masks, denoise and detail are the likely hard ones),
  with what each would cost to include. Build the faithful set and wait
  for his answer on the rest.
- A photo counts as **edited** when it has a saved grade that differs
  from the defaults. Marks alone do not make it edited. "State" (edited,
  not edited) becomes available in the filter bar and as a sort, and a
  small mark shows on edited thumbnails in the strip under the picture.
- Scrolling a folder of graded photos must stay as responsive as a folder
  of ungraded ones. Report what you measure for first picture and for
  scrolling, graded against ungraded.

### Stage C — the "before" state and reverts

- The first time a photo's grade changes in a run of the app, its grade
  from before that change is kept as the session-start state. It
  survives a restart.
- Before any command that rewrites a saved grade from outside the Grade
  panel, the previous grade is kept in that photo's settings file. In
  this slice the only such commands are the reverts below; paste, sync
  and presets come in slice 7 and must be able to use the same safety
  net.
- Reverts, in Grade and on a Library selection:

| Revert | What it does |
|---|---|
| Revert to original | Clears all adjustments. |
| Revert to last saved | Drops unsaved work on the open photo. |
| Revert to last session | Returns to the session-start state. |
| Restore previous grade | Brings back the "before" state. |

- A revert is itself kept as a "before" state, so it can be taken back.
- On a Library selection, each revert appears on the right-click menu
  only when it would do something, confirms with the number of photos,
  says each keeps its previous grade, and is one undo step. Marks and
  tags are not touched.
- If the photo open in Grade is among the targets, the change lands
  there as ordinary unsaved work.

### Stage D — virtual copies

- **Create virtual copy** on the right-click menu asks two things: start
  from the current grade or a clean start, and an optional name. Without
  a name the copy is "Copy 1", "Copy 2" and so on.
- Each copy has its own grade, crop, stars, pick status, label and tags,
  its own ID, its own thumbnail showing its own grade, and can join
  albums on its own. The image file is not duplicated.
- A copy sits straight after its original in every sort order. Its mark
  is in the strip under the thumbnail (a copy symbol; the original shows
  "+2"), never on the photo. Its name follows the file name. Sort and
  filter treat a copy as an item, and "virtual copy or original" becomes
  available in the filter bar.
- Opening a copy in Grade opens that copy's grade. Opening another copy
  of the photo already open goes through the same gate and prompt.
- **Remove virtual copy** has its own window, which says one grade is
  removed, the photo stays and nothing is deleted from disk. It is
  undone with Ctrl+Z.
- Copies travel in the photo's settings file, so they rebuild from it if
  the database is lost.

## Constraints

- **Strict area.** Export and Proof are the exact reference. This work
  changes where a grade is stored, not what a grade produces. Do not
  change Grade's rendering, export, Proof, any shader, any pinned
  tolerance, limit or budget, or the Grade and export decode routes. If
  a stage needs to, stop and tell Steve first.
- Originals are never written, renamed, moved or deleted.
- A settings file the app cannot read is never overwritten, a settings
  file is never left half-written, and unknown fields are kept.
- Nothing is reported as saved unless it is.
- Grading must not feel slower because of autosave. Saving must never
  stall a slider.
- Every new action is a backend command first (PRD rule F5).
- Keep the Stage A to C background-writer and recovery behaviour, and
  slice 2b folder checks, working and their tests intact.
- Not part of this slice: paste, sync and look presets; compare and
  overlays; file and folder controls and delete; smart albums; batch
  export; portable projects, relink and importing conflict copies;
  SDR-only grading; persistent undo history.
- Follow `docs/design/HDR_Finisher_Design_Guidelines.md` and the
  mock-up. Keep new controls simple; Claude will refine the look
  afterwards.
- Pre-1.0 rule: no migration code. If the settings file or the database
  layout changes, say in one line what happens to existing `.hdrf`
  files and to an existing `library.sqlite3`. Do not discard marks or
  albums already saved without telling Steve first.
- Keep each source file's existing line endings (see `AGENTS.md`).
- Small local commits, each undoable alone. Do not push. Do not rebuild
  the installer.

## Testing

Follow `AGENTS.md`: fast checks on every change, GPU checks grouped per
stage, no broad sweeps. Stage A touches how a grade reaches export and
Proof, so run the checks that cover export and Proof for a photo opened
from a settings file. If the validation for any stage is heading past
roughly 30 minutes of slow tests, stop and tell Steve first.

Add fast data checks, in the style of the existing library tests. At
least:

- a grade saved to a settings file and read back is identical, for a
  document that uses every group, masks and crop included;
- a grade save keeps marks, albums and unknown fields, and a mark made
  meanwhile is not lost;
- autosave on and off through every route of the leave gate;
- each "cannot be written" case, and recovery when the cause clears;
- an interruption during a save leaves a whole file, old or new;
- the session-start and "before" states across a restart, and each
  revert, including reverting a revert;
- virtual copies: create both ways, independent grades and marks,
  remove and undo, rebuild from the settings file.

One focused Electron check per stage for the visible part, on disposable
copies only. Never save over the read-only test projects.

Then ask Steve to try each stage on real photos; how it feels is his
call.

## Documentation

In the same change as the code, update `docs/technical/photo-library.md`
to describe what is now built: what the settings file holds, how saving
and autosave work, the save states, the "before" and session states,
virtual copies, the messages table and the log events. In the PRD, mark
each stage built in section 8 and settle the open decisions this brief
gives defaults for, as Steve confirms them. Add the saving flow to the
code map.

## Report to Steve after each stage

Plain language, short:

- what now works, and what he should try;
- anything that behaves differently from this brief, and why;
- any new decision he needs to make, one at a time, each with its
  trade-off and what could break;
- the new messages, for his review;
- which of his existing projects or settings files are affected, if any;
- what was run, and anything that failed.

## Questions protocol

You have the code; this brief describes outcomes, not how to reach them.
If an outcome here conflicts with how the code actually works, or two
outcomes conflict with each other, stop and ask before building. Do not
invent a new product behaviour to resolve it. If something would take
much longer than its value suggests, say so and propose the smaller
version.
