# Codex Brief: Make GPU batch export actually fast
## HDR Finisher

**Date:** October 18, 2026
**Branch:** `film-look-rebuild`, from its current tip.
**Module PRD:** `docs/product/modules/export-and-proof.md`. Update it as
this lands. Related: `archive/briefs/codex-brief-library-saved-picture-speed-2026-10-18.md`
(the same CPU stages slow Library pictures).

## What Steve sees

He ran the test build (`dist-electron/win-unpacked`) and batch exported 48
badminton RAWs with one SDR JPEG version (long edge 4000, sharpening off).
The batch estimated **4,622 s left, about 96 s per photo**, hardly faster
than the CPU export (about 130 s per photo). The GPU fans did not spin.

## What Claude observed while it ran (16:04 to 16:12)

- The hidden renderer is on the right card: the NVIDIA RTX 4070 Ti, not
  the AMD integrated graphics. NVIDIA load was 13 to 30%, fans at 0%.
- **The batch worker process was CPU-bound:** about 440% CPU (4.4 cores)
  and 4 GB of memory, for most of each photo.
- **The GPU step itself was quick.** A full-size batch source
  (`source.npy`, 486 MB float) appeared in the spool, and its 164 MB HDR
  lane came back within about 10 to 20 s. Most of the roughly 96 s per
  photo is CPU work before and after the GPU step. Claude did not profile
  which part (RAW decode, Lensfun, session preparation, Denoise analysis,
  mips, encode, or something else).
- **Library saved-grade pictures were rendering at the same time**,
  roughly one every 10 s for 48 pasted photos. They outrank background
  export on the GPU, and their CPU stages compete with the batch worker.
- **Spool directories leak.** About 10 finished `delivery-*` directories
  (51 to 184 MB each, with `result.json`, `hdr.bin`, `sdr.bin`) stayed in
  `%TEMP%\hdr-gpu-delivery-*`, and old spool roots from earlier launches
  remain. Over a long batch this can fill the disk.

## Goal

A batch of graded RAWs exports in a few seconds per photo, as the GPU-first
decision intended. The GPU is the busy part, not the CPU. Grade stays
usable, and Library pictures don't starve export.

## What to do

1. **Measure each stage of one batch photo** (decode, preparation, spool
   write, GPU render, readback, encode, write) and report the table.
2. **Remove or shrink the CPU stages that dominate.** The design is your
   choice. Directions to consider:
   - pass pixels to the renderer without a 486 MB disk round trip each
     way;
   - don't redo full-size CPU work the GPU graph already does;
   - decode the next photo while the GPU renders the current one;
   - encode in parallel.
3. **Fair sharing with Library pictures.** Visible Library pictures may go
   first, but a running batch must keep moving: for example, a fair share,
   or Library background (non-visible) pictures waiting behind export.
4. **Fix the spool leak.** Every finished, failed or cancelled delivery
   directory is removed, and stale spool roots from earlier launches are
   cleaned at start.

## Constraints

- Export output stays within the agreed perceptual limits against the CPU
  path (ΔE 2000 / ΔE ITP, mean below 1.0, p99.9 at or below 3.0), and the
  HDR ceiling holds.
- Export encoders, gain-map maths and file naming don't change.
- Grade keeps priority. CPU fallback keeps working.

## Testing: light (Steve tests first)

- Fast checks before each commit.
- Report the per-stage table before and after on 3 badminton photos
  (read-only), and the per-photo batch time.
- No release check or sweeps. Ask before anything slow.

## Hand back

A plain-language note: seconds per photo before and after, how much of it
is now GPU, and how to launch the build.

## Status (Claude, October 18, 2026)

Done, uncommitted until the fast checks pass: items 3 and 4, plus part of
item 2 (two photo workers overlap CPU decode with the GPU step). The main
cause was found: preempted or long-queued exports fell back to the CPU.
Details are in the Export and Proof module PRD. Still open in item 2:
moving pixels to and from the renderer without the disk round trip, and
measuring the per-photo time with these changes on Steve's batch.

## October 19 outcome

The GPU RAW follow-up brief takes over the disk round trip and batch-stage
measurement. Its parts 1-2 replace pixel files with shared RAM. Scheduling,
cleanup and fairness remain as built here; later work is tracked by the
module PRD and codex-brief-gpu-raw-follow-ups-2026-10-19.md.
