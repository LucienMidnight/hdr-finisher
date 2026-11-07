# Codex Brief: Focus and Exposure on undeveloped RAW photos
## HDR Finisher, Library

**Date:** November 7, 2026
**Requested by:** Steve ("I need focus and exposure to work on undeveloped RAW files.")

Read `ai/AGENTS.md` first and follow it: testing scale, the 30-minute
"Stop and ask" rule, line endings, small local commits, no push, and
`tools/output_size.py` at the start and end. Then read
`docs/product/PRD.md`, `docs/product/modules/photo-library.md` (the
November 3 and November 7 sections especially) and
`docs/technical/code-map.md`.

## Goal

In the Library, turning on Focus (key `s`) or Exposure (key `e`) shows the
overlay on RAW photos that have not been developed, in every view that
already supports overlays: grid, filmstrip, single, zoomed, compare and
review. Today these photos show nothing at all, not even an "unavailable"
badge, so the feature looks broken on most of a fresh shoot.

## Context: what is true today

- Since November 3 (`75f1de90`, "Show camera pictures and develop Library
  photos only on demand"), an undeveloped RAW is shown with the camera's
  embedded preview. Develop is an explicit action.
- The overlay frontend (`codebase/frontend/library-overlays.js`) returns
  straight away when the shown picture is a camera/bitmap picture
  (`if(meta.bitmap)return;`). That is why undeveloped RAWs get nothing. The
  commit gives no reason for that line. The likely reason is that the
  embedded preview may not line up with the measured map. Confirm this
  before relying on it.
- The overlay maps are already measured from the original file, not from
  the developed picture. `codebase/backend/hdr_finisher/library_overlays.py`
  reads RAW sensor data with rawpy (Exposure: clipping against the black and
  white levels; Focus: from a quick or half RAW decode). It handles LibRaw
  orientation. So the measurement side may already be largely there; the
  gap is mainly placing the map over a camera preview.
- November 7 (`d20f7ada`): overlays now attach to the picture actually
  shown in a tile (they had been drawing at 0×0 on a hidden element). The
  `library-focus.js` and `library-exposure.js` drivers were repaired, but
  they develop PNG photos first, because overlays only worked on developed
  pictures.
- Separate and not in scope: photos with a saved grade show
  "Focus unavailable · graded". Overlays on graded photos are open work
  (possibly v2).

## Outcome spec

| Situation | What the user sees |
|---|---|
| Undeveloped RAW, Focus on | Focus peaking over the camera preview, in the same place as the subject, in every overlay view. Half quality in grid/filmstrip, refined to full in large views, as for developed photos today. |
| Undeveloped RAW, Exposure on | Blown and blocked regions measured from the sensor data, over the preview, aligned with the picture. |
| User then develops the photo | The overlay stays on and stays aligned; no flicker to empty, no second measurement if the map is still valid. |
| Embedded preview cannot be aligned reliably (for example a preview crop or aspect that differs from the sensor frame and cannot be mapped) | A short badge naming the reason, never a silently missing or misplaced overlay. Prefer making alignment work over showing the badge. |
| Non-RAW direct pictures (JPEG, PNG, TIFF shown as-is) | Decide and report whether the same change makes them work too. Include it if it is the same mechanism and low risk; otherwise list it as open work. |
| Graded photos | Unchanged ("unavailable · graded"). |

Alignment matters more than anything else here. An overlay that is a few
percent off on a crop or a rotated portrait is worse than none. Check
landscape and portrait frames, at least two camera makes (the test copies
include Sony ARW and Canon CR2), and embedded previews whose aspect ratio
differs from the visible sensor area, if any can be found.

## Constraints

- Showing an overlay must not develop the photo or start a full
  development. The camera preview stays what is shown until the user
  chooses Develop.
- Do not change memory or cache sizes without Steve
  (`docs/product/modules/memory-and-caches.md`). The overlay map cache
  already exists; reuse it.
- Speed: measure the whole wait from the key press to the overlay on screen
  for an undeveloped RAW in the grid and in single view. Proposed
  tolerance: the first overlay in the grid within 1.5× the current time for
  a developed photo of the same file, since both measure the same sensor
  data. Record the timings in `docs/technical/performance-table.md`. If
  that tolerance cannot be met, report the numbers before optimising.
- No change to export or Proof output, Grade, pinned shaders, tolerances or
  budgets. Keep the existing overlay colours, strength and sensitivity
  controls and their saved preferences.
- No compatibility code for old projects or preferences (pre-1.0 rule).

## Testing

- Use the RAW copies already in `codebase/output/test-photos/` (for example
  `DSC07060.ARW`, `IMG_0114.CR2`, `IMG_3129.CR2`). Check for an `.hdrf`
  beside a file: graded photos are out of scope. Copy into a temporary
  folder only if a check needs to; never copy per run, and never modify the
  originals.
- Add or extend an Electron driver that turns each overlay on for
  undeveloped RAWs and checks:
  - overlay pixels are present;
  - the overlay rectangle matches the shown picture's rectangle (within one
    CSS pixel);
  - nothing was developed (the picture is still the camera preview).

  Then develop and confirm the overlay stays aligned. Register it in
  `codebase/tests/release/drivers.json`. The driver removes its temporary
  folders in `finally`.
- Keep `library-focus.js` and `library-exposure.js` passing.
- Fast checks from `codebase`: `node --test tests/*.test.js` and
  `.venv/Scripts/python.exe -m pytest tests -q`.
  `test_remembered_failure_does_not_hide_current_grade_cached_scene` is a
  known unrelated failure.
- Run GPU/Electron checks one at a time with
  `HDR_FINISHER_ELECTRON_WINDOW_SIZE=2560x1440`.
- Make a small review page in `codebase/output/review/library-raw-overlays/`:
  downscaled crops of Focus and Exposure on two or three undeveloped RAWs,
  including one portrait. Steve signs off on the look.

## Records

Update `docs/product/modules/photo-library.md`: the decision with today's
date, what is built, and anything left open (direct pictures, graded
photos). Move this brief to `docs/technical/archive/briefs/` when done and
update the map in `ai/AGENTS.md`.

## Questions protocol

Ask Steve before:
- inventing a new user-visible state or badge wording beyond what is
  described above;
- choosing to develop photos in order to show overlays;
- changing behaviour for graded photos.

If the code contradicts this brief, for example if the `meta.bitmap` skip
exists for a reason that makes this unsafe, report it in plain language
with the options and their trade-offs before building.
