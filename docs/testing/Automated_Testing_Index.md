# Automated Testing Index

The automated suite is risk-oriented rather than coverage-percentage driven. Private photographs and large renderer outputs are never required by CI.

## Test tiers

| Tier | Contents | Run from `codebase/` |
|---|---|---|
| Fast deterministic | Color normalization, HDR classification boundaries, adjustment invariants, SDR fallback, scopes, diagnostics, preview math, cache behavior, API validation, and mocked exporter failure/atomicity paths | `.\.venv\Scripts\python.exe -m pytest -q tests` |
| Small file-level | Tracked PNG, float TIFF, untagged linear EXR, and Blender `colorInteropID` EXR fixtures under `tests/fixtures/` | `.\.venv\Scripts\python.exe -m pytest -q tests/test_loader_fixtures.py tests/test_api.py` |
| Encoder/export integration | Real AVIF preview and gain-map inspection, JPEG Ultra HDR encode/legacy decode/HDR decode, and proof-artifact reconstruction. Tests skip with an explicit reason when the required binary is unavailable. | `.\.venv\Scripts\python.exe -m pytest -q tests/test_avif_info.py tests/test_ultrahdr_export.py tests/test_proofing.py` |
| Optional local media | Large Blender/Affinity EXRs and private iPhone HEIC media in ignored `local-test-media/inputs/`; results go to ignored `output/` | `.\.venv\Scripts\python.exe .\tools\local_media_probe.py <paths> --export` |
| Alpha harness | Full pytest, JavaScript syntax checks, capability report, sample export/inspection, and browser layout smoke | `powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\run_alpha_qa.ps1` |

Set `PYTHONPATH` to the resolved `backend` directory when running pytest outside the project scripts.

## Requirement inventory

| Risk area | Primary automated coverage | Status |
|---|---|---|
| Source metadata and ambiguity | `test_loader_fixtures.py`, `test_api.py` | Exact recognized OCIO IDs, unknown/similar IDs, chromaticity precedence/conflict policy, ICC naming, transfer-only override safety, manual override/reset lifecycle |
| ACEScg normalization | `test_core.py`, `test_loader_fixtures.py` | sRGB, BT.2020, PQ, ACEScg pass-through, unknown-linear preservation, and numerical normalization of the Blender fixture |
| HDR classification/headroom | `test_core.py`, `test_adjustments.py` | Strict `1.0` boundary, encoded and scene-linear classifications, Apple gain-map path, source-latitude policy |
| HDR/SDR finishing | `test_adjustments.py`, `test_core.py`, `test_frontend_contract.py` | Variable-node equalizer migration/limits, targeting masks, section bypass, fixed HDR curve domain, highlight ordering/rolloff continuity, branch isolation, hue behavior, and grading interaction contracts |
| Float preview/resampling | `test_core.py`, `test_render_cache.py`, `test_preview_display.py` | Long-edge cap, float/HDR-range preservation, high-frequency filtering, proxy reuse/alignment, SDR-display fallback math |
| Scopes and overlays | `test_core.py` | AP1 luminance, 100/203/1000-nit guides and strict thresholds, histograms, waveform aggregation, false color, zebra alpha/cutoff |
| Export and metadata | `test_ultrahdr_export.py`, `test_avif_info.py`, `test_proofing.py` | Independent base/gain-map quality and scale, proof/export parity, metadata-selected JPEG gamut conversion, encoded offsets/capacity, atomic replacement, AVIF gain-map metadata, legacy fallback decode, and optional real round trips |
| API/session/preflight | `test_api.py`, `test_capability_gates.py`, `test_folder_picker.py` | Upload cleanup, interpretation lifecycle, preview/scopes/proxy routes, unsupported format rejection, backend capability rejection, and Windows STA picker selection/cancellation/failure paths |
| Delivery/hosting | `test_proofing.py`, `test_hosting_probe.py` | Fixed-headroom reconstruction, content hashes/cache, evidence persistence, metadata survival and destructive conversion detection |

## Remaining gaps

- Real iPhone auxiliary gain-map extraction and rendition comparison remain optional local-media validation; the private HEIC must not become a committed or CI fixture.
- Real Affinity and high-resolution Blender rendering remain manual/local checks for decoder performance, saturated highlights, gradients, downsampling, and clipping diagnostics.
- Physical HDR/SDR monitor behavior, browser/compositor differences, Instagram handling, and hosting transformations require the manual procedures in this directory.
- Capability-aware encoder tests validate installed binaries, but CI should eventually publish a matrix showing which optional encoders ran rather than treating skips as equivalent to executed round trips.
- Packaged clean-machine testing, macOS packaging, and JPEG XL remain outside the mandatory pytest tier. Windows picker behavior is unit-covered; packaged interaction remains a manual check.

Generated reports are evidence from a particular run. Record durable conclusions in `docs/testing/`, not only under `codebase/output/`.
