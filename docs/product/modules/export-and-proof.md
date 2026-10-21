# Module PRD: Export and Proof

- **Owner:** Steve
- **Master PRD:** [PRD](../PRD.md)
- **Last status check:** October 19, 2026, against the code.
- **Code:** `exporters.py`, `batch_export.py`, `batch_export*.py`,
  `export_presets.py`, `proofing.py`, `hdr_ceiling.py`, `delivery_colour.py`,
  `jpegxl.py`; frontend `export-ui.js`, `batch-export.js`.

## 1. Purpose

Turn a graded photo into delivery files that look the way it looked while
grading: one HDR picture and one SDR fallback, joined by a gain map where
the format allows. Proof shows exactly what an export will write, before
it is written. Export must be fast enough for a batch of graded RAWs to
take seconds per photo, not minutes.

## 2. Scope

- Single-photo export, batch export (Export page and Quick export…),
  export presets, Proof.
- Output formats and their settings, metadata policy, resize and output
  sharpening.
- The HDR ceiling and the perceptual agreement rules for delivery.
- Rendering for delivery on the GPU, with the CPU as fallback.

Not here: Library pictures as a product feature (Photo Library module),
although they are made by the same delivery renderer.

## 3. Output formats

| Format | Role |
| --- | --- |
| AVIF with ISO 21496-1 gain map | Primary. Default: 10-bit 4:2:0 primary, half-resolution 10-bit 4:4:4 gain map. |
| JPEG Ultra HDR | Widest compatibility. Default 4:2:0. A gentle, SDR-guided denoise is applied to the gain map automatically. |
| JPEG XL HDR | Direct Rec.2020 PQ. 12-bit integer by default. |
| SDR JPEG, SDR PNG (8 or 16-bit), SDR JPEG XL | Utility outputs. |

Settings rules (from v1.2 section 5, still in force):

- Defaults are web-correct. Niche codec controls sit behind Advanced.
- Colour encoding is automatic: sRGB for SDR, Rec.2020 PQ for HDR.
- Built-in presets per format: Web Default, Web Optimized, Maximum Fidelity.
  Any manual change shows Custom. Users can save their own presets.
- Dithering (Auto / Off / Subtle) only where 8-bit output needs it.
- Source metadata: None, Copyright only, All except location, All
  including location. Colour and gain-map metadata is never removed.
- Resize: Original, Long edge, Fit, with no enlargement.

## 4. Decisions

| Decision | Date |
| --- | --- |
| **GPU first, including export.** Export, Proof and Library pictures render on the GPU at full size (tiled where memory needs it); the CPU is the fallback. CPU export is no longer an exact reference. | Steve, 2026-10-18 |
| **Approved GPU architecture:** a hidden Electron renderer reuses Grade's renderer and shaders. Export resize and output sharpening join the shared GPU graph, after the creative look and before the final highlight limiter. Preset versions that share rendering reuse the same finished lanes. | Steve, 2026-10-18 |
| **Scheduling:** Grade first, then visible Library pictures (top-left first), then background export. GPU work yields between bounded submissions and shares one memory budget. Closing the last visible window cancels a batch cleanly; finished files stay. | Steve, 2026-10-18 |
| **Perceptual limits** for GPU against CPU, Proof against export, and Library picture against export: SDR ΔE 2000 and HDR ΔE ITP (BT.2124), per image and per lane, mean below 1.0, 99.9th percentile at or below 3.0. No per-pixel maximum. Include grain and local adjustments. | Steve, 2026-10-18 |
| **HDR ceiling:** Guarantee HDR peak is optional per preset version, HDR formats only, off by default. Off encodes once without a decoded peak check. On checks near-target files and applies local correction; any remaining overshoot is delivered with its nits-over-target note. Library pictures skip the check. | Steve, 2026-10-18 |
| Enabled highlight targets are mandatory after encoding for export, Proof and saved Library pictures. Decode every file, correct local overshoots, reject any file still over target. With Highlights off, the optional per-version codec check enforces 10,000 nits. This supersedes the optional-target and deliver-anyway decision. | Steve, 2026-10-19 |
| Each export result records which renderer made it and any fallback reason. | Steve, 2026-10-18 |
| The Export page stays and grows. Two routes: the Export page and Quick export… with a preset. It must leave room for print settings and watermarks. | Steve, 2026-10-11 |
| Export presets carry every Export setting, typed sizes, a naming pattern and a sub-folder; one run can make several versions (for example HDR AVIF and SDR JPEG). Presets are JSON files in the `Export` sub-folder of the preset library. | 2026-10-17 |
| Proof does not need to carry export resize, output sharpening or metadata policy for now. | Steve, 2026-10-01 |
| Do not change encoders or gain-map maths without asking. A whole-image dimming correction for the ceiling was rejected (it failed the perceptual limits). | 2026-10-18 |

## 5. Current state (October 18, 2026)

**Built**

- All output formats, settings, built-in and saved presets.
- Batch export: the Export page and Quick export…, presets with versions,
  naming and sub-folders, a background queue with Pause and Cancel,
  numbered names on collisions, per-file results. Exported and "Edited
  since last export" states feed the Library.
- Proof: reduced size (1,200 px) or full size, through the export pipeline.
- Guarantee HDR peak is back in each preset version's Advanced settings for
  HDR formats only, off by default (Steve restored the October 18 decision,
  October 19). Off encodes each file once with no decoded peak check. On
  skips pictures whose finished peak is at least 20% below target, otherwise
  checks the decoded file and applies the existing local correction. A file
  still over target is delivered with a note stating how many nits over.
  With Highlights off, the enabled option uses the 10,000-nit codec ceiling.
  Library pictures never run this check; cache v7 refreshes checked pictures.
  Proof carries the same option and includes it in its cache identity; changing
  it invalidates the current Proof. No encoder or gain-map maths changed.
- The perceptual comparison helper (`delivery_colour.py`), with tests.
- A shared force-CPU delivery preference in Settings → Performance, and
  `HDR_FINISHER_FORCE_CPU_DELIVERY=1` (environment wins). Export, Proof
  through export, and saved-grade Library workers read the same policy.
  Preference changes apply to new work without an app restart.
- Export results now record `renderer` and `fallback_reason`; batch results
  retain and display them. Saved-grade picture results record them too.

- Step 2: hidden Electron renderer reuses Grade's shaders, stock tables,
  masks and Denoise. Finished film passes through GPU Lanczos resize,
  edge-aware multiscale output sharpening and the shared output limiter,
  then the existing encoders. Both lanes fall back together with a reason
  on unavailable hardware, allocation failure or render failure.
- Small decoded 96×64 fixture, resized to 72×48 with standard sharpening:
  HDR ΔE ITP mean 0.625 / p99.9 2.756; SDR ΔE 2000 mean 0.565 /
  p99.9 2.782. Both pass; decoded HDR peak 668.73 nits against 1000.

- Step 3: batch workers inherit the app-owned GPU queue. Compatible preset
  versions reuse one finished pair; per-photo GPU failure keeps the batch
  running on CPU. The existing Pause, Cancel, names and per-file results stay.
  Delivery submits one creative tile or 128 finishing rows at a time. Grade
  clients report resident memory against one shared budget; a new Grade render
  preempts delivery and releases its reservation before Grade admission. That
  photo falls back to CPU with the reason recorded. Closing the last visible
  window cancels queued/running batch work; completed files remain.

- Step 4: Proof encodes and inspects the same shared finished lane pair as
  export, with its renderer and fallback reason recorded. Matching full-size
  Proof and export reuse that pair, including the per-photo CPU decision.
  Concurrent requests serialize the render; the bounded session cache keys
  source identity, grade, locals, Denoise, white, finishing and force-CPU policy.
  Reduced Proof remains explicitly labelled and uses the same graph at its size.

- Step 5: saved-grade Library producers use the shared GPU graph for both
  lanes, including local adjustments, Denoise and delivery resize before the
  limiter. Visible queued pictures outrank background export, retaining the
  existing top-left request order. Single export and Proof no longer hold
  the old blanket Library pause while waiting for delivery. Results fill the existing gain-map disk
  picture cache; the cache version changes so old CPU pictures are regenerated.
  The artificial two-second wait after the quick reminder is removed. Library
  pictures also enforce enabled highlight targets after encoding; cache v6
  refreshes pictures made before this rule.

- **Sharing the GPU fairly (Claude, October 18, after Steve's first GPU
  batch).** In that batch the first four photos were rendered on the CPU
  ("A higher-priority delivery needs the GPU"), and the batch estimated about
  96 s per photo. Each newly queued visible Library picture interrupted the
  running export, and an interrupted export fell back to the CPU. A job
  waiting in the queue also fell back after 180 s. With the Library paused,
  the same batch ran at about 17 s per photo: about 10 to 12 s of GPU work,
  including transport, and 6 to 8 s of CPU preparation. Now:
  - a job interrupted by Grade or by a more urgent delivery goes back in the
    queue with its original queue time, and is never sent to the CPU for that
    reason;
  - the 180 s render deadline starts when the renderer claims the job, not
    while it waits;
  - jobs are chosen and preempted by priority lowered one step per 5 s of
    waiting, so a waiting export gets its turn within about 25 s;
  - batch export runs two photo workers at once (`HDR_FINISHER_BATCH_PARALLEL`,
    default 2), so one photo's CPU decode overlaps the previous photo's GPU
    render, and results keep photo order;
  - finished or abandoned spool directories are removed (after 2 and 30
    minutes), and spool roots from earlier launches are removed at start;
  - each GPU render logs `gpu_delivery_rendered` with its stage timings in
    `backend.log`.

- October 19, GPU RAW follow-ups parts 1–2: workers and the hidden renderer
  exchange source and finished pixels in job-owned OS shared RAM, retaining
  Blob uploads, metadata-spool cleanup, fairness and CPU fallback. Controlled
  disk/RAM replays have byte-identical encoder inputs and final JPEGs.
  Colour agreement is qualified before encoding, under the unchanged limits;
  the exact HDR ceiling is checked after encoding. The single requested
  repeat moved the bad values on DSC07061/DSC07072, attributed by Steve to
  his faulty RTX 4070 Ti VRAM. Previous SDR errors did not repeat. No hardware
  guards or workarounds were added. Original pairs remain available in
  `codebase/output/gpu-raw-followups/HDR-screen-pairs/compare.html`.
  Fast checks: 540 Node / 2311 Python passed (3 skipped); GPU and forced-CPU
  export/Proof smoke passed.
- October 19, delivered HDR ceiling repair: DSC07060 input is exactly 800
  nits, but gain-map reconstruction reached 1213.147. Independent direct
  libultrahdr decode and gamut conversion confirmed the measurement; the
  old default bypassed correction. The initial change made targets mandatory;
  Steve subsequently restored the October 18 optional policy above. The
  DSC07060 local correction remains available when explicitly enabled.
  Existing correction and encoders are unchanged. At 4000 px,
  GPU export and full-size Proof both peak at 797.075 nits; forced CPU both
  peak at 781.706. Each Proof is byte-identical to its export. GPU export
  took 31.64 s; forced CPU took 137.32 s (full RAW grade). Tests: 540 Node,
  2311 Python passed (3 skipped, 19 existing serializer warnings); focused
  encoder/Proof checks 65 passed, covering JPEG, AVIF and JPEG XL. The first
  real test driver's synchronous decoder blocked its network loop; after
  asynchronous inspection, the connection error did not repeat. No production
  retry or hardware guard. The HDR comparison page includes the ceiling pair.

- October 19, optional HDR peak cost, measured on disposable DSC07060,
  DSC07061 and DSC07072 copies at a 1000-nit target, reference white 203:
  Ultra HDR JPEG quality 95, 4:4:4, gain map 95/full, 4000 px long edge,
  no output sharpening. GPU delivery, already-open RAW sessions, one warm-up
  export per photo before the recorded off/on pair. These are steady-state
  export-request times, not batch throughput or cold RAW loading times.
  Existing 5% timing-noise allowance applies; one recorded pair per photo.
  Off averaged **5.12 seconds/photo** (4.97-5.33): exactly one encode and
  zero peak-check decodes on all three. On DSC07072, checking without
  correction took **7.71 seconds**, versus 4.97 off (2.74 seconds extra):
  one encode and one decode, peak 823.825 nits. On DSC07060, checking and
  correcting took **23.95 seconds**, versus 5.33 off (18.63 seconds extra):
  three encodes and three decodes, peaks 1469.477 -> 1082.640 -> 988.525 nits.
  The existing local correction is retained. On DSC07061 the dim-picture
  skip took **5.44 seconds**, versus 5.07 off: one encode, zero decodes.
  Its extra 0.38 seconds is the input-peak scan (measured 0.365 seconds),
  not unexplained timing drift. Decode and re-encode work dominate the
  option's extra cost; turning it off removes them.
  Count/timing instrumentation was temporary and restored after measurement;
  no production counters, retries, encoder changes or hardware guards.
  The first setup assumed every sidecar contained a grade; DSC07061 has
  none, so the harness now uses its starting document. Warm-up also removes
  the first render/compilation cost from the recorded comparisons.
  Restoring the option exposed Proof discarding it; its request now preserves
  the switch, and Proof displays/caches any remaining-overshoot delivery note.
  Real DSC07060 opt-in export and full-size Proof remain byte-identical,
  both 797.075 nits against its saved 800-nit target. GPU and forced-CPU
  export/Proof smoke also pass (decoded peak 668.726 / 1000 nits).
  Validation: 541 Node passed. Full Python run: 2320 passed, 3 skipped,
  19 existing serializer warnings; its one failure was the old Proof request
  field-list contract. Updated that contract for the restored option and
  verified cache identity, conversion, per-version saving and cached notes
  (4 focused checks passed). Final ceiling/note checks: 17 passed, covering
  real JPEG, AVIF and JPEG XL export/Proof. The initial focused JPEG/JXL
  identity failures exposed Proof discarding the option; carrying it through
  fixes them. Real opt-in DSC07060, GPU/CPU delivery smoke and Advanced
  settings Electron checks passed, serially at 2560 by 1440. No push.

- October 20, GPU export speed part 1 and first encoding improvement: measured
  a three-photo 4000 px batch at 33.439 s (11.146 s/photo); full-size Maximum
  Fidelity DSC07060 export at 28.747 s, excluding 2.869 s to open the RAW.
  Encoding is the largest full-size stage (15.371 s). Two unchanged gain-map
  filter stripes now run concurrently with bounded scratch; JPEG writing
  remains serial. Isolated full-size filtering/repackaging fell from 7.766 s
  to 6.382 s, with complete repackaged files byte-identical on three badminton
  photos and the full-size single. These are encoding replays, not a new
  end-to-end claim. Neither the 5 s batch nor under-15 s single target is met.
  RAW preparation, GPU overhead and tiled finishing remain open. Validation:
  539 Node and 2275 Python passed (3 skipped); GPU/forced-CPU export and Proof
  smoke passed, including the existing perceptual limits and opt-in ceiling.
  Guarantee HDR peak remains optional and off by default (brief a3170de).

- October 20, GPU export speed (Claude, after Codex ran out of credits).
  Measured on six disposable badminton RAW copies, 4000 px Ultra HDR JPEG 95,
  4:4:4, full gain map, no sharpening. In a batch the GPU handles one photo at
  a time, so its turn sets the pace; most of that turn was waiting, not work.
  Changes, none of which changes an output byte:
  - the renderer reuses a "ready" answer from the scheduler for 0.1 s instead
    of asking before each of ~690 small GPU batches (~3 ms each);
  - without an authored SDR base the SDR lane reuses the HDR source upload
    (identical pixels) instead of fetching it again (~0.9 s);
  - finishing works in strips of about 4 M pixels instead of 128 rows, and
    the creative render submits four tiles per batch, as Grade's preview does;
  - the worker measures the full-size Denoise noise model before queueing,
    instead of the renderer waiting 2-3 s mid-turn for the same measurement;
  - three batch workers on machines with 16 GB or more (peak ~1.6 GB each),
    two below; `HDR_FINISHER_BATCH_PARALLEL` still overrides.

  | | Before | After |
  |---|---:|---:|
  | GPU turn per photo, mean | about 7.7 s | 2.7 s |
  | Six-photo batch | 72.7 s | 40.8 s |
  | Pace once the pipeline is full | 10.5 s/photo | about 5.2 s/photo |
  | Full-size Maximum Fidelity single | 28.7 s | 24.2-24.8 s |

  All six batch files were byte-identical to the "before" run. Two workers
  took 50.2 s, four 41.1 s (no gain over three). The batch is now limited by
  the workers' CPU stages (RAW preparation ~3.7 s, encoding ~4 s), and the
  single export by encoding (~13 s, mostly the gain-map filter and the
  external Ultra HDR tool). Four gain-map filter stripes instead of two saved
  only 0.6 s for more memory and were not kept. Each GPU job's turn is now
  logged as `gpu_delivery_turn` in backend.log, per lane.
  On Steve's card two full-size runs of the same code differed in 81 isolated
  pixels (faulty graphics memory); compare full-size runs by pixels, not bytes.
  Checks: 539 Node, 2277 Python (3 skipped); GPU delivery smoke (unchanged
  limits: HDR mean 0.625 / p99.9 2.756, SDR 0.565 / 2.782, peak 668.73 nits)
  and the DSC07060 ceiling check (GPU export and Proof 797.075 nits, CPU
  781.706, target 800) passed.

**Not built**

- No broad GPU-delivery accuracy or speed claim: Steve tests first. The
  per-photo time with the fairness changes is not yet measured.
- The about-1-second saved-grade update goal is not reached; the measured
  GPU RAW saved picture takes 6.71 s, with encoding largest.
- Creative rendering is tiled, but delivery finishing still needs full-frame
  scratch. Large sharpened originals can exceed the shared memory budget and
  fall back to CPU with that reason; unsharpened work reserves no sharpening scratch.
- Proof covers the three HDR formats only.

## 6. Open work, in order

0. **GPU export speed, end to end** (Steve, October 20: before the live
   recorded test session). Brief:
   [codex-brief-export-gpu-speed-2026-10-20](../../technical/briefs/codex-brief-export-gpu-speed-2026-10-20.md).
   Batch pace is now about 5.2 s/photo (target 5 s) and the GPU turn 2.7 s;
   see the October 20 entry above. Still open: the full-size single export
   (24 s against under 15 s), which is now mostly CPU encoding; export RAW
   development on the GPU (the CPU workers, not the GPU, now set the batch
   pace, so this may now pay off); tiled finishing for large sharpened
   originals (an unqualified version is in Git stash `424d7e0`).
1. **GPU delivery.** Brief:
   [codex-brief-gpu-delivery-build-2026-10-18](../../technical/archive/briefs/codex-brief-gpu-delivery-build-2026-10-18.md).
   Steps 1–5 implemented. Steve to try one badminton export, a small batch,
   Proof, and a Library grade paste. Real-photo responsiveness and the broader
   perceptual comparisons remain unqualified under the light-testing brief.
   - **Done October 19 (Steve approved):** send the
     GPU delivery pixel upload (`frontend/gpu-delivery.js`, about 70 MB
     per saved-grade picture) as a `Blob` instead of a plain buffer. Test
     runs only: the plain buffer is copied into the test tool's debugging
     connection, which drops past 256 MB and closes the app mid-test
     (details in `codebase/tests/release/README.md`). Users are not
     affected. It touches the export and Proof path, so its export and
     Proof checks run with the rest of the release check, plus a check that
     the backend receives the same bytes and the hand-off time is unchanged.
2. Replace the old file-side parity allowance (`target × 1.01 + 1`) with
   the zero-upward-allowance check, once GPU delivery exists.
3. Batch-export metadata follow-ups (shared with Photo Library): bundled
   ExifTool, title/caption/copyright template, privacy options (strip
   location and serial numbers).
4. AVIF gain-map denoise: only if a corpus shows a net benefit.

**Ideas (not scheduled)**

- **Speck detector for GPU output** (Steve, October 19, 2026). Steve's RTX
  4070 Ti has faulty graphics memory that leaves bright orange/red specks in
  some exports (also in Resolve and Affinity), and one GPU RAW test picked up
  a garbage value from it. A cheap check could look for isolated pixels far
  brighter or more saturated than their neighbours, then re-render or fall
  back to the CPU. Risk: flagging real specular highlights, stars or LEDs.
  Not planned for now; Steve will test on a healthy MacBook.

## 7. Detail and history

- Full October 18 policy text, metric definitions and the encoder finding:
  [HDR_Finisher_PRD_v1.2 section 11d](../archive/HDR_Finisher_PRD_v1.2.md)
- Planning brief (superseded by the build brief):
  [codex-brief-gpu-export-2026-10-18](../../technical/archive/briefs/codex-brief-gpu-export-2026-10-18.md)
- Batch export build: [codex-brief-library-paste-and-batch-export-2026-10-17](../../technical/archive/briefs/codex-brief-library-paste-and-batch-export-2026-10-17.md),
  mock-up `../export-wireframes/index.html`
- Proof as the accurate fallback (October 1):
  [Viewport_Bounded_GPU_Preview_PRD section 3](../archive/Viewport_Bounded_GPU_Preview_PRD_2026-10-01.md)
- User guide: [export](../../user-guide/export.md), [proof](../../user-guide/proof.md)
- Known limits: [known limitations, export and proofing](../../known-limitations.md)

October 19, RAW follow-up part 4: Library RAW reservations now join Grade
and delivery in the same scheduler, including Grade preemption and delivery
queue ageing. Large sharpened originals still exceed the budget: the six
full-frame float scratch images need tiled resize and sharpening with filter
overlap, multiscale passes and matching boundaries before that can change.
