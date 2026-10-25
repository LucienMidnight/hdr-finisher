# Codex Brief: Use all cores, then qualify preview codecs

## HDR Finisher, Photo Library and core

**Date:** October 25, 2026 · **Written by:** Claude, for Steve · **Read first:** `ai/AGENTS.md`

**Follows:** [Library responsiveness core](codex-brief-library-responsiveness-core-2026-10-25.md),
Steps 0–3 (committed through `3e9bfb4`).

## Goal

1. **Part A, threads.** CPU work that cannot run on the GPU uses the whole
   machine instead of one thread or a small fixed count. Background work scales
   up too, and stays out of the way by priority and yielding, not by caps.
   This is the new master PRD principle "Use the whole machine" (principle 3).
2. **Part B, codecs.** Decide which compressed format should carry HDRF's
   finished browsing previews, using real finished pictures, so the next brief
   can build stored previews. This part is an offline experiment plus a report.
   It does not integrate anything into the app.

## Part 0: make fullscreen navigation usable now (do first)

**What Steve saw (October 25, 16:06, mixed folder, after Step 3).** It felt
"awful and inconsistent": a few photos appeared at once, but scrolling did not
work well, even though grid thumbnails had loaded for the whole folder.

Logs, 88 fullscreen requests:

- Window hits: 2–10 ms.
- Misses: 270–800 ms. Mostly the stored-scene pixel fetch (180–800 ms), then
  render, with lease waits up to 280 ms.
- 28 requests never showed a picture: superseded and cancelled as Steve moved
  on.
- One miss queued 2,005 ms behind neighbour drawing.
- One uncached AVIF took 8.1 s.
- Earlier (15:36), graded badminton photos rendered in 1.7–2.8 s each at Fit.

The ±2 window fills at about one photo per 0.3–0.8 s, so ordinary navigation
outruns it.

**Outcome**

1. **Grid picture as a stand-in (Steve approved, October 25).** When the sharp
   fullscreen picture is not ready, show that photo's own finished grid or
   filmstrip picture at once, scaled to Fit, then replace it with the sharp
   picture when it is ready. The stand-in must:
   - be the same photo, with the current grade and the current HDR/SDR mode;
   - never be a camera embedded JPEG (the October 14 rule still stands);
   - never show another photo, or an obsolete grade, even briefly.

   If no finished grid picture exists, keep the current behaviour.
2. **The current photo always goes first.** Work for the selected photo never
   waits behind neighbour prefetch. Neighbour work yields or is pre-empted.
3. **Finish where the user stops.** Rapid navigation shows stand-ins
   immediately. Once navigation pauses, the photo on screen is drawn sharp
   rather than lost to cancellation. Prefetch in the direction of travel, as
   far as budgets allow.
4. **Cheaper misses.** Cut the stored-scene fetch cost, for example by
   avoiding the backend float32 round trip, unneeded reference arrays and
   repeated transfers of recently used scenes. Codex chooses how. Pixels must
   not change.
5. **Explain slow renders.** Report what dominates the 1.7–2.8 s Fit render of
   graded photos (Denoise, grain, analysis or otherwise) and what could be
   cheaper for Library Fit. Do not change the look without asking; report the
   options.

**Report** the same key-to-picture breakdown from the log after a short try,
including how often a stand-in versus a sharp picture appeared.

**Part 0c follow-up, October 25 (built; stop for Steve's try).** Graded quick
pictures now use their own renderer/priority queue, model measurement happens
outside draw queues with bounded exact-identity reuse, and both sizes of all
in-window neighbours start preparation before the selection finishes sharp.
The module PRD records the one graded-copy trial and each fullscreen request's
stand-in, sharp-ready, queue and Denoise times. The cold model cost remains;
no Denoise algorithm or appearance change was made. After Part A, remeasure the
module PRD's "Known slow items to target" from a short normal-use run and update
that table before Part B. Parts A and B remain open.

## Part A: thread audit and fixes

**Part 0b follow-up, October 25 (before A/B).** Steve's badminton try requires
a correct 640-scene stand-in when no finished grid picture exists, a quiet gate
before source misses, preservation/promotion of in-window preparations and
draws, Library surface eviction before RAW GPU budget fallback, Denoise model
reuse without repeated scene loads, and removal of false Grade helper pauses.
The implementation/outcome is recorded at the start of the Photo Library
module PRD. Stop after committing Part 0b for Steve to retry. Parts A/B remain
open; this brief stays here until they are completed.

**Known caps** found October 25. Confirm each in the code; this list may be
incomplete.

| Where | Current limit |
| --- | --- |
| `library_worker.py` helper | native threads = half the logical CPUs; decode workers 1; index workers 1 |
| `library_raw_decode.py` RAW decode workers | OMP/BLAS threads forced to 1 per process |
| `import_bands.py` Grade import | at most 2 bands |
| `sdr_gamut.py`, `local_adjustments.py` brush | half the CPUs, at most 8 |
| `adjustments.py` grain, `denoise_adaptive.py` | CPUs minus 1, at most 8 |
| `retouch_jobs.py`, `sessions.py` source hash | 1 worker |
| `exporters.py` Ultra HDR | 2 stripe workers, 3 gain-map workers |
| Library scene scheduler (`library-scenes.js`) | 2 source slots, 1 heavy |
| AVIF / Ultra HDR decoding | per-photo command-line processes; no thread setting |
| Indexing metadata batches | one helper lane, 32-photo batches |

**Outcome**

- Thread counts derive from the machine (logical CPUs), not from fixed small
  numbers.
- Background processes and threads run at below-normal OS priority, so
  foreground work wins when it needs the CPU.
- Existing pause and yield gates (Grade, export, Proof) keep precedence.
- Where several parallel jobs each use many threads, avoid oversubscription
  (for example two source slots each using all cores) in a reasonable way of
  Codex's choosing.
- A cap may remain only with a one-line reason in the code: measured memory, a
  non-thread-safe library, or a GPU or I/O bound.
- Indexing a large library should use more than one lane when the machine has
  spare cores, while preserving Step 1–2 behaviour: foreground never waits on
  the shared lock, and maintenance stays scoped.

**Scope limits**

- Do not change export or Proof thread counts in a way that changes output
  pixels. If a change there can alter results (for example in ordering-sensitive
  maths), report it instead of making it.
- Leave Library memory budgets and GPU broker budgets unchanged.

**Report:** a short before/after table of each limit, plus one rough timing
where it is cheap to get (for example indexing photos per second on a database
copy, or one Library source preparation). No timing sweeps.

## Part B: preview codec qualification (offline)

**Candidates.** Encode and decode in-process, never through per-photo
command-line tools:

| Candidate | Form |
| --- | --- |
| JPEG Ultra HDR | Authored SDR as the base plus gain map (libultrahdr via `imagecodecs`, or an equivalent in-process binding). Settings: q90/q95, gain map at full and half size, and a wider-gamut gain map where supported. |
| AVIF 10-bit PQ | HDR rendition. The SDR rendition as either a separate small file or an AVIF gain map, whichever is practical in-process. |
| JPEG XL | Separate HDR (PQ, BT.2100-tagged, 16-bit) and SDR files; each display mode decodes only its own file. A gain-map single file needs a native libjxl binding (libjxl 0.12 has the API; `imagecodecs` does not expose it). Estimate that work, but do not build it unless it is small. |
| Reference only | Lossless half-float, for exact comparison. |

**Pictures**

- Use real finished output from the existing GPU renderer (HDR and authored
  SDR, as Library draws them at 2560 px Fit).
- Use the existing 16-source RAW comparison set, plus "alley" (wide HDR range)
  and IMG_0790 (wide gamut). Both were earlier Ultra HDR failures.
- Include a few graded photos with grain and Denoise.

**Measure for each candidate and setting**

- Bytes per photo.
- Encode time.
- Decode time at 1 thread, 4 threads and all threads.
- For Ultra HDR, decode as two parts as well: base JPEG plus gain-map JPEG,
  with the gain map applied in a small WGSL shader on the GPU. Compare that
  output with libultrahdr's own HDR reconstruction.
- Perceptual difference against the uncompressed finished pictures, using the
  existing Library guide (HDR and SDR mean below 1.0, p99.9 at most 3.0).
- The exact 1000-nit HDR ceiling after decoding.

**Electron's own decoders.** Optional, if cheap: the app's Chromium 150 decodes
JPEG XL only with the `JXLImageFormat` feature on (checked October 25: 78 ms
HDR versus 37 ms for 8-thread libjxl). Ultra HDR and AVIF decode natively.
Check whether `createImageBitmap` into a WebGPU half-float texture keeps HDR
precision for any format. Report it; do not depend on it.

**Deliverable**

- A short report in the module PRD's codec section: a table, a recommended
  format with settings, and the trade-offs.
- A simple local HTML page of side-by-side crops for Steve to judge by eye:
  the worst cases per candidate, in HDR and SDR.
- The pictures and scripts stay in a scratch or ignored folder, not in the
  repo.

## Safety

Never write to Steve's live library database, photos, sidecars or cache
folders. Read copies only. No app behaviour changes in Part B.

## Testing: absolute minimum (Steve, October 25)

- **Part 0:** fast checks once, plus a small result test that a stand-in never
  shows the wrong photo or an obsolete grade. At most one existing Library
  Single/live GPU driver, once. Steve judges the feel in the app.
- **Part A:** fast checks once at the end, plus a small result test only where
  a change could affect output. No GPU drivers unless a change touches GPU
  code.
- **Part B:** no app tests needed; it is an experiment.
- No sweeps or release runner. If something would exceed about 30 minutes of
  slow tests, stop and ask.

## Questions protocol

Ask before changing export or Proof output, a tolerance or budget, or
anything about how ratings and grades are saved.


## Part 0 handoff — October 25, 2026

Implemented Part 0 only; Parts A and B remain unstarted at Steve's requested
stop. The approved stand-in borrows the same photo's finished live surface,
checking source/grade identity, display epoch and HDR/SDR. Selected work now
preempts lower priorities and unfinished neighbour demand restarts at selected
priority. Memory polling no longer discards that selection during source waits.
Neutral-geometry transport packs the chosen stored half-float lane directly;
exact packed bytes are checked against the ordinary geometry/render-cache path.

The one Step 3 Library fullscreen RAW follow-up passed at 2560x1440 **before**
these changes. No second GPU run. Detailed stage breakdown, observed counts,
slow-render findings and options are in the module PRD's October 25 Part 0
entry. Old logs cannot split Denoise from film/grain/halation time; the two slow
badminton grades have all of those enabled. No look change was made. Added
Library-only Denoise/mask stages and stand-in/sharp presentation flags for the
next normal-use logs. Post-change timing/counts await Steve's short try.

Validation and commit outcome are recorded in that module entry. No live
library database, photos, sidecars or cache folders were written. Keep this
brief active for Steve's try and the later Parts A and B.


## Part 0d follow-up — October 25, 2026

Implemented the cold fullscreen follow-up before Part A: draw fresh developed
thumbnail/screen preview data from memory, save afterwards, give the selected
photo first development and promote it on stopping. The apparent two-second
lease wait was a neighbour development admitted while the selection saved.
The quiet gate is now 350 ms. Capacity inspection and the one isolated GPU
run's per-request breakdown are in the module PRD's Part 0d entry.
Allowances are unchanged. Commit and stop for Steve's try; Parts A/B remain
unstarted. This brief remains active for those unfinished parts.
