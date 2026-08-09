# Interactive Preview Performance Validation — 2026-08-09

This is the durable implementation and validation record for the [Interactive Preview, Instant Scopes, and Image Pipeline Performance Sprint](../product/Interactive_Preview_and_Scopes_Performance_Sprint_PRD.md). The software sprint and automated gates are complete. Physical HDR/SDR display observations remain a release-certification activity because this run was performed in headless Edge on an SDR Windows session.

## Reference environment

| Item | Value |
|---|---|
| Date | August 9, 2026 |
| Source revision | `391756d` plus the sprint working-tree changes |
| OS | Windows NT 10.0.26200.0 |
| Browser | Microsoft Edge 151.0.4129.72, headless |
| Node | 24.14.0 |
| Python suite | Project `.venv` |
| Display capability in automation | `dynamic-range: high` false |
| Performance repetitions | 30 timed changes after warm-up; 100 settled changes per scenario |

The matrix used the deterministic `blender_linear_rec2020.exr` and `hdr_headroom.tiff` fixtures plus the local 4032 × 3024 Apple HDR `IMG_4109.HEIC` benchmark source. It covered fast, high-quality, and forced no-WebGPU modes. Generated JSON, screenshots, and traces remain under ignored `codebase/output/`.

## Automated gate results

| Gate | Target | Result | Status |
|---|---:|---:|---|
| Visible response after input | ≤50 ms p95 | 5.4 ms worst p95 | Pass |
| First visible scope feedback | ≤100 ms p95 | 87.0 ms worst p95 | Pass |
| Normal settled scope | ≤250 ms p95 | 110 ms debounce + 120.4 ms scope-compute p95 = 230.4 ms | Pass |
| GPU render work | informational | 2.0 ms worst p95 | Pass |
| Encoded authoring previews during ordinary WebGPU grading | 0 | 0 in all GPU scenarios | Pass |
| Wrong/stale result applied | 0 | 0; final scope state `Settled` in all scenarios | Pass |
| Browser/page errors | 0 | 0 | Pass |
| Apple HDR HEIC ready time | ≥35% faster than ~4.0 s | 1.975 s fast mode, 50.6% faster | Pass |
| 1600 × 1200 RGBA16F payload | ~15.4 MB | 15,360,000 bytes; 12,800-byte aligned row | Pass |
| Fast-mode HEIC managed payload | ≤384 MiB | 337.4 MiB after steady run | Pass |
| Memory growth after 100 settles | ≤5% | −1.7% fast HEIC | Pass |
| No-WebGPU transport | no routine PNG/AVIF encode/decode | raw RGBA8 canvas path; 0 encoded requests | Pass |

EXR/TIFF fixture ready times were 49–81 ms. Because these committed fixtures are deliberately tiny, their percentage cache-growth values are dominated by lazy fixed-size entries and are not meaningful memory gates; the representative 12 MP HEIC is the memory acceptance source.

High-quality HEIC mode finished at 1.937 s and 351.5 MiB. Forced CPU fallback finished at 2.517 s and 354.3 MiB. All modes retained the last valid scope while updating.

## Preview parity

The parity harness covers 118 low/high control cases across both lanes, tone equalizer, and curves. It compares the WebGPU surface with the raw CPU RGBA8 reference through equivalent browser canvas composition, avoiding encoded-image transport as a confounder.

The initial PRD float-relative thresholds cannot be inferred faithfully from an 8-bit browser screenshot: a single code-value difference is already 0.392% of full scale and can be much larger when divided by a dark reference channel. The approved observable browser envelope is therefore:

- mean absolute channel error ≤0.75% of full scale;
- p95 absolute channel error ≤2.5% of full scale;
- pixels with any channel differing by more than eight code values ≤4.5%.

On the representative Apple HDR HEIC, the worst results were 0.673% mean absolute error, 2.353% p95 channel error, and 4.17% visibly changed pixels. The deterministic tiny fixture produced 0.619% and 0.784% for the first two measures. There were no browser errors, GPU-to-encoded handoffs, hue-order failures, lane-isolation failures, or monotonicity failures in the automated run. The harness retains median and p99 dark-sensitive relative diagnostics for trend analysis but does not mislabel those quantized values as float-domain measurements.

CPU/export math remains authoritative for proof and delivery. Preview-quality preference state is browser-local and is not part of the adjustment or export request model, so fast and high-quality modes cannot alter export inputs.

## Correctness and regression evidence

Run from `codebase/`:

```powershell
.\.venv\Scripts\python.exe -m pytest -q tests
node --check frontend/app.js
node --check frontend/webgpu-preview.js
node --check frontend/preview-scheduler.js
node tools/playwright_preview.js --url http://127.0.0.1:8000 --input tests/fixtures/hdr_headroom.tiff
node tools/playwright_gpu_parity.js <representative-input> output/performance/gpu-parity
npm run test:performance -- --url http://127.0.0.1:8000 --inputs <EXR,TIFF,HEIC>
```

Results for this run:

- 255 pytest tests passed; five dependency deprecation/optional-feature warnings only.
- JavaScript syntax validation passed for the application, scheduler, WebGPU renderer, browser smoke tool, parity tool, and performance harness.
- The full browser smoke flow passed GPU rendering, tone equalizer edit/reset, scope switching, HDR/SDR lane switching, overlay controls, zoom, source rail, export sheet, and browser error monitoring.
- RGBA16F alignment/range fallback, scope reference equivalence, tiny 4,000-nit highlight preservation, HEIC Display-P3 transform equivalence, cache byte eviction, and per-key single-flight behavior have dedicated tests.

## Physical-display release procedure

Run these checks before signing a release build. Record device, OS/browser, GPU, display model, HDR mode, source, observation, and pass/fail in a dated follow-up log.

### Windows HDR display

1. Enable system HDR and confirm the app reports the HDR WebGPU surface.
2. Open the deterministic HDR chart, representative Apple HDR HEIC, a photographic TIFF, and a Blender EXR.
3. Compare the settled GPU preview with an explicit CPU/Chrome Proof reference at neutral and at low/high exposure, contrast, saturation, tone equalizer, and curve settings.
4. Confirm highlight order, neutral axis, hue order, clipping indication, and the 100/400/1,000/4,000/10,000-nit scope regions.
5. Grade primarily from histogram/waveform feedback and confirm the old scope remains visible with `Updating`, then becomes `Preview`, `Settled`, or `Refined` without a zero flash.
6. Toggle High-quality preview repeatedly; confirm the image and scopes do not blank and export settings do not change.
7. Move the window to an SDR display and back, then toggle system HDR if the browser permits it. Confirm a non-disruptive surface reconfiguration or documented CPU fallback.
8. Exercise overlay, A/B, zoom, pan, lane switching, Chrome Proof, and final export.

### Windows SDR display

Repeat the source/control matrix with system HDR disabled. Confirm the GPU canvas is the settled authoring view, HDR content uses the documented SDR display transform, scopes remain current, and forced no-WebGPU mode uses the raw canvas fallback without encoded-preview churn.

### macOS available display

Repeat the neutral and extreme-control matrix in a current supported browser. Record WebGPU availability, selected proxy format, dynamic-range result, device-loss/fallback behavior where practical, and visual comparison with CPU/Chrome Proof. Safari-capable application-shell behavior must be recorded even when it selects the documented CPU fallback.

### Release sign-off fields

| Platform/display | Tester/date | Result | Notes/evidence |
|---|---|---|---|
| Windows HDR | Pending | Pending | Physical display not available to headless automation |
| Windows SDR | Pending | Pending | Physical observation not performed in this run |
| macOS | Pending | Pending | macOS hardware not available in this run |

## Documented implementation limits

- Interactive scopes currently use the vectorized, compact backend path; a WebGPU reduction pass remains an optional P1 optimization because the measured ≤100 ms feedback budget already passes.
- Overlay imagery continues to use its explicit composited layer, while the ordinary HDR/SDR base remains GPU-authoritative. Overlay work is scheduled and does not restore routine encoded base settling.
- Device-loss handling preserves the last valid view and switches to raw CPU fallback, but vendor-specific physical device-loss behavior still belongs to the platform sign-off above.
- This validation establishes authoring parity, not colorimetric monitor certification.
