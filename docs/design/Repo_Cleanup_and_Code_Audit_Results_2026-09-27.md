# Repo Cleanup and Code Audit — Results (2026-09-27)

Companion to `Repo_Cleanup_and_Code_Audit_Plan_2026-09-27.md` and
`Repo_Cleanup_and_Code_Audit_Baseline_2026-09-27.md`. This records what was
executed from the review table, the evidence, and what remains.

Validation host: dev-tree Electron host plus the `codebase/.venv` Python
environment, Windows, AC power. Every batch below ran the full Python suite and
matched or beat the baseline of 1,448 passed / 3 skipped. The continuation
audit after finding 11 was approved through finding 20. This pass stops after
finding 18 as requested; findings 15–17 remain the next structural batches.

## Finding status

| # | Finding | Status |
|---|---|---|
| 1 | Two SDR rendering branches repeat the post-highlight pipeline | Implemented |
| 2 | HDR/SDR highlight compression duplicate Peak Fit and soft ceiling | Implemented |
| 3 | Strip renderer bypasses the adjusted-frame single-flight | Implemented |
| 4 | Persistent source-mip filesystem failures swallowed | Implemented |
| 5 | RAW EXIF extraction swallows every failure; LibRaw fallback misses camera identity | Implemented |
| 6 | `decode_raw` coordinator is 260+ lines | Implemented |
| 7 | Export backends duplicate lifecycle; preparation escapes the error boundary | Implemented |
| 8 | Single local-mask tile endpoint misses the bound and resource guard | Implemented |
| 9 | HDR/SDR models and export/proof request models duplicate declarations | Implemented |
| 10 | Unreferenced internals (`StubExportBackend`, `_write_hdr_linear_rgba_f16`, `reset_default_source_mip_store`) | Implemented |
| 11 | Old sprint/implementation-history comments on core image paths | Implemented |
| 12 | Direct whole-frame masks bypass bounded/cancellable mask request coordination | Implemented |
| 13 | Perspective draft preview swallows every fetch failure | Implemented |
| 14 | Deferred highlight measurement failures disappear without diagnostics | Implemented |
| 15 | `webgpu-preview.js` remains a renderer/transport/cache/shader grab bag | Approved — deferred after finding 18 |
| 16 | `app.js` remains a 734-function application grab bag | Approved — deferred after finding 18 |
| 17 | `styles.css` is an override stack with contradictory late patches | Approved — deferred after finding 18 |
| 18 | Frontend contract tests pin source text instead of behavior | Implemented |
| 19 | Frontend comments still carry sprint/phase/work-item history | Implemented |
| 20 | The baseline deprecation warnings remain live | Implemented |

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

### 9. RAW decode phase coordinator (finding 6)

`decode_raw` is now a 22-line coordinator over five named phases:
`_inspect_raw`, `_build_raw_decode_plan`, `_execute_raw_decode`,
`_apply_raw_corrections`, and `_build_raw_provenance`. Small phase-result
dataclasses carry the inspected metadata, selected decoder contract, developed
buffer, and correction result without changing decoder options or the array
pipeline.

The existing camera-linear, mandatory-opcode, linear-DNG routing, metadata, and
extended-format tests exercise the extracted phases end to end. A new
`test_decode_raw_is_only_the_ordered_phase_coordinator` fixture pins the phase
order and requires the public entry point to return the correction pixels and
provenance result unchanged.

### 10. Shared export executor (finding 7)

All six export backends now delegate to `_execute_export`. The executor owns
output-path preparation, overwrite enforcement, backend preparation/rendering,
same-directory staging, fsync, validation, atomic replacement, incomplete-file
cleanup, and normalization of expected encoder/filesystem/value failures.
`ExportOverwriteRequired` still escapes for the API's 409 flow, and unexpected
programming errors are deliberately not caught.

Each backend supplies only its format-specific preparation, staged writer,
validator, and success copy. The old `_write_sdr_atomic` special case was
removed because PNG and JPEG now use the same lifecycle as JPEG XL, AVIF gain
map, and JPEG Ultra HDR.

Fixtures in `test_export_lifecycle.py` require every backend to call the shared
executor exactly once, prove preparation failures are normalized, prove a
partial staging file is removed, and prove an unexpected `RuntimeError`
remains visible. The existing export/API slice passed 190 tests.

### 11. Shared branch and encoding models (finding 9)

`_BranchAdjustments` now owns the 53 identical HDR/SDR declarations plus the
shared legacy migration and tone-node normalization. HDR and SDR subclasses
retain only their lane-specific fields, defaults, and validation.
`_EncodingSettings` similarly owns the shared export/proof encoding contract.
`ProofArtifactRequest.to_export_settings` replaces the manual 13-field copy in
`proofing.py`.

Wrap serializers preserve the previous serialized field order even though the
fields are now inherited. The recorded default `adjustment_signature` SHA-256
remains
`e75b6b7a29dffdfd13925e16f6bb4ed3189afabdabbe9ed22bd5b8aecec8a785`,
and the default proof cache key remains `27295d5e6543edfd11f1b83a`.

Fixtures in `test_model_declaration_contracts.py` pin both branch field orders,
both signatures, JSON project round-trip compatibility, proof request order,
and proof-to-export field parity. The model/project/proof/export slice passed
313 tests.

### 12. Perspective draft failure reporting (finding 13)

`renderPerspectiveDraftPreview` now treats an `AbortError` as the expected
superseded-request path, but reports any current non-cancellation fetch failure
through the Perspective status instead of silently retaining the old image.
Stale failures remain unable to overwrite the status for a newer draft.

The focused `perspective-draft-preview.test.js` behavior fixture covers both
paths: cancellation leaves the current status untouched, while a rejected
fetch exposes its error message. The existing bounded-draft contract also
continues to pass.

### 13. Deferred highlight-measurement diagnostics (finding 14)

Deferred highlight refinement remains non-fatal, but failures no longer
disappear. The renderer classifies them with the shared render-failure taxonomy,
keeps a bounded 40-entry diagnostic ring, records an instrumentation stage, and
emits `hdrfinisher:highlight-anchor-measurement-failed`. The accepted frame and
estimated/carried anchor remain visible.

`highlight-anchor.test.js` proves device-loss classification, the emitted event,
and the diagnostic bound.

### 14. Frontend invariant comments (finding 19)

Historical sprint, phase, work-item, and ledger markers were removed from
`app.js`, `webgpu-preview.js`, `styles.css`, and the frontend contract test.
Comments that carry a live constraint were rewritten as present-tense
invariants; the implementation history stays in this audit and its PRD.

The marker inventory is now empty apart from legitimate Display P3 identifiers.

### 15. Deprecation warning cleanup (finding 20)

Proof evidence now defaults to an explicitly UTC-aware timestamp and its JSON
round trip is pinned. Pillow calls no longer pass the deprecated `mode=`
argument. The development test dependency now uses Starlette's supported
`httpx2` path instead of the deprecated `httpx` fallback.

The original warning slice now passes 56 tests with no warnings.

### 16. Coordinated Direct mask loading (finding 12)

Direct whole-frame masks now use the same six-slot foreground coordinator as
tiled masks. A newer generation aborts active requests and prevents obsolete
queued work from starting; its `AbortSignal` reaches leaf fetches and scene
luminance source loading. Compound-mask leaves resolve without an inner
unbounded `Promise.all`, and identical leaf requests share a keyed in-flight
fetch without joining a request whose signal was already aborted.

`direct-mask-coordination.test.js` pins concurrency, cancellation, result order,
and in-flight reuse. Together with the existing coordinator suite, all nine
focused cases pass.

### 17. Frontend contract ownership (finding 18)

The 2,750-line `test_frontend_contract.py` monolith was split into six focused
contract modules: source workflow, controls, presentation, editor layout,
render pipeline, and local/scope behavior. Static markup, CSS, route, and
integration-wiring contracts remain explicit; runtime behavior is owned by the
focused JavaScript and Electron suites beside them instead of being added back
to one catch-all file.

`test_frontend_inventory_contract.py` pins the six-module boundary, the 101
reviewed contract tests, unique test names, and removal of the legacy monolith.
The resulting focused gate collects and passes 102 tests including the
inventory check.

## Continuation audit — frontend, styles, and tests

This is the next decision table required by the plan. It is based on source
inspection of the current working tree after findings 1–11. All nine findings
were approved; findings 12–14 and 18–20 are implemented in this pass, while the
larger structural findings 15–17 are intentionally deferred after finding 18.

| # | What's wrong (plain) | Where | What it means for you | Proposed fix | Risk | Decision |
|---|---|---|---|---|---|---|
| 12 | The Direct renderer started every active whole-frame local mask with one unbounded `Promise.all`, bypassing the tiled coordinator. | `frontend/webgpu-preview.js`; `tests/direct-mask-coordination.test.js` | Obsolete mask responses could consume browser slots and memory. | Implemented: shared bounded coordinator, cancellation signals, sequential compound leaves, and keyed in-flight reuse. | Medium | Implemented |
| 13 | The perspective draft request caught both `AbortError` and real network/backend failures and returned `null` for either; the conditional literally had the same result on both sides. | `frontend/app.js`; `tests/perspective-draft-preview.test.js` | Cancellation is harmless, but a disconnected backend or failed request silently left the previous image and gave no status, so the control appeared to have stopped working. | Implemented: ignore `AbortError`; surface a current non-cancellation exception through the Perspective status. Added cancellation and rejected-fetch behavior cases. | Low | Implemented |
| 14 | Deferred highlight measurement failures disappeared without diagnostics. | `frontend/webgpu-preview.js`; `tests/highlight-anchor.test.js` | Support could not explain why refinement stayed on an approximation. | Implemented: bounded classified diagnostics and a paired failure event, while preserving the non-fatal fallback. | Low | Implemented |
| 15 | `webgpu-preview.js` is still one 532 KB classic script containing WGSL, curve math, admission planning, source transport, GPU allocation/cache policy, denoise, masks, scopes, and presentation. These parts share one large mutable renderer object, so an edit to one subsystem has a very wide review surface. | `frontend/webgpu-preview.js` (about 10,000 physical lines) | GPU work is harder to review and isolate; transport or mask changes can accidentally disturb shader/presentation code, and unit tests must load the whole file. | After findings 12 and 18, extract leaf modules in dependency order: transport, mask loading, scope readback, and shader sources. Keep `HDRWebGPUPreview` as the coordinator and run the full Electron parity battery after each extraction. | High | Approved — deferred |
| 16 | `app.js` is still an 870 KB classic script with 734 named functions covering boot, global state, importing, project I/O, grading controls, geometry, preview scheduling, scopes, proof/export handoff, local masks, and DOM rendering. Existing extracted coordinators are consumed through load-order-dependent `window.HDR*` globals. | `frontend/app.js`; script order at the end of `frontend/index.html` | Unrelated UI work collides in one file, hidden global dependencies make ordering part of correctness, and safe ownership boundaries remain unclear. | First give extracted modules behavior tests and explicit inputs; then move one vertical at a time (import/project lifecycle, geometry tools, local-mask authoring, scope/UI rendering). Do not split pixel math and orchestration in the same batch. | High | Approved — deferred |
| 17 | The stylesheet has grown as successive late override passes instead of one owned rule per component. A leaf-rule inventory found 1,467 rules: 159 selectors occur more than once (417 rules total), 21 selectors occur at least four times, and `.app-shell` occurs nine times. Top-level patches set a 720 px minimum and later reset it to zero; several sections explicitly call themselves a “final cascade” or refinement pass. Breakpoint repeats are valid, but these top-level reversals make final behavior depend on distant source order. | `frontend/styles.css`, especially `:428`, `:3250`, `:6518`, `:7140`, `:7837`, `:7956`, `:8735` | A local CSS change can be silently overridden thousands of lines later; deleting what looks obsolete can change compact or desktop layouts. | Build a computed-style/screenshot matrix for normal, compact, desktop, native-menu, and supported viewport sizes; consolidate one component at a time while preserving that matrix byte/geometry-equivalently. Keep media/container overrides next to their owner. | Medium | Approved — deferred |
| 18 | The former `test_frontend_contract.py` primarily snapshotted implementation text and coupled unrelated frontend areas. | Six `tests/test_frontend_*_contract.py` modules plus `test_frontend_inventory_contract.py` | Frontend contracts now fail within their owning area, and the suite can migrate behavior one subsystem at a time without restoring a catch-all file. | Implemented: split 101 reviewed contracts by responsibility and added an inventory/uniqueness gate; focused JavaScript and Electron suites retain runtime behavior ownership. | Medium | Implemented |
| 19 | Frontend files carried 88 sprint/phase/work-item history markers. | Frontend files and `tests/test_frontend_contract.py` | Live invariants were obscured by implementation history. | Implemented: present-tense invariant comments; history retained in the audit/PRD. | Low | Implemented |
| 20 | UTC, Pillow, and TestClient deprecation warnings remained live. | Models, image call sites, fixture, and `requirements-dev.txt` | Warnings hid new regressions and future removals. | Implemented: aware UTC, inferred Pillow modes, and `httpx2`; warning-count gate is clean. | Medium | Implemented |

## Validation summary

| Check | Result |
|---|---|
| Python suite after the last batch | 1,466 passed, 3 skipped (baseline 1,448 / 3) |
| Earlier desktop unit gate for findings 1–11 | 22 passed |
| Earlier `npm run test:electron` baseline | Pass |
| Current Electron smoke and export-parity rerun | Host-blocked before first window: Electron GPU helper repeatedly crashed with Windows status `-1073741515`, including with hardware acceleration disabled |
| ROI parity after all backend batches | Max difference 0, no page errors |
| SDR branch hash matrix | 26/26 byte-identical |
| Highlight-curve hash matrix | 33/33 byte-identical |
| Continuation findings 12–20 | Findings 12–14 and 18–20 implemented; findings 15–17 approved and deferred as requested |
| Continuation warning confirmation | 56 passed, no warnings (`test_source_tile_api`, `test_proofing`, `test_launcher`) |
| Desktop JavaScript unit gate | 239/239 passed |
| Split frontend contract gate | 102/102 passed, including the inventory check |

The full Electron parity battery (B&W, clarity-map, grain, tiled denoise, tiled
CPU detail, tiled/direct, tiled film, adaptive denoise, GPU scopes, highlight
compression, SDR gamut, ROI and denoise ROI, export) was run at the baseline
and is recorded in the Baseline document. Reports live in
`codebase/output/performance/electron-*.json`.

The earlier batches are committed on `audit/repo-cleanup`; findings 6, 7, and 9
and their fixtures are uncommitted, so `git status` and `git diff` are the
recovery path for the current batches.

## Remaining batches

Findings 1–14 and 18–20 are implemented. Per Steve's request, this pass stops
after finding 18. The approved structural findings 15–17 remain, in that
order: renderer leaf modules, application verticals, then stylesheet
consolidation. Each runtime batch keeps the original no-pixel-change and
preview-performance gates.

The live Electron smoke and export-parity rerun also remain an environment
validation follow-up because the host GPU helper exits before the application
creates a window.

## Handoff

**State.** Baseline follow-ups 1–4 are closed. Findings 1–14 and 18–20 are
implemented; findings 15–17 are approved but intentionally deferred after
finding 18. Findings 1–5, 8, 10, and 11 are committed on
`audit/repo-cleanup`; findings 6, 7, 9, and 12–14 plus 18–20 are validated in
the current uncommitted batches. The current live Electron rerun is
host-blocked as recorded above.

**Environment.**
- Python gate: from `codebase/`, `.venv/Scripts/python.exe -m pytest -q tests`.
- Frontend static-contract gate: run all `tests/test_frontend_*_contract.py`;
  the current split contains 102 passing tests including its inventory gate.
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

**Validation follow-up.** Restore a working Electron GPU helper on this host,
then rerun `npm run test:electron` and
`node tests/run-in-electron.js tests/performance/export-parity.js`. The current
failure occurs before test code or the application window starts.

**Working agreements.** No pixel changes, preview must not get slower, nothing
is deleted without Steve's yes, and this Results document is updated after each
batch.
