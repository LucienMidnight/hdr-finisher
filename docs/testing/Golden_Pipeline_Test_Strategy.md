# Golden Pipeline Test Strategy

**Baseline:** `rw203-v1`  
**Manifest:** `codebase/tests/golden/manifest.json`  
**Runner:** `codebase/tools/run_golden_pipeline.py`

The Golden Pipeline is a thin integration layer over existing unit, contract, exporter, proofing, desktop, and performance coverage. It does not create a duplicate pytest suite. Its three journeys use deterministic adjustment recipes and a shared chart containing black, near-black, `0.18`, 100-, 203-, 406-, 1,000-, and over-range patches plus saturated in- and out-of-gamut colors.

## Journeys and reused coverage

| Journey | Golden assertions | Existing coverage reused or consolidated |
|---|---|---|
| Synthetic neutral chart | v3/203 default, exact 2.03 reference switch, absolute threshold movement, generated-SDR invariance, fixed/project analysis anchors, scope agreement, cache source reuse | model/project/API, adjustments, scopes, overlay, render-cache, proofing, frontend-contract tests |
| Representative real photograph | deterministic representative recipe, measured peak/order, HDR and SDR visual diagnostics, preview/export parity | fixture import, CPU/WebGPU parity, preview/scopes, performance profiling; requires the approved licensed release fixture |
| Authored gain-map round trip | authored SDR preservation, gain metadata, independent reconstruction, proof/export/re-import agreement, two-generation drift | Ultra HDR, AVIF gain-map, JPEG XL, decoder, proofing, metadata and exporter integration tests |

The legacy migration assertions were replaced by explicit v1/v2 rejection tests. Combined `overlay_preset` tests were replaced by independent band-anchor and ceiling assertions. Existing exporter and proof tests remain authoritative for codec details; the Golden report links their availability instead of multiplying equivalent cases.

## Tolerance policy

- Analytical float operations: relative tolerance `5e-5` and absolute luminance tolerance `0.02` nit, matching the frozen manifest and accommodating the float32 fixture path.
- Reference switch: `203 / 100 = 2.03` within `5e-5`; no ratio check is made after an enabled absolute-nit compression operation.
- Scope versus independently measured luma: `5e-5` relative plus the `0.02`-nit absolute floor for deterministic float fixtures.
- SDR pure-reference switch: exact array equality before quantization; no requirement applies when SDR controls change.
- Lossless metadata/schema checks: exact semantic equality.
- Lossy round trip: format-specific luminance/color, PSNR/SSIM, and second-generation drift tolerances owned by the existing exporter tests; byte equality is never required.
- Performance: compare medians on the same pinned machine/configuration and flag a regression above the manifest budget rather than comparing unlike machines.

## Baselines and approval

`diagnostic-100-v2/before-state.json` is diagnostic evidence only and cannot approve the new design. `rw203-v1` derives from analytical patch values plus explicit visual approval of the representative photograph and authored gain-map delta. A baseline update must include the runner report, recipe/fixture hashes, code revision, platform and Electron/Chromium versions, display record where visual claims are made, numerical deltas, and the approver. Never approve a new baseline merely because it resembles the old 100-nit result.

## Tiers and pinned release systems

- **Pull request:** fast existing tests plus the synthetic neutral journey; hardware independent.
- **Nightly:** all three journeys and available encoders/decoders on the repository's pinned build environment.
- **Release:** packaged Electron on the pinned Windows HDR system and a pinned macOS HDR system, including WebGPU/compositor comparison, cold/warm performance, visual diagnostics, and complete display-environment evidence.

The release record must name the actual machines. No unobserved Windows external display, macOS built-in/XDR, macOS external monitor, or unavailable codec may be marked passed. A missing machine or licensed fixture is an external qualification gate, not a reason to weaken the PR tier.
