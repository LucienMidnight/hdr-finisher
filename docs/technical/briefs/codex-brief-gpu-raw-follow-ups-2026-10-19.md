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

### Parts 1–2 outcome — October 19

Steve approved combining parts 1–2. Cold saved-grade Bayer RAW pictures now
use GPU development with saved lens settings and full-source measurements.
Delivery source and finished lanes travel through job-owned OS shared RAM;
only metadata spools remain. Blob uploads, fairness, cleanup and recorded
CPU fallback remain. No half-size RAW decode, encoder or gain-map changes.

Steve's corrected qualification rule: colour agreement is measured **before
encoding**, with the same mean < 1.0 / p99.9 <= 3.0 at Fit and native size.
The exact HDR ceiling remains measured **after encoding**. Three disposable
badminton RAWs pass at 2560 and Fit/1280. DSC07060 and DSC07061 additionally
exercise manual Lensfun distortion and vignetting (Samyang 135 mm profile);
DSC07060 retains its grain and Denoise. Worst HDR mean 0.06417 / p99.9 1.54996;
worst SDR mean 0.02381 / p99.9 0.23240. DSC07072's isolated RAW comparison also
passes (HDR p99.9 0.39779). No numeric limit changed.

Controlled disk/RAM replays have byte-identical encoder inputs and final
JPEGs. The single requested rerun moved the bad values: DSC07061/DSC07072 now
have 256 changed HDR red values starting at (161,674), instead of earlier
(33,578) SDR / (417,866) HDR locations. Previous SDR failures did not repeat.
Steve attributes these moving failures to his known faulty RTX 4070 Ti VRAM,
also observed in Resolve/Affinity. No retries, guards or hardware workarounds.
The garbage widened the encoder gain-map range, changing HDR quantization;
SHA-256 before Blob upload and after shared-memory receipt matches exactly.
Original before/after JPEG pairs are preserved byte-for-byte with the viewer:
`codebase/output/gpu-raw-followups/HDR-screen-pairs/compare.html`.

The cold DSC07072 saved picture improved from 10.13 s to 6.71 s: sensor 0.26 s,
GPU RAW 1.09 s, remaining delivery 2.79 s, encode 2.43 s (largest stage).
The about-1-second goal is not reached. Initial batch samples were 12.33 to
13.46 s/photo; no timing tolerance preceded those observations. The focused
stage measurement below uses the proposed 5% timing noise allowance, two
batch workers, 4000 px, JPEG 95/444/full gain map, no sharpening. Per-photo
stage times overlap across workers; throughput is total batch time / 3.

Batch throughput: 14.03 → 13.64 s/photo.

| Photo | RAW prep s, disk → RAM | Active GPU s, disk → RAM | Encode s, disk → RAM | Upload s, disk → RAM |
| --- | ---: | ---: | ---: | ---: |
| DSC07060 | 3.75 → 3.60 | 11.29 → 10.59 | 5.13 → 5.86 | 0.88 → 0.70 |
| DSC07061 | 3.79 → 3.62 | 7.64 → 6.70 | 5.57 → 5.44 | 0.88 → 0.46 |
| DSC07072 | 3.48 → 3.69 | 7.60 → 7.90 | 4.76 → 4.99 | 0.77 → 0.70 |

Encoding is the largest individual stage. Removing disk transport does not
remove CPU RAW preparation from batch export. One-sample stage variations
are observations, not a claim that every stage got faster.

Checks: 540 Node passed; 2311 Python passed, 3 skipped, 19 serializer warnings
(6 min 27 s); focused backend checks 56 passed. Real Electron GPU and forced-
CPU export/Proof smoke passed, decoded peak 668.73 against 1000 nits. All
qualification instrumentation restored; captures remain only in ignored output.

### Delivered HDR ceiling repair - October 19

DSC07060 input is exactly 800.000 nits, but its old JPEG reaches 1213.147
BT.2020 channel nits and 1055.428 luminance nits. Independent direct
libultrahdr half-float decode and gamut conversion confirm the measurement.
The default bypassed the existing correction, including Proof and Library.

Enabled targets are now enforced on every encoded export, Proof and saved
picture. Dim inputs are also decoded; files still over target are rejected
and removed. Existing local correction, encoders and gain-map maths stay.
With Highlights off, the optional setting checks the 10,000-nit codec ceiling.
Saved-picture cache v6 refreshes earlier pictures.

Real saved DSC07060 at 4000 px: GPU export and full-size Proof peak at
797.075 nits; forced CPU both reach 781.706. Each Proof is byte-identical to
its export. GPU export took 31.64 s; CPU 137.32 s. Exact checking adds decode
and correction time. The original HDR viewer also includes this ceiling pair.

Checks: 540 Node passed; 2311 Python passed, 3 skipped, 19 existing serializer
warnings (11 min 13 s, overlapping the real CPU check). Focused encoder/Proof
checks: 65 passed, covering JPEG, AVIF and JPEG XL. The real driver first
hit a connection reset after synchronous external decode blocked its network
loop; asynchronous inspection fixed the setup and the error did not repeat.
No production retries, guards or card workarounds.

### Part 3 outcome - October 19

GPU RAW thumbnails now retain their starting document, full-source measures,
RAW settings and source fingerprint in the existing picture cache. Paste
reuses it under the existing per-photo lock; simultaneous checks cannot
repeat development. Older scene cache entries rebuild once (v6). Missing
starting documents retain CPU preparation with a recorded reason.

Real app timing: CPU preparation 4.364 s; three concurrent reuse requests
0.031 s total, within the proposed 5% timing-noise allowance. No rendering
maths or pixels change; parts 1-2 picture qualification remains applicable.
Try: let a fresh RAW thumbnail develop in Library, then paste a grade.

Checks: 540 Node passed; 2312 Python passed, 3 skipped, 19 existing warnings
(8 min); focused backend 14 passed; real Electron paste/reuse passed.

### Part 4 outcome - October 19

Library RAW reservations now use the delivery broker's budget alongside
resident Grade/Library resources. One background GPU job runs at a time;
Grade preempts at bounded submissions, and delivery's existing queue ageing
also applies to RAW thumbnails. Admission is locked across request threads.
RAW frees its buffers before releasing the reservation and requeues after
preemption, with no CPU fallback for queue waits. Closed/cancelled work drops
its reservation; abandoned requests expire. True insufficient memory and
missing/software/lost GPUs retain the recorded CPU fallback.

RAW scratch reserves 44 bytes per sensor pixel plus 64 MiB. Early release of
intermediates keeps the working set inside it; allocation peak is recorded.
The reserved uniform slot 21 supplies the row offset for 128-row submissions;
pixel coordinates, reductions and maths stay unchanged. Retained Library
scenes outside the current proxy are now included in shared accounting.

Three badminton thumbnails pass: worst HDR mean 0.0266 / p99.9 0.0774, SDR
0.0182 / 0.0590. GPU RAW takes 1.0-1.6 s including scheduler checks versus
about 4.8 s for CPU development. This is not a like-for-like speedup claim
against the earlier saved-picture timing; scheduler checks add round trips.
Real GPU and forced-CPU export/Proof smoke passes, delivered peak 668.73 nits
against 1000. HDR mean 0.6250 / p99.9 2.7562; SDR 0.5647 / 2.7821.

Large sharpened originals still need full-frame finishing scratch (six float
images, 96 bytes/output pixel). Staying on GPU requires tiled resize and
multiscale sharpening with filter overlap and matching boundaries; increasing
the shared budget cannot make those allocations fit. The existing memory
fallback remains. Try Library scrolling and batch export while adjusting
Grade; the broker reserves Grade's turn before admitting another RAW job.

Checks: 541 Node passed; 2314 Python passed, 3 skipped, 19 existing warnings
(8 min 15 s). Focused broker: 13 passed, including reservation accounting,
Grade preemption and aged export fairness. Two serial Electron drivers passed:
RAW picture agreement and GPU/CPU export/Proof. No numeric limits changed.

### Part 5 outcome - October 19

Grid, Single, Compare and full-screen Bayer RAW pictures now share the same
GPU development and full-source measurements. One development produces 640
and 2560 px scenes directly from the full source; concurrent requests merge.
Neighbours retain GPU textures within the existing bounded cache. First
100% zoom develops one full source on the GPU into RAM; subsequent viewport
crops reuse it. Moving to another photo replaces that one retained source.
No full-size native scene is written to disk. CPU fallback uses Grade's full
development, with a recorded reason. Scene cache v7 refreshes older views;
CPU and GPU native crops have separate keys so fallback crops cannot shadow
a newly developed GPU source. Saved-grade zoom behaviour is unchanged.

Three badminton RAWs pass at 2560, Fit/1280 and native viewport detail, with
manual Lensfun corrections on DSC07060/61, grain and a local adjustment.
Worst HDR mean 0.09243 / p99.9 1.80228; SDR 0.05364 / 0.83131, before encoding.
All use the unchanged limits. Cold two-size preparation takes 1.92-2.34 s,
cached requests about 6 ms; prepared neighbour navigation takes 56 ms. These
are observations under the existing 5% timing allowance, not a new speed
guarantee. First native preparation measured 3.44-4.40 s including full-source
transfer; this is the remaining cost when entering 100%, not when panning.
There is no like-for-like previous Single timing for this three-photo setup.

Try: let neighbouring RAWs finish, open Single, use the arrow keys, enter
full screen and click 100%. The same starting look now follows each view.
Checks: 541 Node passed; 2315 Python passed, 3 skipped, 19 existing warnings
(9 min 32 s); focused native/cache checks 20 passed after the crop-key fix.
The Single driver and four-make unedited grid driver pass, run serially.
The first two UI attempts passed native zoom but tried a hidden toolbar
button to exit full screen; correcting the driver to use its keyboard
shortcut resolved that test-control failure. No production retry or guard.

Next: part 6 report only. Ask before slow work or pushing.

### Intended result

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
