# Repo Cleanup and Code Audit — Results (2026-09-27)

Companion to `Repo_Cleanup_and_Code_Audit_Plan_2026-09-27.md` and
`Repo_Cleanup_and_Code_Audit_Baseline_2026-09-27.md`. This records what was
executed from the review table, the evidence, and what remains.

Validation host: dev-tree Electron host plus the `codebase/.venv` Python
environment, Windows, AC power. Every batch below ran the full Python suite and
matched or beat the baseline of 1,448 passed / 3 skipped. The continuation
audit after finding 11 was approved through finding 20. The resumed pass
completed findings 15–17 in small, independently validated batches.

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
| 15 | `webgpu-preview.js` remains a renderer/transport/cache/shader grab bag | Implemented |
| 16 | `app.js` remains a 734-function application grab bag | Implemented |
| 17 | `styles.css` is an override stack with contradictory late patches | Implemented |
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

### 18. Renderer source-transport boundary (finding 15, batch 1)

Added `source-transport.js` as an explicit dependency loaded before the WebGPU
renderer. It now owns the bounded upload-ring size and mechanics, pending
response-read cancellation, superseded-source error contract, staging-buffer
release, and the diagnostic A/B transport-mode selection. This established the
loud dependency boundary used by the next transport extraction.

The existing `source-transport.test.js` behavior harness now loads the module
as the page does. All 20 transport cases pass, including the 42 MP staging
bound, one-drain ring reuse, stream/strip/whole-frame routing, stale geometry,
single-flight, session abort, and supersession cleanup. The complete desktop
JavaScript unit gate remains 239/239 and the split frontend contract gate
remains 102/102. The full Python suite remains 1,466 passed / 3 skipped.

### 19. Source proxy coordinator (finding 15, batch 2)

`source-transport.js` now also owns whole-frame fetch/validation/upload,
source-proxy cache reuse, keyed single-flight, region/stream/strip/whole-frame
route selection, and advisory source-mip progress polling. The renderer's
`loadProxy` entry point is a thin compatibility delegate; its existing streamed,
strip, and ROI upload implementations remain the next transport sub-batch.

The same 20-case transport harness passed after each step. The complete desktop
JavaScript gate remains 239/239, the frontend contract gate remains 102/102,
and the full Python suite remains 1,466 passed / 3 skipped.

### 20. Single-response source streaming (finding 15, batch 3)

Moved the complete `proxy-stream`/streamed-`proxy` upload lifetime into
`source-transport.js`: response ownership, header and geometry validation,
supersession polling, bounded row assembly, staging-ring copies and drain,
partial-texture destruction, unread-body cancellation, cache publication, and
transport metrics. `HDRWebGPUPreview.loadProxyStreaming` is now a thin delegate.

All 20 transport cases pass, including early EOF, a superseded pending read,
unavailable-route fallback, geometry rejection before upload, and the 42 MP
bounded-staging case. The complete desktop JavaScript gate remains 239/239,
the frontend contract gate remains 102/102, and the full Python suite remains
1,466 passed / 3 skipped.

### 21. Per-strip source transport (finding 15, batch 4)

Moved the complete bounded `source-tile` whole-frame route into
`source-transport.js`: probe and epoch handling, stale-geometry checks, chunk
fetches, staging-ring copies, partial-texture cleanup, cache publication, and
metrics. `HDRWebGPUPreview.loadProxyStreamed` is now a thin delegate. All 20
transport cases, 239 desktop JavaScript tests, 102 frontend contracts, and the
full 1,466 passed / 3 skipped Python suite remain green.

### 22. ROI source transport (finding 15, batch 5)

Moved the magnified-viewport `source-tile` route into `source-transport.js`,
including the probe, source-epoch propagation, geometry and region validation,
bounded row-chunk uploads, supersession cleanup, cache publication, and
transport metrics. `HDRWebGPUPreview.loadProxyRegion` is now a thin delegate,
so every source-pixel network/upload lifetime is owned by one explicit module.

All 20 source-transport cases pass, including the four ROI-region cases. The
complete desktop JavaScript gate remains 239/239, the frontend contract gate
remains 102/102 after moving its static ownership assertions, and the full
Python suite remains 1,466 passed / 3 skipped.

### 23. CPU mask transport (finding 15, batch 6)

Added `mask-loader.js` and moved both CPU-rendered mask lifetimes into it: the
whole-mask leaf path and the batched tiled path. It owns request bodies,
response cancellation, geometry validation, row padding, texture upload,
cache publication, keyed in-flight reuse, and supersession checks. The
renderer retains mask-type selection and GPU graph orchestration.

The focused mask gate passes 14/14 cases, including stale-body cancellation,
post-read supersession, cache reuse, bounded batched upload, and coordinator
cancellation. The complete desktop JavaScript gate grew to 244/244; frontend
contracts remain 102/102 and the full Python suite remains 1,466/3.

### 24. Scope readback (finding 15, batch 7)

Added `scope-readback.js` for the two authoring-scope mapping lifetimes: the
settled exact-peak grid and the histogram/waveform analysis buffer. It owns
mapping, padded-row unpacking, stale-source rejection, timing metrics, unmap,
resource release, and deferred-destroy flushing. Encoding and resource-pool
allocation remain renderer responsibilities.

Four focused cases pin padded unpacking, stale rejection, peak maximum, and
failed-map cleanup. The complete desktop JavaScript gate is 248/248; frontend
contracts remain 102/102 and the full Python suite remains 1,466/3.

### 25. WebGPU shader ownership (finding 15, batch 8)

Moved all five WGSL programs—main grading, luma/mask, peak reduction, compact
denoise, and adaptive denoise—plus their Black & White shader generator into
`webgpu-shaders.js`. The renderer now consumes one explicit immutable shader
module and contains no vertex, fragment, or compute function bodies.

SHA-256 comparison against committed pre-extraction source at `5880184`
matched all five generated shader strings exactly. Two permanent fixtures pin
those byte identities and the load-order/ownership boundary. The complete
desktop JavaScript gate is 250/250; frontend contracts remain 102/102 and the
full Python suite remains 1,466/3.

### 26. Scope UI and analysis ownership (finding 16, batch 1)

Added `scope-ui.js` for scope freshness, resolution/profile labels, guide and
tooltip text, guide positioning, channel filtering, and scope titles. Added
`scope-analysis.js` for the GPU scope payload, robust population peak, analysis
bounds, HDR luminance conversion, SDR transfer, and vectorscope payload. Both
modules receive channel mode and reference white explicitly; `app.js` retains
request scheduling, accepted-presentation checks, DOM/canvas orchestration,
and thin compatibility delegates.

Nine focused behavior cases cover the extracted boundary. The complete desktop
JavaScript gate grew to 259/259, frontend contracts remain 102/102 after moving
their ownership assertions, and the full Python suite remains 1,466/3.

### 27. Geometry calculation ownership (finding 16, batch 2)

Added `geometry-math.js` for neutral-transform detection, projective point
mapping, rotated and cropped source-frame dimensions, crop aspect ratios, and
recursive local-mask expression projection. These calculations now take the
source, geometry, coordinate map, and mask expression explicitly. `app.js`
retains authoritative geometry-map requests, cache lifetime, gestures, and DOM
rendering through thin delegates.

Five focused cases pin rotation/straighten/crop sizing, authoritative-map
precedence, points at infinity, recursive gradient/path projection, and the
null path-handle invariant. The complete desktop JavaScript gate is 264/264,
frontend contracts remain 102/102, and the full Python suite remains 1,466/3.

### 28. Import and project transport ownership (finding 16, batch 3)

Added `project-io.js` for desktop-grant and path-based project open/save
requests; import-job creation, polling, and cancellation; source upload;
session recovery/eject; safe JSON decoding; relink classification; and
response-error normalization. Its public operations take `fetch` and all
path/grant/session inputs explicitly. `app.js` retains unsaved-change policy,
dialog choices, generation ownership, activation, and document-state rendering.

Seven focused behavior cases pin project and import endpoint/body contracts,
optional relink fields, abort-signal forwarding, browser-owned FormData
headers, invalid JSON, and error normalization. The complete desktop
JavaScript gate is 271/271, frontend contracts remain 102/102, and the full
Python suite remains 1,466/3.

### 29. Local-mask expression ownership (finding 16, batch 4)

Added `mask-expression.js` for authoring defaults, identity injection,
sub-mask flattening and lookup, parent/typed-leaf traversal, expression
replacement, copied-tree identity regeneration, and spatial cache signatures.
`app.js` retains gestures, selection state, command persistence, canvas
rendering, and thin compatibility delegates.

Six focused behavior cases pin every mask-tool default, explicit identity,
left-spine display order, typed traversal, replacement/regeneration, and the
leaf-opacity cache invariant. This closes the four planned finding-16
verticals without mixing pixel math with application orchestration. The
complete desktop JavaScript gate is 277/277, frontend contracts remain
102/102, and the full Python suite remains 1,466/3.

### 30. Shell cascade consolidation (finding 17)

Added `css-app-shell-matrix.js` and captured normal, wide, compact, desktop,
and native-menu states through the live FastAPI application in headless Edge.
Consolidated the final effective ownership of `html`/`body`, `.app-shell`,
`.top-bar`, `.workspace-main`, `.source-rail`, `.grade-rail`, and
`.viewer-panel` into their primary rules, removing dead breakpoint rules and
late reversals.

All five before/after screenshots are SHA-256 identical and their computed
grid columns, rows, gaps, backgrounds, dimensions, and desktop offsets match.
The CSSOM inventory fell from 1,467 to 1,422 leaf rules; repeated selectors
fell from 159 to 151 and rules under repeated selectors from 417 to 373.
Static contracts now require one top-level primary rule for each shell owner
and require the five-state live-browser matrix. Remaining repeated selectors
are component and state refinements rather than the contradictory shell
reversal identified by this finding, so they were not merged mechanically.
The startup-state, workflow-stage-overlay, and local-stack-sizing browser
checks also pass against the consolidated stylesheet. This closes finding 17.

## Continuation audit — frontend, styles, and tests

This is the next decision table required by the plan. It is based on source
inspection of the current working tree after findings 1–11. All nine findings
were approved and findings 12–20 are implemented.

| # | What's wrong (plain) | Where | What it means for you | Proposed fix | Risk | Decision |
|---|---|---|---|---|---|---|
| 12 | The Direct renderer started every active whole-frame local mask with one unbounded `Promise.all`, bypassing the tiled coordinator. | `frontend/webgpu-preview.js`; `tests/direct-mask-coordination.test.js` | Obsolete mask responses could consume browser slots and memory. | Implemented: shared bounded coordinator, cancellation signals, sequential compound leaves, and keyed in-flight reuse. | Medium | Implemented |
| 13 | The perspective draft request caught both `AbortError` and real network/backend failures and returned `null` for either; the conditional literally had the same result on both sides. | `frontend/app.js`; `tests/perspective-draft-preview.test.js` | Cancellation is harmless, but a disconnected backend or failed request silently left the previous image and gave no status, so the control appeared to have stopped working. | Implemented: ignore `AbortError`; surface a current non-cancellation exception through the Perspective status. Added cancellation and rejected-fetch behavior cases. | Low | Implemented |
| 14 | Deferred highlight measurement failures disappeared without diagnostics. | `frontend/webgpu-preview.js`; `tests/highlight-anchor.test.js` | Support could not explain why refinement stayed on an approximation. | Implemented: bounded classified diagnostics and a paired failure event, while preserving the non-fatal fallback. | Low | Implemented |
| 15 | `webgpu-preview.js` combined renderer coordination with source/mask transport, readback, and 129 KB of generated WGSL. | `frontend/webgpu-preview.js`; `frontend/source-transport.js`; `frontend/mask-loader.js`; `frontend/scope-readback.js`; `frontend/webgpu-shaders.js` | GPU subsystems now have explicit owners and focused behavior gates; renderer changes no longer carry transport or shader bodies in their review surface. | Implemented in eight validated batches: complete source transport, CPU mask transport, authoring-scope readback, and byte-identical shader ownership. `HDRWebGPUPreview` remains the GPU coordinator. | High | Implemented |
| 16 | `app.js` was an 870 KB classic script with 734 named functions covering boot, global state, importing, project I/O, grading controls, geometry, preview scheduling, scopes, proof/export handoff, local masks, and DOM rendering. | `frontend/app.js`; `scope-ui.js`; `scope-analysis.js`; `geometry-math.js`; `project-io.js`; `mask-expression.js` | Pure calculation and transport responsibilities now have explicit owners and focused behavior tests; `app.js` remains the DOM/orchestration shell. | Implemented in four vertical batches without mixing pixel math and application orchestration. | High | Implemented |
| 17 | The stylesheet grew as successive late override passes instead of one owned rule per component. The original inventory found 1,467 rules, 159 repeated selectors, and 417 rules under repeated selectors; `.app-shell` occurred nine times and top-level minimum sizes reversed later. | `frontend/styles.css`; `tests/css-app-shell-matrix.js` | The core shell no longer depends on distant reversals; remaining repeats can be evaluated component-by-component against a permanent live-browser matrix. | Implemented: five-state matrix added; shell chassis consolidated with byte-identical screenshots and geometry; primary-rule uniqueness is contract-pinned. Inventory is now 1,422 / 151 / 373. | Medium | Implemented |
| 18 | The former `test_frontend_contract.py` primarily snapshotted implementation text and coupled unrelated frontend areas. | Six `tests/test_frontend_*_contract.py` modules plus `test_frontend_inventory_contract.py` | Frontend contracts now fail within their owning area, and the suite can migrate behavior one subsystem at a time without restoring a catch-all file. | Implemented: split 101 reviewed contracts by responsibility and added an inventory/uniqueness gate; focused JavaScript and Electron suites retain runtime behavior ownership. | Medium | Implemented |
| 19 | Frontend files carried 88 sprint/phase/work-item history markers. | Frontend files and `tests/test_frontend_contract.py` | Live invariants were obscured by implementation history. | Implemented: present-tense invariant comments; history retained in the audit/PRD. | Low | Implemented |
| 20 | UTC, Pillow, and TestClient deprecation warnings remained live. | Models, image call sites, fixture, and `requirements-dev.txt` | Warnings hid new regressions and future removals. | Implemented: aware UTC, inferred Pillow modes, and `httpx2`; warning-count gate is clean. | Medium | Implemented |

## Validation summary

| Check | Result |
|---|---|
| Python suite after the last batch | 1,466 passed, 3 skipped (baseline 1,448 / 3) |
| Earlier desktop unit gate for findings 1–11 | 22 passed |
| Earlier `npm run test:electron` baseline | Pass |
| Electron smoke and export-parity rerun (2026-09-28) | Both passed with desktop-app permission; export parity completed all six scenarios. The restricted launch still closed before its first window. |
| ROI parity after all backend batches | Max difference 0, no page errors |
| SDR branch hash matrix | 26/26 byte-identical |
| Highlight-curve hash matrix | 33/33 byte-identical |
| Continuation findings 12–20 | All findings implemented |
| Continuation warning confirmation | 56 passed, no warnings (`test_source_tile_api`, `test_proofing`, `test_launcher`) |
| Desktop JavaScript unit gate | 277/277 passed |
| Split frontend contract gate | 102/102 passed, including the inventory check |
| Finding 15 source-transport batch 1 | 20/20 focused transport cases; 239/239 desktop JavaScript; 102/102 frontend contracts; 1,466 passed / 3 skipped full Python suite |
| Finding 15 source-transport batch 2 | 20/20 focused transport cases; 239/239 desktop JavaScript; 102/102 frontend contracts; 1,466 passed / 3 skipped full Python suite |
| Finding 15 source-transport batch 3 | 20/20 focused transport cases; 239/239 desktop JavaScript; 102/102 frontend contracts; 1,466 passed / 3 skipped full Python suite |
| Finding 15 source-transport batch 4 | 20/20 focused transport cases; 239/239 desktop JavaScript; 102/102 frontend contracts; 1,466 passed / 3 skipped full Python suite |
| Finding 15 source-transport batch 5 | 20/20 focused transport cases (including 4/4 ROI); 239/239 desktop JavaScript; 102/102 frontend contracts; 1,466 passed / 3 skipped full Python suite |
| Finding 15 mask-loading batch 6 | 14/14 focused mask cases; 244/244 desktop JavaScript; 102/102 frontend contracts; 1,466 passed / 3 skipped full Python suite |
| Finding 15 scope-readback batch 7 | 4/4 focused readback cases; 248/248 desktop JavaScript; 102/102 frontend contracts; 1,466 passed / 3 skipped full Python suite |
| Finding 15 shader-source batch 8 | 5/5 historical shader hashes exact; 250/250 desktop JavaScript; 102/102 frontend contracts; 1,466 passed / 3 skipped full Python suite |
| Finding 16 scope/UI batch 1 | 9/9 focused behavior cases; 259/259 desktop JavaScript; 102/102 frontend contracts; 1,466 passed / 3 skipped full Python suite |
| Finding 16 geometry-math batch 2 | 5/5 focused behavior cases; 264/264 desktop JavaScript; 102/102 frontend contracts; 1,466 passed / 3 skipped full Python suite |
| Finding 16 import/project transport batch 3 | 7/7 focused behavior cases; 271/271 desktop JavaScript; 102/102 frontend contracts; 1,466 passed / 3 skipped full Python suite |
| Finding 16 local-mask expression batch 4 | 6/6 focused behavior cases; 277/277 desktop JavaScript; 102/102 frontend contracts; 1,466 passed / 3 skipped full Python suite |
| Finding 17 shell cascade | 5/5 computed-style states and screenshot hashes exact; CSS leaf rules 1,467 → 1,422; repeated-selector rules 417 → 373; startup-state, workflow-stage-overlay, and local-stack-sizing browser checks pass |

The full Electron parity battery (B&W, clarity-map, grain, tiled denoise, tiled
CPU detail, tiled/direct, tiled film, adaptive denoise, GPU scopes, highlight
compression, SDR gamut, ROI and denoise ROI, export) was run at the baseline
and is recorded in the Baseline document. Reports live in
`codebase/output/performance/electron-*.json`.

The earlier batches through finding 20 were committed at `5880184`.
Finding 15 batches 1–8, finding 16 batches 1–4, and finding 17 were
subsequently committed on `audit/repo-cleanup` at `49697fe`.

### September 28 validation closeout

With desktop-app permission, `npm run test:electron` passed its fresh-profile
startup check. `node tests/run-in-electron.js tests/performance/export-parity.js`
passed all six export scenarios. The first restricted smoke attempt closed
before a window; this was a host permission boundary, not an application test
failure.

The held-constant release-to-settled latency command from the Baseline document
ran twice at 2560×1440 with the generated 7968×5320 source, NVIDIA Lovelace,
Electron 43.4.0, and AC power. Both runs reported zero failures and nine warm
samples per view state. Warm median milliseconds were:

| View | Baseline | After run 1 | After run 2 |
|---|---:|---:|---:|
| Fit | 3.9 | 5.4 | 2.9 |
| 100% | 5.2 | 5.3 | 5.1 |
| 200% | 4.5 | 5.5 | 4.6 |
| 400% | 5.2 | 5.5 | 5.3 |

The two after runs straddle the baseline at Fit and 100%; 200% differs by
0.1–1.0 ms and 400% by 0.1–0.3 ms. This evidence shows run-to-run variation
and no consistent
slowdown, but it cannot prove that latency is numerically unchanged at
sub-millisecond precision. The ignored reports are
`codebase/output/performance/electron-headline-latency-after-audit.json` and
`electron-headline-latency-after-audit-repeat.json` in the same directory.
The required repository map was added to `docs/README.md`.

## Remaining batches

Findings 1–20 are implemented. No approved code-audit batch remains.
The Electron and preview-smoothness validation follow-ups were run on
September 28 as recorded above.

## Handoff

**State.** Baseline follow-ups 1–4 are closed. Findings 1–20 are implemented
and committed through `49697fe`. The September 28 Electron, export-parity,
preview-smoothness, and documentation closeout is recorded above.

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

**Validation note.** Electron drivers require desktop-app permission on this
host. Restricted launches can close before the application window starts.

**Working agreements.** No pixel changes, preview must not get slower, nothing
is deleted without Steve's yes, and this Results document is updated after each
batch.
