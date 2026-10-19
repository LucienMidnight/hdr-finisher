# Module PRD: Export and Proof

- **Owner:** Steve
- **Master PRD:** [PRD](../PRD.md)
- **Last status check:** October 18, 2026, against the code.
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
| **HDR ceiling:** no finished HDR pixel above the highlight compression target, on every path, measured on decoded files, rounding down (zero upward allowance). | Steve, 2026-10-18 |
| **Guarantee HDR peak** is a per-preset-version option (Advanced, HDR formats only), off by default, because the decode-and-correct check adds seconds per photo. A file that stays over target is still delivered, with a note giving how many nits over. Library pictures never run it. | Steve, 2026-10-18 |
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
- HDR ceiling check and correction (`hdr_ceiling.py`) behind Guarantee HDR
  peak. On Steve's RAWs at 1000 nits, files that overshot by up to 73 nits
  land between 972 and 998.
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
  pictures keep skipping the decoded peak correction/check.

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

**Not built**

- No broad GPU-delivery accuracy or speed claim: Steve tests first. The
  per-photo time with the fairness changes is not yet measured.
- The GPU step still moves full-size float pixels through disk files in both
  directions (a 486 MB source and two 163 MB lanes for a 42 MP photo at a
  4000 px output). That transport is part of the 10 to 12 s (briefed in
  [codex-brief-gpu-raw-follow-ups-2026-10-19](../../technical/briefs/codex-brief-gpu-raw-follow-ups-2026-10-19.md), part 2). The
  about-1-second saved-grade update target is not yet measured on his RAWs.
- Creative rendering is tiled, but delivery finishing still needs full-frame
  scratch. Large sharpened originals can exceed the shared memory budget and
  fall back to CPU with that reason; unsharpened work reserves no sharpening scratch.
- Proof covers the three HDR formats only.

## 6. Open work, in order

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
