# Module PRD: Preview and GPU

- **Owner:** Steve
- **Master PRD:** [PRD](../PRD.md)
- **Last status check:** October 18, 2026, against the code.
- **Code:** frontend `webgpu-preview.js`, `webgpu-shaders.js`, `gpu-*.js`
  (including `gpu-param-layout.js`, `graph-scale.js`), `render-plan*.js`,
  scopes UI; backend `render_cache.py`, `cpu_strips.py`, `preview.py`,
  `scopes.py`, `overlay.py`, `peak_*.py`.

## 1. Purpose

Show the graded photo in true HDR, instantly, at any zoom, on the graphics
card, with scopes that can be trusted. The same GPU renderer is to become
the delivery renderer for export, Proof and Library pictures (see
[export-and-proof](export-and-proof.md)).

## 2. Principles (October 1, updated October 18, 2026)

1. **While editing, work is bounded by what is on screen.** Whole-image,
   full-resolution work happens at export and in Proof.
2. **Interactive work runs on the GPU.**
3. **Rigour goes where HDR matters.** Peak and highlight handling keep the
   tightest limits. Masks and tone only need to be perceptually identical.
4. **Cost per added local adjustment stays small and predictable.** More
   locals may cost speed, but there is never a cliff.
5. **No visible seams** when zooming, crossing a zoom threshold or panning.
6. **GPU and CPU agree within agreed tolerances,** not pixel for pixel. Since
   October 18, CPU export is no longer the exact reference (GPU first).

## 3. Decisions

| Decision | Date |
| --- | --- |
| Viewport-bounded preview: masks independent of resolution, small preview-against-export differences accepted, interactive work on the GPU. | Steve, 2026-10-01 |
| Stage tolerances (for example a painted-mask feather may differ by 2 of 255 levels) stay in force. Whole-image perceptual limits (ΔE 2000 / ΔE ITP, mean < 1.0, p99.9 ≤ 3.0) apply on top for delivery. | 2026-10-01, 2026-10-18 |
| GPU first for everything, including export. | Steve, 2026-10-18 |
| Responsiveness is judged first by Steve using the app. A timing outside its tolerance that can't be explained is reported, and Steve tries the app before a test run is spent on it. | Steve, 2026-10 |

## 4. Current state (October 18, 2026)

**Built:** WebGPU renderer for the whole look (film stock, grain,
halation, Denoise, local adjustments and masks, geometry, lens), tiled
full-resolution rendering, viewport-bounded tiers with native zoom, GPU
scopes and navigation, GPU Match candidates, GPU memory budget, device-loss
recovery, CPU fallback paths, preview-against-export comparison tools and
parity checks per stage.

**Open**

- PERF-04: background settle work at Full is cheap to feel but expensive to
  run. Suppressed at explicit Full in single view; auto tiers and compare
  keep the old behaviour by design.
- Optional full-resolution settle and faster refinement ("preview
  settling"). Not started.
- Linux: presentation-only dithering for HDR gradients (banding). Not built.
- Crop and Rotate may cost more speed than they should (11f). Not measured.
- REFWHITE-01: reference white on a file with its own HDR brightness.
  Behaviour unchanged.
- Known failures recorded in [known limitations](../../known-limitations.md):
  Black & White Direct/Tiled mismatch, uncompressed extreme HDR on
  Neutral, and the CF-SPEED, CF-DRIFT, CF-ROUTE and P3 rows marked "Later".

## 5. Open work, in order

1. Serve GPU delivery: give export, Proof and Library pictures a hidden
   renderer that reuses this one (brief in Export and Proof).
2. Measure Crop and Rotate cost if Steve finds them slow.
3. Preview settling, as its own piece of work.
4. Linux HDR gradient dithering.
5. The "Later" performance rows, when Steve asks.

## 6. Detail and history

- Viewport-bounded design, tolerance policy and phase records:
  [Viewport_Bounded_GPU_Preview_PRD](../archive/Viewport_Bounded_GPU_Preview_PRD_2026-10-01.md)
  (section 15 lists everything deferred at the end of phase 3, and 16.22
  the phase 4 carry-overs)
- Earlier performance sprints: [GPU_Performance_Review](../archive/GPU_Performance_Review_Sprint_PRD_2026-09-29.md),
  [Viewport_ROI_Preview_Performance](../archive/Viewport_ROI_Preview_Performance_Sprint_PRD_2026-09-22.md),
  [Preview_Responsiveness_Tuning](../archive/Preview_Responsiveness_Tuning_Sprint_PRD_2026-09-25.md),
  [Stable_Exact_Full_Preview](../archive/Stable_Exact_Full_Preview_Sprint_PRD_2026-09-19.md),
  [Interactive_Preview_and_Scopes_Performance](../archive/Interactive_Preview_and_Scopes_Performance_Sprint_PRD.md),
  [Electron_Preview_Correctness](../archive/Electron_Preview_Correctness_Sprint.md)
- Full-tier deferred work (PERF-03 to PERF-07): [HDR_Finisher_PRD_v1.2 section 11b](../archive/HDR_Finisher_PRD_v1.2.md)
- Technical: [architecture, preview scheduling](../../technical/architecture.md),
  [highlight compression](../../technical/highlight-compression.md)
