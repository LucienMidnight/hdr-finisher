# Photo Library PRD

**Date:** October 9, 2026
**Status:** Requirements agreed in outline. **Not yet a build brief for the
library itself.** Three things are still to come before library features are
built: the measurements in section 7, a wireframe of the views, and the open
decisions in section 9. The foundation work in section 1 does not depend on
any of those and can start now.

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
  rebuild on another machine and a lost database loses nothing. (Open.)

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

### 5.9 Thumbnails, previews and zoom

Decided:

- **Nothing is written next to photos except the sidecar.** Thumbnails,
  previews and focus maps live in one cache in the app's data area.
- Made when first looked at, then reused. The cache is disposable.
- **User-set cache size limit.** When reached, the least recently used are
  removed first, **in batches**, so the app is not constantly deleting and
  remaking.
- **The grid is SDR by default.**
- **"Create HDR previews"** is a command run on a folder, album, selection or
  several folders at once. It works in the background and each thumbnail
  switches to HDR as its preview becomes ready.
- HDR previews are built at **screen size** as well as thumbnail size, with a
  **resolution limit**; full-size images are never stored as previews.
- **Comfort cap:** the HDR grid is limited to 1000 nits by default,
  adjustable.
- If measurement shows it is fast enough, **prefer a simple HDR toggle** that
  builds previews for whatever is on screen. The command then remains as the
  way to prepare a folder ahead of time.
- **Generic method.** The same steps for every camera and format. No feature
  may depend on the camera's embedded JPEG, whose size varies from full size
  to tiny to absent.

The three tiers (decided as the approach, numbers to be measured):

1. **Embedded JPEG, instantly**, as a head start. For each file the app
   checks what is actually there and uses it only if it is big enough for the
   size being shown. No per-camera lists.
2. **Quick plain decode** of the RAW: no grade, no denoise, simplest
   reconstruction. This is what everything relies on. It serves zooming in,
   focus maps and exposure maps. A reduced-size decode covers "fit to
   window" and the maps; a full decode is only for a true 100% view.
3. **Full HDR Finisher rendering**, only for Grade and for HDR previews.

Files that are not RAW follow the same steps with their own quick decode.

Proposed:

- HDR previews show HDR Finisher's rendering: the default look for unedited
  photos, the user's grade for edited ones. This also removes the mismatch
  between the browsing look and the opened look.
- Edited photos always get a preview of their grade, saved when work on the
  photo settles, even when HDR previews have not been requested.
- Preview size limit: 2560 pixels on the long edge by default, with a
  setting (for example 1920 / 2560 / 3840).
- One stored file that serves both the HDR and SDR preview modes (a small
  gain-map image; the app already makes gain maps).
- The grid draws only what is on screen and drops requests for thumbnails
  that have scrolled away.
- **Read ahead:** while flipping through photos, decode the next and previous
  in the background. Keep only a few decoded photos in memory.
- The comfort cap rolls bright highlights off smoothly and applies to the
  grid only; single view and compare show the true image.
- The preview job has progress, pause and cancel, gives way to grading and
  export, and carries on after the app is restarted.
- A photo whose grade changes gets its previews remade.
- Cache keyed so a moved or renamed photo keeps its previews. Cache location
  movable to another drive.

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

- **Sidecar:** one small file next to each photo. Holds that photo's
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
  (`DSC02339.ARW.<ending>`), so a RAW and a JPEG of the same name each get
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
- Watch pinned folders for changes. Network drives report changes
  unreliably, so also re-check a folder when it is opened and offer a manual
  re-scan.
- An unplugged drive keeps its index; its photos show as offline.
- A small progress indicator with pause. Searches and smart albums say when
  indexing is still running.
- Advanced settings: on or off, how much processor to use, pause on battery,
  pins to leave out.

### 5.19 Size and speed targets

Decided: the library is designed to a stated size, so performance is planned
and not hoped for. The number is set after measuring what each indexed photo
costs in database size, memory and time, and may change.

Proposed targets to define once numbers exist: photos indexed while staying
quick; time for first thumbnails in a folder; time to flip between photos in
compare; time and disk per HDR preview; first full index of a large drive.

---

## 6. Technical approach

Notes for whoever turns this into build briefs. Proposed unless stated.

### 6.1 Two windows

- The shell starts one backend and opens windows that load pages from it.
  Both windows see the same pins, marks and previews because those live in
  the backend.
- **Docking is the open question.** Two candidates:
  - The library is its own page, shown inside the main window in a frame.
    Simple to layer with the rest of the interface. Popping out reloads it in
    a new window and restores its state.
  - The library is its own page in a native view that the shell places over
    the preview area and can hand to another window. State survives the
    move untouched, but menus and dialogs of the main window cannot draw over
    it and its position must be kept in step with the layout.
  - Either way the library is a separate page that does not share the
    editor's `state` (F4).
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

**Remaining experiments:** M2/M3/M6 need explicit HDR-preview, indexing and
edited-preview refresh models before numbers can set limits. T1's
beside-photo save/autosave trial remains experimental work, not a settled
sidecar format. No cache size, database schema, reader switch or preview
pipeline is adopted from these foundation measurements.

Also to come: the wireframe for the views in 5.3.

---

## 8. Build order

Proposed. Each slice is usable on its own.

| Slice | Contents | What Steve can do afterwards |
|---|---|---|
| 0 | Foundation work, section 1 | Nothing new; the ground is ready |
| 1 | Docked library: pinned folders and the Add folder picker, grid, single view, full-screen review, ratings, picks, tags, multi-select, basic sort and filter, double-click to Grade through the one gate, sidecars holding marks, the database, undo for marks | Cull real shoots |
| 2 | Pop-out window, background indexing, metadata panel, full filter bar, tag management, albums | Use two monitors; find photos across the library |
| 3 | Grades in sidecars, autosave option, "before" state, reverts, virtual copies | Stop using Save / Save As |
| 4 | Quick decode, compare, focus and exposure overlays | Pick the sharpest frame fast |
| 5 | File and folder controls, delete all rejected | Tidy up without Explorer |
| 6 | Smart albums | Rule-based sets |
| 7 | Selective copy and paste, sync, look presets | Grade a set quickly |
| 8 | Batch export, recipes, naming patterns, metadata authoring | Deliver a job |
| 9 | HDR previews, comfort cap, HDR/SDR switch in the library | Browse in HDR |
| 10 | Portable projects, relink, merge, conflict handling | Hand work to someone else |

The MCP server (section 11) and SDR-only grading (section 12) are separate
and each gets its own PRD. SDR-only grading should be settled before slice 3,
because it affects what the sidecar records.

---

## 9. Open decisions

For Steve, one at a time, each with its trade-off.

1. File endings for the sidecar and for the project index, so Explorer can
   tell them apart.
2. Virtual copies: all in the photo's one sidecar (Claude's lean), or one
   file per copy.
3. Whether album names are also written into sidecars (Claude's lean: yes).
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
13. HDR toggle versus per-folder command (after M2).
14. The size target (after M3).
15. Metadata reader (after R1).
16. One focus overlay or two.
17. How docking is done (6.1).
18. ~~What the side panels show while the library is docked.~~ Settled
    October 9: folders left, details right, both collapsible, reset to open
    on launch (section 5.1).
19. Whether existing `.hdrfinisher` projects appear in the library, after
    checking Steve's real projects.
20. Nested tags.
21. Whether a project can be packed into one file.
22. The build order in section 8.

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
