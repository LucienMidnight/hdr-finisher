# Photo Library PRD

**Date:** October 9, 2026
**Status:** Slice 1 is authorized by the October 10 brief. Stages A (looking
at photos), B (culling), and C (find, HDR, sharpness) are implemented on
`photo-library` and ready for Steve to try. Slice 2 (pop-out window,
background indexing, fuller details, filter rules, tag management, albums)
is implemented and awaits his trial; see section 8. The
October 10 decisions below supersede the older preview proposals.

**How to read the labels:** *Decided* means Steve has agreed it. *Proposed*
means Claude's suggestion, not yet confirmed. *Open* means a choice still to
be made. The raw brainstorm, in the order it was discussed, is in git history
(commit `9347b0e`).

---

## 0. Where this work happens: the `photo-library` branch

**Decided by Steve, October 9. Read this before changing any code.**

- **All library work, including the foundation work in section 1, is done on
  the `photo-library` branch. Never on `main`.**
- The branch was made on October 9, 2026 from `main` at the 0.9.0 release
  (commit `e4274ae`). It is a branch of the same repository, not a separate
  fork on GitHub.
- **`main` stays releasable.** Fixes and small improvements to the released
  app keep going to `main` as before, and nothing from the library reaches
  users until Steve decides it should.
- **Before starting, check where you are:** `git branch --show-current` must
  say `photo-library`. If it does not, stop and switch; do not commit library
  work anywhere else. Do not create further long-lived branches for library
  work without asking Steve.
- **Keep the branch from drifting.** Bring `main` into `photo-library`
  regularly (at least whenever `main` gets a fix in a file the library work
  also touches, such as `codebase/desktop/main.js`). Changes flow from `main`
  into the branch, never the other way, until the merge below. A long gap is
  what makes the eventual merge painful.
- **Merging into `main` is Steve's decision** and is a release point: the
  full sweep in `AGENTS.md` applies before it. It can happen slice by slice
  (section 8) once a slice is finished and Steve has used it, not only at the
  very end.
- Everything else in `AGENTS.md` applies as usual: small local commits, ask
  before pushing, one agent at a time in the same files.
- This document lives on the `photo-library` branch. It is not on `main`
  until the branch is merged or Steve asks for the document to be copied
  across.

---

## 1. Start here: foundation work that can begin now

Steve asked for this at the top so agents can work on it while he and Claude
do the measurements and the wireframe.

**Correction to the brainstorm notes:** they said the Codebase Modularization
Sprint was still running. It is not. All five phases were completed on
October 8, 2026 (see `Codebase_Modularization_Sprint_PRD_2026-10-06.md`).
What remains is the work that sprint deliberately left out, plus groundwork
specific to the library.

Every item below changes **nothing the user can see**. Each one is finished
when the app behaves exactly as it does today and the stated proof exists.
Testing follows `AGENTS.md`: fast checks on every change, plus only the GPU
check that covers what was touched. None of these items touches CPU export,
Proof, or a pinned shader, tolerance, limit or budget. If one turns out to,
stop and tell Steve.

Do the items one at a time when they touch the same files (F1 and F2 both
touch `codebase/desktop/main.js`).

### F1. The desktop shell can manage more than one window

- **Why:** the library will be able to live in its own window. Today
  `codebase/desktop/main.js` is written around a single window: closing,
  unsaved-work prompts, menus, saved window position and display detection
  all assume one.
- **What:** restructure so the shell keeps track of windows by role (main,
  and later library), with per-window saved position and per-window display
  detection. Agree the closing rules in code: closing the main window ends
  the app; closing a secondary window only closes that window.
- **Proof:** with a developer-only switch, the shell opens a second, empty
  window that loads a page from the backend, can be moved to another monitor,
  snapped and made full screen, and comes back in the same place next launch.
  Without the switch, nothing is different.

**Implementation progress, October 9:** F1 shell code is implemented on
`photo-library`. Windows are registered by role, keep separate bounds and
display notifications, and receive their own window controls. The main window
owns the app lifetime and document prompts. The developer-only switch is
`HDR_FINISHER_DEV_LIBRARY_WINDOW=1`; the second empty page is served by the
shared backend and uses native window controls, with F11 for full screen.
Normal startup still opens one window. The focused Electron check covers
secondary close, main close with a secondary open, unsaved Cancel/Discard,
separate bounds restored after relaunch, sender/display isolation and controls.
Physical monitor movement and Windows snap remain for Steve's manual trial.
No section 5 features have been built.
Validation: 435 JavaScript checks, 1,581 Python checks (3 skipped), 22 desktop
unit checks, the focused multi-window Electron check and the display capability
GPU check passed. Two old source-name assertions were updated for the refactor.

### F2. One gate for "leaving the current photo"

- **Why:** the save model is changing (section 5.13). The check for unsaved
  work is currently made in several places: opening another source, opening a
  project, closing the window, quitting, and Windows shutting down. Autosave,
  saving to a sidecar and the "save before switching?" prompt all need a
  single place to attach.
- **What:** list every route that replaces or closes the open photo, then
  route them all through one function that decides whether it may proceed.
  Start in `frontend/project-documents.js`, `frontend/session-import.js`,
  `frontend/edit-commands.js`, `frontend/desktop-commands.js` and the close
  handling in `desktop/main.js`. Take stock first; the list may be longer.
- **Proof:** a short note in the code map naming the gate and the routes
  through it. Prompts appear exactly when they do today.

**Implementation progress, October 9:** F2 is implemented. The shared
`leaveCurrentPhoto` policy in `frontend/photo-transition.js` is used by the
editor and desktop shell, including synchronous Windows session-end handling.
The code map lists all routes and the deliberate non-transitions. Existing
prompts are unchanged. Validation passed: 438 JavaScript checks, 1,581 Python
checks (3 skipped), the focused multi-window Electron check and the session
replacement GPU interaction check. No CPU export/Proof or shader changes.

### F3. A helper process for library work

- **Why:** indexing folders, reading metadata, making thumbnails and decoding
  RAW files for previews are heavy. Inside the same backend process as the
  grade they would make grading stutter. Cheap to separate now, awkward
  later.
- **What:** a second backend process that starts and stops with the app, runs
  at low priority, takes jobs with a priority and can cancel them, and can be
  told to pause while the user is grading or exporting. As its first job,
  move today's thumbnail making into it
  (`backend/hdr_finisher/media_browser.py`), so the current import browser
  keeps working unchanged but no longer decodes thumbnails inside the grading
  process.
- **Proof:** the import browser looks and behaves as it does now. Thumbnails
  for a large folder load while a grade is being adjusted, without the
  preview slowing. Confirm it also works in the packaged app at the next
  installer build (separate processes are a known trouble spot when
  packaged).

**Implementation progress, October 9:** F3 helper code is implemented. A
single low-priority decoder process starts/stops with the backend, handles
priority and cancellation, and respects independent pause reasons. Current
browser thumbnails and staged import previews use it. Session requests pause
background work. Cached previews remain available; paused uncached HTTP
requests return a retry response so thumbnail requests cannot starve grading
of browser connections. The original thumbnail decoding and cache rules are
unchanged. A native decode already running may finish before a pause takes
effect; cancelled results are discarded. The packaged entry point now supports
spawned workers, but packaged confirmation remains for the next installer
build. M5's large-folder trial with Steve is still needed.

Validation: 438 JavaScript tests and 1,588 Python tests passed (3 skipped).
The background/grade concurrency and existing browser preview GPU checks
passed. The first concurrency run exposed browser connection starvation
while paused; the retry response fixed it and has an API regression check.

### F4. The browser runs on its own page

- **Why:** the library has to appear both inside the main window and in its
  own window. The interface has no module system (decided against before
  1.0) and its files share one global `state`. `frontend/media-browser.js`
  leans on that shared state, so today it cannot run without the whole
  editor. This is the "walls between features" work the modularization
  sprint listed as its natural follow-up, applied to the one feature that
  needs it first.
- **What:** make the browser depend only on things it is handed (a place to
  draw, the backend address, callbacks for "open this"), not on editor
  state. Add a bare page served by the backend that shows the browser alone,
  with none of the editor's scripts loaded.
- **Proof:** the stand-alone page shows folders and thumbnails in the F1
  second window. The import browser in the main window is unchanged.

**Implementation progress, October 9:** F4 code is implemented. The current
browser owns its state/events and takes a root, backend URL and callbacks.
The editor supplies its integration through a small adapter. A bare backend
page shows that same browser in the F1 second window with no editor scripts.
Its source-open command reaches Grade through the F2 gate. This is available
only with `HDR_FINISHER_DEV_LIBRARY_BROWSER=1`; normal startup is unchanged.
No library wireframe, new visible library feature or saved-file format was
introduced. The independent-page Electron check and existing browser preview
check passed, including Cancel/Discard and the editor's destination choices.
Validation: 438 JavaScript and 1,588 Python tests passed (3 skipped). The
first standalone run exposed editor-adapter script ordering; fixed by loading
it after editor state. One source-call contract was updated to verify the
new callback handoff and error reporting. No remaining failed checks.

### F5. Rule for all new library code: a backend command first

Not a task, a rule that starts now. Every library action (rate, tag, move,
paste a grade, export) is a backend command that the interface calls. No
logic that exists only in the interface. This is what later lets an MCP
server (section 11) drive the app without a second implementation, and it is
what makes library undo and the helper process practical.

### Not to be started yet

Anything in section 5 that shows on screen, the sidecar file format, the
database layout, and the preview pipeline. They wait on section 7 (numbers),
the wireframe, or section 9 (open decisions).

---

## 2. Purpose

HDR Finisher grows from a finishing-only tool into a full editor. The name
stays. The missing piece is a library: a place to browse, cull, rate,
compare, organise and batch-export photos without leaving the app.

Reference Steve shared: DxO PhotoLab's PhotoLibrary. The useful parts are
folder-first browsing and quick compare. The aim is the same jobs with far
less on screen.

## 3. Principles

All decided.

1. **No import step.** Folders are browsed where they are. Pinning a folder
   is how it becomes part of the library.
2. **The grade lives next to the photo.** A sidecar file beside each photo
   holds everything about that photo. The database is an index that can be
   rebuilt.
3. **Browsing never changes a grade and never prompts.** A grade changes only
   through the Grade panel, or through an explicit library command that says
   how many photos it will change.
4. **Single click navigates. Double-click opens in Grade.**
5. **Minimal.** Keyboard first. Controls appear when relevant. Nothing
   permanent on screen that is not needed.
6. **Generic, not tuned to one camera.** The same method for every camera and
   every supported format.
7. **Background work stays out of the way** of grading and export.
8. **Nothing is silently lost or overwritten.** Bulk changes keep the previous
   state; clashes stop and ask.
9. **Built in slices that are each useful alone**, culling first.

## 4. Decisions made on October 9, 2026

| # | Topic | Decision |
|---|---|---|
| 1 | Windows | Library opens where the preview is; a pop-out button moves it to its own window and the main window switches to Grade. "Library" replaces "Import". |
| 2 | Navigation | Pinned folders are the navigation. The whole drive tree is not shown. Folders are added through an "Add folder" picker. |
| 3 | Clicks | Single click selects and navigates. Double-click (or Enter) opens the photo in Grade. |
| 4 | Sidecars | One per photo, next to the photo, hidden inside the library. |
| 5 | Autosave | A user option, on or off, quick to reach and always visible. |
| 6 | Autosave off | A Save / Don't save / Cancel window appears only when Grade is asked to switch photos. Browsing, culling and comparing never prompt. |
| 7 | Library commands that change grades | Paste, preset and sync save straight away whatever the autosave setting, and keep the previous grade as a "before" state. |
| 8 | Reverts | Revert to original, revert to last saved, revert to last session, restore previous grade. |
| 9 | Virtual copies | Included. |
| 10 | Projects | Lean: the sidecar replaces Save / Save As. Sharing is by portable project folders, sources optional, shown in their own section like pinned folders. |
| 11 | Projects without sources | The receiver chooses merge or keep separate. A simple manual relink is enough. |
| 12 | Background indexing | On by default for pinned folders and opened projects, with an advanced setting to turn it off. Uses spare processor capacity; uses the graphics card only when idle. |
| 13 | Ratings from other apps | Ignored for now. |
| 14 | RAW + JPEG pairs | Two separate items, with a "RAW only" filter. No stacking. |
| 15 | Grid and HDR | Grid is SDR by default. HDR previews are created on request. If measurement shows it is fast enough, prefer a simple HDR toggle. |
| 16 | HDR preview size | Screen-sized previews are built as well as thumbnails, with a resolution limit. Never full-size. |
| 17 | Comfort cap | The HDR grid is limited to 1000 nits by default, adjustable. |
| 18 | Preview cache | User-set size limit. Oldest removed first, in batches. |
| 19 | Zoom and focus | Generic three-tier method (section 5.9). Nothing depends on the camera's embedded JPEG. |
| 20 | File controls | Rename and move folders, create folder, move and rename photos, delete photos with confirmation, delete all rejected, show in Explorer, multi-select of photos and folders. No deleting whole folders. No batch rename of originals. |
| 21 | Added features | Export recipes, exposure and clipping overlay, tag management, metadata authoring, full-screen review, library undo. |
| 22 | Unreadable files | Hidden for now. |
| 23 | Size target | There must be one. Number set after measuring. |
| 24 | Claude's ten feedback points | All agreed (slices, early trials, helper process, minimal UI, "before" safety net, look mismatch, overlay before score, sync conflicts, light testing, groundwork first). |
| 25 | AI features | Version 2 at the earliest. An MCP server is wanted before 1.0 (section 11). |

### Decisions made on October 10, 2026

Steve authorized Stage A of the slice 1 brief on October 10:

- Build the library first; leave the known DNG colour and Canon/DJI
  brightness faults for Steve to judge in use.
- Give the library its own quick demosaic, with no lens correction,
  highlight reconstruction, denoise or DNG correction opcodes. Grade and
  export keep their existing corrected routes.
- Draw optional HDR live from the same quick scene picture. Do not make
  gain-map preview files or require a prepare-ahead command.
- Lower resolution is acceptable for browsing. Source saturation uses a
  simple hard clip to neutral white on the camera RAW and linear DNG routes.
- Sidecars use the complete photo filename plus `.hdrf`, for example
  `DSC02339.ARW.hdrf`. `.hdrfinisher` remains the saved-project ending.
- Keep the library as a separate page, docked in a same-origin frame. This
  keeps its state independent of Grade and leaves the page reusable for
  the later pop-out window. Only this page permits same-origin framing;
  other pages retain the existing frame prohibition.

### Decisions made on October 11, 2026

- **Mark changes save to the library at once; settings files catch up in
  the background; Undo is the cancel.** Ratings, picks, labels, tags, albums
  and renames no longer wait for every `.hdrf` file. Unwritten files are
  tracked in the database, so an interrupted change is finished at the next
  start. Moves, copies, exports, previews and indexing keep Pause and
  Cancel. Accepted cost: for a short time after a large change the files
  lag behind what the app shows. Not built yet. The design, its reasoning
  and the unusual cases are in
  [Photo Library: how it works](../technical/photo-library.md), section 12.
- **Each complex system gets a page recording how it works and why.** The
  library's is `docs/technical/photo-library.md`, kept current in the same
  change as the code.
- **Marks waiting for an unplugged drive or a read-only folder** are
  written automatically when the folder is next connected and writable,
  and the user is told. This settles open decision 25.
- **A settings file changed by something else** while the library holds
  unwritten marks for that photo: the library's marks and albums are
  written, every other field is kept, and it is reported. Never silent.
- **Background work shows in one Activity item** at the right end of the
  bottom bar, with a list of jobs and a "Needs attention" list.
- **Pinned folders keep themselves current; other folders are read when
  opened.** Timed checks, not instant, plus a button that checks chosen
  folders first. Built October 11 as slice 2b. Details in section 5.18,
  "Keeping folders current".
- **Undo history is still lost on restart.** Not part of this work.
- Brief for the build:
  `docs/technical/codex-brief-library-background-writer-2026-10-11.md`.

---

## 5. Requirements

### 5.1 Windows and entry point

Decided:

- **Library** replaces **Import** in the main window. It opens in the area
  where the preview is now.
- A **pop-out** button moves the library to its own window. The main window
  switches to Grade. The library window can be snapped, maximised or made
  full screen on a second monitor, and remembers its monitor and size.
- One app, two windows. No second copy of the app is started.
- Closing the main window closes the app. Closing the library window puts
  the library away or re-docks it.

Proposed:

- The library is built once and shown in either place.
- The library window detects the HDR ability and brightness of the monitor
  it is on, separately from the main window.

Open:

- How docking is done technically (section 6.1).
- (Settled October 9, see below.)

Decided on October 9 from the mock-up (`docs/product/library-wireframes`):

- While the library is docked, the left panel shows folders, projects and
  albums, and the right panel shows details of the selection (marks, tags,
  camera data). The Control Panel and Scopes are not shown in Library.
- Both panels collapse to a narrow rail, the same way Metadata does on the
  other stages. One key collapses or opens both.
- Both panels start open on every launch. Collapsed state is not
  remembered, in line with the design guidelines.

### 5.2 Navigation

Decided:

- The left side shows **pinned folders**, **projects** and **albums**, not
  the whole drive tree. A pinned folder expands to its own sub-folders.
- **Add folder** (a small + by the Folders heading, and a menu item) opens a
  folder picker for navigating drives and choosing what to pin.
- Decided October 9 from the mock-up. The picker takes several folders at
  once: click, Ctrl-click and Shift-click, as for photos. Folders already
  pinned are skipped and the picker says how many.
- Decided October 9. Clicking a pinned folder shows everything in its
  sub-folders together, not only the photos directly in it. The grid must
  therefore stay quick when a parent folder holds many thousands of photos
  (see the size target, 5.19).

Proposed:

- The picker is built from today's import browser, which already navigates
  drives and stores pins.
- Right-click a pinned folder: unpin, rename its label, show in Explorer,
  re-scan. Right-click any sub-folder: pin it as its own entry.
- Drag to reorder pins. Drag a folder in from Explorer to pin it.
- A pin whose drive is unplugged stays listed, greyed out.
- "Open without pinning" for a memory card or one-off folder, shown as a
  temporary entry.
- First run: an empty state with one "Add a folder" prompt.

### 5.3 Views

Decided:

- Several layouts, a full-screen review mode, and a minimal look.
- Views are designed properly with a wireframe or mock-up before building.
- Decided October 9 from the mock-up. In single view and full-screen
  review, a click on the photo (or Z) zooms to 100% on that spot, drag
  moves around, and zoom and position are kept while flipping between
  photos.
- Decided October 9. Double-click opens in Grade on thumbnails only: in the
  grid and in the filmstrip. On the large photo in single view it does not
  open Grade, and in full-screen review a double-click does nothing. Enter
  opens the current photo in Grade from the grid and single view.

Proposed starting set for the wireframe:

- Grid of thumbnails, with a size slider.
- Single photo with a filmstrip.
- Compare (section 5.11).
- Full-screen review: one key hides everything but the photo, on either
  monitor, with rating and pick keys still working.
- Each window remembers its layout. Optional one-line details under
  thumbnails.

### 5.4 Selection, and file and folder controls

**Stated plainly so it is not skipped: the library is not read-only. It
changes files and folders on disk.** All decided unless marked.

Selection:

- Multi-select photos and multi-select folders: Ctrl-click, Shift-click for a
  range, select all, drag a box around thumbnails.
- Commands apply to the whole selection (rate, tag, paste a grade, export,
  delete, create HDR previews for several folders at once).

Controls included:

- Rename a folder. Move a folder. Create a new folder.
- Move photos between folders by dragging. Rename a single photo.
- Delete photos from disk, always behind an "Are you sure?" window.
- Delete all rejected, behind the same window.
- Show in Explorer.

Left out: deleting a whole folder; batch rename of originals (pattern naming
belongs to export, section 5.16).

What each control must get right:

- **Everything attached travels.** Moving or renaming carries the sidecar, so
  grades, marks, tags and virtual copies stay attached. The database, pins,
  albums and cached previews follow to the new location without re-indexing.
- **The delete window says exactly what will happen:** how many photos; that
  their sidecars, grades and virtual copies go too; and whether they go to
  the Recycle Bin or are gone for good. Network drives and many removable
  drives have no Recycle Bin, and the window must say so. Recycle Bin
  wherever one exists.
- Deleting a virtual copy is a smaller action (one grade removed, photo
  kept) and is worded differently so the two are never confused.
- Moving between drives is copy-then-delete. Confirm the copy before removing
  anything, show progress, and survive interruption without losing files.
- Clashes and failures (same name at the destination, file open elsewhere,
  read-only location): stop and ask. Never overwrite silently. Report which
  items were not done.
- The photo open in Grade: a move or rename keeps the session attached or
  asks to close it first. Deleting it asks first.
- A folder being indexed, exported from or having previews built: the
  operation waits, or the job is cancelled cleanly.

Proposed, mocked up October 10 (not yet confirmed by Steve):

- **Rename a photo:** a small window with the name; the file ending cannot
  be changed. A name already used in the folder stops with "That name is
  taken. Nothing was renamed." and offers to choose another.
- **Move photos:** right-click, Move to folder, with a list of pinned
  folders and their sub-folders; or drag thumbnails onto a folder in the
  left panel. A drag moves at once with no confirmation, like Explorer, and
  Ctrl+Z moves the photos back. (Open: should a drag ask first?)
- **A name clash at the destination** stops with the file name and three
  answers: Keep both (the moved file gets a number), Skip this one, Cancel
  move. The window says nothing has been moved or overwritten yet. The
  result line says how many moved and how many were skipped.
- **A move to another drive** runs in the background and shows in the
  bottom bar. Each photo is copied and checked before its original is
  removed. Pause and cancel are on the bar; a cancelled move leaves the
  remaining photos where they were.
- **New folder inside**, **Rename folder** and **Move folder** on a folder's
  right-click menu. A pinned folder's own entry offers Rename label, which
  changes only the name shown in the list.
- **A folder that background work is using** (indexing, HDR previews, an
  export): the window "This folder is busy" offers Do it when finished or
  Stop it and continue.
- Renames and moves are each one undo step.

### 5.5 Culling marks

Decided:

- Star rating 0 to 5. Pick, reject or unmarked. Tags.
- Marks work on a multi-selection.
- **Marks always save at once**, whatever the autosave setting, and never
  count as unsaved work, even on the photo open in Grade.
- **Tag management:** suggestions while typing, a list of all tags with
  counts, rename or merge a tag everywhere.
- Decided October 9 from the mock-up:
  - **Colour labels are included** (red, orange, green, blue), asked for by
    Steve; they were previously parked. A small dot beside the stars, keys
    6 to 9, the same key again clears it. They can be filtered on, and are
    to be part of tag management when that is designed.
  - **Stars are yellow.** Stars and colour labels are marks on a photo and
    get their own colours, never the ultraviolet accent. The design
    guidelines need new tokens for them.
  - Marks sit in a strip under the thumbnail, never over the photo.

Proposed:

- Keyboard first: number keys for stars, single keys for pick and reject,
  arrows to move, optional auto-advance after marking.
- Small marks on thumbnails only where something is set.
- Nested tags (family > kids): open.

Proposed, mocked up October 10 (not yet confirmed by Steve):

- **Typing a tag:** T moves to the tag box. Tags already in the library are
  suggested as you type, most used first, each with its count. Arrows and
  Enter choose one; Enter on new text makes a new tag.
- With several photos selected, a tag carried by only some of them shows
  with a dashed outline; clicking it adds it to all. A small x takes a tag
  off the selection.
- **Tags and Labels window**, opened from the Details panel: every tag with
  its count, a search box, sort by name or most used. Click selects, Ctrl-
  click selects several. Rename, Merge, Remove and Show photos act on the
  selection. Renaming to a name that already exists stops and asks before
  merging. Each change is one undo step.
- **Colour labels can be given a meaning** in the same window (for example
  red = "to retouch"). The name shows in tooltips. The four colours and
  keys do not change. Names are a personal setting, kept in preferences.
- **New tag** in the same window adds a tag to the list before any photo
  carries it, so it is offered as a suggestion. (Asked for by Steve,
  October 10.) A tag stays on the list, even on no photos, until it is
  removed in this window.

### 5.6 Sort, filter and search

Decided: the library has sorting and filtering, including a quick "RAW only"
filter.

Proposed:

- **Sort by** capture time, file name, rating, pick status, file type, date
  modified, edited or not; ascending or descending.
- **Filter by** rating, pick status, tags, state (section 5.7), file type,
  camera, lens, ISO, focal length, aperture, shutter speed, date range, is a
  virtual copy.
- **Text search** on file name and tags.
- On the first visit to a large folder the grid appears at once sorted by
  name, then settles into capture order as details arrive.
- One thin filter bar, hidden until called up, showing active filters as
  small chips. Common filters on keys.

Proposed, mocked up October 10 (not yet confirmed by Steve):

- **Sort** adds file type, date modified and edited, and a button beside
  it for ascending or descending.
- **"+ Filter"** on the filter bar lists the further fields: camera, lens,
  ISO, focal length, aperture, shutter speed, capture date, file type, tag,
  state, virtual copy or original, linked. Choosing one offers the values
  that occur in the folder being looked at, each with its count; ISO and
  date ask for a number or a range. Each becomes a chip on the bar; a click
  on the chip removes it.
- These are the same rules smart albums use, so Save as smart album carries
  them across unchanged.

### 5.7 Albums and smart albums

Decided:

- **Albums:** hand-picked sets. Photos stay where they are on disk.
- **Smart albums:** defined by rules, for example tagged "kids" and "beach"
  and state is edited. They cover everything the database has indexed and
  tie into the filter and tag systems.

Proposed:

- **A smart album is a saved filter.** One rule engine for the filter bar and
  smart albums. Build a filter, then "Save as smart album".
- Rules: match all or any, plus "is not". Optional limit to chosen pinned
  folders. Nested rule groups later if needed.
- Always current. Stored as rules, not paths, and exportable.
- **State** definitions:
  - *Not edited:* known to the library, no grade adjustments saved.
  - *Edited:* has saved grade adjustments that differ from the defaults.
    Rating or tagging alone does not make a photo edited.
  - *Exported:* exported at least once. Also "edited since last export".
- **Album names are also written into each photo's sidecar**, so albums
  rebuild on another machine and a lost database loses nothing. (Decided
  by Steve, October 10: yes.)

Proposed, mocked up October 10 (not yet confirmed by Steve):

- **New album** from the + by the Albums heading: empty, or from the
  selected photos. Photos are added by right-click, Add to album, or by
  dragging thumbnails onto the album in the left panel. Remove from album
  takes photos out without touching the files. Each is one undo step.
- The Details panel says which albums a photo is in.
- **Smart album window:** a name, "match all / any of these rules", and
  rule rows of field, comparison and value. Fields in the mock-up: rating,
  pick status, colour label, tag, state, file type, virtual copy or
  original, camera, lens, ISO, file name. "Look in" ticks limit it to chosen
  pinned folders; all ticked means the whole library. The window shows how
  many photos match as the rules change.
- **Save as smart album** on the filter bar opens the same window with the
  current filter already written as rules, limited to the folder being
  looked at.

### 5.8 Metadata

Decided:

- **Viewing:** show all the camera and lens information that can be reliably
  read, especially for RAW. Generic across brands.
- **Authoring:** title, caption, creator, copyright and usage notes, entered
  once as a template and written into exported files.

What exists today: camera maker and model, lens and lens maker, ISO, shutter
speed, aperture and focal length are read when an image is opened, and camera
and lens are matched for lens corrections.

Proposed:

- Standard fields are reliable everywhere. **Lens identity is the unreliable
  part:** many cameras keep it in maker-specific notes, often as a code that
  must be looked up, and adapted or manual lenses report nothing or something
  wrong.
- **Show the truth.** Unknown is shown as unknown, never guessed.
- A manual lens name per photo or selection, for adapted and vintage lenses.
- Read once per file in the background and kept in the database. The same
  pass feeds sort, filter and smart albums.
- A quiet details panel: short summary by default, "show all" for the rest.
- Maker-specific extras where available: focus distance and mode, picture
  profile, stabilisation, drive mode, shutter type, serial numbers, crop mode.
- Privacy options on export (strip location, strip serial numbers).

Open: which reader to use (section 7, research item R1).

Proposed, mocked up October 10 (not yet confirmed by Steve):

- **Show all** in the Details panel swaps the six-line summary for the full
  list in groups: File, Camera, Lens, Exposure, Focus and drive, Location,
  Authoring. Show less goes back. The choice is not remembered between
  launches.
- Anything the camera did not write shows as "Not recorded"; a lens the
  file does not identify shows as "Unknown". Neither is ever filled in by
  guessing.
- **Set name** beside an unknown lens takes a typed lens name, kept with
  the photo and marked "entered by hand".
- The File group says whether a settings file exists beside the photo yet.
- **Authoring:** title and caption are typed per photo. Creator, copyright
  and usage notes come from one template, edited in a small window and kept
  in preferences.

### 5.9 Thumbnails, previews and zoom

Decided October 10, superseding the stored gain-map and prepare-ahead
proposals:

- Nothing is written beside photos except sidecars. Looking at photos
  writes no sidecars. Pictures live in the existing app cache area and
  can be deleted without losing work.
- The library makes its own quick picture at first view, then reuses it.
  Camera RAW uses a plain half-size linear demosaic. Linear DNG uses a
  separate plain decode, without correction opcodes. Neither route runs
  lens correction, highlight reconstruction or denoise.
- Real embedded/decoder-supported pictures may appear first for slow
  formats, followed by the quick picture. They are a head start; the
  feature does not depend on an embedded JPEG being present.
- Pictures hold reduced scene-linear data, so the graphics card can draw
  SDR or HDR live from the same cache entry. There are no gain-map preview
  files. Grade still opens through its normal fully corrected route.
- The grid defaults to SDR. The optional HDR switch and its 1000-nit grid
  comfort cap are Stage C work.
- Stage A shows the default starting look. Showing saved grades is slice 3.
- Decided by Steve, October 11: the Library picture of an edited photo is
  a reminder of which photo and grade it is, not a culling tool, and can
  be reduced resolution. Planned for slice 3: Grade keeps a small finished
  picture when it saves and the Library shows that, instead of re-creating
  the grade from the quick scene picture. It is a compressed gain-map
  picture (JPEG or AVIF, chosen after measuring), so one file serves SDR
  and HDR. The user has two controls: the storage limit and the
  resolution of pictures for edited photos. This does not change the
  decision above against gain-map files for unedited photos. Details are
  in the slice 3 brief, Stage B. Grades changed in bulk need more work in
  slice 7; see section 8, "Carried forward to slice 7".
- Only visible grid/filmstrip cells are requested. Requests are cancelled
  when they leave the screen. Single view reads ahead to its next and
  previous neighbours. Work uses the existing low-priority helper and
  pause gate for Grade/export.
- Reduced browsing pictures are acceptable. Stage A uses 512-pixel grid
  pictures, 192-pixel filmstrip pictures, and 1280/1920/2560-pixel single
  pictures according to the space available. Native 100% zoom is Stage C.
- Stage A caches compressed float16 scene pixels, plus an authored SDR
  reference where supplied, in `.npz` entries keyed by source path, size,
  modification time, resolution, quality and picture version. No display
  tone mapping is baked into the scene pixels.
- The initial fixed disk limit is 2 GB. Least-recently-used entries are
  removed in batches to leave a 10% gap; a user setting can follow later.
  Natural 512-pixel RAW pictures checked October 10 were about 0.7–0.9 MB
  each; a HEIC/AVIF picture with a second reference was about 2.1 MB. Tiny
  synthetic gradients compress much more and are not a sizing estimate.
- The drawing surface is reused rather than retaining renderer
  intermediates for every photo visited. Source texture caching uses the
  existing GPU allocator unchanged.
- `HDR_FINISHER_DEV_LIBRARY_TIMING=1` enables first-picture timing on the
  displayed photo or thumbnail under the pointer. It is hidden by default.

Known roughness accepted for the early usable library: quick colours on
some DNGs and Canon/DJI brightness are not yet corrected. A format with no
usable embedded picture must wait for its real decoder. Library pictures
currently require WebGPU; Grade's existing CPU fallback is unchanged.

Later proposals still to settle: user cache/size settings, comfort-cap
behaviour, moved-photo cache identities and movable cache storage. The
older "Create HDR previews" mock-up controls are superseded by live HDR.

### 5.10 Overlays: focus, and exposure

Decided:

- **Focus overlay:** shows where focus landed and whether a photo is sharp,
  readable even on thumbnails, without zooming to 200%. Reference:
  FastRawViewer's focus peaking.
- **Exposure and clipping overlay:** blown highlights and blocked shadows
  shown on thumbnails, read from the RAW data.
- Overlay first. A sharpness score comes later, if at all.
- Decided October 9 from the mock-up:
  - **A key is the quick switch; a click opens the options.** Clicking
    Focus, Exposure or Compare in the toolbar does not turn it on or off.
    It opens a small panel, in the same pattern as Overlays, Preview and
    Frame on the Grade stage. The panel has the on/off switch and the
    detailed settings. The key (S, E, C) stays the instant on/off.
  - Focus options: strength, sensitivity, colour. Exposure options:
    strength, blown highlights and blocked shadows each on or off and
    each with its own colour. Compare options: layout (side by side, top
    and bottom, split with a draggable divider) and whether file names
    and marks show under the photos.
  - Overlay colours can also be changed by clicking the colour square in
    the legend.
  - **The option-panel settings are remembered between launches:** overlay
    colours, strength, sensitivity, which exposure warnings show, and the
    compare layout. This is a stated exception to the start-neutral rule
    in the design guidelines: they are preferences about the user's eyes,
    camera and photos, not a layout. Whether an overlay is switched on is
    not remembered.
  - Maps store only where, not what colour; the colour is applied on
    screen, so changing a colour never re-makes maps.

Proposed:

- Sharpness cannot be measured from a thumbnail, which has already lost the
  detail. It is measured once from the tier 2 decode, saved as a small map in
  the cache, and drawn over the thumbnail. The same holds for exposure.
- One key each to toggle, in grid, single view and compare.
- For exposure, also show how much highlight range a photo really holds,
  which is what decides whether it is worth grading in HDR.
- Maps are made in the background, on-screen photos first, only once the
  overlay has been switched on.
- Honest limits to state in the app's help: the overlay shows where the sharp
  plane is, not whether it is on the right subject; high-ISO noise can look
  like detail and needs an allowance.

Open: one focus overlay or two (strong edges and fine detail).

### 5.11 Compare

Decided:

- Pin a reference photo and flip through alternates beside it.
- Zoom and pan stay locked together across both sides.
- Side by side.
- Decided October 9 from the mock-up:
  - Arrow keys flip the right-hand photo only, through the photos in the
    folder. The left-hand photo stays put.
  - Stars, pick and reject always act on the right-hand photo.
  - `[` puts the selected photo on the left and `]` puts it on the right.
    This works from the grid and from the filmstrip, and opens compare if
    it is not open. Inside compare the selected photo is the right-hand
    one, so `[` moves it to the left and the next photo takes its place.

Proposed:

- A split view with a draggable divider as an option.
- Mark stars, pick and reject without leaving compare.
- Uses the tiers in 5.9 with read-ahead so flipping is instant.
- Comparing two virtual copies of one photo is a natural use.

### 5.12 Where the data lives

Decided:

- **Sidecar:** decided October 10: the photo's full filename plus `.hdrf`
  (for example `DSC02339.ARW.hdrf`). One small file next to each photo. Holds that photo's
  adjustments, rating, pick status, tags and virtual copies. Hidden while
  browsing in the library.
- **Database:** one file in the app's data area. Holds pins, albums, smart
  album rules, layout preferences, and a searchable copy of what sidecars and
  camera metadata say.
- **Sidecars are the truth.** If the database is lost it is rebuilt by
  reading folders again.
- **Preferences:** decided October 9. Personal settings that should survive
  a restart (overlay colours first) go in the app's existing preferences
  file, `application-preferences.json` in the app's data area, which
  already holds settings such as remembered folders. They do not go in the
  library database, because the database is an index that can be thrown
  away and rebuilt, and rebuilding it must not reset anyone's preferences.

Proposed:

- The sidecar is the same kind of document as today's `.hdrfinisher` project
  file, which already holds only settings and points at its photo. It looks
  for its photo beside itself first.
- Named with the photo's full file name plus an ending
  (`DSC02339.ARW.hdrf`), so a RAW and a JPEG of the same name each get
  their own, and it sorts beside its photo in Explorer.
- Created only when a photo is first rated, tagged or edited. Looking at a
  folder writes nothing.
- Each photo gets a small ID in its sidecar, and each virtual copy its own
  ID, so albums and returned projects can find them after files move.
- Plain, readable text, written whole in one step.
- Folders that cannot be written (memory cards, read-only shares): keep that
  photo's data in the database and say so.
- **Two sidecars for one photo** (a returned project, a cloud or network
  conflict copy, an orphan): detect it, never pick a winner silently, and
  bring the other in as virtual copies.
- Moving a photo in Explorer without its sidecar leaves an orphan. Offer to
  reconnect orphans by ID. Later nicety.
- Per the pre-1.0 rule: no migration code.

### 5.13 Saving, reverting and undo

Decided:

- **Autosave is an option**, quick to reach, with its state always visible.
  - *On:* adjustments save to the sidecar a moment after the last change, and
    always on leaving the photo or closing the app. No prompts.
  - *Off:* nothing is written until the user saves.
- **Only one photo is open in Grade at a time**, so only one photo can ever
  have unsaved work.
- **Autosave off:** double-click asks Grade to switch photos. If the open
  photo has unsaved work, the switch is held and a window offers Save, Don't
  save or Cancel. The same check covers closing the app, closing the main
  window, and opening another virtual copy of the same photo.
- **Library commands that change grades** (paste, look preset, sync) save
  straight away whatever the autosave setting, after a confirmation that
  says how many photos will change.
- **"Before" safety net:** before such a command rewrites a grade, the
  previous grade is kept in that photo's sidecar. It outlasts a restart.
- **Reverts**, in Grade and on a library selection:
  - Revert to original: clear all adjustments.
  - Revert to last saved: drop unsaved work on the open photo.
  - Revert to last session.
  - Restore previous grade: bring back the "before" state.
- **Undo for library actions:** ratings, picks, tags, album changes, moves
  and renames. A multi-photo action is undone as one step. Deletes are undone
  from the Recycle Bin.

Proposed:

- A **session** is one run of the app. The first time a photo's grade changes
  in a run, its grade from before that change is kept. "Revert to last
  session" returns to it.
- A revert is itself kept as a "before" state, so it can be taken back.
- If the photo open in Grade is among the targets of a library command, the
  change lands there as ordinary unsaved work.
- The library shows and exports the **saved** grade of the open photo. A
  batch export that includes it says so and offers to save first.
- With autosave off, keep a hidden recovery copy of the open photo's unsaved
  work, offered back after a crash.

Proposed, mocked up October 10 (not yet confirmed by Steve):

- **Where the save state shows on Grade:** beside the photo name, as "All
  changes saved", "Saving…", "Unsaved changes" or "No unsaved changes".
  With autosave off and unsaved work, Save (Ctrl+S) and Revert to last
  saved appear there, and the Grade tab carries a small dot that stays
  visible from the Library.
- **The prompt** follows the app's existing unsaved-changes window: title
  "Unsaved changes", body "Save changes to <file> before opening <file>?"
  and nothing more (Steve, October 10: no explanatory text), and buttons
  Cancel, Don't save, Save. Escape is Cancel. The same window appears on
  closing the app.
- Going to the Library tab and back never asks; the Grade tab returns to
  the photo that is open. Opening the photo that is already open never
  asks.
- Turning autosave on while there is unsaved work saves it at once.
- Thumbnails show the saved grade, so an unsaved change is not seen in the
  library until it is saved.

Proposed, mocked up October 10 (not yet confirmed by Steve):

- **Revert to original** and **Revert to last session** are on the photo
  right-click menu beside Restore previous grade, and appear only when they
  would do something. Each confirms with the number of photos, says each
  keeps its previous grade, and is one undo step. Marks and tags are not
  touched.

### 5.14 Virtual copies

Decided: several independent grades of one photo with no duplicate of the
image file.

Proposed:

- Each copy has its own adjustments, crop, rating, pick status and tags; is
  its own thumbnail with a small corner mark beside its original; can join
  albums on its own; and exports as its own file with a name suffix.
- Create from the current grade or from a clean start. Optional name.
- Stored in the sidecar, so copies travel with the photo. (Lightroom keeps
  them only in its catalog.)
- Sort and filter treat a copy as an item.
- Deleting a photo removes its copies; the confirmation says so.

Proposed, mocked up October 10 (not yet confirmed by Steve):

- **Create virtual copy** from the right-click menu asks two things: start
  from the current grade or a clean start, and an optional name. Without a
  name the copy is "Copy 1", "Copy 2" and so on.
- A copy sits straight after its original in every sort order. Its mark is
  in the strip under the thumbnail (a small copy symbol; the original shows
  "+2"), never on the photo. Its name follows the file name.
- A new copy starts with the original's stars, pick status, label and tags.
- **Remove virtual copy** has its own window, which says one grade is
  removed, the photo stays, and nothing is deleted from disk. It is undone
  with Ctrl+Z, not from the Recycle Bin.
- Deleting a photo names how many virtual copies go with it.
- Exported files add the copy's name to the file name.

### 5.15 Copying grades, and look presets

Decided:

- **Selective copy and paste** of grades from inside the library, onto one
  photo or many. A checkbox list chooses what is brought across. Adjustments
  are grouped; each group twirls down for finer choices.
- **Look presets:** styling presets applied from a menu and then customised,
  in the manner of DxO.
- Decided October 9 from the mock-up:
  - Ctrl+C copies the grade of the selected photo. Ctrl+V pastes it onto
    the selection with the same ticks as last time, after a confirmation
    that offers "Choose what to paste". **Ctrl+V always confirms, even for
    one photo** (Steve, October 9). Ctrl+Shift+V goes straight to the tick
    list.
  - Confirmation wording, set by Steve: title "Paste Grade From
    <file name>"; body "Paste Tone, Color, Look, Detail, and RAW
    development settings.", listing what is ticked. For more than one
    photo the body adds "onto N photos".
  - The tick list shows, for each group and setting, whether the copied
    photo changed it (`Mod`) or left it at default, with quick choices
    All, Modified only and None. HDR grade and SDR grade are two ticks at
    the top.
  - The dialog states how many photos will change, that each keeps its
    previous grade, and what will be skipped for which photos.
  - "Save as look preset" is offered from the same dialog.

Proposed:

- **One mechanism.** A look preset is a selective copy saved with a name.
  Copy and paste, sync and presets share one checkbox list and one set of
  rules.
- The twirl-down level is the 22 preset groups the app already has (tone,
  highlights, equalizer, colour, zones, curves, colour grading, film look,
  vignette, detail, black and white, denoise, for HDR and for SDR, plus SDR
  base). Top level:
  - **Tone:** tone, highlights, equalizer, zones, curves
  - **Colour:** colour, colour grading, black and white
  - **Look:** film look, vignette
  - **Detail:** detail, denoise
  - **HDR side / SDR side** as a master pair
  - **Outside the grade groups:** RAW development, lens corrections, crop
    and geometry, local adjustments and masks. (Corrected by Steve on
    October 9: RAW development does not expose white balance, so white
    balance is not listed.)
- Unticked by default, because they do not transfer cleanly between frames:
  masks and local adjustments, crop, lens corrections.
- Settings that do not apply to the target's kind of file are skipped, and
  the app says which.
- A plain paste repeats the last set of ticks. A preset only touches the
  groups it contains.
- Presets: apply in Grade or to a library selection; update from current;
  save as new; folders and favourites; export and import as files; a small
  built-in starter set, designed with Steve.
- Preview on hover before thumbnails of every preset, which cost a render
  each.

Proposed, mocked up October 10 (not yet confirmed by Steve):

- **Apply Look Preset window:** looks listed under Favourites, then the
  user's folders, then the built-in starter set, each with the groups it
  contains. Pointing at a look previews it on the first selected photo;
  clicking selects it. A star marks a favourite.
- The window says how many photos will change and that each keeps its
  previous grade. Applying is one undo step, like paste.
- A user's look can be renamed, updated from the copied grade, exported and
  deleted. A built-in look cannot be changed and has no "save a copy"
  button (Steve, October 10). A new look always comes from an edited
  photo: apply a built-in look, adjust in Grade, save that grade as a look.
- **Save as look preset** in the paste window asks for a name and a folder
  and lists the ticked groups the look will contain.

### 5.16 Export

Decided:

- **Batch export** of a selection, each photo with its own grade.
- **Export recipes, several at once:** one run can produce more than one
  deliverable, for example an HDR AVIF and an SDR JPEG, each with its own
  size, naming pattern and sub-folder.
- **Pattern naming happens here**, on the exported files, not on originals.
- Authored metadata (5.8) is written into exports.
- Decided October 9 from the mock-up:
  - **A recipe has the same settings the Export stage has today**, with the
    same names and choices: format, preset, quality, the advanced settings
    for that format, dithering, source metadata, resize, prevent
    enlargement and output sharpening. A recipe adds only a name, a file
    name pattern and an optional sub-folder.
  - **Sizes are typed as numbers.** Long edge, and width and height for
    "Fit within dimensions", take any whole number of pixels; there is no
    fixed list of sizes.
  - **Direction for the Export stage:** it will probably be retired in time,
    with its tab opening this export window for the open photo instead of
    a page. Not scheduled. Until then both exist and must offer the same
    settings.

Proposed:

- A background queue with progress, a time estimate, cancel, and a per-file
  result list. It must not block grading. Needs a memory plan for large
  files.
- A record of what was exported and when, feeding the "exported" and "edited
  since last export" states.
- Recipes can be saved, and carried inside a project (5.17).
- The exact CPU export is called, not changed. It stays under the strict
  testing rule.

### 5.17 Projects and sharing

Decided (item 10 is a lean, the rest agreed):

- The sidecar replaces Save / Save As for everyday work.
- **Export project** from a folder, an album, a selection or a single photo
  produces a **project folder**: sidecars, a small project index if needed,
  and optionally the source images. The model is DaVinci Resolve's project
  with or without media.
- Projects have their own small section and behave like pinned folders. A
  project is a mini library that is easy to hand over. Typical use: moving
  work between machines or people, and corporate batches converted to HDR as
  one deliverable.
- **A project without sources:** the receiver chooses.
  - *Merge:* each grade lands beside its original as a new virtual copy.
  - *Keep separate:* the project stays its own mini library pointing at
    photos elsewhere.
- **Relinking missing sources** needs a reasonable manual path, not a
  polished one. Most people will use AI for it.

Proposed:

- Kept thin: *a project is a pinned folder with a project file in it.* With
  sources included it needs no import, only pinning and indexing.
- The index holds the project name, its albums and photo order, smart album
  rules, and the export recipes and look presets the job uses. Grades stay in
  sidecars.
- Double-clicking the project file in Explorer opens the app on that
  project.
- Exporting is a copy. Afterwards the project and the originals can drift
  apart; the export window says so.
- Merging a returned project matches photos by ID and fingerprint. Nothing
  local is overwritten. Merge offers to create an album for the set.
- A project kept separate is the one case where a grade does not live beside
  its photo, so it must show clearly when its photos are missing.
- Manual relink: point at a folder; the app searches it and its sub-folders,
  matching by file name and confirming by fingerprint; a plain list of what
  is still missing; pick single files by hand; a fingerprint mismatch warns
  but can be overridden; work continues with some photos offline. Today's
  single-image relink is the starting point.
- Exporting with sources from an album that spans folders copies the photos
  (show the size first) and needs a rule for two photos with the same name.
- Choose which virtual copies travel. Option to pack a project into one file
  for sending.
- Projects stay optional. Nobody has to create one to work.
- Existing `.hdrfinisher` files should keep opening, since the sidecar is the
  same kind of document. Check Steve's real projects before promising it.

Proposed, mocked up October 10 (not yet confirmed by Steve):

- **Export project** from a folder, album, project or selection is one
  window: project name, where to save, grades only or grades with source
  photos (with the size), all virtual copies or only the main grade,
  whether to include the recipes and looks used, and folder or single file.
  It says that the export is a copy and the two can drift apart. It runs in
  the background.
- **Open project** is the + by the Projects heading. For a project with no
  photos the window says how many photos were matched in the library and
  how many were not, and asks Merge or Keep separate, with an option to
  make an album after a merge.
- **Missing photos** keep their place in the project grid as a dashed frame
  marked "Missing", and the project's entry shows the count. The rest of
  the project stays usable.
- **Relink window:** a folder to search (sub-folders included) and one row
  per missing photo with its state: Missing, Found and content matches,
  Name matches but content differs (with "Use anyway"), or Chosen by hand.
  What is found can be relinked while the rest stays missing.

### 5.18 Background indexing

Decided:

- Pinned folders and opened projects are indexed in the background,
  sub-folders included, **on by default**. An advanced setting turns it off.
- It uses processor capacity that is not busy. Anything needing the graphics
  card runs only when the card is mostly idle.

Proposed:

- Runs in the helper process (F3) at low priority on a limited number of
  threads. Slows or pauses while the user grades, exports or scrolls.
- The basic pass needs no graphics card: file list, capture details,
  existing sidecars. Thumbnails, focus maps and exposure maps are separate,
  later in the queue, and made only when wanted.
- Order: the folder on screen, then recently used pins, then the rest.
- Keeping folders current is specified under "Keeping folders current"
  below (decided October 11). It replaces the earlier one-line proposal to
  watch pinned folders.
- An unplugged drive keeps its index; its photos show as offline.
- A small progress indicator with pause. Searches and smart albums say when
  indexing is still running.
- Advanced settings: on or off, how much processor to use, pause on battery,
  pins to leave out.

Proposed, mocked up October 10 (not yet confirmed by Steve):

- **Background work shows in the bottom bar**, one entry per job (indexing,
  HDR previews, a move between drives, a project export) with a count. A
  click offers Pause or Resume, and Cancel.
- The smart album window says when indexing is still running, so a count
  is not taken as final.
- **An unplugged drive:** the pinned folder stays listed and can be opened.
  Its thumbnails are dimmed and marked offline. Marks and tags still work.
  Opening a photo in Grade says the drive is not connected.
- **Library settings**, one page of the Settings window: autosave; cache
  size limit with a "used" bar, cache location and Clear the cache; HDR
  preview size; brightness limit; background indexing on or off, processor
  use (low, medium, high), pause on battery, and pinned folders to leave
  out. The starting numbers are placeholders until M2 and M3 are measured.

#### Keeping folders current

Built October 11: slice 2b in section 8. Timed checks keep pinned folders
and the folder on screen current between the existing opening/pinning and
Re-scan reads. **Check for new photos** checks chosen folders first.

Decided by Steve, October 11:

- **Pinned folders keep themselves current while the app is running.**
  The example to design for: an "intake" folder is pinned, and photos are
  dropped into it from Explorer while the Library is open. They appear in
  the Library with no action from the user.
- **Folders that are not pinned are read when they are opened** in the
  Library, as today. They are not checked in the background.
- **It does not need to be instant.** Checking every so often is enough.
- **A button checks sooner.** It acts on the selected folder or folders
  only, not the whole library. Those folders go to the front: ahead of
  other background library work, or alongside it. It never waits behind a
  long index of some other folder.

Proposed by Claude (the numbers are open decision 27):

- **How often.** The folder on screen is checked about every 15 seconds,
  pinned or not, for as long as it is on screen. Every other pinned folder
  is checked about every 5 minutes, one folder at a time.
- **Slow drives slow themselves down.** After a check, the next one for
  that folder waits at least ten times as long as the check took. A
  network share or a very large parent folder is therefore checked less
  often without a setting. Measure the check on a 50,000-photo folder on a
  local drive and on a network share, and report it, before the numbers
  are fixed.
- **A check is only a listing.** It compares names, sizes and modified
  dates with what the database holds. Only new or changed photos and
  settings files are read. A check that finds nothing writes nothing and
  shows nothing in Activity.
- **What a check notices:** photos added, removed, renamed or replaced
  outside the app, new sub-folders, and settings files added or changed by
  something else (a sync tool, another machine).
- **A photo still being copied in is not shown yet.** It appears once its
  size has stopped changing between two checks, so a half-copied file never
  shows as broken or unreadable.
- **The grid does not jump.** New photos take their place in the current
  sort order. The selection, the scroll position and the photo being
  looked at stay where they are. The bar says once, quietly, how many
  arrived ("12 new photos in Intake").
- **The button** is "Check for new photos" on a folder's right-click menu
  (one folder or a multi-selection) and on the toolbar for the folder on
  screen. Re-scan pinned folders now stays in Activity as the
  whole-library action.
- **Priority** (confirmed by Steve, October 11). A requested check runs
  ahead of background indexing and periodic checks. Settings writing
  carries on alongside it. It still gives way to Grade and export, as all
  library work does (principle 7); if it is held for that reason,
  Activity says so.
- Brief for the build:
  `docs/technical/codex-brief-library-folder-checks-2026-10-11.md`.
- **When checks stop:** background indexing switched off (the folder on
  screen is still checked), indexing paused by the user, Grade or export
  busy, or the drive not connected. A drive that comes back is checked
  straight away.
- Checks run alongside the index in the same helper, on one read-only lane
  that yields to visible Library work and Grade. The index resumes in memory
  without repeating expensive work; a stale name listing may be repeated. Failures are logged and
  reported through Activity and the health command like other indexing
  problems.
- Not included: instant notification from Windows. It can be added later
  for local drives as a way to trigger a check sooner. The timed check
  stays as the base because network drives do not report changes reliably.

### 5.19 Size and speed targets

Decided: the library is designed to a stated size, so performance is planned
and not hoped for. The number is set after measuring what each indexed photo
costs in database size, memory and time, and may change.

Proposed targets to define once numbers exist: photos indexed while staying
quick; time for first thumbnails in a folder; time to flip between photos in
compare; time and disk per HDR preview; first full index of a large drive.

### 5.20 Linked photos (sync)

Decided by Steve, October 10: several photos can be linked so that editing
one changes all the others. The mark is a chain icon. (The PRD earlier used
the word "sync" without defining it; this is the definition.)

Proposed, mocked up October 10:

- Select two or more photos, right-click, **Link grades**. The window asks
  which photo's grade they all start from, and says each keeps its previous
  grade.
- From then on a change to any one of them reaches all: an edit in Grade
  (applied to the others when it is saved), a paste, a look or a revert.
  Windows that count photos include the linked ones and say so.
- A chain icon sits in the strip under each linked thumbnail. Grade shows
  "linked with N other photos" beside the file name.
- **Unlink** takes the selected photos out. Each keeps the grade it has.
  A link left with one photo ends.
- Crop, lens corrections and local adjustments are never linked, for the
  same reason they are unticked by default in paste.
- A photo is in at most one link. Virtual copies can be linked like any
  other photo. A new virtual copy does not inherit the link.
- "Linked" is a field in filters and smart albums.

Open: whether a link covers the whole grade (as mocked) or a chosen set of
groups from the paste tick list; where the link is recorded so it travels
with the photos (each sidecar naming its link is the likely answer).

---

## 6. Technical approach

Notes for whoever turns this into build briefs. Proposed unless stated.

### 6.1 Two windows

- The shell starts one backend and opens windows that load pages from it.
  Both windows see the same pins, marks and previews because those live in
  the backend.
- **Stage A docking:** an independent library page in a same-origin frame
  covers the workspace beneath the stage tabs, including its own folders
  and details rails. The old editor workspace is hidden and inert while
  Library is selected. The page does not share the editor's `state` (F4).
  A small bridge passes activity, review and open-photo messages. Open-photo
  grants the path through the desktop and invokes the existing leave gate.
  The future pop-out can reload the same page and restore its state; native
  view ownership is not needed for the docked stage.
- The windows tell each other things ("open this photo", "rating changed",
  "export finished") through the shell or the backend.

### 6.2 Processes

- Grading backend: as today.
- Library helper (F3): indexing, metadata, thumbnails, quick decodes, maps
  and preview building, at low priority.
- Open: where the database is written from, given two processes. One writer
  is the simplest rule.

### 6.3 What already exists and can be reused

- Folder listing, places, pins and recents:
  `backend/hdr_finisher/media_browser.py`, `frontend/media-browser.js`.
- Thumbnail cache keyed by path, size and modified time, with embedded-JPEG
  extraction for RAW.
- Staged opening of a source: quick preview first, full quality after
  (`backend/hdr_finisher/import_jobs.py`).
- The project document and its relink step
  (`backend/hdr_finisher/projects.py`).
- Per-panel grade presets in 22 groups (`frontend/group-presets.js`, preset
  handling in `desktop/main.js`).
- Camera and lens reading (`backend/hdr_finisher/metadata.py`).
- Gain-map creation, for the proposed preview format.

### 6.4 Testing

Most of the library is new code beside the image pipeline, not inside it, so
it should rarely reach the strict areas. Batch export calls the exact export
without changing it. New library behaviour needs its own fast checks (data
rules, sidecar reading and writing, file operations on throwaway folders).
Anything that deletes or moves files is tested on temporary copies only.

---

## 7. Measurements and research before the design is fixed

To be done by Steve and Claude while the foundation work proceeds. Use a
spread of cameras and formats: several brands, compressed and uncompressed
RAW, low and very high pixel counts. Steve's files are one sample, not the
target.

| # | Question | Decides |
|---|---|---|
| M1 | How long does the quick plain decode take, reduced size and full size? | Whether zoom and compare feel instant; how much read-ahead is needed |
| M2 | How long, and how much disk, per HDR preview at 1920 / 2560 / 3840? | Preview size limit; HDR toggle versus per-folder command; default cache size |
| M3 | What does one indexed photo cost in database size, memory and time? How long is a first full index of a large drive? | The size target (5.19) |
| M4 | How large is the embedded JPEG across cameras, and how often is it big enough? | How much the tier 1 head start is worth |
| M5 | Does thumbnail work in the helper process disturb the grade preview? | Limits for background work |
| M6 | Does keeping edited-photo previews current hold up across a whole library? | The preview design (one of the two risky pieces) |
| R1 | Which metadata reader gives reliable lens and maker-specific data per brand: what is built in, or bundling ExifTool? | Reader choice, and what the app can honestly promise per brand |
| T1 | Trial: save today's project document beside a photo, reopen it with the photo found beside it, with autosave. | The save-model change (the other risky piece) |

**R1 first pass, October 9 (reader not yet chosen):** The current RAW reader
uses ExifRead with `details=False, extract_thumbnail=False`, then fills
missing fields from rawpy/LibRaw. That ExifRead mode explicitly skips maker
notes, so looking up `MakerNote` keys afterwards does not give the current
path maker-specific coverage. [ExifRead processing options](https://github.com/ianare/exif-py#processing-options).

The installed runtime is rawpy 0.27.1 / LibRaw 0.22.1 and ExifRead 3.5.1.
Inspection of `RawPy` found `lens` but no `camera_manufacturer`, `camera_model`
or `metadata` attributes; the current fallback therefore must not be treated
as a complete camera identity reader. LibRaw itself has lens and vendor
metadata structures, but the Python wrapper's exposed fields matter.
[LibRaw structures](https://www.libraw.org/node/31),
[rawpy API](https://letmaik.github.io/rawpy/api/rawpy.RawPy.html).

ExifTool documents maker-note support for many camera brands. It is a strong
candidate to compare against a maker-note-enabled ExifRead run, rather than
assuming that the current quick reader is enough. This is a research
inference, not a verified per-brand coverage claim or a decision to bundle
it. [ExifTool official repository](https://github.com/exiftool/exiftool).

The next R1 comparison needs original camera files with known lens/body
identity: several brands, OEM and third-party/adapted lenses, compressed and
uncompressed RAW, and converted DNG. Compare today's output, ExifRead with
maker notes enabled, and ExifTool; record missing/wrong/ambiguous fields and
read cost. Preserve exact identity and distinguish absent metadata from
reader failure. Do this read-only in the helper; do not change grading's
metadata reader or lens-matching rules as part of foundation work. If
ExifTool wins, packaged startup, Unicode paths and helper shutdown must be
verified before choosing it.

**Camera measurements, October 9:** Steve supplied
`D:\Photos\HDR Test Images`, including `Test Suite Images`. The read-only
probe found 49 RAW/DNG paths: 30 unique files after SHA-256 deduplication,
18 duplicate copies, and one 1.78 GB line-scan DNG excluded by the explicit
256 MiB file / 100 MP pixel guard. Of the 30, LibRaw could open 29; the merged
`DJI_0071-2-HDR.dng` is unsupported by this baseline, not proof that the app's
separate HDR-DNG loader cannot open it. No originals or projects were written.

**M1 baseline:** 12 representative decode cases, two fresh-process samples
per half/full mode on Steve's Ryzen 5 7600, with one decoder thread. Times
below are medians in seconds. This uses LibRaw AHD, unity WB and linear
camera RGB16. It excludes process/module startup, metadata comparison and
pixel-limit preflight; OS file cache is uncontrolled. It is not the finished
color-managed preview, an accuracy qualification, or a latency budget.

| Sample | LibRaw half-size | Full size |
|---|---:|---:|
| DJI FC3170 native DNG, 48 MP | 0.285 | 3.600 |
| Sony A7R III ARW, 42 MP, two size/compression cases | 0.197-0.290 | 3.183-3.235 |
| Canon 5D III CR2, 22 MP | 0.388 | 1.952 |
| Canon 60D CR2, 18 MP | 0.345 | 1.574 |
| Nikon D7500 NEF, 21 MP | 0.308 | 1.731 |
| Fujifilm X-E2S RAF, 16 MP | 0.083 | 5.941 |
| Five converted linear DxO DNG cases, about 42 MP | 2.021-2.166 | 2.039-2.169 |

On those linear DNGs, half-size **did not reduce the output dimensions**.
The largest probe process used about 962 MiB peak memory, including imports
and decode buffers. This is evidence to keep full decodes bounded, not an
estimate of the eventual cached-preview memory. Half-size quality and the
color/profile/correction cost still need a dedicated experimental trial.

**M4:** all 29 LibRaw-readable files supplied a JPEG. The 13 original Sony
ARWs had 1616x1080 previews; the two native DJI DNGs had 960x720; Fuji had
1920x1280; the two Canon CR2s and Nikon NEF had roughly full-size JPEGs.
Ten converted DxO DNGs also had full-size JPEGs. Across all 29, 14 reached a
1920-pixel long edge and 13 reached 2560/3840; among the 19 camera originals,
only 4 reached 1920 and 3 reached 2560/3840. Header-plus-JPEG extraction took
about 0.6-17.9 ms here, before JPEG decoding/display. This small, Sony-heavy
corpus supports a tier-1 head start but not a promise of screen-sized or
100% embedded previews across cameras.

**R1 sample comparison:** ExifTool 13.59 read metadata for all 30, including
the LibRaw-unsupported merged DNG. Today's reader returned no body identity
for the Fuji RAF and no lens model for the Nikon NEF. LibRaw filled the Fuji
lens name, but not its body or the Nikon lens. Enabling ExifRead maker notes
added Nikon tags but did not resolve its full lens name; ExifTool returned
an AF-S Nikkor 80-400mm identity. Canon/Sony standard lens names were mostly
already available; ExifTool additionally identified Sony's Tamron/Sigma
maker-specific identities. These are observed reader outputs, not independently
verified lens labels. The native DJI DNGs also have conflicting EXIF versus
XMP camera model fields, so group provenance and explicit precedence are
required. Do not choose an arbitrary first tag or silently treat a parse
failure as absent metadata.

ExifTool's one-process-per-file reads took roughly 0.30-0.57 seconds here,
including startup; a future persistent-helper comparison is needed before
assuming that cost per indexed photo. The temporary Windows tool was fetched
from the publisher's linked SourceForge distribution and the archive SHA-256
was verified (`44b512b25af500724ba579d0a53c8fc5851628b692dd5e5d94ae4a15c2cba9ec`).
It is under ignored measurement output, not bundled with the application.
Reader choice, packaged behavior and independently checked brand coverage
remain open.

**M5:** the existing Electron concurrency driver also passed with eight real
DNG/ARW/CR2/RAF/NEF thumbnails while adjusting `DSC00264.ARW`. It covered both
paused retries and concurrent processing. This proves functional progress,
not an absence of perceptible stutter; Steve's large-folder/monitor trial
still decides how it feels. Packaged helper confirmation is still deferred
to the next requested installer build.

Reproduce with `tests/performance/photo-library-measurements.py --source
"D:\Photos\HDR Test Images" --exiftool <temporary-exe> --samples 2`. Raw rows
and exclusions are in `codebase/output/library-measurements/corpus.json`
(local ignored output); the script is committed. The real-file M5 driver
takes `--corpus <that-json> --grade-source <original-RAW>`.

Validation for this measurement commit: 438 JavaScript tests and 1,588 Python
tests passed (3 skipped); the real-camera M5 Electron check passed. The
measurement probe also completed 48 half/full decode samples without errors.
The one unsupported merged DNG and oversized line-scan exclusion are recorded
above; neither was treated as a passing decode.

**M2, October 10 (external CPU preview instrument):** Ten representative
RAW/non-RAW files, two default session loads each, with as-shot development,
highlight reconstruction, automatic starting exposure and applicable lens
correction. The unchanged renderer/exporter produced a JPEG Ultra HDR file
(SDR base plus embedded gain map), JPEG quality 85 / gain map 100 / 4:2:0.

The shipped helper currently has import-thumbnail jobs, not HDR-preview jobs.
This instrument uses its below-normal priority and one numerical-library
thread; preview files are rendered on the Ryzen 5 7600 CPU. It is not a
measurement of a future GPU library-preview pipeline. Encoding, validation,
flush and disk write are included; originals remain read-only. No alternate
format was timed: Ultra HDR already exercises the proposed single-file idea.

Cold below is default session preparation plus a freshly built reduced-source
cache, measured as separate components. Warm retains decoded/reduced sources
but still renders and encodes a new file; it is not a cache-hit display time.
Persistent mip reuse is disabled in this instrument for cold builds.
Process/module startup is excluded and OS disk cache is uncontrolled. Each
row pools 20 observations (two per file); sizes are binary MiB.

| Long edge | Cold median, seconds | Warm median, seconds | File median, MiB |
|---|---:|---:|---:|
| 1920 | 11.23 | 3.00 | 2.13 |
| 2560 | 12.94 | 4.50 | 3.94 |
| 3840 | 17.34 | 8.73 | 7.97 |

| Sample at 2560 | Cold median, seconds | Warm median, seconds | File median, MiB |
|---|---:|---:|---:|
| DJI FC3170 native DNG, 48 MP | 105.66 | 5.05 | 2.67 |
| Sony A7R III ARW, 42 MP, DSC02767 | 15.00 | 4.52 | 3.41 |
| Sony A7R III ARW, 42 MP, DSC06615 | 14.69 | 4.48 | 3.43 |
| Converted linear DxO DNG, 42 MP | 14.77 | 2.89 | 4.45 |
| Canon 5D III CR2, 22 MP | 10.70 | 4.64 | 2.39 |
| Fujifilm X-E2S RAF, 16 MP | 12.62 | 4.70 | 4.49 |
| Nikon D7500 NEF, 21 MP | 7.21 | 3.43 | 8.13 |
| DJI JPEG, 48 MP | 13.31 | 4.84 | 4.76 |
| iPhone 16 Pro HEIC, 12 MP | 8.20 | 3.14 | 5.36 |
| DxO TIFF, 42 MP | 7.22 | 4.26 | 3.39 |

One sequential screen-sized batch of **30 distinct originals at 2560** took
**597.95 seconds (9 minutes 58 seconds)**; median per job was 15.28 seconds,
30/30 succeeded. This includes default source preparation for every photo.
Peak process working set was 2.85 GiB during that batch, including full decode
buffers; it is not a proposed preview-memory budget. The DJI default load
alone cost about 100 seconds, showing why M1's plain decode cannot stand in
for this measurement.

Suggestions for Steve: this CPU path supports a **prepare-ahead command**, not
an instant switch that must build uncached photos on screen. Already stored
previews and a future GPU job need separate display/build trials. **2560** is
a reasonable starting long edge for the measured 2560-wide window; 1920 is
cheaper, while 3840 nearly doubles the pooled warm cost and median file size.
This is a cost recommendation, not a visual-quality qualification. An
adjustable **10 GiB combined preview-cache limit** would hold roughly 2,600
median 2560 gain-map files alone, or about 2,000 with illustrative headroom
for other cached items. Actual 2560 files ranged 2.39-8.13 MiB by sample;
thumbnail/map/source-cache usage must be counted before promising capacity.
No existing source-cache limit or budget is changed.

Excluded from M2: the earlier oversized line-scan source and unsupported
merged HDR DNG, virtual copies, local masks, cold disk, network drives,
GPU file creation and display latency. The ten-file sample is Sony-heavy;
its defaults/size distribution are not representative of all libraries.

**M3, October 10 (disposable index instrument):** File stat, grouped capture
metadata through persistent ExifTool 13.59, and existence/read/validation of
a trial beside-photo settings document; 33 original files, one first read
and five repeats each. All 33 supplied camera and capture fields. ExifTool
is the temporary R1 tool, not a newly selected or bundled application reader.
The instrument keys camera/capture by `IFD0:Model` and
`ExifIFD:DateTimeOriginal`; grouped conflicting tags remain in the payload.
This does not settle application field precedence.

Instrument layout: SQLite photos rows hold path/file facts, camera/capture,
rating, metadata JSON and optional settings JSON; a separate table holds tags.
Path, rating, camera, capture and tag indexes support paged queries; this
layout is solely a measuring instrument, not the library schema decision.

| Per-photo read | Median, ms | Scope |
|---|---:|---|
| First read through persistent reader | 27.07 | Stat + capture fields + settings existence; no settings on originals |
| Repeated read | 14.79 | Same work, warm reader/file cache |
| Temporary JPEG without settings | 5.04 | Nine repeated reads of a matched copy |
| Same JPEG with today's ZIP/JSON settings | 5.36 | Read and validate current default document; 8,810 uncompressed bytes |

Reader startup was 1.05 seconds once. The matched settings increment was
0.32 ms here; large local-mask documents were not sampled. The whole-file
read means were 42.41 ms first / 15.02 ms warm; projections use these means,
not the median, plus 25% edited photos and actual measured insert time.

Actual synthetic databases use source-backed metadata, two tags per photo
from a 100-tag pool, ratings 0-5, synthetic capture dates, and today's full
default settings JSON on 25% of rows. Each scale was inserted once in batches
of 1,000 with one commit, reopened with an 8 MiB SQLite page cache, then queried.
Amortized insert cost was 0.38-0.47 ms per photo at these scales.

| Photos | Synthetic insert, seconds | Database, MiB | Bytes/photo | Open/query process working / private, MiB | Projected full index, warm-to-first model |
|---|---:|---:|---:|---:|---|
| 10,000 | 3.77 | 36.91 | 3,871 | 78.2 / 94.8 | 2.6-7.2 minutes |
| 50,000 | 19.70 | 184.82 | 3,876 | 83.0 / 99.6 | 12.9-35.8 minutes |
| 200,000 | 94.01 | 740.27 | 3,881 | 85.8 / 102.6 | 51.9-143.2 minutes |

Full index times are extrapolations, not scans of 200,000 real files and not
cold-disk bounds or confidence intervals. They include reader startup,
measured mean read cost, the settings increment and synthetic insert cost;
folder traversal, other disks, network access and process/module startup
are excluded. Memory is the open Python/SQLite instrument after queries,
with the metadata reader shut down; it excludes the app UI, thumbnails,
GPU textures, Grade and simultaneous indexing. Bounded page-cache memory
must not be extrapolated as a linear per-photo RAM charge.

| Warm query median, ms (11 repeats) | 10,000 | 50,000 | 200,000 |
|---|---:|---:|---:|
| Rating filter, first 100 IDs | 0.46 | 0.45 | 0.42 |
| Tag filter, first 100 IDs | 0.47 | 0.46 | 0.43 |
| Camera filter, first 100 IDs | 0.46 | 0.46 | 0.43 |
| Capture sort, first 100 IDs | 0.46 | 0.45 | 0.42 |
| Full-path sort, first 100 IDs | 0.45 | 0.45 | 0.42 |
| Rating + tag, capture sorted, first 100 IDs | 0.52 | 0.71 | 12.05 |
| Exact camera count | 0.61 | 1.29 | 3.80 |
| Fetch 100 rows of file facts/metadata | 0.54 | 0.54 | 0.52 |

The first combined filter/sort query after reopening took 1.48 / 5.59 /
15.87 ms at those scales. Exact rating/tag counts stayed below 1 ms warm;
the camera filter uses the largest sampled camera group. These are paged
index operations, not sorting/materializing every photo into UI memory.

Suggestion for Steve: **200,000 photos is a plausible provisional index
size target** with paged results, given the measured 12 ms combined query
and roughly 740 MiB database. It is not yet a promise for the complete
library UI or every filter distribution. Confirm actual UI/thumbnail and
large-folder behavior before making that promise; first indexing should be
background work. Long tags, many tags, virtual copies, large masks and
unindexed/adversarial queries remain unmeasured. The merged DNG is included
for metadata only; the oversized line-scan exclusion remains.

**M6, October 10 (external refresh/scheduling trial):** A +0.25 EV change
in both lanes remade the gain-map file through the unchanged CPU renderer.
Single-photo medians pool the same 20 observations per edge as M2. Batch work
uses one below-normal process with the shipped helper's thread settings.

| Long edge | Edited remake median, seconds |
|---|---:|
| 1920 | 3.00 |
| 2560 | 4.50 |
| 3840 | 8.79 |

| Remake jobs at 2560 | Median per job, seconds | Observed batch total, seconds | Separate source preparation, seconds |
|---|---:|---:|---:|
| 50 | 4.46 | 214.01 (3 minutes 34 seconds) | 167.94 |
| 500 | 4.45 | 2,130.96 (35 minutes 31 seconds) | 151.24 |

Both batches succeeded completely. These are 50/500 actual render/encode/write
jobs cycling **ten prepared source proxies**, not 50/500 distinct uncached
photos or an implemented library paste command. Preparation holds those ten
reduced sources in RAM and is excluded from the warm batch total; it must not
be read as preparation time for 500 photos. Process working set ended at
about 722 / 726 MiB, with roughly 2.81 GiB peak during full source preparation.
This is an instrument allocation, not the eventual helper/cache policy.

The development Electron app at 2560x1440 graded the real `DSC00264.ARW` on
Steve's **NVIDIA GeForce RTX 4070 Ti** (Windows driver 32.0.16.1692; app adapter
reported NVIDIA Lovelace, not fallback). Preview-file jobs used the Ryzen 5
7600 CPU. Twenty exposure gestures were sampled idle and at batch start;
the 500-job run sampled another twenty every five minutes through minute 35.

| Trial | Idle Grade median, ms (20 gestures) | Grade median under refresh, ms | Under-refresh p95, ms |
|---|---:|---:|---:|
| 50 jobs, initial 20 gestures | 23.10 | 22.38 | 40.12 |
| 500 jobs, initial + seven later samples, 160 gestures | 23.70 | 21.30 | 34.46 |

Medians are calculated from the raw samples, averaging the middle pair for
even counts; p95 uses nearest rank. Wall times include automation and 16 ms
completion polling, not just GPU execution. Later sample medians ranged
20.42-22.83 ms; maximum animation-frame gap within the refresh samples was
24.3 ms, versus 18.1 ms idle. All gestures reached an exact ready presentation.
Differences this small do not establish a speed improvement under load.

Suggestion for Steve: cached exposure-change refresh can run asynchronously
without an observed sustained Grade slowdown in these brief samples; large
pastes still take minutes on this CPU path. Coalescing changes and prioritizing
visible photos deserve implementation trials. This is an equivalent-priority
external process, because F3 has no HDR-preview job yet. It does not qualify
the shipped helper for HDR work or prove the absence of perceptible stutter;
Steve's use remains the feel check. Source preparation responsiveness,
uncached distinct-photo pastes, source redevelopment, large local masks,
export overlap, cancellation and a whole-library refresh were excluded.

**M2/M6 speed follow-up, October 10 (test-only GPU and opening trial):**
The original October 10 CPU measurements above remain the baseline. The same
ten files and thirty-photo set were copied to ignored output. This trial used
the existing NVIDIA Lovelace / RTX 4070 Ti renderer and the unchanged single
Ultra HDR gain-map JPEG encoder. No app path, shader, export/Proof policy,
helper job type, cache limit, project format or visible control was changed.
Normal numerical threading was OpenBLAS 12 with LibRaw OpenMP enabled; the
one-thread profile set the numerical thread environment to 1. Source caches
were disabled for the external runs; storage was warm, not cold disk.

A. Already-opened 2560 build: forty samples per thread setting (ten photos,
two opens and two builds per open). Stage timings below are inclusive:
codec calls overlap the gain-map pipeline and validation, and must not be
added together. Independent medians also need not sum to the total.

| Measured operation | One thread, s | Normal threads, s |
|---|---:|---:|
| Draw HDR + SDR | 1.733 | 1.778 |
| Prepare HDR half-float pixels | 0.198 | 0.201 |
| SDR transfer conversion | 0.238 | 0.240 |
| Base JPEG encode/write | 0.012 | 0.013 |
| Gain-map filtering, JPEG and repack pipeline (inclusive) | 1.473 | 1.483 |
| All codec commands (gain/JPEG, probes, repack) | 1.498 | 1.494 |
| Final output validation (inclusive) | 0.307 | 0.309 |
| Known Python byte writes / final flush | not separately instrumented | 0.028 / 0.001 |
| **Complete build** | **4.477** | **4.531** |

The initial codec combines gain-map calculation and JPEG encoding; those
cannot be separated by this wrapper without modifying the codec. Normal
thread medians were 0.580 s for that fused call,
0.592 s for probe/decode commands and 0.321 s for repacking.
Drawing was about 39% of the build, contradicting the suspicion that it was
most of the cost. Normal threads did not materially shorten file creation.

B. Already-opened GPU builds. Each cell is **unchanged / +0.25 EV**;
each number is the median of two builds of that photo at that size. Drawing
waits for GPU submission completion; readback covers both RGB pictures.
Encode/write includes existing quality settings, gain-map filtering, JPEG
packaging, validation and flushing. Total also includes half-float packing
and bounded loopback transfer; production IPC overhead was not measured.
First proxy upload/warm-up and opening are
excluded here and included in the end-to-end batch below.

| Photo | Long edge | Draw, ms | Readback, ms | Encode/write, s | Total, s | File, KiB |
|---|---:|---:|---:|---:|---:|---:|
| DJI_0071-2.DNG | 1920 | 16.5 / 16.3 | 43.0 / 42.0 | 2.11 / 2.15 | 2.29 / 2.33 | 1660 / 1649 |
| DJI_0071-2.DNG | 2560 | 23.8 / 16.2 | 63.2 / 47.7 | 2.99 / 3.04 | 3.29 / 3.44 | 3095 / 3090 |
| DJI_0071-2.DNG | 3840 | 75.2 / 72.2 | 139.0 / 140.1 | 5.16 / 5.14 | 5.82 / 5.79 | 6988 / 6312 |
| DSC02767.ARW | 1920 | 16.2 / 15.4 | 37.9 / 36.2 | 2.01 / 1.98 | 2.17 / 2.14 | 2005 / 1911 |
| DSC02767.ARW | 2560 | 38.6 / 38.4 | 57.7 / 56.2 | 2.65 / 2.66 | 2.92 / 2.93 | 3484 / 3451 |
| DSC02767.ARW | 3840 | 89.1 / 87.8 | 131.5 / 126.8 | 4.55 / 4.56 | 5.30 / 5.17 | 8173 / 8642 |
| DSC06615.ARW | 1920 | 13.5 / 15.5 | 34.0 / 36.0 | 1.98 / 2.01 | 2.13 / 2.17 | 2034 / 2095 |
| DSC06615.ARW | 2560 | 25.3 / 23.0 | 56.4 / 60.0 | 2.66 / 2.66 | 2.92 / 2.92 | 3535 / 3676 |
| DSC06615.ARW | 3840 | 76.8 / 75.4 | 123.9 / 124.1 | 4.51 / 4.52 | 5.10 / 5.12 | 8002 / 8151 |
| DSC00264_DxO-optical-corr-only.dng | 1920 | 15.9 / 14.7 | 35.5 / 35.2 | 2.06 / 2.06 | 2.22 / 2.22 | 2347 / 2423 |
| DSC00264_DxO-optical-corr-only.dng | 2560 | 41.3 / 40.5 | 59.1 / 59.8 | 2.82 / 2.78 | 3.10 / 3.06 | 4569 / 4700 |
| DSC00264_DxO-optical-corr-only.dng | 3840 | 93.5 / 92.6 | 143.9 / 141.0 | 4.79 / 5.12 | 5.44 / 5.89 | 11768 / 12018 |
| 2L1B8631.CR2 | 1920 | 15.0 / 16.7 | 34.7 / 34.3 | 2.02 / 2.01 | 2.17 / 2.17 | 1381 / 1428 |
| 2L1B8631.CR2 | 2560 | 22.4 / 23.5 | 54.3 / 55.2 | 2.88 / 2.78 | 3.13 / 3.04 | 2407 / 2503 |
| 2L1B8631.CR2 | 3840 | 71.6 / 69.5 | 122.7 / 121.8 | 4.79 / 4.74 | 5.38 / 5.32 | 5715 / 5982 |
| Fujifilm_X-E2S_DSCF6495.RAF | 1920 | 18.3 / 14.0 | 36.1 / 27.4 | 2.18 / 2.03 | 2.33 / 2.18 | 2369 / 2517 |
| Fujifilm_X-E2S_DSCF6495.RAF | 2560 | 44.6 / 43.4 | 59.9 / 57.4 | 2.83 / 2.83 | 3.11 / 3.11 | 4629 / 4848 |
| Fujifilm_X-E2S_DSCF6495.RAF | 3840 | 100.1 / 98.6 | 130.7 / 129.6 | 4.85 / 4.84 | 5.47 / 5.47 | 12007 / 12371 |
| Nikon_D7500_DSC_3931.NEF | 1920 | 13.2 / 15.0 | 32.3 / 33.8 | 2.06 / 2.06 | 2.21 / 2.22 | 4741 / 4760 |
| Nikon_D7500_DSC_3931.NEF | 2560 | 21.0 / 22.6 | 56.3 / 57.3 | 2.86 / 2.88 | 3.12 / 3.14 | 8443 / 8393 |
| Nikon_D7500_DSC_3931.NEF | 3840 | 63.4 / 63.1 | 125.4 / 127.9 | 4.72 / 4.71 | 5.30 / 5.29 | 6146 / 6082 |
| DJI_0071.JPG | 1920 | 15.6 / 15.0 | 36.7 / 39.5 | 2.12 / 2.13 | 2.29 / 2.30 | 2782 / 2810 |
| DJI_0071.JPG | 2560 | 24.8 / 22.8 | 63.4 / 61.6 | 3.02 / 3.05 | 3.31 / 3.33 | 4900 / 4928 |
| DJI_0071.JPG | 3840 | 70.9 / 72.0 | 137.9 / 136.1 | 5.22 / 5.20 | 5.86 / 5.84 | 10894 / 10934 |
| iphone_16_pro_IMG_3324.HEIC | 1920 | 16.2 / 16.9 | 38.4 / 38.7 | 2.09 / 2.09 | 2.26 / 2.27 | 3371 / 3382 |
| iphone_16_pro_IMG_3324.HEIC | 2560 | 38.0 / 37.9 | 66.3 / 63.6 | 2.93 / 2.94 | 3.23 / 3.24 | 5483 / 5492 |
| iphone_16_pro_IMG_3324.HEIC | 3840 | 89.1 / 87.2 | 139.6 / 141.7 | 4.96 / 4.93 | 5.63 / 5.60 | 10853 / 10845 |
| DSC04375_DxO_clipped_target.tif | 1920 | 14.7 / 14.5 | 34.8 / 35.3 | 2.08 / 2.04 | 2.23 / 2.20 | 2013 / 1949 |
| DSC04375_DxO_clipped_target.tif | 2560 | 21.0 / 21.3 | 55.2 / 54.8 | 2.82 / 2.75 | 3.07 / 3.00 | 3469 / 3345 |
| DSC04375_DxO_clipped_target.tif | 3840 | 56.4 / 55.1 | 116.5 / 116.5 | 4.66 / 4.65 | 5.22 / 5.21 | 7519 / 7244 |

Across the ten photos the unchanged 2560 medians were 25.4 ms
drawing, 58.8 ms readback, 2.86 s encoding/writing,
and **3.12 s total**. The existing gain-map guided filter alone took
0.70 s; all Pillow JPEG saves took 0.032 s
(codec JPEG work is additional). The GPU makes drawing fast; the file still
takes seconds. Unchanged GPU-versus-CPU pictures had HDR relative mean
absolute error up to 0.039% and SDR mean code error
up to 3.20/255. This uses the existing preview approximation,
not an exact CPU Proof result. No tolerance was changed.

C. Opening candidates: two samples per shortcut per photo. **Early** reduces
the decoded image before negative-gamut mapping, automatic exposure and HDR
analysis. **Half** also uses LibRaw half-size and reduces camera RGB before
color conversion and Lensfun; native CFA highlight repair is preserved.
Both are compared against a full open reduced directly to the same size.
SDR errors are absolute 8-bit code differences; HDR error is mean absolute
linear error divided by mean absolute full-reference HDR value.

| Photo | Full open, s | Candidate | Open, s | Long edge | SDR mean / p99 code error | HDR relative mean error, % |
|---|---:|---|---:|---:|---:|---:|
| DJI_0071-2.DNG | 86.01 | early | 82.68 | 2560 | 0.001 / 0 | 0.000 |
| DSC02767.ARW | 7.69 | early | 6.38 | 2560 | 0.052 / 1 | 0.208 |
| DSC02767.ARW | 7.69 | half | 1.85 | 2560 | 2.153 / 13 | 2.706 |
| DSC06615.ARW | 7.57 | early | 6.38 | 2560 | 0.001 / 0 | 0.000 |
| DSC06615.ARW | 7.57 | half | 1.92 | 2560 | 4.178 / 21 | 3.593 |
| DSC00264_DxO-optical-corr-only.dng | 11.36 | early | 8.95 | 2560 | 0.000 / 0 | 0.487 |
| 2L1B8631.CR2 | 4.79 | early | 4.22 | 2560 | 0.000 / 0 | 0.000 |
| 2L1B8631.CR2 | 4.79 | half | 1.99 | 2560 | 1.444 / 13 | 0.754 |
| Fujifilm_X-E2S_DSCF6495.RAF | 3.26 | early | 2.82 | 2560 | 0.131 / 3 | 0.082 |
| Fujifilm_X-E2S_DSCF6495.RAF | 3.26 | half | 0.75 | 2467 | 7.875 / 45 | 11.768 |
| Nikon_D7500_DSC_3931.NEF | 2.50 | early | 2.04 | 2560 | 0.000 / 0 | 0.000 |
| Nikon_D7500_DSC_3931.NEF | 2.50 | half | 1.04 | 2560 | 1.884 / 9 | 1.698 |
| DJI_0071.JPG | 8.21 | early | 1.85 | 2560 | 0.137 / 2 | 0.056 |
| iphone_16_pro_IMG_3324.HEIC | 4.77 | early | 3.03 | 2560 | 0.000 / 0 | 0.001 |
| DSC04375_DxO_clipped_target.tif | 1.90 | early | 1.06 | 2560 | 0.000 / 0 | 0.000 |

The selected browsing candidate uses half-size only when its output reaches
2560, otherwise early reduction. Fuji half-size was only 2448 and had much
larger detail error; it was not used in the batches. Linear DxO DNG and
mandatory-opcode DNG retain their existing decode/correction route. Automatic
exposure shifts were at most 0.007 EV in the selected ten-file comparisons.
Review sheets are in `codebase/output/library-speed-trial/compare-*-*.jpg`:
full on the left, shortcut on the right. DJI DNG/JPEG, both Sony half-size
sheets and Fuji early were visually reviewed. They preserve the broad
picture at browsing size; half-size changes fine detail and corrected edges.
These small SDR sheets and numerical HDR comparisons do not qualify every
camera, grade or HDR display. Nothing is adopted.

Opening-stage CPU times below pair the four size-eligible camera RAWs
(both Sony files, Canon and Nikon), with eight samples per column. These are
diagnostic medians, not additive totals. No equivalent GPU import operation
was found: existing grading/scopes/geometry routines are not interchangeable
with the loader's camera matrix, CFA repair, exposure quantiles, bounded
reduction or DNG opcode semantics. GPU grading is used in every batch.

| Opening operation | Full-size CPU, ms | Candidate CPU, ms | Existing GPU replacement / rough new work |
|---|---:|---:|---|
| Unpack/transport and other decode work | 797.4 | 370.6 | None; keep file unpacking on CPU |
| Demosaic | 574.0 | 73.7 | None; large camera/CFA kernel and qualification work |
| Native mosaic highlight reconstruction | 559.8 | 547.0 | None; large neighborhood/chrominance port |
| Camera color / remaining RAW corrections | 433.2 | 78.5 | Grading color matrices exist, not arbitrary camera import; small matrix-pass integration |
| Lensfun correction | 2092.1 | 282.3 | None; medium coordinate-map sampling integration |
| Negative-gamut mapping | 463.3 | 57.6 | None for this import boundary; small pixel-operation port |
| Automatic exposure | 9.2 | 4.7 | GPU scope/peak analysis exists, not this meter; medium percentile integration |
| HDR source classification | 557.0 | 130.8 | GPU scopes exist, not loader classification; medium analysis integration |
| Reduction | 436.8 | 212.1 | GPU geometric sampling exists, not bounded Lanczos import reduction; medium integration |

A separate timing-only, cell-aligned CFA decimation probe at 1868-2466 long
edge measured highlight reconstruction at 11.8-68.4 ms. It was never used
to produce a preview: decimating CFA cells needs its own quality trial and
does not justify replacing native reconstruction. Color/WB and mandatory
DNG operations remain CPU import work; a generic preview-size color-matrix
port is small, while exactly-once DNG warp/gain-map handling is a larger job.
With half-size demosaic around a tenth of a second, a new GPU demosaic trial
looks less urgent than native highlight work, lens/DNG correction and the
roughly 0.7-second gain-map filter. These are engineering scope estimates,
not implementation commitments.

D. DJI_0071-2.DNG: two profiled full opens per thread setting and two actual
development-app opens of fresh copied paths in a disposable app profile,
with default cache settings. The app measurements include reaching exact ready.

| DJI open | Median, s |
|---|---:|
| External full, one thread | 87.56 |
| External full, normal threads | 86.01 |
| Normal app, two opens | 91.76 |
| Mandatory rectilinear warp, normal profile (inclusive) | 77.86 |
| Mandatory gain-map opcode, normal profile (inclusive) | 4.40 |

Actual app opens were 87.34 / 96.19 s.
The full-resolution mandatory DNG rectilinear warp dominates, particularly
bicubic coordinate weights and sampling. This is a real import bottleneck,
not explained away by one thread or the earlier low-priority instrument.
It was identified and left unchanged; fixing it is a separate decision.

End-to-end at 2560, real GPU draws/readback and the same JPEG format:

| Run | Total, s | Earlier CPU baseline, s |
|---|---:|---:|
| 30 distinct, sequential opening + build | 415.20 | 597.95 |
| Same 30, four concurrent CPU opening workers + sequential GPU/file builds | 244.59 | not previously measured |
| 50 cached-source +0.25 EV remakes while Grade is used | 173.33 | 214.01 |

The four-worker experiment includes unpacking, reconstruction and all later
CPU opening work concurrently, plus temporary reduced-array writes, worker
startup and loading those arrays. It does not isolate unpacking concurrency
alone. GPU/file builds remain sequential; normal thread settings are used.
It changed the measured thirty-photo total by -41.1%.
Each batch starts fresh with source caching disabled. First GPU proxy uploads
are included. Cached-source preparation is outside the 50-remake timer;
initial GPU source uploads and later reuse are inside it.

| Grade exposure gestures | Median, ms | p95, ms | Largest RAF gap, ms |
|---|---:|---:|---:|
| Idle | 22.58 | 34.85 | 15.5 |
| During GPU preview remakes | 29.70 | 48.19 | 24.3 |

Twenty gestures per condition used the same exposure sequence and 16 ms
completion polling as the earlier instrument, on DSC00264.ARW at a
2560x1440 Electron window. Preview work used a second GPU device in the same
renderer process as Grade. Sampling occurred once at batch start and the
batch was still active afterwards; no sustained or whole-library claim is
made. All sampled gestures reached exact ready. Steve's use remains the
feel check, especially for brief upload/readback stalls.

Excluded as before: local masks, denoise changes, virtual copies, network
drives, cold disk, export overlap, oversized line-scan DNG and unsupported
merged HDR DNG. Also excluded: new GPU import/codec shaders, a reduced-CFA
quality pipeline, saved project recipes/complex edited grades, queueing,
cancellation, cache policy, other GPUs, Grade during concurrent opening,
sustained interaction sampling and
the 500-job repeat. Only the ten representative files got shortcut picture
comparisons; the extra twenty test throughput, not per-camera qualification.

Suggestion for Steve: **prepare-ahead remains the safer choice for stored
HDR library files on this measured route**. A simple switch would need to
show SDR placeholders and fill HDR progressively, with seconds of waiting
per photo and much longer for these DJI DNGs. That trades simpler controls
for incomplete/stale HDR views while work catches up; prepare-ahead trades
an explicit preparation step for more predictable viewing. GPU drawing is
fast and preview-size work helps opening, but neither normal threading nor
GPU drawing makes the unchanged file encoder instantaneous. No preview
format, pipeline, cache or UX decision is adopted by this trial.

**M2/M6 quick-open trial, October 10 (test-only, no adoption):**
At 1600 pixels, six concurrent opens presented **7.01 camera RAW photos/s
in SDR and 7.13 in HDR**. The full 29-file corpus reached 8.10 / 8.17 photos/s
because its ten linear DNGs used their embedded JPEG, not their linear pixels.
This is a switched-off driver/helper, not a library implementation. Grade,
CPU export, Proof, pinned shaders, limits, project format and shipped cache
policies are unchanged. Tests ran in development Electron at 2560x1440 on the
existing NVIDIA Lovelace adapter. Disk was warm. No pixels were written to disk
between source request and presentation; PNGs were saved only for comparisons.

1. **Request to screen, ms.** One fresh-source sample per file per lane, with
new test source identities and no persistent source cache. Prefetched means
prepared in helper RAM, then uploaded anew; it does not mean already GPU-resident.
Completion waits for GPU submission and two animation frames, a compositor
opportunity rather than a physical display scanout timestamp. The initial
camera-DNG SDR frame includes shader warm-up (2,349 ms total); the resumed
TIFF comparison also starts a new renderer (2,371 ms SDR, 1,760 ms in draw).
Batch rates below
use already-initialized shaders. Single-file formats have one sample, so their
median and worst are the same. All totals include transport and frame waiting.

| Format | Fresh SDR median / worst | Fresh HDR median / worst | Prefetched SDR median / worst | Prefetched HDR median / worst | SDR CPU quick / upload / GPU color / draw medians |
|---|---:|---:|---:|---:|---:|
| ARW | 436 / 533 | 428 / 509 | 73 / 85 | 73 / 79 | 360.1 / 47.6 / 6.4 / 11.1 |
| CR2 | 557 / 588 | 557 / 582 | 73 / 73 | 70 / 70 | 488.0 / 46.1 / 6.4 / 11.4 |
| NEF | 497 / 497 | 490 / 490 | 71 / 71 | 73 / 73 | 423.0 / 47.9 / 6.3 / 10.1 |
| RAF | 284 / 284 | 264 / 264 | 73 / 73 | 79 / 79 | 190.2 / 62.3 / 6.6 / 11.1 |
| Camera DNG | 1464 / 2349 | 613 / 640 | 73 / 79 | 77 / 79 | 506.7 / 56.5 / 5.9 / 887.0 |
| Linear DNG (JPEG) | 319 / 335 | 312 / 328 | 72 / 79 | 71 / 79 | 247.4 / 45.5 / 6.6 / 11.4 |
| JPG | 408 / 408 | 317 / 317 | 67 / 67 | 91 / 91 | 321.2 / 53.3 / 9.4 / 16.7 |
| HEIC | 2262 / 2262 | 2263 / 2263 | 61 / 61 | 79 / 79 | 2162.6 / 49.8 / 0.0 / 13.5 |
| TIF | 2371 / 2371 | 610 / 610 | 68 / 68 | 73 / 73 | 535.8 / 54.2 / 6.0 / 1759.7 |

CPU quick includes header/unpack, half-size demosaic, resizing, sampled meter
and peaks, and half-float packing. Independent stage medians need not sum.
RAW uses a separate LibRaw half-size linear demosaic with clipped highlights.
The ordinary camera route retains Grade's camera scale/WB/matrix; unsupported
camera-bridge DNGs use LibRaw camera-WB linear sRGB. The GPU applies WB/matrix,
transfer decoding and negative-gamut mapping, then the existing GPU grade.
CPU bilinear reduction before upload keeps transfer small. No lens, highlight
reconstruction, denoise or DNG corrective opcodes run on the quick route.
A serialized global-grade fixture adds +0.25 EV in both lanes. Real saved
project loading and complex saved recipes were not qualified by this instrument.

2. **End-to-end photos/s**, counting each GPU-completed/compositor-ready picture:

| Corpus / lane | 1 open | 4 opens | 6 opens |
|---|---:|---:|---:|
| 19 camera originals / SDR | 2.46 | 5.63 | 7.01 |
| 19 camera originals / HDR | 2.53 | 5.78 | 7.13 |
| Full 29 / SDR | 2.88 | 7.11 | 8.10 |
| Full 29 / HDR | 2.91 | 6.97 | 8.17 |

3. **Hand-over and size.** In the six-open camera SDR batch, helper-to-GPU upload
was 57.5 ms median at 1600; GPU source color conversion took another 13.6 ms and
drawing 22.3 ms. At 960 these were 25.4 / 5.5 / 8.2 ms and throughput increased
from 7.01 to 8.94 photos/s. Median packed fit picture: 13.28 MiB (row-padded
RGBA16F); 960: 4.92 MiB; thumbnail: 384 KiB. These are transfer-buffer sizes,
not a proposed cache budget. A prefetched 1600 picture generally took about
70-85 ms to upload, grade and reach a presentation opportunity. Initial opens
are dominated by CPU preparation; after parallel opening, transfer and drawing
become a substantial part of the remaining time.

4. **HDR cost.** The same inputs are used for both lanes. HDR uses the existing
HDR grade and rgba16float presentation surface instead of SDR bgra8unorm.
It needs no extra source open, readback, gain-map encoder or stored file.
The measured rate difference was small; this run does not establish a hardware
scanout/monitor luminance result. Embedded JPEG linear-DNG previews retain only
their SDR information: an HDR canvas cannot restore the missing linear headroom.

5. **Grid and placeholder.** Thirty distinct source paths (the 29 plus DJI JPEG),
new helper results, six opens, 256-pixel graded SDR thumbnails: first 113.9 ms,
all 2,141.4 ms. Camera embedded-JPEG first-picture samples at 1600 were 157.7 ms
median / 198.4 worst, including GPU grade/presentation. RAW replacement timings
are the fresh-source table. These two moments were measured separately, not as
a combined placeholder-then-replacement scheduling policy.

6. **Grade interaction.** Same DSC00264.ARW exposure sequence as before: twenty
gestures per condition, exact-ready generation completion, 16 ms polling.
Background work used six quick-open threads and a second GPU device in the
same renderer, with all 29 sources reopened in each of eight rounds. The helper
was normal priority (a conservative test, not the shipped helper scheduler).

| Condition | Gesture median, ms | p95, ms | RAF p95 / max gap, ms |
|---|---:|---:|---:|
| Idle | 19.32 | 27.53 | 6.1 / 18.2 |
| Busy | 20.41 | 41.09 | 12.1 / 24.3 |
The batch was still active after sampling, with 1 pictures presented.
All sampled Grade gestures reached exact ready. Steve still needs to judge the
feel; this is one beginning-of-batch sample, not sustained interaction evidence.

7. **Picture difference.** Grade left, quick right; SDR top and HDR bottom in
each linked image. These PNGs are SDR screen captures and clip HDR values; they
do not preserve HDR luminance. Numbers use linear GPU picture readback: SDR
8-bit sRGB mean / p99 absolute code error, and HDR mean absolute linear error
divided by mean absolute Grade HDR. Where dimensions differ, quick pixels are
nearest-sampled to reference dimensions; no geometric registration hides the
correction differences. These are look differences, not shader accuracy checks.

| Photo / local image | SDR mean / p99 code error | HDR relative mean error, % |
|---|---:|---:|
| [DJI_0071-2.DNG](../../codebase/output/library-quick-open-trial/00-DJI_0071-2.DNG.png) | 16.106 / 46 | 15.803 |
| [DSC02767.ARW](../../codebase/output/library-quick-open-trial/09-DSC02767.ARW.png) | 11.969 / 78 | 28.599 |
| [DSC06615.ARW](../../codebase/output/library-quick-open-trial/14-DSC06615.ARW.png) | 13.097 / 49 | 9.757 |
| [DSC00264_DxO-optical-corr-only.dng](../../codebase/output/library-quick-open-trial/02-DSC00264_DxO-optical-corr-only.dng.png) | 18.445 / 67 | 46.290 |
| [2L1B8631.CR2](../../codebase/output/library-quick-open-trial/24-2L1B8631.CR2.png) | 6.925 / 34 | 12.899 |
| [Fujifilm_X-E2S_DSCF6495.RAF](../../codebase/output/library-quick-open-trial/26-Fujifilm_X-E2S_DSCF6495.RAF.png) | 5.082 / 29 | 7.027 |
| [Nikon_D7500_DSC_3931.NEF](../../codebase/output/library-quick-open-trial/27-Nikon_D7500_DSC_3931.NEF.png) | 1.517 / 7 | 0.959 |
| [DJI_0071.JPG](../../codebase/output/library-quick-open-trial/29-DJI_0071.JPG.png) | 0.452 / 5 | 0.469 |
| [iphone_16_pro_IMG_3324.HEIC](../../codebase/output/library-quick-open-trial/30-iphone_16_pro_IMG_3324.HEIC.png) | 2.125 / 17 | 2.788 |
| [DSC04375_DxO_clipped_target.tif](../../codebase/output/library-quick-open-trial/31-DSC04375_DxO_clipped_target.tif.png) | 0.384 / 4 | 0.448 |

Quick pictures omit corrected geometry and highlight recovery. DJI shows both
geometry/color changes; the linear DxO DNG JPEG has a baked camera rendering
and lost HDR latitude. The same automatic exposure meter is retained on a
256-edge CPU sample (about 1.4 ms median); sampled source peaks cost about
18 ms instead of full preview classification. The badge is not needed to draw.
Brightness is close for Sony/Fuji/Nikon (meter EV differences 0-0.004), but this
**does not fully meet exact Grade brightness matching**: Canon differs by
0.245 EV and DJI by 0.458 EV; removing corrections/reconstruction and using the
LibRaw DNG color route changes the metered source. Do not adopt this as a
Grade-identical preview. The TIFF keeps Grade's unresolved color interpretation
without inventing a profile; it is not color-qualified. HEIC retains its
gain-map HDR reconstruction and authored SDR reference, so its approximately
2.3-second decode is still expensive. JPEG uses reduced libjpeg decode; TIFF
and HEIC use their existing decoders, followed by early trial reduction.

Context comparison: the bare-memory six-thread 13.2 camera photos/s was **not**
reproduced end to end (7.01/7.13). This is a different endpoint and includes
resizing, metering/packing, IPC, GPU preparation/grading and presentation waits.
The faster mixed-corpus rate uses JPEGs for linear DNGs and does not contradict
the approximately 2-second linear-pixel decode benchmark. No new bare-decoder
measurement here contradicts Claude's timings. The 2.3-second first SDR frame
is GPU warm-up, not a return of the DJI correction warp.

Excluded: local masks, virtual copies, network drives, cold disk, export
overlap, oversized line-scan DNG, unsupported merged HDR DNG, other GPUs,
full linear-DNG HDR decoding, persistent cache/store policy, real saved-project
loading, combined placeholder/replacement scheduling and sustained gestures.
Uncompressed 42 MP Sony files are 82 MB each; a slow disk would cap the rate
before the processor. The final measurement ran without fast-test contention.
Exploratory bulk-prefetch had a failed bridge request (cause not isolated);
final per-photo prefetch completed. The TIFF initially refused unknown color
metadata and was repaired to mirror Grade's existing unresolved interpretation.
Validation: 438 Node tests passed; 1,588 pytest passed, three skipped; measure,
ten-photo compare and interaction drivers completed sequentially in Electron.
Reproduce from codebase: set HDR_FINISHER_ELECTRON_WINDOW_SIZE=2560x1440, then
run `node tests/run-in-electron.js tests/performance/photo-library-quick-open-trial.js`
with `--mode measure`, `--mode compare`, or `--mode interaction` (one at a time).

Suggestion for Steve: **quick RAW browsing is feasible; replacing every stored
HDR preview is not established**. The one decision is whether the Library may
show this approximate quick picture, including a baked SDR JPEG for linear
DNGs, in exchange for immediate browsing without preparing files. If it must
match Grade's brightness/corrections and preserve linear-DNG HDR, keep stored
previews for those cases. Nothing is adopted by this trial.

**T1, October 10 (trial entirely outside the app):** Temporary copies of
Canon CR2, Fuji RAF and DJI JPEG were saved beside today's project document,
closed and reopened. Three grade changes 50 ms apart used a trial 500 ms
debounce; leaving cancelled the timer and saved immediately. Reopening
verified the final grade after both saves, with no duplicate delayed save.

| Temporary copy | Repeated save median, ms | Project file, bytes | Last change to completed debounced save, ms |
|---|---:|---:|---:|
| Canon 5D III CR2 | 5.86 | 2,435 | 508.9 |
| Fujifilm X-E2S RAF | 5.34 | 2,346 | 513.6 |
| DJI JPEG | 5.13 | 2,343 | 514.7 |

Each median covers nine saves, including the debounced and leaving saves.
First-save single observations were 132 / 28 / 17 ms respectively, including
initial source-fingerprint work; they are not medians. Existing serialization,
normal reopen, source verification and temporary-file/replace saving worked
unchanged. Today's document is a ZIP containing JSON; this trial does not
choose plaintext JSON, an ending or the final beside-photo file format.

Moving each temporary folder exposed the existing absolute source link:
the unchanged opener requested relinking even with the photo beside it.
A trial-only sibling resolver supplied that photo through the existing
explicit-source opener and kept fingerprint verification. Debounce, timer
cancellation and leaving flush are also external trial code; the app's gate
and autosave UI are not implemented or changed. Suggestion: the steady save
cost supports a short debounce, provided the eventual sibling lookup and
leaving/error handling are designed. Read-only folders, concurrent writes,
large local masks, crash/power-loss durability and disk-full errors were
excluded; this is not a guarantee of their behavior.

Reproduce from `codebase` with the `.venv` Python and
`tests/performance/photo-library-remaining.py` in `matrix`, `index`, `trial`
and `bulk --count 30 --result m2-screen-30.json` modes. The index mode accepts
`--exiftool <temporary-exe>`; the earlier corpus is required. Run the M6 driver
sequentially with `node tests/run-in-electron.js` followed by
`tests/performance/photo-library-refresh-interaction.js --count 50` and then
`--count 500`, with `HDR_FINISHER_ELECTRON_WINDOW_SIZE=2560x1440`.
Both scripts are committed instruments; raw JSON/logs/databases and temporary
copies stay in ignored `codebase/output/library-measurements/remaining`.

Validation: 438 JavaScript and 1,588 Python fast tests passed (3 Python skips).
Both focused M6 Electron trials completed successfully,
sequentially at the required window size. All ten M2 cases, 33 metadata reads,
three synthetic index sizes, 30 distinct screen previews and three T1 trials
completed. An earlier redundant full-decode probe hit its case timeout; the
reported cold measurements instead use explicit load/build components.
The interaction driver's initial Windows path escaping was corrected before
both successful trials. No application/export/Proof/shader code was changed.

**Status, October 10:** M2/M3/M6 CPU/instrument baselines and T1 are recorded;
GPU library-preview building and the complete library UI still need
implementation-specific trials. All defaults
and size targets above are suggestions for Steve. No reader, schema, format,
preview pipeline or cache budget is adopted, and no visible behavior changes.

The top menus (File, Edit, View, Window) need no mock-up
(Steve, October 10); their contents follow from the commands in section 5
and are listed in the build brief.

The wireframe for the views in 5.3 is the mock-up in
`docs/product/library-wireframes`.

---

## 8. Build order

**Slice 1, Stage A — October 10 implementation:** the main window now opens
on Library. Add folder accepts several folders; pins persist using the
existing preferences store. Pins expand lazily, and clicking a folder lists
supported photos recursively. Grid and filmstrip render only visible cells;
off-screen requests are cancelled. The size slider, single view, next/previous
read-ahead, collapsible rails and F/Escape full-screen review work. Enter or
a thumbnail double-click opens through the existing Grade leave gate. File >
Open Image and the Library's Open image button still open unpinned files.

Validation: 440 JavaScript tests and 1,594 Python tests passed (three
existing Python skips); the
focused 2560×1440 Electron driver checks a disposable 3,001-photo folder,
cache reuse, actual drawn pixels, folder picker, grid scroll, filmstrip,
arrows, review, Grade opening and Cancel/Discard through the shared policy.
The driver supplies deterministic dialog choices; it does not claim a new
native-dialog audit. It also draws disposable copies of real ARW, linear
DNG and HEIC through the docked page. A read-only format probe covered Sony/Canon/Fuji/Nikon/
DJI RAW, linear DxO DNG, HEIC, AVIF, TIFF, EXR and JPEG. Its linear DNG import
failure was fixed and covered by a regression check that forbids Grade's
corrected decoder. The tests changed no originals or existing sidecars.

**October 10 follow-up after Steve's first use:** picture requests now run
through a cancellable priority queue with four active requests, reserving
browser connections for pixel delivery and navigation. Previously, many
slow visible-photo requests blocked even the first ready picture's pixels;
the diagnostic saw a 40.9-second wait for their delivery. The focused
read-only real-folder check now requested the first pixels at 0.9 seconds
and finished the first picture at 1.4 seconds, while other photos remained
queued. Helper startup also runs outside the backend event loop. These are
observations on the checked folder, not a promise for every source or drive.

Add folder again lists file names, sizes, types and dates, with a selected
photo preview through the existing browser thumbnail endpoint. Folder
multi-selection remains separate from photo previewing. Its list and
places sidebar scroll inside a bounded dialog. File rows and preview styles
reuse the existing browser; arrows and collapse controls use the shared
colour, icon-size and button tokens. The Library page now versions its
assets like the main page to prevent stale scripts and styles.

Follow-up validation: 444 JavaScript tests and 1,594 Python tests passed
(three existing skips). The focused Electron check additionally covers
file previews, mouse-wheel scroll, Ctrl multi-folder selection, tokenized
icons, fresh asset URLs and real-folder first-picture delivery. Its first
attempt stopped because the test inspected pins before refreshing them;
the corrected setup passed without changing the product behavior or checks.

Still to judge in use: responsiveness on Steve's actual large shoots,
quick colour/brightness, decoder waits where no embedded picture exists,
and the basic file facts in the details rail. Every Grade source extension
is routed, but the format probe is representative rather than exhaustive.
Stage A has no Library CPU fallback. The picker’s Ctrl/Shift multi-folder
selection follows the mock-up and can be adjusted after Steve tries it.
Stage C additions are recorded below.

**Slice 1, Stage B — October 10 implementation:** the grid and filmstrip
support click, Ctrl-click, Shift-click, Shift-arrows, Ctrl+A and box selection.
Ratings, picks/rejects, colour labels and tags act on the whole selection.
Marks occupy a separate strip beneath pictures. The shared stylesheet now
contains the mock-up's dedicated yellow-star and red/orange/green/blue label
tokens, also documented in the design guidelines.

Shortcuts follow the mock-up: 0–5 for stars, P/X/U for pick/reject/unmarked,
6–9 for colour labels (repeating a colour clears it), T for tags and Ctrl+Z
for undo. The Details rail supplies the same controls. Tag suggestions are
ordered by use count; arrows and Enter choose one, or Enter creates a tag.
A dashed partial-tag chip adds that tag to all selected photos; its x removes
it from the selection. These proposed mock-up interactions remain open to
Steve's review. The Tags and Labels management window is not included.

Marks save through backend commands without touching Grade's edit document
or leave gate. `library.sqlite3` in the existing app data area is an index
with one writer; pins and preferences retain their existing stores. Each
first mark creates a plain UTF-8 `.hdrf` settings document beside the photo,
with format `HDR Finisher Photo`, schema 1, a stable photo ID, a relative
source filename and marks. It contains no image pixels. Whole-file atomic
replacement preserves other settings fields. A malformed or newer sidecar
is reported and blocks marking that selection; it is never overwritten.
Unmarked browsing creates no sidecar or database. Existing sidecars rebuild
the visited portion of a deleted database as folders are opened again.

A command records its new marks in the database before attempting sidecars.
Failed writes remain pending in the database and are shown in the Details
rail and status line; stale sidecars cannot discard them on restart. Such
marks cannot be recovered from sidecars if the database itself is deleted.
Undo restores a whole bulk command in one step; the latest 100 culling
commands are retained during the backend session. Grades and original photos
are never rewritten by these commands.

Validation: 447 JavaScript tests and 1,610 Python tests passed (three existing
skips). New data checks cover atomic failures, bulk undo, reconstruction,
read-only write failures, sidecar protection and concurrent command ordering.
The focused Stage B Electron check uses only disposable copies and covers
marks, suggestions/partial tags, every selection method, single view, review
and reload persistence. The Stage A check covers the existing 3,001-photo
virtual grid, real formats, first-picture delivery and Grade Cancel/Discard.
A review-found edge case now selects the next readable photo when an
unreadable first file is hidden.

**Slice 1, Stage C — October 10 implementation:** sort by capture time,
file name, rating, pick status or file type in either direction. The grid
starts by name; capture dates arrive in small low-priority helper batches
using the existing `exifread` dependency, without decoding photos or adding
a reader. Missing or unreadable dates stay last, ordered by name. Sorting
preserves the selected photo. The Filter bar combines minimum rating, pick
status (including hide rejected), colour label, file type and file-name/tag
search; RAW only is available directly on the toolbar. Clear removes all
filters. These basic controls reuse shared buttons, selects and colour
tokens. The full + Filter rule builder remains a later slice.

H or HDR switches visible grid, filmstrip, single and review pictures.
Scene caches are reused; the switch does not request a new photo decode.
Pictures now render directly into WebGPU canvases, preserving the existing
renderer’s Display P3 float16 extended HDR surface instead of copying
through an ordinary SDR canvas. The Library HDR starting look targets
1000 nits. Displays without HDR support use the renderer’s SDR surface.
Physical brightness and comfort remain for Steve to judge on his display.

Click the single/review picture, press Z, or use 100% to enter native zoom.
Drag pans; arrows retain zoom and normalized position across photos. Click
or Z returns to fit. One source pixel maps to one display pixel, accounting
for display scaling. The reduced picture remains enlarged while native
pixels arrive. Full RAW demosaic is requested only for zoom and uses the
same quick Library route without Grade’s corrections. Fit and native views
share the same starting look. Only the visible crop is uploaded and graded
on the GPU; native requests are cancelled when superseded.

The helper retains one decoded native source for panning and drops it on
photo replacement or when Grade/export pauses Library work. Native crop
files share the existing 2 GiB cache and eviction policy. A crop is bounded
to 4096 pixels per dimension; unusually larger physical viewports retain
the enlarged browsing picture outside that crop. The first native decode
can take time, and retaining one large source adds helper RAM usage. It is
not a second full-resolution GPU image. Preview cache version 2 adds source
dimensions; earlier disposable cache entries can be regenerated. Projects,
original photos, sidecars, Grade opening, export, Proof, shaders and pinned
rendering limits are unchanged.

**Loading feedback:** the empty grid says “Reading folder…” while its scan
is pending, then reports an empty/read error or no filter matches accurately.
The Add folder picker’s directories-first ordering is covered explicitly.
Whether Steve also wants folder tiles ahead of photos in the recursive grid
is awaiting his clarification; no such tiles are claimed here.

Validation: 452 JavaScript checks and 1,616 Python checks passed, with the
same three existing skips. Focused Electron checks at 2560×1440 cover
loading feedback, folder-first picker rows, sort direction, combined filters,
HDR switches without decoding again, native click/Z zoom and panning,
retained zoom on flips and review, and Stage B culling/restart behavior.
Native zoom also drew disposable copies of 42 MP ARW/linear DNG and HEIC;
original photos were not modified. During development an EXIF test fixture
needed its tag placed in the correct EXIF directory, and a test edit’s text
encoding was corrected; neither check was removed or loosened.

**October 10 follow-up — folder navigation and Slice 2 window:** the Add
folder picker remembers the list scroll position for each folder visited during
that dialog session. Returning with Up restores that position after the parent
rows arrive. Right-click a folder in the picker or the pinned tree to pin or
unpin it; Shift+F10 also opens the menu, and Escape dismisses it. Right-click
the pinned-list background to Add folder. The menu uses the existing window
menu styles and design tokens. Unpin removes only the saved shortcut, including
for offline folders; it does not delete or move anything.

Slice 2 has started with **Pop out** on the Library toolbar. The separate
Library window reuses the same page and backend, has native window controls,
and retains independent saved bounds. The docked page pauses its requests
while detached. Folder, selected photo, multi-selection, sort, filters,
thumbnail size, grid/filmstrip scroll, collapsed rails and fit/native zoom
position transfer between windows. Closing with X or Dock Library returns
to the docked Library. Review exits before popping out; F11 and Review work
in the separate window. The window receives its own display-change events.
Physical HDR behavior across two different monitors still needs Steve's test.

With a photo already open, popping out switches the main window to Grade;
otherwise the main window shows a Show Library button until a photo is opened.
Opening a photo from the separate window uses the existing source grant and
main-window unsaved-photo gate. Main still owns app shutdown. UI state is
transferred within the running app; app restart starts in the docked Library.
Background indexing, the fuller metadata panel, full filter rules, tag
management and albums are still outstanding in Slice 2.

Validation: 452 JavaScript checks, 22 desktop checks and 1,616 Python checks
passed (three existing skips), plus the new offline-unpin backend check.
Focused disposable Electron checks cover parent scroll restoration, modal
pinning, tree unpinning, Escape, window state transfer, the paused docked page,
docking with the button and X, saved bounds and untouched source files.
Driver setup fixes were needed for Electron module resolution, iframe startup,
initial picker loading and the keyboard target. The existing secondary-window
source-handoff check also passed its original Cancel/Discard assertions after
its obsolete Import-button startup wait was updated to the current Library.
No checks were loosened.

**Slice 2, remaining parts — October 10 implementation:**

*Background indexing.* Pinned folders are indexed in the background, on by
default, including folders never opened. It starts when the Library first
loads, after a folder is pinned, and on request. Folder walks and camera
details run in the helper on a lane of their own, which stops between files
whenever visible Library work is queued or Grade/export has paused the
helper. The backend stays the only database writer. A pass records each
file's size, date and camera details, and reads existing `.hdrf` files, so
marks, tags and albums in unvisited folders are known. Unchanged files are
not read again. The bottom bar shows progress at its right edge; a click
offers Pause/Resume, Re-scan pinned folders now, and turning background
indexing off or on. Not built: watching folders for changes (re-scan is at
start, on pinning and on request), processor-use and battery settings,
leaving out chosen pins, the Settings page, and dimmed offline thumbnails.

*Details panel.* One selected photo shows type, size, capture time and its
albums, then a six-line camera summary. Show all swaps it for File, Camera,
Lens, Exposure, Location and "Written by the camera"; the choice is not
kept between launches. A value the file does not record shows "Not
recorded", an unidentified lens "Unknown", and details not yet read
"Reading…". Nothing is guessed. The File group says whether a settings file
exists. The reader is still today's ExifRead without maker notes (open
decision 15), so lens names can be missing for some brands and there is no
Focus and drive group. Not built: Set name for an unknown lens, title and
caption, and the authoring template (slice 8).

*Filter bar.* "+ Filter" lists Camera, Lens, ISO, Focal length, Aperture,
Shutter speed, Capture date, File type and Tag. Choice fields offer the
values found in the photos on screen with counts; ISO and date take a
number or a range. Each rule can be "is not". Rules show as chips; a click
removes one. With two or more, Match all / Match any appears. Sort gained
Date modified. State, virtual copy and linked wait for their slices, as
does Save as smart album (slice 6); the rule format is ready for it.

*Tags and Labels window* (Manage tags and labels… in Details): every tag
with its count, search, sort by name or most used, multi-select. Rename,
Merge, Remove, New tag and Show photos. Renaming to an existing name stops
and asks before merging. Changes reach every connected photo that carries
the tag, rewrite those `.hdrf` files, and are one undo step each. Photos on
folders that are not connected are left as they are and counted in the
result. The four colour labels can be given a meaning, shown in tooltips.

*Albums.* A section under Folders with a count per album. + makes an empty
album or one from the selection. Photos join by right-click (Add to
<album>) or by dragging thumbnails onto the album; Remove from <album>
appears while looking at it. Right-click an album to rename or delete it;
neither touches a photo file. Each is one undo step. Membership is written
to each photo's `.hdrf` as `albums` and indexed in the database; a deleted
database is rebuilt from those files. An empty album exists only in the
database. In folders that cannot be written, membership stays in the
database, as marks do. An album or tag view lists photos across the whole
indexed library and stays current as photos join or leave.

Label meanings and the indexing on/off choice are kept in
`library-preferences.json` beside the existing pinned-folder list in the
app data area, not in the database and not yet in
`application-preferences.json` (that file belongs to the desktop shell;
moving them is small if Steve prefers one file).

Known limits: a tag or album command on many thousands of photos rewrites
one settings file each and can take a while; a first index of a very large
library follows the M3 estimates; undoing a library-wide command fails as
a whole if one of its photos has since gone missing.

Validation: 458 JavaScript, 22 desktop and the Python fast checks passed
(three existing skips). New data checks cover tag and album commands,
undo, unwritable folders, rebuilding from settings files, the index and
indexing of an unvisited pinned folder through the real helper. One
metadata check that pinned the old two-field record was updated to the
fuller record. Focused Electron checks at 2560×1440 on disposable copies:
the new `tests/photo-library-slice-2.js`, Stage B culling and the
navigation/pop-out check. Physical HDR across monitors still needs Steve.

Proposed. Each slice is usable on its own.

| Slice | Contents | What Steve can do afterwards |
|---|---|---|
| 0 | Foundation work, section 1 | Nothing new; the ground is ready |
| 1 | Docked library: pinned folders and the Add folder picker, grid, single view, full-screen review, ratings, picks, tags, multi-select, basic sort and filter, double-click to Grade through the one gate, sidecars holding marks, the database, undo for marks | Cull real shoots |
| 2 | Pop-out window, background indexing, metadata panel, full filter bar, tag management, albums | Use two monitors; find photos across the library |
| 2b · built October 11 | Keeping folders current (5.18): timed checks of pinned folders and the folder on screen, and "Check for new photos" on chosen folders | Drop photos into a pinned intake folder and see them arrive |
| 3 | Grades in sidecars, autosave option, "before" state, reverts, virtual copies | Stop using Save / Save As |
| 4 | Quick decode, compare, focus and exposure overlays | Pick the sharpest frame fast |
| 5 | File and folder controls, delete all rejected | Tidy up without Explorer |
| 6 | Smart albums | Rule-based sets |
| 7 | Selective copy and paste, sync, look presets, and background pictures for grades changed in bulk (see "Carried forward to slice 7" below) | Grade a set quickly |
| 8 | Batch export, recipes, naming patterns, metadata authoring | Deliver a job |
| 9 | HDR previews, comfort cap, HDR/SDR switch in the library | Browse in HDR |
| 10 | Portable projects, relink, merge, conflict handling | Hand work to someone else |

The MCP server (section 11) and SDR-only grading (section 12) are separate
and each gets its own PRD. SDR-only grading should be settled before slice 3,
because it affects what the sidecar records.

**Slice 3 brief, October 11:**
`docs/technical/codex-brief-library-slice-3-2026-10-11.md`. It goes ahead
without the SDR-only PRD: that work is expected to add one field to the
settings file, and settings files keep fields they do not recognise. The
brief builds to Claude's defaults for open decisions 2, 4, 5, 6, 19 and 26;
they stay open here until Steve confirms them.

**Slice 3 Stage A, October 11:** source photos now save the existing project
grade document in their `.hdrf`, with visible app-wide autosave, manual save,
last-saved revert, named-photo leave/close prompts, durable retry and offered
unsaved recovery. Marks and unknown fields are preserved. External grade
changes alone cause the notice in Appendix B; Cancel pauses saving, leaving
or closing asks again, and the unchosen grade is kept safely for Stage C's
before state. A clean Grade picks up an outside grade and says so once.
Keep both is built in Stage D: the outside grade becomes a virtual copy and the local grade is saved.
Stage B is built using Steve's approved backend corrected-source route. JPEG
and 512/1024/1920, initially 1024, are provisional from the recorded measurements.
Stage C is built: locally retained session-start, sidecar previous-grade history,
Grade and counted Library reverts with one Undo. Stage D is built: named virtual
copies from the current grade or clean start, independent grades/marks/albums and
kept pictures, adjacent strip-marked items, copy/original filtering, the same
leave gate between copies, and counted removal with Undo. Copies travel in the
one settings file and rebuild from it. An open Grade copy must be left before
removal, preserving its unsaved work. The brief's defaults are implemented;
Steve's review of how they feel remains pending.

**Carried forward to slice 7: pictures for grades changed in bulk.**
Flagged by Steve on October 11 as important and probably complex. It must
be in the slice 7 brief.

- From slice 3, the Library picture of an edited photo is a small finished
  picture made in the backend after saving. The producer takes a photo
  and saved grade and does not require it to be open in Grade.
- Paste, sync and look presets change the grade of many photos without
  opening any of them. After such a command none of those photos has a
  picture that matches its new grade, and a stale picture must never be
  shown.
- Slice 7 will queue those pictures through slice 3's existing backend
  producer, using the corrected source and export rendering route. Virtual copies
  use their own item ID and saved grade with the same physical source; the bulk
  queue must distinguish them, not collapse work by source path. That is a full
  decode and render per photo: about 10 seconds per 36 MP photo at 1024
  pixels, of which about 5.5 seconds is opening the photo. Several hundred
  photos therefore take over an hour.
- What it has to get right:
  - Until a photo's picture is made, the Library shows it honestly (the
    default look with a mark that its picture is being updated), not the
    old grade.
  - The work shows as a job in Activity with a count, Pause and Resume.
    It gives way to Grade and export, and to pictures for the screen.
    Photos on screen are done first.
  - The list of photos still to do survives a restart, a crash and an
    unplugged drive, the same way settings files waiting to be written
    do.
  - Undo and "Restore previous grade" are instant: the previous picture
    is kept with the "before" state, so taking a paste back needs no
    new rendering.
  - A second paste onto the same photos before the first has finished
    makes one picture for the latest grade, not two.
  - It counts toward the storage limit like other pictures of edited
    photos.
- To settle in that brief: whether a quick approximate picture is shown
  first while the accurate one is made, and how much of the processor the
  job may use.

**Performance to revisit once the slices are built** (Steve, in use):

- October 11, slice 2b: after "Check for new photos" the bar reports the
  new photo promptly, but its picture takes a long time to appear. Not
  investigated; to be covered by the later performance pass and its tests.

---

## 9. Open decisions

For Steve, one at a time, each with its trade-off.

1. Sidecar ending settled October 10: `.hdrf`, appended to the full photo
   filename. Saved projects keep `.hdrfinisher`. A future portable project
   index ending remains open.
2. Virtual copies: all in the photo's one sidecar (Claude's lean), or one
   file per copy.
3. ~~Whether album names are also written into sidecars.~~ Settled
   October 10: yes. Adding a photo to an album may create its `.hdrf` file.
4. How many "before" states to keep: one, or a short list.
5. Whether the session-start state is kept after the app closes (lean: yes,
   until a later session changes that photo).
6. Whether the autosave setting is global, or can be remembered per pinned
   folder or project.
7. Copy and paste of image-dependent settings (anything automatic or matched
   to the picture): re-run on the target, or copy the numbers. A rule per
   control.
8. Look presets and film look: one "looks" menu or two.
9. Definition of "edited" (proposed in 5.7).
10. What "HDR" means for an unedited photo (proposed: HDR Finisher's default
    rendering).
11. Comfort cap details: smooth roll-off or clip; grid only or everywhere.
12. HDR preview size limit and default cache size (after M2).
13. ~~HDR toggle versus per-folder command.~~ Settled October 10: live HDR
    switch from quick scene pictures; no stored gain-map previews.
14. The size target (after M3).
15. Metadata reader (after R1).
16. One focus overlay or two.
17. ~~How docking is done (6.1).~~ Stage A uses an independent same-origin
    frame, chosen under the October 10 brief.
18. ~~What the side panels show while the library is docked.~~ Settled
    October 9: folders left, details right, both collapsible, reset to open
    on launch (section 5.1).
19. Whether existing `.hdrfinisher` projects appear in the library, after
    checking Steve's real projects.
20. Nested tags.
21. Whether a project can be packed into one file.
22. The build order in section 8.
23. Linked photos: whole grade or chosen groups, and where the link is
    recorded (5.20).
24. Whether dragging photos onto a folder moves them at once or asks first
    (5.4).
25. ~~Whether marks made on an offline or read-only folder are written
    beside the photos later, automatically, or only on request
    (Appendix B).~~ Settled October 11: automatically, and reported.
26. Whether a new virtual copy starts with the original's marks and tags
    (as mocked) or clean (5.14).
27. How often folders are checked for changes (5.18, "Keeping folders
    current"). Proposed: the folder on screen about every 15 seconds, other
    pinned folders about every 5 minutes, slower on their own for slow
    drives. Measured October 11: a local D: folder with 50,000 disposable valid
    JPEG photos took 3.23 seconds to list; a complete unchanged check took
    2.70 seconds with the helper already started and a warmed listing. No mapped
    SMB share was available. Recommendation: retain the 15-second/five-minute
    base periods; the ten-times-duration rule makes this folder wait at least
    about 27 seconds in the foreground. Steve still decides how it feels on
    real intake, external and network folders. This measures names/stat data,
    not picture decoding or absence of stutter.

---

## 10. Not planned

**Decided out:** stacks for bursts and near-duplicates; "open in another
app" and linking files processed elsewhere; batch rename of originals;
deleting whole folders; reading or writing other apps' ratings (for now);
showing unreadable files (hidden for now; some formats may be shown greyed
out later).

**Not planned for now:** face recognition, maps, cloud sync, phone
companion, tethered shooting, printing, web galleries, slideshows, video.

**Version 2 at the earliest:** AI search by content and automatic tagging.

**Ideas noted, not currently planned:**

- Finding duplicate files.
- Watermark on export.
- Edit history list, or named snapshots inside one photo. (The "before"
  state is a first step toward this.)
- A sharpness score per photo, for sorting and for marking the sharpest of
  a run. Only after the overlay has proved itself.
- A strength slider for an applied look preset.
- A default preset applied to new photos, perhaps per camera.
- Automatic HDR previews for chosen pinned folders.
- Saved workspace layouts (which panels are open, and where), if more of
  the interface becomes modular. Raised by Steve on October 9; not needed
  now.

**Parked, were Claude's additions and not Steve's requests:**
a list layout with detail columns, a multi-photo survey view, a
copy-from-card helper.

---

## 11. Related: MCP server before 1.0

Raised by Steve. An MCP server lets an AI assistant operate the app
directly. It is its own piece of work and needs its own PRD. It is recorded
here because the library must be built ready for it.

- Likely first uses: relink missing sources, find photos by description of
  their marks and details, tag and rate in bulk, build albums and smart
  albums, apply a look preset to a set, queue a batch export, report what is
  in a project.
- The app already has the right shape: the interface talks to a local
  backend through commands. The server would be a thin layer over chosen
  commands.
- What it asks of the library now:
  - Rule F5: every action is a backend command first.
  - Bulk changes keep the same guards for an assistant as for a person: a
    count of what will change, the "before" state, one undo.
  - Sidecars and project files are plain and readable.
  - **An assistant can never delete from disk without a person confirming.**
    Also to settle: overwriting exports, and writing outside pinned folders
    and projects.
- Open: read-only tools first and writing tools later; whether the app must
  be open for the server to work.

---

## 12. Related: grading in SDR without any HDR

Raised by Steve on October 9, after the rest of this document was organised.
Now that the app is becoming general-purpose, people should be able to grade
a photo in SDR only, with no HDR grade at all. **This is a change to Grade,
not to the library, and needs its own PRD.** It is recorded here because the
library must not be built on the assumption that every photo has an HDR
grade.

Not yet discussed in any detail. Questions for that PRD:

- Today the SDR grade follows from the HDR grade. What does an SDR-only photo
  start from, and which panels does it show?
- Is SDR-only chosen per photo, per virtual copy, or as an app-wide way of
  working? Can a photo be switched later, and what happens to its grade?
- What does someone without an HDR monitor see on first launch?

Where it touches this document:

- **Sidecar (5.12):** records whether a photo, or a virtual copy, is graded
  for HDR and SDR or for SDR only.
- **Previews (5.9):** "Create HDR previews", the HDR/SDR switch and the
  comfort cap have nothing to show for SDR-only photos. They stay SDR, and
  the grid should not look broken because of it.
- **Copy and paste, look presets (5.15):** pasting between an SDR-only photo
  and an HDR one. The "HDR side / SDR side" ticks already point the right
  way; the skipped-settings message covers the rest.
- **Export recipes (5.16):** an HDR recipe run on an SDR-only photo is
  skipped, with a clear line in the results.
- **Filters and smart albums (5.6, 5.7):** "SDR only" becomes a useful state
  to filter on.
- **Virtual copies (5.14):** an HDR grade and an SDR-only grade of the same
  photo as two copies is a natural use.

---

## Appendix A. What other apps do when you zoom in

From Claude's general knowledge of these apps, not re-checked against current
versions.

| App | At 100% |
|---|---|
| Lightroom Classic | Keeps screen-sized previews. Builds a full-size "1:1" preview on demand (the "Loading..." pause). These can be built ahead for a folder and are discarded after a set time. |
| Capture One | Keeps previews at a size the user sets. Loads the full image on demand past that size. |
| Photo Mechanic | Never develops the RAW. Shows the camera's embedded JPEG, so its 100% view is only as good as that. |
| FastRawViewer | Quickly decodes the actual RAW for each photo viewed, so the focus check is on real sensor data. |
| DxO PhotoLab | Shows a quick preview, then renders its corrections on demand when zoomed, with a visible wait. |

The common pattern is the one in 5.9: a cached screen-sized preview for
browsing, full resolution only on demand, optionally prepared ahead. Nobody
keeps full-size previews of everything permanently. FastRawViewer is a
specialist tuned for exactly this; HDR Finisher should not expect to match
its speed at first.

---

## Appendix B. Notices for unusual situations

Draft wording by Claude, October 10, for Steve to review once there is a
coded draft. Each notice says what happened, that nothing was lost, and
what the choices are. None of them is mocked up.

| Situation | Notice |
|---|---|
| A folder cannot be written to (memory card, read-only share) | "Marks and grades for photos in <folder> are kept in the library, not beside the photos, because this folder cannot be written to. They will not travel with the files." Shown once per folder, and as a line in the Details panel. |
| A drive is unplugged | "<folder> is not connected. Its photos stay listed. Marks and tags still work." Opening one in Grade: "<photo> is on a drive that is not connected." |
| Two settings files for one photo | "<photo> has a second set of grades, usually from a returned project or a cloud conflict. Nothing was overwritten. The second set was added as virtual copies named From <file>." |
| The same settings file's grade changed elsewhere while Grade has unsaved work | Title: "Grade changed elsewhere". "The grade for <photo> changed elsewhere while you were working. Nothing was overwritten. Choose which grade to use; the other will be kept as the previous grade." Buttons: Cancel, Use the file's grade, Keep my grade. Cancel leaves "Saving paused — grade changed elsewhere"; leaving or closing asks again. The unchosen grade is retained for Stage C. Changes only to marks, tags, albums or unknown fields do not show this notice. Keep both brings the file's grade in as a virtual copy, then saves the local grade. |
| The same settings file's grade changed elsewhere and Grade has no unsaved work | Grade loads the file's grade without a question. Once: "The grade for <photo> changed elsewhere. Grade now shows the file's grade." |
| A settings file with no photo | "<n> settings files in <folder> have no photo. Their photos were probably moved outside HDR Finisher." Buttons: Reconnect, Leave them. |
| A settings file that cannot be read | "The settings for <photo> could not be read. The photo is shown without a grade. The file has been left untouched." Buttons: Show in Explorer, Start a new grade (keeps the old file under another name). |
| A settings file from a newer version | "<photo> was graded in a newer HDR Finisher. It can be viewed here but not changed, so nothing in it is lost." |
| A file is in use by another program (rename, move, delete) | "<photo> could not be <moved> because another program is using it. Nothing was changed for this file. <n> other photos were <moved>." Buttons: Try again, Skip. |
| The destination cannot be written to | "<folder> cannot be written to. Nothing was moved." |
| Not enough room on the destination drive | "<drive> needs <x> GB and has <y> GB free. Nothing was moved." |
| A move between drives was interrupted | On the next start: "A move to <folder> was interrupted. <n> photos had been copied and checked; <m> had not. Nothing was lost." Buttons: Finish the move, Leave as it is. |
| Deleting where there is no Recycle Bin | Already in 5.4: the delete window says the photos will be gone for good. |
| Moving or deleting the photo open in Grade | Move or rename: the photo stays open and follows the file. Delete: the delete window adds "One of these is open in Grade and will be closed." |
| Exporting a photo with unsaved work in Grade | "<photo> has unsaved changes in Grade. Export uses the saved grade." Buttons: Save and export, Export the saved grade, Cancel. |
| An HDR recipe on an SDR-only photo | A line in the export results: "skipped: HDR recipe, SDR-only photo". |
| Searching or opening a smart album while indexing | "Indexing is still running, so more may turn up." |
| A network folder | "Network folders do not always report changes. This folder is checked each time it is opened. Re-scan checks it now." Shown once, in the folder's right-click menu area. |
| The cache drive is not connected | "The preview cache on <drive> is not connected. Thumbnails are being made in a temporary place and will be slower this session." |
| The cache is full | No notice. The oldest previews are removed in a batch. |
| A project photo is missing | The dashed "Missing" frame in the grid and the count on the project's entry (5.17). |
| Pasting onto, or reverting, a linked photo | The confirmation counts the linked photos: "That includes <n> photos linked to the selection." |
