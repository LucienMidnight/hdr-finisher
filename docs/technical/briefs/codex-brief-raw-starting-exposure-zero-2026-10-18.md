# Codex Brief: RAW photos start with Exposure at zero
## HDR Finisher

**Date:** October 18, 2026
**Branch:** `film-look-rebuild`, from its current tip.
**Module PRD:** `docs/product/modules/import-and-raw.md` (open work item 1,
decision of 2026-10-11). Also touches `docs/product/modules/photo-library.md`
(paste rules) and master PRD priority 3. Update all three as this lands.

## What Steve sees

- A newly opened RAW shows a non-zero Exposure value in Grade (the
  metered starting exposure). He wants Exposure to read 0.0 on every photo
  he has not touched.
- The Library's unedited thumbnails may not match what Grade shows when he
  opens the same photo.
- Copy and paste shipped with a temporary rule for RAW exposure (paste as
  a change from each photo's own start). That rule was only ever meant to
  exist until this work was done.

## Goal

Every photo, RAW included, opens with Exposure at 0.0 in both HDR and SDR.
At zero, a RAW looks about as bright as the camera's own JPEG of that shot.
The Library's unedited picture and Grade's starting picture of the same
photo match. Exposure then pastes as a plain number.

## What is there today (Claude read this; confirm it)

- `loader.py` `_recommended_raw_exposure_ev` meters each RAW (median and
  90th percentile, clipped to −2..+4 EV, then any lift reduced by 1.5 EV).
- `sessions.py` `_apply_import_defaults` puts that value on the Exposure
  controls and records `default_exposure_applied` in the metadata.
- `library_pictures.py` `default_look` meters again, on a downsampled
  sample (so it can differ from Grade's value), and then adds a further
  +0.25 EV that Grade does not add.
- `library_paste.py` `raw_exposure_from_start` is the temporary paste rule.
- `library_pictures.py` `camera_preview` already extracts the camera's
  embedded JPEG, which is useful as the comparison target.

## Direction (Steve's decision, October 11)

- The Exposure control starts at zero. Nothing is hidden on it.
- RAW development is tuned so that the camera JPEG, the RAW as first
  shown, and Grade's starting point roughly agree.
- Generic, not tuned to one camera (decision of October 9).
- **Steve, October 18:** the starting brightness follows how the photo
  was shot, like the camera JPEG, not a per-photo automatic meter moved
  out of sight. A deliberately dark or
  bright shot stays dark or bright. If the tuning needs a per-camera or
  per-file baseline (for example DNG `BaselineExposure`, or a fixed
  development offset), that is fine; a per-image meter hidden inside
  development is not, unless Steve says so. If the measurements in step 1
  suggest the meter is needed after all, stop and say why.

How the baseline is implemented is your choice.

## Steps

1. **Measure first, change nothing.** On Steve's own RAW folders (the
   Library's pinned folders; the badminton folder is a good start; cover
   at least two camera makes if he has them, and both bright and dark
   scenes), compare the camera JPEG's mid-tone brightness with Grade's
   current start, and with the same RAW at Exposure 0. Report the gap in
   EV per photo, in a short table. Propose the tuning from this.
2. **Tune RAW development** so the start at zero lands within the
   tolerance below.
3. **Zero in Grade and the Library.** Remove the metered start, the
   Library's second meter and its +0.25 EV. The Library's unedited look
   must come from the same starting state as Grade, not a copy of the
   logic that can drift.
4. **Paste.** Remove the temporary RAW exposure rule. Exposure pastes as
   a plain number like every other control. Update the paste rules in the
   Library module PRD.
5. **Caches.** Unedited Library thumbnails and saved-grade pictures made
   with the old start must not be reused. Make sure they regenerate.
6. **A side-by-side sheet for Steve.** Save one image (or a small HTML
   page) under `output/` with, for 12 to 20 of his photos: camera JPEG,
   old start, new start. He judges the result by eye before this is
   called done.

## Tolerances (proposed by Claude, record in the module PRD)

| Check | Limit | Why |
| --- | --- | --- |
| New start vs camera JPEG, mid-tone brightness (SDR) | Within ±1/3 EV on at least 80% of the test photos; none beyond ±1 EV | Camera JPEGs carry their own tone curve, so exact agreement is not expected; 1/3 stop is about the smallest change people notice when flipping between pictures. |
| Library unedited picture vs Grade's start, same size | The agreed perceptual limits: ΔE 2000 (SDR) / ΔE ITP (HDR) mean below 1.0, p99.9 at or below 3.0 | Same limits the Library already uses against export. |
| Non-RAW files (EXR, gain-map JPEG/HEIC/AVIF, linear DNG, SDR) | Unchanged | This work is about camera RAW only. |

## Constraints

- **Strict testing applies.** This changes what RAW import produces, so it
  changes export and Proof output for every RAW. Run every check that
  covers RAW import, export and Proof, per `ai/AGENTS.md` "Still strict".
  Never save over the read-only test projects.
- No migration (pre-1.0 rule). RAW grades saved before this will look
  brighter or darker. Look in Steve's real projects and `.hdrf` files as
  well as the test projects, then name the affected ones in one line.
- Highlight-compression peak syncing at the start (`_sync_highlight_source_peaks`)
  must still see the starting state correctly.
- Do not change white balance, demosaic, highlight reconstruction or
  camera colour unless the measurements show one of them is the cause of
  the brightness gap. If so, say so before changing it.
- Do not touch GPU delivery, the Library speed work or the Film Look
  rebuild beyond what this needs.
- Tests check results (brightness, saved grade values, pasted values),
  not wording or code shape.

## Questions protocol

If the code disagrees with this brief, or step 1 shows the direction
above will not work, stop and report before changing anything. Do not
invent a new starting-look system without checking first.

## Report back

In plain language for Steve: the step 1 table, what was tuned, the
tolerance results, the side-by-side sheet's path, which projects are
affected, and which checks ran.
