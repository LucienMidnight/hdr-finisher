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
At zero, a RAW's brightness is in the same range as the camera's own JPEG
of that shot. Its contrast may be flatter: contrast comes from the visible
tools. The Library's unedited picture and Grade's starting picture of the
same photo match. Exposure then pastes as a plain number.

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

## Direction (Steve's decisions)

- **October 11:** the Exposure control starts at zero. Nothing is hidden
  on it.
- **October 9:** generic, not tuned to one camera.
- **October 18:** the starting brightness follows how the photo was shot,
  like the camera JPEG, not a per-photo automatic meter moved out of
  sight. A deliberately dark or bright shot stays dark or bright.
- **October 18, after the step 1 measurements: nothing that shapes the
  look is baked in.** No starting tone curve, hidden in development or
  pre-set in Curves. Reasons: Film Look already applies its own film and
  print curves after Curves, so a starting curve would stack contrast
  under every stock; renders and passes (EXR and similar, planned) have
  no camera JPEG and must start the same neutral way; paste and Looks
  stay simple when every file starts neutral. A camera-like starting look
  may come later as a visible Look, not as part of this work.

What *is* allowed, because it defines what Exposure 0 means rather than
adding a look:

- **One fixed brightness calibration for camera RAW**, the same for every
  photo and every camera.
- **Brightness information the file itself records**, for example DNG
  `BaselineExposure`. Using what the file says is not tuning.

Nothing else changes in RAW development. How the calibration is
implemented is your choice.

## Steps

1. **Measure first, change nothing.** Done October 18: 16 photos, five
   camera makes, sheet at `output/raw-start-measure/comparison.html`. At
   Exposure 0 the gap to the camera JPEG runs from −0.65 to +2.38 EV,
   middle about +0.7 EV; five photos are beyond ±1 EV.
2. **Explain the outliers before changing anything.** For each photo
   beyond ±1 EV, say what causes the gap. Likely candidates: brightness
   information in the file that we ignore (DNG `BaselineExposure`, a
   phone's own RAW format), or in-camera brightening of the JPEG such as
   Fuji DR modes, Sony DRO or Nikon Active D-Lighting. In-camera
   brightening is not something to match; mark those photos in the table
   and leave them out of the calibration.
3. **Set the calibration.** Use what the files record, then choose the
   one fixed RAW calibration that best centres the remaining photos.
   Update the sheet with a column for the new start and report back
   before step 4. Steve judges it by eye.
4. **Zero in Grade and the Library.** Remove the metered start, the
   Library's second meter and its +0.25 EV. The Library's unedited look
   must come from the same starting state as Grade, not a copy of the
   logic that can drift.
5. **Paste.** Remove the temporary RAW exposure rule. Exposure pastes as
   a plain number like every other control. Update the paste rules in the
   Library module PRD.
6. **Caches.** Unedited Library thumbnails and saved-grade pictures made
   with the old start must not be reused. Make sure they regenerate.
7. **Final sheet for Steve.** Refresh the comparison sheet from the
   finished code (camera JPEG, old start, new start). He judges the result
   by eye before this is called done.

## Tolerances (proposed by Claude, record in the module PRD)

| Check | Limit | Why |
| --- | --- | --- |
| New start vs camera JPEG | Brightness in the same range, judged by Steve by eye on the comparison sheet. Report the EV gaps as information, not as pass or fail. Photos with in-camera brightening are excluded. | Steve, October 18. The earlier ±1/3 EV target assumed matching the camera's contrast curve, which we no longer do; a flatter start will not measure the same mid-tones. |
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
- Do not change white balance, demosaic, highlight reconstruction,
  camera colour or contrast. If the outliers point to one of them, say so
  before changing anything.
- Non-RAW files keep their current start, unchanged.
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
