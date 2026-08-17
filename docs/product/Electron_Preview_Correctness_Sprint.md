# Electron Preview Correctness Sprint

**Date:** August 16, 2026  
**Status:** Correctness and geometry-aware GPU preview implemented through iteration 6; full-installer acceptance pending
**Branch:** `feature/electron-desktop-shell`  
**Owner:** HDR Finisher engineering  
**Related plan:** [Electron Desktop Wrapper Sprint](Electron_Desktop_Wrapper_Sprint_PRD.md)

## 1. Sprint outcome

Make the installed Electron editor's HDR and SDR previews trustworthy and responsive after geometry edits, rendition switches, and high-resolution-preview changes. A control state may not claim that a rendition, render mode, or quality tier is active unless the visible preview has accepted and presented the matching lane, geometry, generation, mode, and resolution.

This sprint delivers correctness fallback and geometry-aware GPU acceleration together. It does not duplicate all geometry math in WGSL initially. The preferred implementation applies the authoritative backend geometry stage once to a scene-linear proxy, uploads that geometry-correct proxy to WebGPU, and keeps subsequent HDR/SDR grading interactions GPU-resident.

## 2. Scope and priorities

| ID | Priority | Summary | Status | Safest planned direction |
|---|---:|---|---|---|
| BUG-01 | P1 | HDR and SDR comparison frames misalign after geometry changes | Implemented; installed check pending | Comparison WebGPU rendering now shares the geometry eligibility gate and backend frames are accepted only for the current geometry signature |
| BUG-02 | P1 | HDR Controls / SDR Controls changes the selected controls but leaves the previous rendition visible after geometry edits | Implemented; installed check pending | Lane switching now checks GPU success, then uses a generation- and geometry-matched cache or requests the authoritative backend frame |
| BUG-03 | P1 | High-Res Preview does not refine geometry-edited images | Implemented; installed check pending | Refinement now falls back to the backend requested long edge and rejects stale generation, lane, geometry, or preference results |
| BUG-04 | P2 | Preview quality UI reports the requested mode rather than the quality actually presented | Implemented | The toolbar and Technical readout distinguish requested, refining, presented, source-limited, and fallback states |
| FEATURE-01 | P1 | Users and tests cannot explicitly select Auto, GPU, or CPU rendering | Implemented | Electron persists one validated **Edit > Rendering Mode** radio preference and the renderer re-presents without dirtying the project |
| FEATURE-02 | P1 | Rotate/flip/straighten commits repeatedly instead of using one explicit geometry transaction | Implemented | Rotate, flip, and straighten share an Apply/Cancel draft and invalidate the authoritative preview once on Apply |
| FEATURE-03 | P1 | Crop and Rotate lack one authoritative reset to the imported frame | Implemented | The shared header Reset covers all geometry, is disabled at defaults, discards drafts, confirms the non-undoable reset, and rebuilds both lanes |
| PERF-01 | P1 | Geometry edits permanently move later grading interactions off the fast GPU path | Implemented; installed check pending | The backend prepares one authoritative geometry-correct proxy; WebGPU caches it by lane, resolution, and geometry signature so later grading remains GPU-resident |
| BUG-05 | P1 | Rotating an HDR frame temporarily or permanently presents an SDR-looking result while HDR scopes remain active | Implemented; unpacked-app acceptance through iteration 6 | HDR rotation drafts use a transient authoritative HDR image, new geometry waits for edit commit before GPU proxy loading, and recoverable proxy conflicts no longer disable WebGPU |
| BUG-06 | P1 | Local adjustments and their red masks do not remain attached to the image through rotate/straighten/crop | Implemented; unpacked-app acceptance through iteration 6 | Persist local masks in immutable source coordinates, compile them before exact destructive geometry, and map editor input bidirectionally through the authoritative geometry transform |
| BUG-07 | P2 | Interactive and settled proxy swaps shift the fitted image by a few pixels during continuous grading | Implemented in iteration 6; full-installer check pending | Retain one viewport aspect for each geometry signature so proxy-resolution rounding cannot alter screen placement |

## 3. Bug list

### BUG-01 — Comparison geometry mismatch

**User-visible symptom**

After rotating an image, HDR and SDR no longer show matching image coordinates in split comparison. One rendition is visibly stretched or offset relative to the other.

**Confirmed evidence**

Using the deterministic `24×16` asymmetric gradient fixture and a 90-degree rotation:

- primary HDR intrinsic frame: `16×24`;
- secondary SDR intrinsic frame: `24×16`;
- both elements are assigned the same portrait CSS rectangle;
- comparison state reports the SDR generation as current despite presenting the unrotated frame;
- forcing CPU/backend preview produces matching `16×24` frames.

**Root cause**

The primary preview rejects WebGPU rendering when `shared.geometry` differs from its defaults. The comparison path does not apply the same eligibility rule. It renders the original, geometry-free GPU proxy and marks that comparison generation as complete. CSS then sizes the unrotated result to the rotated primary frame.

**Safest fix for this sprint**

1. Centralize or reuse one GPU-preview eligibility predicate.
2. Require default shared geometry before calling comparison `renderTo(...)`.
3. When ineligible, render the secondary lane through the existing settled backend preview path.
4. Do not mark `comparisonRenderedGeneration` complete until the geometry-correct frame has been accepted.
5. Preserve current WebGPU behavior for default geometry.

The correctness fallback ships even if the accelerated proxy is unavailable. Direct WGSL implementations of rotation, crop, straighten, and flip are deferred unless profiling proves the geometry-proxy preparation itself is a material interaction bottleneck. The backend already contains the authoritative geometry implementation, including valid-pixel straighten behavior.

**Acceptance criteria**

- Rotate left/right, flip horizontally/vertically, straighten, and crop each produce matching intrinsic dimensions and image coordinates across HDR and SDR.
- Split vertical/horizontal and side-by-side/stacked layouts remain aligned.
- Switching the active lane does not change fixed HDR-left/top and SDR-right/bottom comparison ordering.
- The comparison generation is never labelled current while its geometry signature or intrinsic aspect differs from the active frame.
- Default-geometry comparison retains the current GPU path and performance.

**Required regression coverage**

- Extend comparison browser QA to perform a 90-degree rotation and inspect both intrinsic frame dimensions.
- Use an asymmetric fixture and compare normalized landmark/edge positions across lanes, not only pane rectangles.
- Add cases for flip, straighten, and a non-full crop.
- Run the same assertions with WebGPU available and forced CPU fallback.

### BUG-02 — Rendition tab does not immediately switch the visible preview

**Reported symptom**

Clicking **HDR Controls** or **SDR Controls** updates the controls, but the preview can remain on the previous rendition. Making an adjustment then causes the expected rendition to appear.

**Confirmed evidence**

With default geometry, HDR-to-SDR switching immediately presented an SDR WebGPU render at `1038×584`. After a 90-degree rotation:

- the active lane changed from HDR to SDR;
- the control panels, scope label, and internal `currentView` changed to SDR;
- the visible preview retained the exact same HDR object URL;
- preview metadata for the selected SDR lane said `No preview yet`;
- no GPU presentation event occurred;
- changing SDR exposure then produced a new object URL with SDR preview metadata.

**Root cause**

`switchLane(...)` chooses `renderGpuDraft(...)` whenever WebGPU is available. A non-default geometry makes `renderGpuDraft(...)` return `false`, but `switchLane(...)` does not inspect that result and request the cached/backend rendition. A later adjustment enters `settlePreview(...)`, which does contain that fallback, explaining why the expected image appears only after an edit.

The defect is not limited conceptually to geometry. Any future eligibility or recoverable GPU failure that returns `false` can produce the same stale-lane handoff unless lane switching treats GPU success as conditional.

**Safest fix for this sprint**

1. Add a small `presentLane(...)` or equivalent helper that attempts eligible GPU rendering and checks its resolved result.
2. If GPU presentation is ineligible or returns `false`, show a current cached frame only when its generation and geometry signature match.
3. Otherwise request and present the authoritative backend preview for the selected lane.
4. Keep the old rendition visible only as an explicitly labelled loading state, never as if it were the selected lane.
5. Update `previewInfo` only when the corresponding lane frame is actually presented.

**Acceptance criteria**

- Under default geometry, HDR/SDR tabs retain immediate WebGPU switching.
- After rotate, flip, straighten, and crop, each tab click presents the selected rendition without requiring an adjustment.
- The selected tab, control folder, scope label, preview metadata, and visible frame always refer to the same lane.
- Cached frames are accepted only for the current preview generation and geometry signature.
- A forced GPU rejection follows the backend fallback path and cannot leave the old lane falsely labelled as the new lane.

**Required regression coverage**

- Browser interaction test: default geometry HDR → SDR → HDR.
- Browser interaction test: each non-default geometry category followed by HDR → SDR → HDR.
- Instrument the accepted frame with lane, generation, and geometry signature; assert all three at handoff.
- Force `renderGpuDraft(...)` to return `false` independently of geometry and assert backend presentation.

### BUG-03 — High-Res Preview behavior is unclear or ineffective

**Reported symptom**

The user cannot reliably tell whether **High-Res Preview** is working.

**Confirmed evidence**

High-Res Preview works under default geometry. On a `1920×1080` source in a `1640×1160` test viewport, enabling it refined the active WebGPU preview from `1038×584` to `1600×900`, with an accepted 1600-pixel presentation event.

After a 90-degree rotation, enabling High-Res Preview left the backend image at `584×1038`. No refinement presentation occurred even after the refinement interval, while the preference remained enabled.

**Root cause**

`refinePreview(...)` is restricted to an available WebGPU preview and only calls `renderGpuDraft(...)`. Non-default geometry makes that call return `false`; unlike `settlePreview(...)`, refinement has no backend fallback. The settled preview limit is unchanged by the option, so the geometry-edited frame remains at the ordinary settled resolution.

**Safest fix for this sprint**

1. Keep the current WebGPU refinement for eligible default-geometry previews.
2. When GPU refinement is ineligible or returns `false`, request a backend preview at `refinementProxyLongEdge()` and present it only if lane, edit generation, geometry signature, and High-Res preference still match.
3. Do not upscale beyond the source dimensions.
4. Reuse the normal preview cache with its long-edge metadata so a refined frame satisfies later settled requests without duplicate processing.
5. Cancel or discard refinement when the user switches lanes, changes geometry, disables High-Res Preview, or starts a newer edit.

**Acceptance criteria**

- A sufficiently large default-geometry source presents a larger accepted frame after High-Res Preview is enabled.
- Rotate, flip, straighten, and crop receive the same refinement through the backend fallback.
- The active high-resolution frame matches the current lane, edit generation, and geometry signature.
- Disabling High-Res Preview prevents an outstanding refinement from replacing the ordinary settled frame.
- Small sources are not upscaled and are reported as source-limited rather than silently appearing unchanged.

**Required regression coverage**

- Use a deterministic source larger than both settled and refinement targets.
- Assert the actual presented intrinsic long edge before and after enabling High-Res Preview.
- Repeat with 90-degree rotation and a crop.
- Toggle the option off during an in-flight refinement and assert stale-result rejection.
- Switch HDR/SDR during refinement and assert lane-correct presentation.

### BUG-04 — Requested High-Res state is presented as achieved quality

**User-visible symptom**

The checkbox gives no indication whether refinement is pending, ready, source-limited, or unavailable. The Technical readout says `Preview Mode: High quality` directly from the checkbox state even when the displayed frame never refined.

**Root cause**

Requested preference and accepted presentation state are represented by the same boolean. The preview does already carry transport notes and dimensions internally, but there is no first-class presented-quality state tied to lane and generation.

**Safest fix for this sprint**

1. Introduce presentation metadata containing lane, generation, geometry signature, tier, intrinsic dimensions, requested long edge, transport, and fallback reason.
2. Keep the checkbox as the preference, but expose compact status such as `Refining`, `High-res · 1600px`, `Source-limited · 1080px`, or `Fallback · 1038px`.
3. Make the Technical readout report the accepted tier and dimensions, not just the checkbox.
4. Use an `aria-live` status update when the accepted quality changes.

**Acceptance criteria**

- The UI never says High-Res is presented solely because the preference is enabled.
- Users can determine the current accepted long edge without opening developer tools.
- Fallback and source-limited results are stated without implying export quality is affected.
- Status updates remain stable during ordinary editing and do not flicker between every intermediate GPU frame.

## 4. Sprint boundaries

In scope:

- preview correctness in the installed Electron renderer and ordinary browser-development mode;
- safe GPU eligibility and backend fallback behavior;
- accepted-generation, lane, geometry, and resolution tracking;
- focused automated regression coverage and a short installed-app manual check.

Out of scope:

- changing export geometry or color processing unless investigation finds an independent defect;
- broad UI redesign;
- direct WGSL geometry transforms unless the geometry-proxy benchmark fails its sprint budget.

## 5. Exit gates

- All confirmed bugs have automated reproduction tests that fail before and pass after their fixes.
- The visible preview always matches the selected rendition and current shared geometry.
- High-Res Preview has a measurable resolution effect or is relabelled/redesigned to match its actual behavior.
- Default-geometry WebGPU performance does not regress materially.
- CPU/backend fallback produces no stale lane handoff, flash of the wrong geometry, or false “settled” status.
- Packaged Electron validation passes with one asymmetric SDR fixture and one representative HDR source.

## 6. Recommended implementation order

1. Add the rendering-mode model, shared GPU eligibility, and accepted-presentation metadata.
2. Fix BUG-01 comparison rendering with geometry-safe backend fallback.
3. Fix BUG-02 lane handoff through one result-checked presentation helper.
4. Add the geometry-correct WebGPU proxy and cache, retaining the fallback from steps 2–3.
5. Fix BUG-03 high-resolution refinement in both GPU and backend modes with stale-result guards.
6. Add BUG-04 quality/mode status based on accepted presentation metadata.
7. Run focused CPU-required, GPU-required, and Auto-fallback automation, then the existing frontend and preview-performance suites.
8. Build and validate the installed Electron package on the same branch.

The order is deliberate: the visible status in BUG-04 should consume the correctness state introduced for BUG-01 through BUG-03, not create a second parallel model.

## 7. Validation matrix

| Scenario | Fast/default | High-Res | HDR → SDR → HDR | Split comparison |
|---|---:|---:|---:|---:|
| Default geometry | Required | Required | Required | Required |
| Rotate 90°/270° | Required | Required | Required | Required |
| Flip H/V | Required | Required | Required | Required |
| Straighten | Required | Required | Required | Required |
| Crop | Required | Required | Required | Required |
| Forced GPU rejection | Required | Required | Required | Required |
| GPU unavailable | Required | Required | Required | Required |

For every matrix cell, validate the accepted lane, edit generation, geometry signature, intrinsic dimensions/aspect, requested quality tier, presented quality tier, and transport. Visual screenshots supplement these assertions but do not replace them.

## 8. Rendering modes and Electron settings

Add an **Edit > Rendering Mode** radio submenu:

- **Auto (Recommended)** — use WebGPU when the current operation has a validated GPU path; fall back to the backend when unavailable, rejected, or recovering from device loss.
- **GPU Preferred** — prioritize validated WebGPU paths and disclose every fallback. This is useful for performance-sensitive users and diagnostics, but it must never knowingly present an incorrect frame.
- **CPU Compatibility** — bypass WebGPU preview and scopes intentionally and use the authoritative backend paths. This is useful for unstable drivers, visual diagnosis, and parity testing.

Do not expose independent CPU and GPU checkboxes. They permit ambiguous combinations such as both enabled or neither enabled. One exclusive mode is easier to understand, persist, test, and report.

Add a separate test-only **GPU Required** override. It behaves like GPU Preferred but fails the test immediately if a scenario expected to be accelerated uses backend fallback. This strict behavior is valuable for coverage but inappropriate as a normal user mode because correctness must remain recoverable.

The Electron main process owns and persists the validated rendering preference. Its existing menu-command bridge sends mode changes to the renderer. The renderer acknowledges the accepted mode and re-presents the current lane. Menu checkmarks must reflect the acknowledged preference rather than optimistic click state.

Changing modes must not alter the project document or mark it dirty. The preference is application-level and should survive restart.

## 9. Geometry-aware GPU strategy

### 9.1 Transactional Rotate tool

Make Rotate behave like the existing transactional Crop tool:

1. Opening Rotate clones the committed shared geometry into a rotate draft.
2. Rotate left/right, Flip H/V, and Straighten update only that draft.
3. Quarter rotations and flips use an exact viewer transform immediately. Straighten uses the current interactive transform and fixed valid-output guide without starting authoritative proxy work on slider release.
4. **Apply** commits the complete draft as one edit command, invalidates disposable CPU/GPU preview proxies once, and starts one geometry-correct proxy preparation for the active lane.
5. **Cancel** discards the draft and restores the committed frame without touching caches.
6. Undo/redo treats the complete Apply operation as one command.

“Destructive” in this workflow means destructive replacement of disposable preview/cache files and GPU textures. It must not flatten or overwrite the source image, remove editable geometry from the project, or change export authority. The project continues storing geometry parameters non-destructively.

While a rotate draft is open:

- mark the viewer as a draft/interactive preview;
- transform image-bound overlays with the draft where parity is reliable;
- pause or clearly mark scopes and pixel-coordinate tools as stale if they still describe committed pixels;
- prevent export from silently using an unapplied draft;
- when switching tools, projects, sources, or closing the app, resolve the draft through Apply, Discard, or Cancel as appropriate;
- do not trigger High-Res refinement until Apply.

This moves the unavoidable proxy-preparation pause to an explicit user action. Slider movement and release remain responsive, and repeated straighten changes do not create obsolete backend/GPU proxy work.

### 9.2 Reset Geometry

Expose the same **Reset Geometry** action in both Crop and Rotate. It resets the complete shared geometry stage, not only the controls visible in the current tool:

- rotation to `0`;
- horizontal and vertical flips off;
- straighten to `0.0`;
- crop to the full frame;
- ratio/crop authoring state to the agreed default where applicable;
- any open Crop or Rotate draft discarded.

Place one compact **Reset** action at the far right of the **Crop & Rotate** section header, following the same visual pattern as the grading-group reset actions. Do not duplicate Reset inside the Crop and Rotate tool bodies. Its accessible name and tooltip should read **Reset all crop and rotation geometry** so the broader scope is clear even though the visible label is compact.

Keep tool-specific **Apply** and **Cancel** actions inside the active Crop or Rotate body. The header Reset remains visible whenever the section is expanded and is disabled when committed geometry and any open draft are already at defaults.

On confirmation, Reset Geometry:

1. replaces committed shared geometry with defaults;
2. clears geometry-derived CPU preview frames, WebGPU proxies/textures, comparison frames, masks, scopes, overlays, and High-Res refinements;
3. regenerates the active preview from the immutable source imported into the session;
4. prepares the inactive HDR/SDR lane according to the normal foreground/idle policy;
5. reports rebuilding and accepted presentation state truthfully.

“From the original imported file” means the immutable decoded session source is authoritative. Do not unnecessarily decode a multi-hundred-megabyte source again when that immutable source is still resident and fingerprint-valid. Re-read the source path only when the session source is unavailable, after verifying the path/fingerprint or completing the existing relink flow.

Reset Geometry is intentionally not added to edit undo/redo history. Because it changes the project document, it still marks the project dirty and must be saved to persist. When geometry is non-default, use a concise confirmation explaining that the reset cannot be undone; when geometry is already default, disable the action.

### 9.3 Preferred first implementation: geometry-correct GPU proxy

1. Extend the proxy request with the current edit revision or a canonical geometry signature.
2. Reuse the backend's authoritative `apply_geometry(...)` on the downsampled scene-linear HDR source and matched SDR reference before proxy encoding.
3. Return the geometry signature and intrinsic dimensions in response headers.
4. Key backend and frontend proxy caches by session, lane/base source, long edge, pixel format, and geometry signature.
5. Upload the geometry-correct half-float proxy once, then run HDR/SDR grading, local adjustments, scopes, comparison, and high-resolution refinement through WebGPU as supported.
6. Reject any proxy response whose edit revision or geometry signature is stale.

This design may still have a one-time preparation pause when geometry is committed, especially for straighten. It should remove the larger current problem where every later grading operation remains on the backend path after rotation.

### 9.4 Correctness fallback

If geometry-proxy preparation fails, WebGPU is lost, a local adjustment is unsupported, or the mode is CPU Compatibility, present the existing authoritative backend preview. Auto and GPU Preferred remain trustworthy because fallback is explicit and generation-safe.

### 9.5 Direct shader geometry decision gate

Only move geometry itself into WGSL if measurement shows that proxy preparation misses the agreed geometry-commit latency budget. A shader implementation must exactly match backend rotation direction, flip order, crop rounding, bicubic straighten resampling, valid-pixel rectangle, local-mask coordinates, and output dimensions. Until that parity exists, the geometry-correct proxy is the lower-risk accelerated path.

## 10. Mode-specific test strategy

### CPU Compatibility suite

- Assert no WebGPU render, comparison, or GPU scope method is called.
- Run rotate, flip, straighten, crop, HDR/SDR switching, all comparison layouts, and High-Res Preview.
- Validate lane, generation, geometry signature, intrinsic dimensions, and representative pixels/landmarks.
- Measure geometry commit, ordinary grading settle, lane switch, comparison settle, and high-resolution refinement latency.

### GPU Required suite

- Fail on any unexpected backend preview request or fallback event.
- Run the same geometry, lane, comparison, and High-Res matrix against geometry-correct GPU proxies.
- Compare GPU results with CPU Compatibility reference output using existing parity tolerances plus exact geometry/dimension assertions.
- Verify proxy-cache reuse: after one geometry commit, repeated tonal edits must not request or upload another identical geometry proxy.
- Measure proxy preparation separately from subsequent GPU grade presentation.

### Auto fallback suite

- Inject WebGPU initialization failure, unsupported-operation rejection, stale proxy, and device loss.
- Assert one clear fallback transition, correct backend presentation, truthful status, and continued editing.
- Restore WebGPU where supported and verify recovery does not accept stale GPU frames.

### Electron integration suite

- Assert the **Edit > Rendering Mode** radio items, exclusivity, checkmarks, persistence, and command delivery.
- Restart the app and confirm the saved mode is restored before the first source preview.
- Confirm rendering-mode changes do not dirty the image document.
- Include the selected and actually presented modes in diagnostic output.

### Transactional geometry suite

- Drag Straighten repeatedly and assert zero authoritative proxy requests before Apply.
- Rotate and flip multiple times, then Apply; assert one committed edit command and one proxy invalidation per required lane/tier.
- Cancel a draft and assert the committed geometry, proxy identities, project dirty state, and visible authoritative frame are unchanged.
- Undo/redo one applied compound geometry draft atomically.
- Verify draft behavior when switching tools, changing HDR/SDR lanes, saving, exporting, importing, opening a project, and closing the app.
- Verify scopes, overlays, masks, and pixel-coordinate tools are either draft-correct or explicitly marked stale while the draft is open.
- Apply crop plus rotate/flip/straighten, invoke Reset Geometry from each tool, and assert the same complete default geometry result.
- Assert Reset Geometry creates no undo entry, clears redo history as required by the history model, and marks the project dirty.
- Assert all geometry-derived CPU/GPU caches are invalidated while immutable source storage remains reusable.
- Assert the rebuilt active frame matches a fresh import of the same fingerprinted source in CPU Compatibility and GPU Required modes.
- Assert Reset Geometry is disabled at default geometry and requires confirmation when it would discard committed geometry.

## 11. Performance gates

Record separate budgets after a baseline run rather than combining unlike work:

- one-time geometry-proxy preparation and upload;
- first HDR and SDR presentation for a new geometry signature;
- subsequent GPU grading presentation with the proxy already resident;
- CPU Compatibility grading settle;
- HDR/SDR lane switching in each mode;
- split comparison readiness in each mode;
- High-Res refinement in each mode;
- memory retained by source, geometry-proxy, comparison, mask, and refinement textures.

The sprint does not pass merely because Auto is correct. GPU Required must remain accelerated after geometry is committed, CPU Compatibility must remain usable and cancellation-safe, and Auto must select/fall back without displaying stale content.

## 12. Iteration-6 implementation record: rotation, HDR, and source-anchored masks

### Reported failure sequence

Hands-on testing exposed a connected set of geometry defects that the initial rotate transaction alone did not solve:

1. Straighten moved the image while the slider was held, but releasing the pointer restored the pre-rotation preview even though the control retained the new value and Apply produced the expected geometry.
2. Keeping the draft visible revealed a more serious color-path error: rotating an HDR source produced a dark, SDR-looking draft. Applying the rotation could leave that SDR-looking presentation visible while the scopes still described HDR data.
3. Once the HDR preview path was corrected, an exposure adjustment painted before rotation remained fixed to the screen instead of rotating with the photographed subject. Its red mask overlay could disagree with both the transformed image and the visible exposure effect.
4. Review found the reverse case as well: when geometry was already active, new brush, gradient, and path input was recorded in display-normalized coordinates even though persisted mask data was intended to be source-anchored.
5. During ordinary color-wheel, curve, and slider drags, swapping the interactive proxy for the settled proxy shifted the fitted image by several pixels because their rounded intrinsic dimensions produced slightly different aspect ratios.

These were not independent cosmetic errors. They showed that the editor had no single authoritative contract connecting immutable source coordinates, destructively transformed preview pixels, local-mask storage, editor hit testing, and the currently presented proxy tier.

### Root cause

Image geometry was applied destructively to preview pixels, but local-mask geometry used an approximate inverse transform and the frontend still treated several source-space controls as if they were display-space controls. Straighten compounds the mismatch because Pillow expansion, the valid-pixel inset, crop rounding, flips, and quarter turns all affect the final output rectangle. Reimplementing only the obvious rotation formula could not reproduce that complete path.

The WebGPU proxy also loaded geometry independently from the edit-commit lifecycle. A transient rotate draft could therefore request or present a proxy for the wrong revision, and a recoverable stale-proxy conflict was treated like a permanent GPU failure. Finally, viewport layout reused a stable reference long edge but accidentally accepted each proxy bitmap's newly rounded aspect ratio.

### Implemented solution

- Rotate, flip, and straighten remain one explicit Apply/Cancel transaction. The draft transform stays visible after pointer release, and Apply commits the complete geometry once.
- HDR rotate drafts use an authoritative transient HDR render. Geometry-aware GPU proxies are requested only against an accepted edit revision and canonical geometry signature; stale results are rejected without disabling WebGPU.
- The backend prepares the geometry-correct scene-linear proxy once and caches it by session, lane, long edge, pixel format, and geometry signature. Later tonal and color edits remain GPU-resident instead of repeatedly applying crop/rotation on the CPU.
- Local masks are compiled in neutral immutable-source coordinates and then passed through the exact same `apply_geometry(...)` operation as the image. This makes the adjustment influence and authoritative red overlay pixel-identical with rotation, flip, straighten, valid-pixel crop, and user crop.
- The backend exposes a cached bidirectional affine coordinate map derived by passing coordinate ramps through the real geometry operation. Frontend pointer input uses output-to-source mapping before persistence; path nodes, handles, gradients, brush cursors, and other gizmos use source-to-output mapping for drawing and hit testing.
- Mask raster and gizmo rendering are split into two phases: the authoritative transformed mask is drawn in output space, while editable controls are transformed from source space. Luminance sampling deliberately remains output-space because it samples the already transformed frame and is not persisted as mask geometry.
- The geometry map is prefetched when Local Adjustments opens and cached per geometry/preview size. Pointer movement performs only a six-coefficient affine calculation. Brush gesture canvases and tinted overlays are retained and updated incrementally rather than allocated per pointer event.
- Viewport sizing now stores one aspect ratio per session and geometry signature. Interactive, settled, and high-resolution proxies may change pixel density without changing the image's CSS rectangle or apparent position.

### Result and regression coverage

Hands-on unpacked-app testing through iteration 6 confirmed the connected rotation flow was generally working after the source-anchoring repair: straighten remains visible before Apply, HDR appearance survives rotate draft and commit, previously authored local exposure follows the image, and the red mask stays aligned. The stable-aspect correction for continuous color-wheel and curve editing is implemented and covered by the focused frontend contract; final confirmation remains part of the full-installer acceptance pass.

Automated coverage now includes exact destructive mask geometry, source/display map round trips through quarter turns, flips, straighten, and crop, the geometry-map API contract, transient HDR geometry handling, stale proxy rejection, two-phase local-mask rendering, manual source-interpretation messaging, and stable viewport aspect. Focused correctness runs completed with 185 passing tests before the final viewport correction; the viewport/geometry follow-up completed with 53 passing tests and JavaScript syntax validation.

The final iteration-6 installer build completed on August 17, 2026 after the complete deterministic suite passed `466` tests and the Electron unit suite passed `3` tests. Packaged-asset inspection confirmed the bidirectional geometry editor, stable-aspect viewport correction, and removal of the obsolete export-format ranking labels. The generated Windows x64 artifacts are `HDR-Finisher-Setup-0.3.5-x64.exe` (`155,928,243` bytes, SHA-256 `BB8C7A77D8EDF4184F7356DDC6FC9A4528CA96398A79F5FDFA05FAD2B1F899E6`) and `HDR-Finisher-Portable-0.3.5-x64.exe` (`155,710,787` bytes, SHA-256 `0FAD639C9ED4F06FE99A33A84840D594A206DC39E0F7E6EBB026E9D65618D975`). Launch/install acceptance remains a hands-on gate because the build was not started while another HDR Finisher instance was open.

## 13. User-provided brand assets task

**Owner:** User / product design  
**Engineering support:** Validate, generate platform derivatives, bundle, and test  
**Status:** Core masters received and integrated; packaged small-size visual QA remains

The supplied simplified and full SVG masters are now vendored under `codebase/frontend/assets/brand/`. The simplified mark is the browser favicon and compact application-header mark beside the IBM Plex Sans wordmark. The full `HDRF` mark is retained as the Electron icon source, with a generated `1024×1024` RGBA PNG under `codebase/desktop/assets/`; Electron Builder derives the Windows executable and installer resources from that PNG. The first unpacked-package check confirmed the executable contains the new icon, including a legible 32-pixel resource.

The user should provide this as a dedicated task during the sprint: **Deliver HDR Finisher logo, application-icon, favicon, and font masters with redistribution rights.**

### Required design masters

- **Symbol/application mark:** one square SVG master with a simple silhouette, no embedded bitmap, no external font dependency, and enough clear space to remain legible at 16 pixels.
- **Square raster master:** transparent or intentionally opaque `1024×1024` PNG in sRGB, derived from the approved symbol. Keep critical artwork inside an approximately 80–85% safe area and avoid fine text.
- **Horizontal logo/wordmark:** SVG with symbol plus `HDR Finisher` text, with text converted to approved vector outlines or accompanied by the licensed font. Provide a compact-width variant if the full wordmark does not fit the application header.
- **Theme variants:** approved dark-background and light-background versions, or one documented color treatment that works on both. Include monochrome fallback artwork for installer/OS contexts.
- **Color specification:** sRGB hex values for the brand colors and any minimum-size/clear-space guidance.

Engineering will generate and validate these derivatives from the masters:

- Windows multi-resolution `.ico` containing at least `16`, `24`, `32`, `48`, `64`, `128`, and `256` pixel sizes;
- Electron/installer/taskbar/shortcut icon configuration;
- favicon SVG plus `.ico` containing `16`, `32`, and `48` pixel sizes;
- `32×32` and `180×180` PNG web derivatives;
- macOS `.icns`/iconset through `1024×1024` when macOS packaging begins.

Do not hand-edit each small derivative independently. Small-size validation may justify a simplified 16/24-pixel symbol variant, but it must remain recognizably the same mark.

### Font handoff

The user supplied IBM Plex Sans and IBM Plex Mono with the SIL Open Font License. Engineering now bundles the Sans variable font plus Mono Regular, Medium, SemiBold, and Bold, declares them locally with `@font-face`, and uses Plex Sans in the launcher instead of requesting Inter. No additional product font family is required. Several UI glyphs still request Windows-only Segoe Fluent Icons/Segoe MDL2 Assets until the SVG migration is complete.

The completed font handoff includes:

- locally hostable TTF files covering the weights actually used by the UI; WOFF2 conversion is an optional package-size optimization rather than a functional requirement;
- sans weights covering regular, medium, semibold, and bold UI text;
- mono weights covering regular, medium, semibold, and bold values/status text;
- the exact font family/style names and intended sans/mono mapping;
- the font license and explicit redistribution permission for packaged desktop and locally served web use;
- any required copyright or attribution text for `THIRD_PARTY_NOTICES.md`.

Engineering must add local `@font-face` declarations, package the font files with the frontend through the backend sidecar, and verify the installed app makes no network font requests. Use `font-display: swap` for browser development mode while keeping layout metrics stable.

Do not bundle or redistribute Segoe UI, Segoe Fluent Icons, Cascadia, Consolas, or other system fonts without an appropriate redistribution license. Replace Windows-only icon-font glyphs with local SVG icons so Windows, future macOS builds, browser mode, and screenshots remain consistent.

### SVG control-icon migration inventory

Replace the following 12 unique Segoe Fluent Icons/Segoe MDL2 glyph dependencies with local SVG assets:

- disclosure chevron right (rotate the same asset 90 degrees for expanded state);
- local-adjustment brush;
- local-adjustment eraser;
- local-adjustment linear gradient;
- local-adjustment luminance/luma range;
- local-adjustment path/Bezier path;
- show/hide local-adjustment overlay (eye);
- duplicate local adjustment (copy);
- move local adjustment up;
- move local adjustment down;
- crop tool;
- rotate tool.

Use **Tabler Icons** as the default source for these control icons. The required 12-icon outline subset has been vendored from upstream commit `183e715d5a81ba1959e285f69c08235fe34b04ce` under `codebase/frontend/assets/icons/tabler/`, together with the MIT license and source attribution. The selected mapping uses `square-half` for the linear-gradient mask, `brightness-half` for luma range, and—per product direction—`pencil` for the path mask; the remaining assets are `chevron-right`, `brush`, `eraser`, `eye`, `copy`, `arrow-up`, `arrow-down`, `crop`, and `rotate-clockwise`.

Vendor only the selected SVG source files and the applicable MIT license into the repository; do not add an icon-font or a runtime CDN dependency. Normalize them to a `24×24` view box, `fill="none"`, `stroke="currentColor"`, round caps/joins, and a consistent 2-pixel stroke before visual QA at their actual UI sizes. Decorative SVGs must be hidden from assistive technology while the containing buttons retain accessible names.

The five comparison-layout buttons are already inline SVG and do not require migration. The existing bypass symbol is also an embedded SVG mask. Text/CSS marks such as plus, minus, warning symbols, and status dots are outside this required cross-platform migration, though they may be standardized later.

### Brand-asset acceptance criteria

- No blank `data:,` favicon remains in the frontend.
- Electron Builder uses the approved application icon for the executable, installer, portable build, shortcuts, taskbar, file association, and uninstall entry.
- The logo remains crisp at normal and high-DPI scaling and passes visual checks at 16, 24, 32, 48, 256, and 1024 pixels.
- The installed package contains the approved local fonts and licenses and makes zero external font requests.
- A clean Windows machine renders the intended typography without depending on separately installed IBM Plex/Inter fonts.
- Windows-only icon-font dependencies are removed or have tested local SVG fallbacks.
- Packaged-asset tests assert that favicon, icon, logo, local font, and license files are present in their final build locations.
