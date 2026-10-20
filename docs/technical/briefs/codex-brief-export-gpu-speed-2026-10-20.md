# Codex Brief: Make GPU export fast end to end
## HDR Finisher

**Date:** October 20, 2026
**Branch:** `gpu-raw-library`, from its current tip (not yet merged to
`main`).
**Module PRD:** `docs/product/modules/export-and-proof.md`. Update its
current state and "Not built" list as each part lands.
**Background:** `docs/technical/archive/briefs/codex-brief-gpu-batch-export-speed-2026-10-18.md`
(its goal was never reached) and
`docs/technical/archive/briefs/codex-brief-gpu-raw-follow-ups-2026-10-19.md`
(the stage table below).

## Goal

A batch of graded camera RAWs exports in a few seconds per photo, with the
GPU doing the heavy work, as the October 18 GPU-first decision intended.
Exported files and Proof keep their current quality rules. Steve wants this
done before a live recorded test session of the whole app.

## Where things stand

Export already renders on the GPU through the hidden delivery renderer, with
pixels handed over in RAM. But a photo still takes a long time:

- **Batch** (two workers, 4000 px long edge, Ultra HDR JPEG 95, 4:4:4, full
  gain map, no sharpening): about **13.6 s per photo** of throughput. For
  each photo, one sample:

  | Stage | Seconds | Where |
  |---|---:|---|
  | RAW preparation | about 3.6 | CPU, still the old development |
  | Active GPU work | 6.7 to 11.3 | GPU (the creative render itself is about 0.8 s) |
  | Encode | 5.0 to 5.9 | CPU |
  | Upload | 0.5 to 0.7 | transfer |

- **Single export, Maximum Fidelity, full size:** about **33 s per photo**
  (three badminton RAWs, October 19). No stage breakdown yet.
- **Large sharpened originals** can exceed the shared GPU memory budget,
  because delivery finishing still needs full-frame scratch. They then fall
  back to the CPU (about 130 s per photo).
- GPU RAW development already exists and is shared by the Library, Single,
  full-screen, paste and saved grades. It develops a 42 MP RAW in about 1 s.
  Export doesn't use it yet.

## The work

Measure first, then remove the biggest costs. Report after each part.

### 1. Measure both cases

Give a stage table for one batch photo and one Maximum Fidelity full-size
single export. Split "active GPU work" into what it actually spends time on
(for example Denoise preparation, tiling, finishing, resize, readback,
waiting for the queue). Propose a timing target for each case before
changing anything, with a one-line reason. A starting point: batch
throughput of about 5 s per photo or less at 4000 px, and full-size Maximum
Fidelity well under 15 s. Steve would rather see an honest target than an
optimistic one.

### 2. Export develops RAWs on the GPU

Export and Proof use the shared GPU RAW development, the same one the
Library uses, instead of the CPU preparation. The same lens correction,
starting state and full-source measurements apply. Unsupported families
(X-Trans, DNG and others) keep the CPU route with a recorded reason. A
photo already developed for Grade or the Library at the right size may be
reused, if that is safe.

### 3. Shrink the GPU stage

Bring active GPU time close to the work the render actually needs. Your
design. Fix whatever the measurement in part 1 shows is waste.

### 4. Faster encoding without changing the files

Make the encode stage faster without changing a single output byte: for
example, encode the HDR and SDR parts or the gain map in parallel, use the
encoder's own threading, avoid repeated start-up, or overlap encoding with
the next photo's GPU work. Byte-identical files before and after are the
check. If a real speed-up would need different bytes, stop and ask, because
that changes the files Steve delivers.

### 5. Tiled delivery finishing

Large sharpened originals stay on the GPU by finishing in tiles within the
shared memory budget, instead of falling back to the CPU. The finished
result must stay within the agreed limits against the full-frame result,
including at tile edges.

## Constraints (export and Proof are "still strict")

- **Perceptual limits:** SDR ΔE 2000 and HDR ΔE ITP, mean below 1.0,
  p99.9 at or below 3.0, judged before encoding (Steve, October 19). Compare
  GPU against CPU, and Proof against export. Check at Fit and at 100%.
- **HDR ceiling:** the finished render (before encoding) never exceeds the
  highlight target, on every route. The check after encoding stays
  **optional**: "Guarantee HDR peak" keeps its current behaviour (per preset
  version, off by default, with the dim-picture skip and the deliver-anyway
  note), as Steve restored it on October 19. Don't make it mandatory. When
  it's on, it must still work and give the same results.
- Encoders and gain-map maths don't change.
- Proof keeps showing the same result as export.
- Grade keeps GPU priority. The October 18 fairness rules (no CPU fallback
  for preemption or queue waits), the shared memory budget, and Library and
  Export tile yielding all stay. Two batch workers is the current default;
  change it only if your measurements show a better number.
- The CPU route keeps working (force-CPU preference, missing or lost GPU),
  with no speed work on it.
- No half-size RAW decode. It was rejected on October 18 because bright
  highlights failed the limits.
- Steve's RTX 4070 Ti has faulty graphics memory. A GPU check that fails
  once but moves or vanishes on a rerun is hardware: say so and don't add
  workarounds. A failure that repeats exactly is a real bug.

## Testing

Export is "still strict" under `ai/AGENTS.md`, so run every export and
Proof check that covers what each part touches. Group parts that touch the
same code and run their checks once for the group, not once per part.

- Fast checks before each commit.
- Perceptual comparisons on 3 to 5 badminton RAWs, two with lens
  corrections, for parts 2, 3 and 5.
- Byte-identity on the same photos for part 4.
- Timings against the targets you proposed, with the 5% noise allowance.
- No full sweep or release check. Stop and ask before anything over about
  30 minutes of slow tests, and before pushing.

## Hand back, after each part

A short plain-language note for Steve: seconds per photo before and after
for batch and for full-size single export, which stage is now the largest,
whether files still pass the limits, what still falls back to the CPU and
why, and how to try it.

## Questions protocol

If anything here conflicts with the code, or a part turns out much larger
than it looks, stop and ask before inventing a new pattern.

## Working record (October 20)

Timing targets proposed before changes: at most 5 s/photo batch throughput
at 4000 px, and under 15 s for a full-size Maximum Fidelity export request.
These reflect seconds-per-photo delivery; retain the 5% noise allowance.
Full-size timing excludes opening the RAW in Grade; record opening separately.

Part 1 baseline, disposable copies, optional peak guarantee off, two batch
workers: 3-photo batch 33.439 s (11.146 s/photo); DSC07060 Maximum Fidelity
full-size request 28.747 s, opening 2.869 s separately. Its GPU job takes
11.221 s; encoding 15.371 s, including gain-map filtering/repackaging 8.027 s.
Encoding is the largest full-size cost. No production behaviour changed
for this measurement; temporary hooks restored byte-for-byte.

Stage seconds for DSC07060 (both lanes combined). Batch time is one photo's
latency within the two-worker run; it is not throughput. Queue/broker is
request wait minus renderer time, including claim/return overhead.

| Stage | Batch photo, 4000 px | Full-size single |
|---|---:|---:|
| RAW opening/preparation | 3.735 | 2.869 (before export request) |
| Queue/broker | 7.194 | 0.378 |
| GPU setup | 0.003 | 0.039 |
| Source transport | 1.335 | 1.206 |
| Denoise preparation | 2.875 | 2.411 |
| Creative tiles (including submission waits) | 2.901 | 3.310 |
| Finishing | 1.859 | 1.503 |
| Readback | 0.326 | 0.706 |
| Finished-pixel transfer | 0.472 | 2.047 |
| Encoding | 3.959 | 15.371 |
| Validation | 0.113 | 0.556 |

Scheduler permits are nested in the GPU stages: 690 calls per job, 2.019 s
for the batch photo and 1.659 s for the full-size single. Finishing includes
unpacking film, resize for the batch, clipping and the final limiter.
The full-size case has no resize or output sharpening.

Part 4 first improvement (largest measured cost): overlap two unchanged
gain-map filter stripes, with only two results in flight and a serial JPEG
writer. Complete repackaged JPEG bytes match the old serial writer on all
three batch outputs and the full-size single. The full-size filtering and
repackaging step fell from 7.766 s to 6.382 s; batch-sized files save about
0.2-0.3 s. These are isolated encoding replays, not new end-to-end timings.
Neither timing target is achieved yet. Encoders, filter maths and its halo
remain unchanged.

Part 2 experiment, not retained: running full-source GPU RAW development as
one delivery job and creative finishing as a second job made the same
three-photo batch take 40.958 s (13.653 s/photo), against the 33.439 s
baseline (11.146 s/photo). It adds a full developed-image readback and a
second upload, plus another turn in the GPU queue. All three used the GPU;
this is a performance rejection, not a perceptual qualification. The
experimental source changes were removed before committing this record.

Continuing part 2 efficiently needs a larger delivery change: keep the
full-source GPU-developed image resident through creative finishing, while
passing its measurements back to initialise the starting settings and
Denoise. Existing Grade/Library source reuse, CPU fallback, priority,
yielding, budget and optional Guarantee HDR peak must remain intact.
Await Steve's decision under the Questions protocol before introducing
that pattern. Parts 2, 3 and 5 remain unfinished, and part 4 has only the
first isolated improvement described above. No post-change end-to-end
speed target has been demonstrated.
