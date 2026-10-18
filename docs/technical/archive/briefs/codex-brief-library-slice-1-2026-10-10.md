# Codex Brief — Photo Library, Slice 1: Browse and Cull
## HDR Finisher

**Date:** October 10, 2026
**Branch:** `photo-library` only. Check with `git branch --show-current`
before changing anything (PRD section 0).
**Read first:** `AGENTS.md`, then `docs/product/archive/Photo_Library_PRD_2026-10-09.md`
sections 0, 3, 4, 5.1-5.6, 5.9, 5.12, 6 and the "quick-open trial" entry at
the end of section 7. Open the mock-up at
`docs/product/library-wireframes/index.html`.

## Goal

Steve can open the app on the `photo-library` branch, add his real photo
folders, and browse and cull thousands of photos at speed: a grid, a single
view with a filmstrip, full-screen review, ratings, picks, colour labels and
tags, and double-click to open a photo in Grade. The pictures come from the
quick route proven in the quick-open trial, not from stored HDR preview
files.

The point of building now is that Steve wants to find the real problems by
using it on his own photos. Get a usable library in front of him early and
keep it usable after every stage.

## Decisions by Steve, October 10 (record these in the PRD)

- **Build the library first.** The known faults in the quick picture (colour
  on some DNGs, brightness on Canon and DJI) are not fixed beforehand. Steve
  will judge them in use.
- **The library applies no corrective steps:** no lens correction, no
  highlight reconstruction, no denoise, no DNG correction opcodes. Those
  load when a photo is opened in Grade, as today.
- **The library has its own quick demosaic,** separate from grading and
  export, which keep theirs.
- **HDR in the library is optional and drawn live** by the graphics card
  from the same quick picture. No gain-map preview files are made. This
  replaces the "one stored gain-map file" proposal in PRD 5.9 and the
  prepare-ahead suggestion in section 7.
- **Blown highlights:** a simple hard clip to white is the intended answer
  for the library. Do it if it is small; otherwise leave the tint and say so.
- **Lower resolution is acceptable** for browsing.

## Context

- Foundation work F1-F4 is done: the shell manages windows by role, there is
  one gate for leaving the current photo, a low-priority helper process
  exists, and the browser runs on its own page. F5 is a standing rule: every
  library action is a backend command the interface calls.
- The quick-open trial (`tests/performance/photo-library-quick-open-trial.js`
  and its helper) is a switched-off instrument, not a feature. It showed
  about 7 camera RAW photos per second to the screen with six opening at
  once, about 70-80 ms for a prefetched photo, HDR at no extra cost, and 30
  thumbnails filled in about 2.1 seconds. Use what it learned; you decide
  how much of its code is fit to keep.
- This is PRD slice 1, with two things pulled forward because Steve wants to
  judge them now: the quick picture route (from slice 4) and the HDR switch
  (from slice 9).

## Design reference

The mock-up in `docs/product/library-wireframes` is the reference for
layout, look and behaviour. It is a mock-up, not code to copy. It shows
more than this slice; build only what is listed below. Where the PRD marks
something "Proposed, mocked up, not yet confirmed", follow the mock-up and
list it in your report so Steve can confirm or change it.

## Outcome spec

Work in three stages. Each ends with the app usable and a short plain
report to Steve, so he can start reviewing while the next stage is built.

### Stage A — Look at photos

| Thing | What Steve experiences |
|---|---|
| Library in the main window | "Library" replaces "Import" and opens where the preview is. Folders panel on the left, details panel on the right, both collapsible as on the other stages (PRD 5.1). |
| Pinned folders | Add folder opens a picker that takes several folders. A pinned folder expands to its sub-folders. Clicking one shows everything beneath it together. First run shows one "Add a folder" prompt (PRD 5.2). |
| Grid | Thumbnails appear quickly and keep appearing as he scrolls. Only what is on screen is worked on; photos scrolled past are dropped from the queue. A size slider. Scrolling a folder of several thousand photos stays smooth. |
| Second visit | Thumbnails already seen come back at once. They are kept in the app's existing cache area, never beside the photos, and the cache can be thrown away without loss. |
| Single view with filmstrip | Arrow keys flip between photos. The next and previous photos are prepared ahead so flipping feels immediate. The picture is sharp at the size it is shown, not a stretched thumbnail. |
| Full-screen review | One key hides everything but the photo; arrows still work. |
| Open in Grade | Double-click a thumbnail, or Enter, opens that photo in Grade through the existing leave-photo gate. Grade opens it its normal, fully corrected way. |
| File types | Every type Grade can open appears. Slow types (linear DNG, HEIC, TIFF) show the fastest honest picture first and improve when the real one is ready. Files that cannot be read are hidden. |

### Stage B — Cull

| Thing | What Steve experiences |
|---|---|
| Marks | Stars 0-5, pick / reject / unmarked, four colour labels, with the keys in the mock-up. Shown in a strip under the thumbnail, never over the photo. Stars are yellow (PRD 5.5). |
| Tags | Type a tag onto the selection, with suggestions from tags already used. The Tags and Labels management window is not in this slice. |
| Multi-select | Click, Ctrl-click, Shift-click, select all, drag a box. Marks apply to the whole selection. |
| Saved at once | A mark is saved the moment it is made and never counts as unsaved work. It is written to a sidecar beside the photo and to the database. Looking at a folder writes nothing. |
| Undo | Ctrl+Z undoes the last mark change, including one made on many photos. |
| Survives everything | Marks are there after a restart. If the database file is deleted, it is rebuilt from the sidecars and the marks come back. |
| Folders that cannot be written | Marks are kept in the database and the library says so (PRD 5.12). |

### Stage C — Find, HDR, and check sharpness

| Thing | What Steve experiences |
|---|---|
| Sort | By capture time, file name, rating, pick status and file type, either direction. A large folder appears at once by name and settles into capture order as details arrive. |
| Filter | By rating, pick status, colour label, tag and file type, plus the quick "RAW only" filter. The full "+ Filter" list is a later slice. |
| HDR switch | H, or the HDR button, switches the grid and single view between SDR and HDR. It takes effect at once on what is on screen. The grid is SDR by default and limited to 1000 nits in HDR. |
| Zoom to 100% | In single view and full-screen review, a click or Z zooms to 100% on that spot, drag moves around, and zoom and position are kept while flipping. The full-size picture loads on request; until it arrives the current one is shown enlarged. |

Notes on the picture:

- **Unedited look.** This slice shows every photo with the app's default
  starting look. Showing a photo's saved grade comes with slice 3. Build the
  picture route so a grade can be handed to it later without rework.
- **Stored thumbnails must not bake in SDR.** What is kept has to be able to
  draw both SDR and HDR, and should not need remaking when a grade changes
  later. The format is yours to choose. Report the size per thumbnail and
  put a simple fixed limit on the cache for now, removing the least recently
  used in batches.
- **Stay out of Grade's way.** Library work pauses or yields while a photo
  is being graded or exported, as the helper already does.

Steve also needs a way to tell you what is slow. Add a developer-only
switch that shows, or logs, time-to-picture for the photo under the cursor
or just shown. Nothing visible without the switch.

## Not in this slice

Pop-out window, background indexing of unvisited folders, the metadata
panel beyond what the mock-up's details panel needs for marks, albums and
smart albums, grades in sidecars, autosave, virtual copies, compare, focus
and exposure overlays, moving / renaming / deleting files or folders, copy
and paste of grades, linking, export, projects. Do not build ahead.

## Constraints

- **The library never changes, moves or deletes a photo in this slice.** The
  only thing it writes beside photos is the sidecar.
- **Sidecar name (decided by Steve, October 10):** the photo's full file
  name plus `.hdrf`, for example `DSC02339.ARW.hdrf`. Record it in the PRD
  (open decision 1). Keep the ending in one place in the code. It is the
  same kind of document as today's project file. `.hdrfinisher` stays the
  ending for saved projects, which must keep opening as they do today;
  whether those appear in the library is open decision 19, not this slice.
- **Your tests never write into Steve's photo folders.** Sidecar and
  database tests use temporary copies only. Never save over the read-only
  test projects.
- **Do not change** Grade's opening route, CPU export, Proof, any pinned
  shader, tolerance, limit or budget. If the library needs one touched,
  stop and ask.
- **Nothing is lost from today's app.** Opening a single file that is not in
  a pinned folder must still be possible. Say how in your report.
- **One writer for the database.** Its layout is yours to design; it is an
  index that can be rebuilt, and preferences do not live in it (PRD 5.12).
  The M3 instrument layout is a measuring tool, not a decision.
- **Metadata:** use today's reader for capture time and file facts. Do not
  bundle ExifTool or choose a new reader here.
- **Docking:** how the library page is shown inside the main window is
  yours to decide (PRD 6.1). Only the docked library is needed now, but do
  not close off the pop-out window planned for slice 2. Say which you chose
  and why in one or two lines.
- **Pre-1.0 rule:** no migration or compatibility code.
- **Design guidelines apply.** Marks get their own colour tokens, never the
  accent colour (PRD 5.5).
- **Testing follows `AGENTS.md`.** Fast checks on every change, new fast
  checks for the data rules, and only the GPU checks that cover what you
  touched, one at a time at `HDR_FINISHER_ELECTRON_WINDOW_SIZE=2560x1440`.
  If slow tests will pass about 30 minutes, tell Steve first.
- Small local commits. No push, no installer build.

## Records and report

- Update the PRD: record the October 10 decisions above in sections 4 and
  5.9, mark slice 1 progress in section 8, and note anything a future reader
  needs. No separate evidence document.
- After each stage, report to Steve in plain language: what he can now do,
  how to start it, what is known to be rough, and any "proposed" mock-up
  behaviour he should confirm.
- Put decisions to Steve one at a time, each with its trade-off and what
  could break.

## Questions protocol

If anything here conflicts with the existing code or the PRD, or a stage
turns out much larger than it reads, ask before building. Do not invent new
interface patterns or colour tokens beyond what the mock-up and the design
guidelines call for without checking first.
