# Codex Brief: Finish GPU RAW development and remove the disk round trip
## HDR Finisher

**Date:** October 19, 2026
**Branch:** `gpu-raw-library`, from its current tip.
**Module PRDs:** `docs/product/modules/photo-library.md` (section 5, item 1,
"Not yet covered") and `docs/product/modules/export-and-proof.md` ("Not
built" and open work item 1). Update both as each part lands.
**Supersedes the open part of:** `codex-brief-gpu-batch-export-speed-2026-10-18.md`
(item 2, the disk round trip and the per-photo measurement). Move that brief
to `archive/briefs/` with an outcome note when this one takes it over.

## Goal

Camera RAW development runs on the GPU wherever the app develops a RAW, not
only for unedited grid and filmstrip thumbnails. Above all, an edited photo's
saved-grade picture takes close to the target of about 1 s instead of about
16 s. Pixels reach and leave the GPU delivery renderer without full-size
files on disk. The CPU stays the fallback everywhere, and the reason it was
used is recorded each time.

## Where things stand

GPU RAW development is built for grid and filmstrip thumbnails
(`frontend/library-gpu-raw.js`, `backend/hdr_finisher/library_gpu_raw.py`,
`tests/library-gpu-raw-grid.js`). A cold thumbnail takes 0.5 to 0.8 s
against 2.4 to 8 s on the CPU, and five real RAWs pass the agreed limits.
Saved-grade pictures already render through the shared hidden GPU delivery
renderer (`frontend/gpu-delivery.js`, `backend/hdr_finisher/gpu_delivery.py`,
`library_pictures.py`, `library_picture_queue.py`). But they still develop
the RAW on the CPU first.

Measured on the badminton RAWs (42 MP Sony, USB HDD), October 18, for one
saved-grade picture:

| Stage | Time | Where |
|---|---|---|
| Reopen and develop the full RAW (decode 2.5 s, lens correction 3.1 s, colour and analysis) | 8 to 10 s | CPU |
| Denoise preparation and pixel transport | most of 4 to 7 s | CPU / disk |
| Creative render | about 0.8 s | GPU |
| Ultra HDR encode | 2 to 5 s | CPU |

Export has the same shape: 10 to 12 s of GPU-step time per photo, much of
it moving full-size float pixels through disk files (a 486 MB source and
two 163 MB lanes for a 42 MP photo at 4000 px output).

## The work, in order

Each part should land and be checked on its own before the next starts.
Report after each part (see "Hand back").

### 1. Saved-grade pictures develop the RAW on the GPU (priority)

When an edited camera RAW needs its saved-grade picture (after a grade
change, a paste, a cache version change or a cold cache), the RAW is
developed on the GPU, the same way the grid thumbnails already are, and
then handed to the delivery render without going back through the CPU
development.

- Measure each stage of one saved-grade picture before you start, and again
  after. The table above is from logs, not a profiler.
- The development must match what Grade and export develop for that photo:
  the same lens correction, the same starting state and the same full-source
  measurements. The picture must stay within the agreed limits against
  export of the same grade.
- Look at Denoise preparation and the encode too. If one of them is now the
  largest stage, say so, with numbers, and suggest a next step. Don't change
  the encoder or the gain-map maths.
- The two-lanes-at-once overlap that is already built stays, unless your
  measurements show it no longer helps.

### 2. No full-size disk round trip for the GPU delivery renderer

Saved-grade pictures, batch export and Proof hand their pixels to the hidden
renderer, and get their lanes back, without writing and reading full-size
files on disk. You choose the design. The Blob upload fix (October 19) is
already in. Build on it, don't undo it.

- Report the per-photo batch time on 3 badminton photos before and after,
  with the stage table. That measurement was left open by the batch export
  brief.
- Spool cleanup (built October 18) keeps working for anything that still
  uses a spool.

### 3. Paste starts from the GPU-developed photo

When a grade is pasted onto a RAW whose thumbnail the GPU already developed,
paste reuses that development and its starting document instead of
preparing the photo the slow CPU way. Each photo is still developed at most
once, even when the change check and the paste ask at the same time.

### 4. One GPU memory budget across Grade, delivery and GPU RAW

A GPU RAW development briefly holds up to about 2 GB. With Grade open, a
batch export running and Library pictures in flight, the three must not
together exceed what the card has. When there isn't room, work waits or
takes the CPU with a recorded reason. It must never crash, lose the device,
or slow Grade's interactive preview. `frontend/gpu-budget.js` and
`gpu-allocator.js` may already be the right home. Your call.

Related, from Export and Proof: large sharpened originals can exceed the
budget because delivery finishing still needs full-frame scratch. If the
shared budget lets them stay on the GPU (tiled finishing, for example), do
it. Otherwise report what it would take.

### 5. Single and full-screen views use the GPU-developed version

In the Library's Single and full-screen views, a camera RAW shows the same
GPU-developed version the grid uses (step 4 of the Library speed plan),
not a separate quick decode. This also settles the "separate quick decoder
mismatch" noted under RAW picture agreement. A flip to a neighbouring photo
should feel immediate when that photo is already developed.

### 6. Report only: X-Trans, DNG and other RAW types

These still use the CPU route everywhere. Don't build GPU support. Report
what each would need and roughly how big the job is, so Steve can decide.

## Constraints

- **Perceptual limits** (Steve, October 18): SDR ΔE 2000 and HDR ΔE ITP,
  per image and per lane, mean below 1.0, 99.9th percentile at or below 3.0,
  including grain and local adjustments. Only the HDR highlight-compression
  peak limit is exact. Check at Fit and at 100%.
- **No half-size RAW decode** for Library pictures. It was tried and
  rejected on October 18 because bright highlights failed the limits
  (`photo-library.md`, "Tried and rejected").
- Grade keeps GPU priority. Export keeps the October 18 fairness rules (no
  CPU fallback because of preemption or queue wait).
- The export encoders, gain-map maths, file naming and saved-grade cache
  location stay the same. Cache versions may change if pixels change. Old
  entries must refresh, not break.
- Pre-1.0: no migration code for old caches or projects beyond the existing
  version invalidation.
- CPU fallback keeps working on machines with a missing, software or lost
  GPU. Every fallback logs its reason.
- Don't touch Steve's real projects or photos except to read them. The
  release runner's read-only hash check must still pass.

## Testing: light, per `ai/AGENTS.md`

- Fast checks before each commit (`node --test tests/*.test.js`, `.venv`
  pytest).
- For each part, only the one or two GPU checks that cover it, one at a
  time, at `HDR_FINISHER_ELECTRON_WINDOW_SIZE=2560x1440`. Add a driver where
  none covers a part, and add every new driver to
  `tests/release/drivers.json`.
- Perceptual comparisons on 3 to 5 badminton RAWs (two with lens
  corrections) for parts 1, 2 and 5.
- Parts 1 and 2 touch the export and Proof path, so they are "still strict"
  under `AGENTS.md`. Run the export and Proof checks for them once, together,
  not once per change.
- No release check, full sweep or endurance run unless Steve asks. If
  something would take more than about 15 minutes, stop and ask.

## Stop and ask

- If a part can't stay within the perceptual limits without a change Steve
  would see.
- If parts 1 and 2 turn out to need one shared design that changes the
  order above.
- Before pushing anything.

## Hand back, after each part

A short plain-language note for Steve (he is not a coder):

- seconds per photo before and after, and which stage is now the largest;
- whether pictures still match export (worst mean and p99.9);
- anything that falls back to the CPU, and why;
- how to try it in the app.

Update the module PRDs' status lines in the same commit as the code.
