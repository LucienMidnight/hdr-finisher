# Automated Testing Index

The automated suite is risk-oriented rather than coverage-percentage driven. Private photographs and large renderer outputs are never required by CI.

The dated [Interactive Preview Performance Validation](Interactive_Preview_Performance_Validation_2026-08-09.md) records the sprint's final benchmark results, approved observable parity envelope, and remaining physical-display sign-off procedure.

The dated [GPU Local Adjustments Phase 0/1 Validation](GPU_Local_Adjustments_Phase_0_1_Validation_2026-08-14.md) records the local-control instrumentation, before/after Luma timings, mask-request elimination, live-scope cadence, and parity/preservation gates.

The [Phase 2](GPU_Local_Adjustments_Phase_2_Validation_2026-08-14.md) and [Phase 3](GPU_Local_Adjustments_Phase_3_Validation_2026-08-14.md) records cover retained GPU Luma/Feather and GPU-backed live-scope cadence, parity, and resource behavior.

The [Phase 4/5 record](GPU_Local_Adjustments_Phase_4_5_Validation_2026-08-15.md) covers mixed-leaf Boolean graph parity, 16/32/64-local resource scaling, destructive device-loss fallback, EXR/TIFF endurance, and final automated release evidence.

## Test tiers

| Tier | Contents | Run from `codebase/` |
|---|---|---|
| Fast deterministic | Color normalization, HDR classification boundaries, adjustment invariants, SDR fallback, scopes, diagnostics, preview math, cache behavior, API validation, and mocked exporter failure/atomicity paths | `.\.venv\Scripts\python.exe -m pytest -q tests` |
| Small file-level | Tracked PNG, float TIFF, untagged linear EXR, and Blender `colorInteropID` EXR fixtures under `tests/fixtures/` | `.\.venv\Scripts\python.exe -m pytest -q tests/test_loader_fixtures.py tests/test_api.py` |
| Encoder/import/export integration | Real AVIF preview and gain-map inspection, direct-PQ and gain-map AVIF import, JPEG Ultra HDR encode/legacy/HDR import, two-generation round trips, and proof-artifact reconstruction. Tests skip with an explicit reason when the required binary is unavailable. | `.\.venv\Scripts\python.exe -m pytest -q tests/test_avif_info.py tests/test_ultrahdr_export.py tests/test_gainmap_import.py tests/test_proofing.py` |
| Export presets and AVIF gain-map chroma | All 18 built-in format/preset mappings, Custom divergence, keyboard disclosure behavior, real 4:4:4/4:2:2/4:2:0/4:0:0 gain-map encoding, numeric delivery-pattern comparison, and Chromium decode. | `npm run test:export-presets`; `.\.venv\Scripts\python.exe .\tools\measure_avif_gainmap_chroma.py`; `node .\tools\check_avif_gainmap_chromium.js` |
| Optional local media | Large Blender/Affinity EXRs and private iPhone HEIC/AVIF media in ignored `local-test-media/inputs/`; results go to ignored `output/`. The 40+ MP gain-map AVIF regression gate accepts an external path without copying private media into the repository. | `.\.venv\Scripts\python.exe .\tools\local_media_probe.py <paths> --export`; set `HDR_FINISHER_LARGE_AVIF=<path>` and run `.\.venv\Scripts\python.exe -m pytest -q tests\test_large_avif_import_performance.py` |
| Experimental DNG | Deterministic classifier, color, opcode, resource, raw-routing, export-preflight, and transactional tests; optional ignored real-corpus inspection/decode | `.\.venv\Scripts\python.exe -m pytest -q tests\test_dng_*.py tests\test_linear_dng.py`; `.\.venv\Scripts\python.exe .\tools\experimental_dng_audit.py` |
| Alpha harness | Full pytest, JavaScript syntax checks, capability report, sample export/inspection, and browser layout smoke | `powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\run_alpha_qa.ps1` |
| Preview performance | Fast/high-quality/forced-fallback browser matrix, event-to-frame/scope timing, backend requests, JSON parse, Canvas draw, request payloads, long tasks, heap trend, and browser errors | `npm run test:performance` |
| GPU local adjustments | Isolated and rapid Luma opacity/feather timing, mask request counts, backend CPU attribution, GPU queue/presentation, live-scope draft content/fingerprints, stale cancellation, adapter, and resolution | `npm run test:gpu-local-adjustments -- --url http://127.0.0.1:8000 --phase phase1` |
| GPU scope parity | Settled GPU/CPU histogram, waveform, and vectorscope peak/distribution comparison in installed Edge | `npm run test:gpu-scopes -- --url http://127.0.0.1:8765` |
| Retained mask graph | Mixed Gradient/Luma graph residency, Boolean influence semantics, zero-request edits, history, and server convergence | `npm run test:mask-graph -- --url http://127.0.0.1:8765` |
| Many local layers | 16/32/64-local influence latency, request count, and mask-resource residency | `npm run test:many-local-layers -- --url http://127.0.0.1:8000` |
| Device loss | Destructive WebGPU loss, raw RGBA8 CPU fallback, continued editing/scopes, and reload recovery | `npm run test:device-loss -- --url http://127.0.0.1:8765` |
| Export and file browser | Edge file-chooser handoff, folder-selection UI response, pending-edit synchronization, real SDR JPEG/PNG export, and validated JPEG Ultra HDR export | `npm run test:export-browser -- --url http://127.0.0.1:8000` |
| Path mask interaction | Sharp/click-drag creation, closure and cancellation, exact split insertion, right-click/keyboard removal, Sharp/Smooth conversion, Path/Feather targeting, independent feather edits, slider-delta preservation, reset, and invalid-geometry clamping | `npm run test:path-mask -- --url http://127.0.0.1:8000` |

Set `PYTHONPATH` to the resolved `backend` directory when running pytest outside the project scripts.

## Requirement inventory

| Risk area | Primary automated coverage | Status |
|---|---|---|
| Source metadata and ambiguity | `test_loader_fixtures.py`, `test_api.py` | Exact recognized OCIO IDs, unknown/similar IDs, chromaticity precedence/conflict policy, ICC naming, transfer-only override safety, manual override/reset lifecycle |
| ACEScg normalization | `test_core.py`, `test_loader_fixtures.py` | sRGB, BT.2020, PQ, ACEScg pass-through, unknown-linear preservation, and numerical normalization of the Blender fixture |
| HDR classification/headroom | `test_core.py`, `test_adjustments.py` | Strict `1.0` boundary, encoded and scene-linear classifications, Apple gain-map path, source-latitude policy |
| HDR/SDR finishing | `test_adjustments.py`, `test_core.py`, `test_frontend_contract.py` | Variable-node equalizer migration/limits, targeting masks, section bypass, fixed HDR curve domain, highlight ordering/rolloff continuity, branch isolation, hue behavior, and grading interaction contracts |
| Local adjustments and projects | `test_local_adjustments.py`, `local-adjustments-interaction.js`, `path-mask-interaction.js`, `luma-mask-interaction.js`, `brush-mask-interaction.js`, `gradient-mask-interaction.js`, `mask-graph-interaction.js`, `many-local-layers.js` | Soft mask algebra, retained mixed-leaf Boolean graphs, EV luminance trapezoids, fixed-source selection, HDR/SDR grade independence, tile determinism, spatial-mask opacity reuse, exact influence semantics, zero-request edits, one-r8-step Luma/Gradient/Brush parity, exact draft/settled mask parity, latest-state cancellation, editable Bezier path/feather boundaries, outer-boundary falloff and legacy compatibility, Shift Edge and Feather interaction matrices, geometry mapping, revision conflicts, undo, project round trips, 16/32/64-layer scaling, persistent stack presentation, visible on-image gizmos and gestures for every core mask, brush-only Erase eligibility, in-flow group expansion, HDR/SDR folder-tab interaction, and nonblank live histogram/waveform refresh during local edits |
| Float preview/resampling | `test_core.py`, `test_render_cache.py`, `test_preview_display.py`, `test_performance_pipeline.py` | Display-aware caps, float/HDR-range preservation, half-float precision/range fallback, byte accounting/eviction, single-flight reuse, raw SDR-display fallback math |
| Scopes and overlays | `test_core.py`, `test_performance_pipeline.py`, `gpu-scope-parity.js`, `local-adjustments-interaction.js` | AP1 luminance, 100/203/1000-nit guides and strict thresholds, vectorized waveform equivalence, histogram/waveform/vectorscope GPU parity, live presentation generations, tiny-highlight peak priority, normalization, false color, zebra alpha/cutoff |
| Import/export and metadata | `test_gainmap_import.py`, `test_ultrahdr_export.py`, `test_avif_info.py`, `test_proofing.py` | Independent base/gain-map quality and scale, proof/export parity, direct-PQ and gain-map AVIF input, JPEG Ultra HDR input without silent SDR fallback, metadata-selected gamut conversion, encoded offsets/capacity, atomic replacement, and two-generation lossy round trips |
| API/session/preflight | `test_api.py`, `test_capability_gates.py`, `test_folder_picker.py` | Upload cleanup, interpretation lifecycle, encoded/raw preview, tiered scopes, proxy format, diagnostics, unsupported format rejection, backend capability rejection, and Windows STA picker paths |
| Experimental DNG import | `test_linear_dng.py`, `test_dng_color.py`, `test_dng_opcodes.py`, `test_dng_resource_preflight.py`, `test_dng_raw_routing.py` | Metadata-only full-primary selection, Fast Load exclusion, LinearRaw/CFA routes, ForwardMatrix and ColorMatrix-only math, bounded GainMap/WarpRectilinear, audited exactly-once raw stage, Lensfun precedence, resource boundaries, separate export denial, cancellation/OOM transactionality, and optional real-corpus route checks |
| Delivery/hosting | `test_proofing.py`, `test_hosting_probe.py` | Fixed-headroom reconstruction, content hashes/cache, evidence persistence, metadata survival and destructive conversion detection |

## Remaining gaps

- Real iPhone auxiliary gain-map extraction and rendition comparison remain optional local-media validation; the private HEIC must not become a committed or CI fixture.
- Real Affinity and high-resolution Blender rendering remain manual/local checks for decoder performance, saturated highlights, gradients, downsampling, and clipping diagnostics.
- Physical HDR/SDR monitor behavior, browser/compositor differences, Instagram handling, and hosting transformations require the manual procedures in this directory.
- The broad test-pattern parity sweep retains a known saturated-blue outlier (`hdr.blue_purity = 65`); the Phase 4 mask-graph differential cases pass, and the older exception requires visual/color review rather than a silently relaxed gate.
- Capability-aware encoder tests validate installed binaries, but CI should eventually publish a matrix showing which optional encoders ran rather than treating skips as equivalent to executed round trips.
- Clean-machine and macOS packaging plus JPEG XL remain outside the mandatory pytest tier. The Windows package is smoke-tested during build; this sprint additionally verified a frozen AVIF gain-map upload. Windows picker behavior is unit-covered; interactive clean-machine use remains manual.
- Experimental DNG visual correctness still requires neutral producer renders for color/tone and reference-backed geometry/shading comparisons; macOS memory-policy measurements are also outstanding. Private DNGs remain optional local inputs and never enter CI.

Generated reports are evidence from a particular run. Record durable conclusions in `docs/testing/`, not only under `codebase/output/`.
