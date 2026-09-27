# Repo Cleanup and Code Audit — Results (2026-09-27)

Companion to `Repo_Cleanup_and_Code_Audit_Plan_2026-09-27.md` and
`Repo_Cleanup_and_Code_Audit_Baseline_2026-09-27.md`. This records what was
executed from the review table, the evidence, and what remains.

Validation host: dev-tree Electron host plus the `codebase/.venv` Python
environment, Windows, AC power. Every batch below ran the full Python suite and
matched or beat the baseline of 1,448 passed / 3 skipped.

## Finding status

| # | Finding | Status |
|---|---|---|
| 1 | Two SDR rendering branches repeat the post-highlight pipeline | Implemented |
| 2 | HDR/SDR highlight compression duplicate Peak Fit and soft ceiling | Implemented |
| 3 | Strip renderer bypasses the adjusted-frame single-flight | Implemented |
| 4 | Persistent source-mip filesystem failures swallowed | Implemented |
| 5 | RAW EXIF extraction swallows every failure; LibRaw fallback misses camera identity | Implemented |
| 6 | `decode_raw` coordinator is 260+ lines | Pending |
| 7 | Export backends duplicate lifecycle; preparation escapes the error boundary | Pending |
| 8 | Single local-mask tile endpoint misses the bound and resource guard | Implemented |
| 9 | HDR/SDR models and export/proof request models duplicate declarations | Pending |
| 10 | Unreferenced internals (`StubExportBackend`, `_write_hdr_linear_rgba_f16`, `reset_default_source_mip_store`) | Implemented |
| 11 | Old sprint/implementation-history comments on core image paths | Implemented |

## Implementation record

### 1. Shared SDR tail (finding 1)

`_apply_sdr_post_highlight_tail` now owns every stage after the highlight
stage, in one explicit order, and both `_apply_sdr_adjustments` and
`_apply_sdr_adjustments_to_reference` call it. The only branch difference
inside the tail is Color: the authored reference runs `_apply_sdr_color_stage`
between the tone controls and Primaries; the generated path grades Color in its
scene-linear prefix.

Pixel parity: a 26-case matrix (both branches by legacy/neutral, highlight,
Color, Black & White, exposure/shadow, section toggles, detail, grain and
ceiling toggles) hashed byte-identically before and after the extraction.

Fixture: `test_sdr_branches_share_one_post_highlight_tail` records the stage
order for both branches, requires each to use the shared tail exactly once,
and pins the reference's Color placement.

### 2. Shared highlight-curve construction (finding 2)

Added `_PeakFitParameters` plus `_peak_fit_parameters`, `_peak_fit_progress`,
`_peak_fit_ratio_application`, `_peak_fit_group_channels`,
`_soft_ceiling_exponent`, `_soft_ceiling_curve`, and
`_soft_ceiling_activation`. Both lanes build their curves from these helpers.

The per-lane evaluation forms stay local on purpose: the expanded polynomial
(SDR) and the Hermite-basis form (HDR) are algebraically identical but not
bit-identical (measured differences up to ~1.8e-7 in float32), and the HDR
smooth path keeps its in-place BT.2020 loop. Each lane's scalar types are
preserved by passing already-clamped `detail`/`curve_bias` into the shared
parameter helper.

Pixel parity: a 33-case matrix (both lanes by mode, softness, color handling,
measurement, bias, detail, start/target, peak and clip) hashed byte-identically
before and after the extraction.

Fixture: `test_both_highlight_lanes_build_their_curves_from_the_shared_helpers`
spies the shared helpers and requires both lanes to use all of them.

### 3. Mask endpoint policy (finding 8)

Added `_checked_edit_session`, `_check_mask_geometry`, and
`_checked_mask_local`; all four mask endpoints use them. The single-tile
endpoint now has `le=16384` on `long_edge` and calls
`_guard_preview_resources`, matching the whole-mask, batch, and preview
siblings.

Fixture: `test_local_mask_tile_answers_to_the_whole_mask_resource_policy`
asserts the 422 bound and a mocked 507 guard refusal on both the tile and
whole-mask endpoints.

### 4. Source-mip failure accounting (finding 4)

`SourceMipStore` now records `disk_read_failures`, `disk_write_failures`, and
`disk_delete_failures`, keeps the last failure category and path in
`diagnostics()["last_failure"]`, and logs each category at most once. Plain
`FileNotFoundError` remains an ordinary miss. `_ensure_cleaned` counts a stale
version only after `rmtree` succeeds, and `default_source_mip_store` logs an
unusable root once.

Fixtures: read (permission), write (`os.replace` denied), and stale-delete
failure tests in `test_render_cache.py`.

### 5. RAW EXIF provenance (finding 5)

`_read_raw_exif` returns `(metadata, warning)`; the warning separates
`missing_dependency`, `io_error`, and `parse_error`, and is exposed as
`metadata["raw_exif_warning"]` without changing the soft fallback.
`_read_libraw_metadata` now also falls back to LibRaw's
`camera_manufacturer`/`camera_model`, so Lensfun's automatic match can still
qualify when EXIF is missing. Exact EXIF still wins the merge.

Fixtures: cross-vendor tag reading (warning `None`), unreadable file, parse
failure, and LibRaw camera-identity restoration in `test_metadata.py`.

### 6. Single-flight for the strip path (finding 3)

`_acquire_frame_flight` now owns frame-cache check, single-flight acquisition,
waiting, and stale-cancellation for both `adjusted_frame` and
`adjusted_frame_in_strips` under the same `("frame", *key)` flight. The strip
owner commits its frame inside the guarded block before releasing the flight.

Fixture: `test_strip_and_whole_frame_paths_share_one_single_flight` holds the
strip render, proves a concurrent whole-frame request joins the flight, and
asserts exactly one render (`_misses == 1`, `_hits == 1`) with equal frames.

### 7. Dead code (finding 10)

Removed `StubExportBackend`, `_write_hdr_linear_rgba_f16`, and
`reset_default_source_mip_store` after confirming no runtime, test, frontend,
or documentation references. Recoverable from git history.

### 8. Stale comments (finding 11)

Rewrote the four sites as present-tense invariants; the historical evidence
already lives in the PRD (`NEXT-01 #2`, Phase 4 bounded strips) and the denoise
parity suites.

## Validation summary

| Check | Result |
|---|---|
| Python suite after the last batch | 1,458 passed, 3 skipped (baseline 1,448 / 3) |
| Desktop unit tests | 22 passed |
| `npm run test:electron` | Pass |
| ROI parity after all backend batches | Max difference 0, no page errors |
| SDR branch hash matrix | 26/26 byte-identical |
| Highlight-curve hash matrix | 33/33 byte-identical |

The full Electron parity battery (B&W, clarity-map, grain, tiled denoise, tiled
CPU detail, tiled/direct, tiled film, adaptive denoise, GPU scopes, highlight
compression, SDR gamut, ROI and denoise ROI, export) was run at the baseline
and is recorded in the Baseline document. Reports live in
`codebase/output/performance/electron-*.json`.

All changes are uncommitted; `git status` and `git diff` are the recovery path,
including for the three removals.

## Remaining batches

- **Finding 6 — split `decode_raw`.** Split into inspect, decode-plan, execute,
  corrections, and provenance phases while preserving the exact array pipeline
  and fallback contract. `test_camera_linear_raw_bridge.py`,
  `test_dng_raw_routing.py`, `test_linear_dng.py`, and `test_metadata.py` are
  the gates.
- **Finding 7 — one export executor.** Cover preparation, render, staging,
  validation, atomic replace, cleanup, and expected-error normalization across
  all six backends; keep programming errors visible. Export parity is the
  end-to-end gate.
- **Finding 9 — model declaration dedup and proof→export conversion.**
  Prerequisite: snapshot serialized field order, project compatibility, and
  cache signatures (field order feeds `adjustment_signature`) before touching
  the models.

## Handoff

**State.** Baseline follow-ups 1–4 are closed; audit findings 1–5, 8, 10, and
11 are implemented and validated and committed on `audit/repo-cleanup`.
Findings 6, 7, and 9 remain.

**Environment.**
- Python gate: from `codebase/`, `.venv/Scripts/python.exe -m pytest -q tests`
  (expect 1,458 passed, 3 skipped).
- Electron smoke: `npm run test:electron`. Electron drivers open a real window
  and may need desktop-app permission.
- Parity and smoothness drivers: `node tests/run-in-electron.js tests/<driver>.js`;
  reports land in `codebase/output/performance/`.
- The held-constant smoothness command and baseline numbers are in the Baseline
  document; rerun that command and compare.

**Method that worked here.** Capture before/after output hashes for the pixels
the change can touch (the 26- and 33-case matrices recorded above), refactor,
require byte-identical hashes, then add a structural fixture that pins the new
shared path. One extraction per batch, and never unify lane-specific rounding
just because two forms are algebraically equal.

**Next batches.**
- #6 `decode_raw` split (`raw_import.py:95`): phases inspect → decode plan →
  execute → corrections → provenance. Gates: `test_camera_linear_raw_bridge.py`,
  `test_dng_raw_routing.py`, `test_linear_dng.py`, `test_metadata.py`.
- #7 one export executor (`exporters.py`, `main.py:1620`): preparation, render,
  staging, validation, atomic replace, cleanup, expected-error normalization;
  keep programming errors visible. Gate:
  `node tests/run-in-electron.js tests/performance/export-parity.js`.
- #9 model dedup (`models.py:367`, `:475`, `:1388`, `:1461`, `proofing.py`):
  snapshot serialized field order, project compatibility, and cache signatures
  before touching the models.

**Working agreements.** No pixel changes, preview must not get slower, nothing
is deleted without Steve's yes, and this Results document is updated after each
batch.
