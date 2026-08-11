# Codebase Review, Scope Performance, and HDR Round-Trip Results

**Date:** August 11, 2026
**Application:** HDR Finisher v0.2.1
**Sprint source:** `Codebase_Review_Cleanup_and_Round_Trip_Sprint.md`

## Outcome

The codebase remains structurally sound. The sprint fixed the highest-risk product gap: AVIF gain-map and JPEG Ultra HDR exports can now be re-imported as HDR without silently discarding their gain maps. Both formats retain an independently decoded SDR rendition and pass two-generation lossy round-trip bounds.

No scope algorithm rewrite was justified. The measured interactive path is already fast: backend scope requests were 4.1–9.0 ms p95, JSON parsing 0.5–0.6 ms p95, and Canvas drawing 0.5–0.7 ms p95. The visible 61–72 ms cadence is primarily the intentional scheduling/coalescing interval. Existing proxy, cache, stale-rejection, and peak-preservation behavior should remain.

The deterministic suite increased from **272 passed** to **280 passed**. The rebuilt Windows package passed `/health`, capability discovery, and an actual packaged AVIF gain-map upload. A final verification rebuild after the PRD acceptance review produced a 194.12 MiB folder payload and 80.34 MiB ZIP; this is modestly larger than the earlier sprint build and should be treated as build-environment/package-input drift rather than attributed to the small decoder patch without a clean artifact diff.

## Prioritized findings

| Priority | Finding | Resolution |
|---|---|---|
| P0 | JPEG Ultra HDR entered the normal Pillow JPEG path and silently became only its 8-bit SDR base. AVIF was not routed at all. | Added format-aware native decoding, explicit capability gates, HDR/SDR rendition recovery, strict failures, and round-trip tests. |
| P1 | Scopes can feel delayed even though computation is fast. The scheduler intentionally waits/coalesces; neither JSON nor Canvas is the bottleneck. | Preserved the algorithm. Added phase-level and browser client instrumentation so future cadence tuning is evidence-led. |
| P1 | A cold proxy is the main scope-related cost for large sources: 98 ms for HEIC and 660 ms for the 477 MiB EXR. Warm cached retrieval is below 0.25 ms p95. | Retained the current once-per-tier proxy cache. Do not add a hybrid representation unless cold-source interaction becomes a repeatable product problem. |
| P1 | `imagecodecs` contributes about 48 MiB and broad collection produces build warnings for unused optional codec DLLs. It also protects compressed TIFF and now preserves the 16-bit PNG output of `avifdec`. | Keep unchanged. Selective collection remains deferred until a representative TIFF corpus and clean packaged-build matrix exist. |
| P2 | JPEG gain-map metadata parsing was duplicated between proofing and input. | Moved parsing into the shared gain-map decoder module while retaining proofing's injectable command runner. |
| P2 | `colour-science` announced missing SciPy/Matplotlib features even though HDR Finisher does not call those optional APIs. | Suppressed only those exact import-time messages from `colour.utilities.verbose`; all other warnings remain visible. PyInstaller can still print them during build analysis, before application filters run. |
| P2 | The frontend remains concentrated in `app.js` (4,491 lines) and `styles.css` (3,895 lines). State is centralized, and stable scheduler/WebGPU seams already exist. Later CSS layers intentionally override earlier instrument-shell selectors. | No speculative split. A safe future extraction should begin with source-session lifecycle or scope rendering and require browser parity tests. CSS consolidation should wait for the active redesign decision and screenshot regression coverage. |

## Responsibility map

| Layer | Ownership and dependency direction |
|---|---|
| HTTP/application | `main.py` validates HTTP inputs and delegates to sessions, render cache, preview/scopes, proofing, and exporters. It does not own color math. |
| Session/cache | `sessions.py` owns source/session lifecycle. `render_cache.py` owns bounded source proxies, adjusted frames, scope results, byte limits, single-flight work, and stale cancellation. |
| Import | `loader.py` is dispatch and normalization policy. Format readers produce pixels and metadata; `gainmap_decoders.py` owns AVIF/Ultra HDR native adaptation; `color.py` normalizes once to ACEScg; `analysis.py` classifies the normalized result. |
| Processing | `adjustments.py` owns separate HDR and SDR branches. ACEScg and `0.18 == 100 nits` remain authoritative. |
| Preview/scopes | `preview.py` creates bounded display/proxy outputs. `scopes.py` consumes processed float proxies and produces aggregated bins/grids. Neither changes export pixels. |
| Export/proof | `exporters.py` owns encoder subprocesses and atomic outputs. `proofing.py` validates artifacts and reconstructs proofs; it shares low-level gain-map metadata parsing with input. |
| Capabilities/binaries | `capabilities.py` reports modules and composite native capabilities. `binaries.py` searches frozen resources, runtime overrides, then `PATH`. |
| Frontend | `app.js` owns the session/view/workflow state and DOM bindings. `preview-scheduler.js` owns coalescing/freshness. `webgpu-preview.js` owns GPU display only. CPU/export remains authoritative. |

The active scope lifecycle is: input event → preview scheduler generation → cached proxy/adjusted frame → scope aggregation → JSON → generation check → Canvas draw → settled/refinement request. Aborted or older generations cannot replace current results.

## Scope performance evidence

### Browser matrix

The same EXR, TIFF, and Apple HDR HEIC sources were run in fast, high-quality, and forced CPU-fallback modes with 30 interaction repetitions and 100 memory repetitions. All nine scenarios ended `Settled`, with zero browser errors and zero stale results applied.

| Input / mode | Baseline visible scope p95 | Final visible scope p95 | Final frame p95 | Backend request p95 | Parse p95 | Draw p95 | Managed cache after stress |
|---|---:|---:|---:|---:|---:|---:|---:|
| Affinity EXR / fast | 60.5 ms | 71.0 ms | 3.8 ms | 4.5 ms | 0.5 ms | 0.6 ms | 517.1 MiB |
| Affinity EXR / high quality | 69.1 ms | 66.0 ms | 3.2 ms | 9.0 ms | 0.5 ms | 0.6 ms | 531.3 MiB |
| Affinity EXR / CPU fallback | 62.2 ms | 66.3 ms | 4.8 ms | 7.5 ms | 0.5 ms | 0.7 ms | 512.8 MiB |
| Float TIFF / fast | 68.3 ms | 65.3 ms | 4.8 ms | 4.6 ms | 0.5 ms | 0.6 ms | 33.7 MiB |
| Float TIFF / high quality | 70.7 ms | 66.0 ms | 2.7 ms | 7.9 ms | 0.5 ms | 0.6 ms | 35.9 MiB |
| Float TIFF / CPU fallback | 69.6 ms | 65.9 ms | 4.7 ms | 5.1 ms | 0.5 ms | 0.7 ms | 35.9 MiB |
| Apple HEIC / fast | 67.4 ms | 66.1 ms | 5.3 ms | 4.1 ms | 0.5 ms | 0.5 ms | 172.9 MiB |
| Apple HEIC / high quality | 66.0 ms | 61.4 ms | 4.1 ms | 4.2 ms | 0.5 ms | 0.6 ms | 181.7 MiB |
| Apple HEIC / CPU fallback | 70.7 ms | 71.8 ms | 5.0 ms | 5.3 ms | 0.6 ms | 0.7 ms | 170.2 MiB |

Cold input-to-ready time was highly cache/disk dependent: the large EXR varied from about 1.0 seconds in the baseline run to 5.6–8.8 seconds in the final run, while TIFF and HEIC generally improved. No loader or scope change explains this variance; report cold decode separately from interactive cadence.

### Backend phase profile at a 768 px proxy

| Input | Decode | Cold proxy | Adjustment p95 | Histogram p95 | Waveform p95 | Waveform JSON p95 / size | Warm cached scope p95 |
|---|---:|---:|---:|---:|---:|---:|---:|
| 477 MiB Affinity EXR | 2,986 ms | 660 ms | 2.32 ms | 17.50 ms | 71.12 ms | 3.72 ms / 646 KiB | 0.24 ms |
| Float TIFF | 108 ms | 13 ms | 2.51 ms | 14.16 ms | 42.73 ms | 3.37 ms / 603 KiB | 0.21 ms |
| Apple HDR HEIC | 936 ms | 98 ms | 1.66 ms | 10.71 ms | 52.14 ms | 3.57 ms / 604 KiB | 0.23 ms |

Histogram JSON was only 5–6 KiB and serialized below 0.04 ms p95. Waveform output is larger, but its computation and transfer remain inside the settled-tier budget. The existing vectorized waveform and fixed dimensions are appropriate.

Durable generated evidence (ignored by Git):

- `codebase/output/performance/codebase-review-baseline.json`
- `codebase/output/performance/codebase-review-after.json`
- `codebase/output/performance/scope-phase-profile.json`

## Dependency and package audit

“Automatic” means PyInstaller's graph or standard/contrib hook collected the dependency in the successful build. Sizes are approximate ownership indicators from the folder build; shared DLLs and transitive packages prevent exact attribution.

| Dependency (tested version) | Importing area / capability | Requirement | Frozen discovery / approximate size | Test evidence | License / notice | Recommendation |
|---|---|---|---|---|---|---|
| FastAPI 0.141.1 | `main.py`; HTTP/API/static app | Mandatory | Standard graph/hook; small, plus Starlette | API, frontend contract, proofing | MIT | Keep |
| Uvicorn 0.52.0 | `main.py`, `launcher.py`; local server | Mandatory | Hook plus explicit `collect_submodules`; HTTP stack several MiB | launcher, packaged health | BSD-3-Clause | Keep; broad submodule collection can be reviewed later |
| python-multipart 0.0.32 | FastAPI upload route | Mandatory | Graph-discovered; small | real API uploads, packaged AVIF upload | Apache-2.0 | Keep |
| NumPy 2.5.1 | All image/color/adjustment/scope paths | Mandatory | Standard hook; ~26 MiB including 19.46 MiB OpenBLAS | broad suite and performance | BSD-3-Clause plus bundled notices | Keep |
| Pillow 11.3.0 | bitmap import, SDR intermediates/base, previews | Mandatory | Standard hook; ~10.6 MiB | loader, display, export, round trip | MIT-CMU plus bundled codec notices | Keep |
| Pydantic 2.13.4 | models and API contracts | Mandatory | Hook; core is ~5 MiB | all API/model tests | MIT | Keep |
| tifffile 2026.7.14 | TIFF import and proof fixture output | Format capability | Graph-discovered; small Python layer | loader fixtures, local float TIFF, proofing | BSD-3-Clause | Keep |
| imagecodecs 2026.6.26 | compressed TIFF segments; 16-bit AVIF decoder PNG | Format capability, deliberately packaged | Explicit `collect_all`; ~47.9 MiB | TIFF fixtures/local TIFF; AVIF import/round trip | BSD-3-Clause plus bundled codec licenses; retain upstream files | **Keep unchanged** |
| ImageIO 2.37.4 | Radiance HDR/PFM import | Format capability | Contrib hook; small excluding Pillow | loader paths/fixture generation | BSD-2-Clause | Keep while HDR/PFM remain supported |
| colour-science 0.4.7 | color-space matrices and PQ/HLG EOTFs | Mandatory color correctness | Graph-discovered; Python package; SciPy/Matplotlib not collected | core color, loader, exports | BSD-3-Clause | Keep; do not add SciPy/Matplotlib |
| OpenEXR 3.4.13 | EXR import | Format capability | Graph-discovered; binding 1.81 MiB plus libraries | EXR fixtures and local large EXRs | BSD-3-Clause (retain upstream notice) | Keep |
| pillow-heif 1.5.0 | HEIC/HEIF and Apple gain map decode | Format capability | Graph-discovered; HEIF stack roughly 10 MiB | local Apple HEIC and loader tests | BSD-3-Clause; bundled libheif codec obligations | Keep |
| ExifRead 3.5.1 | Apple MakerNote headroom fields | HEIC metadata capability | Graph-discovered; small | Apple metadata/classification tests | BSD-3-Clause-style notice must be retained | Keep |
| Native libavif tools 1.4.1 | AVIF preview/export/proof/input | AVIF capability | Explicit `bin` data; ~35.8 MiB total | AVIF inspection, proofing, direct/gain-map input, packaged upload | BSD-2-Clause and codec notices | Keep |
| libultrahdr tool | JPEG Ultra HDR export/proof/input | Ultra HDR capability | Explicit `bin` data; ~1.23 MiB tool plus libraries | Ultra HDR export/proof/round trip, packaged discovery | MIT + Apache-2.0 + Adobe notice | Keep |

The first final package measurement was **195,506,806 bytes (186.45 MiB)** uncompressed and **81,084,229 bytes (77.33 MiB)** zipped. Baseline was 195,495,333 bytes and 81,071,230 bytes respectively: only +11.2 KiB uncompressed and +12.7 KiB zipped. A later verification rebuild from the accepted checkpoint produced **203,549,000 bytes (194.12 MiB)** uncompressed and **84,247,676 bytes (80.34 MiB)** zipped. Both builds fully collect `imagecodecs`; the later increase is recorded as build-input/environment drift pending a clean artifact-level comparison.

PyInstaller warnings for missing `jxs.dll`, Jetraw DLLs, and an imagecodecs HEIF DLL belong to unused optional modules collected by `collect_all`; active TIFF and AVIF paths pass. The local Tk installation warning is pre-existing; Windows folder-picker fallback is unit-tested. These warnings should not be broadly suppressed.

## AVIF and JPEG Ultra HDR decoder contract

### Shared invariants

- Output HDR pixels are float32 ACEScg, with `0.18 == 100 nits`.
- The SDR rendition is kept separately in linear sRGB; it is never generated by double-tone-mapping the reconstructed HDR rendition when a real base exists.
- PQ/HLG is decoded once. Gain maps are applied once by the authoritative native decoder.
- Missing, malformed, contradictory, unsupported-transfer, or dimension-mismatched data is a loader error. A file advertising HDR must never silently fall back to SDR.
- Capability reporting describes decoder combinations, not merely extension acceptance.

### AVIF

- `avifdec` is the direct pixel decoder. It emits 16-bit PNG; `imagecodecs.png_decode` retains that precision.
- Plain SDR/direct HDR AVIF uses container CICP primaries and transfer. PQ/HLG is normalized once to ACEScg. Unsupported/missing transfer is rejected.
- ISO 21496-1 gain-map AVIF uses `avifgainmaputil tonemap` at the declared HDR headroom and BT.2020/PQ output, then normalizes to ACEScg. The SDR base is decoded directly when it is the base rendition; inverted containers reconstruct the SDR endpoint explicitly.
- Metadata records source/alternate CICP, base/alternate headroom, capacity ratio, offsets/gamma reported by the utility, dimensions, orientation transform description, and whether the exact base was preserved.

### JPEG Ultra HDR

- A JPEG is routed to the Ultra HDR decoder when it carries Adobe/ISO gain-map identifiers or the secondary JPEG structure. Plain JPEG remains on Pillow's SDR path.
- `ultrahdr_app` probes required capacity/offset/gamma/gamut metadata and emits linear half-float HDR. Its `1.0 == 203 nits` convention is converted to HDR Finisher's `0.18 == 100 nits` reference before the gamut transform.
- `useBaseColorSpace=1` means the reconstructed linear output is interpreted in the base sRGB/BT.709 gamut; otherwise it is BT.2020. The legacy JPEG base is independently decoded, ICC-converted to sRGB when possible, and EXIF orientation is applied to both renditions.
- If the native tool is unavailable or rejects the gain map, loading fails rather than presenting only the SDR JPEG.

The implementation follows the bundled tools' documented decode/tonemap interfaces. Primary references: [libavif](https://github.com/AOMediaCodec/libavif) and [libultrahdr](https://github.com/google/libultrahdr).

## Round-trip matrix and tolerances

The deterministic source contains neutral/color patches, gradients, and small highlights. Each production encoder is exercised, inspected by its native tooling, loaded, exported again, and loaded a second time.

| Check | AVIF gain map | JPEG Ultra HDR | Acceptance |
|---|---|---|---|
| First import HDR classification | Pass | Pass | `HDR_TRUE` |
| Dimensions/orientation | Pass | Pass | Exact |
| Authored SDR relationship | Pass | Pass | First-generation linear mean absolute error < 0.06 |
| HDR peak/distribution | Pass | Pass | P99 within 22% of authored HDR |
| Tiny/highlight ordering | Pass | Pass | Reconstructed top highlights correspond above authored P90 |
| Second-generation SDR drift | ~0.065 | ~0.065 | Linear mean absolute error < 0.075 |
| Second-generation HDR drift | Pass | Pass | P99 within 25% of generation one |
| Capacity/headroom drift | Pass | Pass | Within 0.35 stop |

Tracked fixtures cover plain JPEG, tracked gain-map AVIF, direct PQ AVIF, missing decoder refusal, and both production round trips. Real local export/proof tests continue to use ignored media for high-resolution inspection.

## JPEG XL recommendation: later

No implementation is justified in this sprint. `cjxl` is absent, target application/browser/hosting preservation has not been established, and adding direct HDR plus possible gain-map semantics would create another native toolchain and proof matrix. Bundled imagecodecs JPEG XL components are useful for controlled experiments but are not a product architecture or evidence of platform interoperability.

Proceed only after a corpus answers: direct HDR versus gain map, Windows/macOS packaging, editor/browser/hosting round trips, metadata preservation, and whether archival value exceeds package/maintenance cost.

## DNG recommendation: later, constrained candidate only

Do not add generic camera RAW. A plausible first candidate is **input-only, already-rendered linear DNG** with explicit RGB samples, documented primaries/matrix, white balance, black/white levels, baseline exposure, orientation, and a deterministic mapping to ACEScg. Mosaiced RAW, demosaicing, camera profiles, highlight reconstruction, and development controls remain outside v1.

Before code, collect real files from named source applications and verify whether LibRaw/rawpy returns rendered scene-linear RGB or application-dependent developed pixels. Then measure binaries, licensing, clean Windows/macOS packaging, and whether the handoff is useful without RAW controls.

## Warnings and deferred work

Retained deterministic-test warnings after the local Pillow fix:

- Starlette warns that its current `httpx` TestClient path is deprecated. This is test infrastructure, not app startup.
- Pydantic 2.13.4 internally calls deprecated `datetime.utcnow()` during one evidence-model validation. Do not suppress it globally.

Explicitly deferred: selective imagecodecs packaging, frontend framework/build chain, speculative CSS/JS splitting, WebGPU scope reduction, JPEG XL implementation, general DNG/RAW development, full-source tiling, and unrelated visual redesign.

## Commands and validation

Run from `codebase/` unless stated otherwise:

```powershell
.\.venv\Scripts\python.exe -m pytest -q tests
node --check frontend/app.js
node --check frontend/webgpu-preview.js
node --check frontend/preview-scheduler.js
node --check tools/playwright_preview.js
node --check tools/playwright_gpu_parity.js
node --check tests/performance/preview-performance.js
node --check tools/playwright_live_scopes_qa.js
.\.venv\Scripts\python.exe tools/profile_scope_pipeline.py <EXR> <TIFF> <HEIC> --repetitions 10 --output output/performance/scope-phase-profile.json
node tests/performance/preview-performance.js --url http://127.0.0.1:8001 --inputs <EXR>,<TIFF>,<HEIC> --repetitions 30 --memory-repetitions 100 --output output/performance/codebase-review-after.json --enforce
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\build_windows.ps1 -SkipTests -SmokeTestPort 8012
```

Final deterministic result: **280 passed**. Focused gain-map/proofing result: **24 passed**. Browser matrix: **9/9 scenarios passed enforced budgets**, zero browser errors. Packaged result: health 200, both decoder capabilities available from frozen resources, and AVIF gain-map upload 200/HDR_TRUE. Final verified ZIP: `HDR-Finisher-v0.2.1-Windows-x64.zip`, **84,247,676 bytes (80.34 MiB)**, SHA-256 `ab7264fc43bcb5d43db4c57573b654db37f36e5cbcd69739d192e279ce121dd7`.
