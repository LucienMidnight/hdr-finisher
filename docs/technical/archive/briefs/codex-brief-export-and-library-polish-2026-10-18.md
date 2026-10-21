# Codex Brief: Export Page and Library Polish
## HDR Finisher

**Date:** October 18, 2026
**Do this before:** the GPU export work recorded in PRD section 11d. Do not
start GPU export in this brief.
**Read first:** `ai/AGENTS.md` (testing scale, reporting to Steve, line
endings). It was updated on October 18 for the GPU-first decision.

---

## Before you start: what changed overnight

Claude fixed four bugs on `film-look-rebuild` while you were out of
credits. They are committed locally (not pushed):

| Commit | What it fixed |
| --- | --- |
| `8056ede` | Library indexing locked its own database ("database is locked"), which broke the Library and the Export grid |
| `2dea68f` | The Export page's folder picker was rejected by the backend |
| `3ae4c77` | Library menu commands stayed greyed out when the Library is in its own window |
| `18aae3a` | Open in Export / Quick export loaded the photos but the Export tab refused to open without a photo in Grade |
| `f8180ec` | PRD 11d: the GPU-first export decision |

Your unfinished work (`batch_export.py`, `batch_export_api.py`,
`batch-export.js`, the PRD) was left uncommitted and untouched, except
that **`frontend/batch-export.js` now also contains two of Claude's
changes that you must keep:** the **Select all** button in the grid's
button row, and `batch:true` passed to `activateWorkflowTab` in `open()`.
The second one is what lets `18aae3a` work. Finish your own work first
and commit it, keeping both.

A new Electron check, `tests/library-export-menu.js`, covers Library →
Export. Run it after any change to that path.

---

## Goal

Steve used batch export for real on October 17 and 18. It works, but the
Export page does not look like the approved mock-up, a few pages are
blocked or overlap, and Library thumbnails are too slow to update after an
edit. Fix the items below so the app feels finished before the GPU work.

Steve is not a coder. When you report back, describe what he will see.

---

## 1. Export page: match the mock-up (the main item)

**Design reference:** `docs/product/export-wireframes/index.html`. Open it
straight from disk in a browser. The yellow strip at the top is the
mock-up's own control (switch Not started / Running / Finished); it is
not app UI. Its Notes button summarises the design.

Use the app's existing components, classes and tokens (`styles.css`). Do
not copy the mock-up's CSS, and do not add new colours, font sizes,
spacing values or button styles. If the mock-up needs something the app
has no token or component for, ask before inventing one. The mock-up loads
the app's real stylesheet, so almost everything it shows already exists.

Steve's words: the grid "doesn't match your mockup", the first row of
tiles overlaps the status line, and the status line floats behind the
grid when scrolling. "Pretty messed up." He also says Codex is weakest at
UI, so check every point below against the mock-up side by side, at 2560
x 1440 and at a smaller window (about 1440 x 900), before reporting.

### What is wrong today, and what it should be

| Area | Today | Should be (as in the mock-up) |
| --- | --- | --- |
| Left rail | Full-width **Grid**, **Preview** and **New preset** buttons above the presets | Only the preset list. Each preset is a row with its name and a one-line summary of its versions (for example "AVIF + gain map + JPEG (SDR)"); the selected preset is highlighted like other selected list items in the app. New preset is the small **+** icon button in the rail header. A short hint at the bottom of the rail (right-click to rename, duplicate or delete). Grid/Preview do not belong in the rail. |
| Batch header | An unlabelled row of plain text buttons, with Grid and Preview repeated | A panel header like the other panels: **EXPORT BATCH** title, then a muted summary "12 photos · 2 versions · 23 files". On the right: Grid / Preview as a pair of icon buttons (one shows as active), then **Add Library selection**, **Select all**, **Remove**, **Clear** in the app's existing small tool-button style. |
| "Needs a look" notice | Missing | When any photo has a flag (unsaved changes, SDR only), one amber notice line under the header: "2 photos need a look before exporting. Details are on each photo below." |
| Tiles | A floating checkbox above each tile, a black box for the picture, small caps text, "Ready" text over the first tile | Tiles as in the mock-up: the photo fills the top of the tile, letterboxed on the dark surface; under it the photo name (and copy name), then "2 files"; amber chips for flags ("Unsaved changes in Grade · last saved grade used", "SDR only · HDR version skipped"). Selection is shown by highlighting the whole tile with the accent border, as in the Library grid. No visible checkbox. Click selects, Ctrl/Shift-click extend, Select all selects all. |
| Tile status | Text in the caption | A small badge in the top-right corner of the picture: **Exporting…**, **Done**, **1 skipped**, **Failed**. |
| Status / progress | "Ready" at the top-left of the grid, overlapping the first row and floating behind tiles when scrolling. Pause / Resume / Cancel and Show in Explorer are separate, at the bottom | **One strip, fixed at the bottom of the batch area, outside the scrolling grid.** The grid scrolls only in its own area between the header and this strip; nothing scrolls under or over it. Before a run the strip is hidden (or shows nothing). While running: "Exporting 7 of 23 files", time left, an **overall progress bar** across the strip, then **Pause** (becomes **Resume**) and **Cancel** on the right. When finished, the same place shows the results: a summary line ("22 files exported · 1 renamed · 1 skipped"), **Show in Explorer** and **Close**, and the per-file list (file, photo · version, outcome), as in the mock-up's Finished state. Status text, its controls and its progress are always together in one place. |
| Per-photo progress (new, Steve's request) | None | While a photo is exporting, a thin progress bar along the bottom edge of its picture, in the accent colour, showing how far that photo has got. Photos waiting show nothing; finished photos show the Done badge. |
| Control panel | Fine in content | Unchanged apart from item 2 below. Keep today's controls and wording where they differ from the mock-up. |

### Per-photo progress: what the bar should mean

The bar must move honestly. If the batch worker can report progress
within one photo (decode, render each version, encode), use that. If it
can only report "started" and "finished per version", fill the bar in
steps per version (a photo with two versions is half full after the
first). Do not fake smooth movement. Say in your report which you did.

### Thumbnails on the Export grid

In Claude's check (`tests/library-export-menu.js` with three copies of
`tests/fixtures/sdr_gradient.png`) the tile pictures came out as black
boxes. That fixture may simply be dark; confirm with a real RAW that the
Export grid shows the same picture as the Library grid, including the
saved grade.

---

## 2. Export page control panel overlaps the top bar

**Symptom:** on the Export page the right-hand control panel extends up
into the app's top bar, covering **Settings** and **Help**.
**Expected:** the control panel starts below the top bar and is sized the
same way as the right-hand panel on Grade and Proof. Check it at both
window sizes above.

---

## 3. All four pages available when the app opens

**Today:** Grade, Proof and Export cannot be opened until a photo is open
(the guard is in `activateWorkflowTab`). Claude made a narrow exception
for the Library → Export hand-off only.

**Steve's decision:** all four pages open straight away.

| Page | With no photo open |
| --- | --- |
| Library | As today. |
| Grade | An empty state that invites a drop: dragging a RAW or image file onto the app (anywhere on Grade) opens it for grading directly, without going through the Library. Also offer the existing Open command. |
| Proof | Reachable so that proof settings and future Proof presets can be managed. The picture area says no photo is open. |
| Export | The preset rail and control panel work, so presets can be made and edited with no photo. The batch area says how to add photos (Library selection, or open a photo in Grade). |

Nothing should throw, show stale content from a previously closed photo,
or start rendering when no photo is open.

---

## 4. Remember the sort per source

**Today:** the Library remembers one sort order for everything.
**Expected:** the sort choice (field and direction) is remembered
separately for each pinned folder, album and smart album, and restored
when you return to it. A source that has never been sorted uses the
current default. Sub-folders browsed inside a pinned folder may share
their pinned folder's choice; say which you chose.

---

## 5. No broken-image icon while pictures load

**Symptom:** when the app opens, Steve sees the browser's broken-image
icon in place of pictures before they load.
**Expected:** a placeholder that matches the surface (the same as an
empty tile) until the picture is ready. A picture that genuinely fails
shows the app's own failed state, never the browser's icon.
**Hypothesis:** an `<img>` is shown with a `src` that is not ready yet, or
fails and is retried. Check every place that shows photo pictures (Library
grid, filmstrip, Single view, Export grid, Quick export), not just the
first one you find.

---

## 6. Library thumbnails take minutes to show an edit

**Symptom:** after saving an edit in Grade, the Library shows the old
look for minutes, even when Steve sits in the Library waiting for that one
photo.

**What Claude measured** (Steve's 45-photo badminton folder, film stock
and Denoise grade, `backend.log`, events `kept_source_ready`,
`kept_rendered`, `kept_encoded`): each saved-grade picture takes about
**50 s**. That is 6 to 11 s to decode the RAW again, 35 to 51 s to render
on the CPU at a 2560-pixel edge (`library-picture-preferences.json` has
`screen_edge: 2560`), and 2 to 5 s to encode. They are made one at a time,
so a photo just edited can sit behind dozens of others. A pasted grade on
45 photos queues roughly 40 minutes of work.

**Expected (tolerance, recorded here per AGENTS.md):** when the app is
otherwise idle, the photo Steve just saved shows its new look in the
Library grid **within 5 seconds**. The photo he is looking at, or that is
selected, jumps ahead of background work. Large pictures for Single view
and full screen may follow later.

**Direction, not prescription:** the Grade window has already drawn this
exact look on the GPU at the moment of saving. Under the GPU-first
decision, reusing what the GPU drew for the thumbnail is welcome. A
small-thumbnail-first render on the CPU and better queue priority are also
acceptable. Investigate and pick; report the measured time. Do **not**
start the full GPU export work here, and do not change export output.

---

## Constraints

- Keep today's export output exactly as it is. This brief changes UI,
  queue order, thumbnails and page access, not exported files.
- Use existing tokens and components. Ask before adding any.
- Keep each file's line endings (see AGENTS.md).
- Commit locally in small commits, one per item where practical. Ask
  before pushing.

## Testing (scaled per AGENTS.md)

- Fast checks after each change (`node --test tests/*.test.js`, `.venv`
  pytest).
- GPU checks only where they cover what you touched, one at a time at
  2560 x 1440: `tests/batch-export-ui.js` and
  `tests/library-export-menu.js` for the Export page; the Library
  thumbnail checks for item 6. Update their expectations where the UI
  changes on purpose (for example the checkbox becoming tile selection).
- For item 1, take screenshots of Not started, Running (with per-photo
  bars) and Finished, at both window sizes, and compare them with the
  mock-up before reporting. Send Steve those screenshots.
- No full sweep.

## Questions protocol

If anything here conflicts with the existing code, or the mock-up needs a
component the app lacks, stop and ask before inventing. If a fix turns out
to need backend work much bigger than described (especially item 6), say
so with an estimate before doing it.
