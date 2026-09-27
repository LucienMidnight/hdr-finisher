from __future__ import annotations

import re
from pathlib import Path

from fastapi.testclient import TestClient

from hdr_finisher.main import app


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
DESKTOP = ROOT / "desktop"


def test_raw_development_is_first_grade_control_group() -> None:
    markup = (FRONTEND / "index.html").read_text(encoding="utf-8")
    css = (FRONTEND / "styles.css").read_text(encoding="utf-8")
    script = (FRONTEND / "app.js").read_text(encoding="utf-8")

    grade_start = markup.index('id="grade-workflow-panel"')
    raw_start = markup.index('id="raw-settings-section"')
    local_start = markup.index('id="local-adjustments-group"')
    assert grade_start < raw_start < local_start
    assert "RAW &amp; Lens Development" not in markup
    assert "<span>RAW DEVELOPMENT</span>" in markup
    assert 'class="disclosure-panel raw-development-group module-unavailable"' in markup
    assert 'id="raw-settings-toggle"' in markup and 'aria-controls="raw-settings-panel" disabled' in markup
    assert ".raw-development-group" in css
    assert ".module-unavailable" in css
    assert "setSourceModuleAvailability" in script
    assert 'rawSettingsSection?.classList.toggle("hidden", !visible)' not in script
    assert "--control-group-header-h: 38px" in css
    assert ".raw-development-group .disclosure-trigger" in css
    assert ".source-rail > .disclosure-panel" in css

def test_raw_highlight_reconstruction_is_a_versioned_module_stack_control() -> None:
    markup = (FRONTEND / "index.html").read_text(encoding="utf-8")
    script = (FRONTEND / "app.js").read_text(encoding="utf-8")
    css = (FRONTEND / "styles.css").read_text(encoding="utf-8")

    raw_development = markup.index('id="raw-settings-section"')
    highlights = markup.index('id="raw-highlight-group"')
    denoise = markup.index('data-group="denoise"')
    assert raw_development < highlights < denoise
    assert 'id="raw-highlight-bypass"' in markup
    assert 'value="opposed_color_v1"' in markup
    assert 'id="raw-highlight-threshold"' in markup
    assert 'class="control-group raw-highlight-group collapsed module-unavailable"' in markup
    assert '>Highlight Reconstruction <span class="module-modified-marker" aria-hidden="true"></span></button>' in markup
    assert '.control-group[data-group="raw-highlights"] > .control-group-header::before { content: "02"; }' in css
    assert '.control-group[data-group="geometry"] > .control-group-header::before { content: "03"; }' in css
    assert '.control-group[data-group="denoise"] > .control-group-header::before { content: "05"; }' in css
    assert '.control-group[data-group="vignette"] > .control-group-header::before { content: "17"; }' in css
    assert 'rawHighlightGroup?.classList.toggle("hidden", !bridgeQualified)' not in script
    assert 'highlight_reconstruction: {' in script
    assert 'method: els.rawHighlightMethod?.value || "opposed_color_v1"' in script
    assert 'els.rawHighlightGroup.classList.toggle("modified", modified)' in script
    assert "applyRawImportSettings" in script

def test_staged_import_waits_for_the_authoritative_preview_and_resets_fit_zoom() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    staged_import = javascript[
        javascript.index("async function openStagedDesktopSource"):
        javascript.index("async function cancelActiveImport")
    ]
    activation = javascript[
        javascript.index("async function activateDesktopSession"):
        javascript.index("function documentTransitionToken")
    ]

    assert "showStagedImportPreview" not in staged_import
    assert "job.preview_available" not in staged_import
    assert 'state.zoomMode = "fit";' in activation
    assert "state.zoomReferenceFrame = null;" in activation

def test_local_bypass_renders_optimistically_and_tiled_masks_ignore_grade_revisions() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    webgpu = (FRONTEND / "webgpu-preview.js").read_text(encoding="utf-8")
    bypass = javascript[
        javascript.index('const bypassButton = event.target.closest("button[data-local-bypass-id]")'):
        javascript.index('const subMaskBypassButton = event.target.closest("button[data-sub-mask-bypass-id]")')
    ]
    tile_loader = webgpu[
        webgpu.index("async loadLocalMaskTile"):
        webgpu.index("trimMaskTiles", webgpu.index("async loadLocalMaskTile"))
    ]

    assert bypass.index("scheduleLocalPreview();") < bypass.index('queueEditCommand(')
    assert "{ refreshPreview: false }" in bypass
    assert "editRevision}:${signature}" not in tile_loader
    assert "geometrySignature}:${signature}:" in tile_loader
    assert "${prefix}${tile.key}" in tile_loader

def test_tiled_mask_transport_is_batched_not_one_request_per_tile() -> None:
    webgpu = (FRONTEND / "webgpu-preview.js").read_text(encoding="utf-8")
    loader = webgpu[
        webgpu.index("async loadLocalMaskTiles"):
        webgpu.index("trimMaskTiles", webgpu.index("async loadLocalMaskTiles"))
    ]

    assert "/local-mask-tiles" in loader
    assert "/local-mask-tile/" not in loader
    assert "this.maskTileBatch.plan({ locals: activeLocals, tiles: foregroundTiles })" in webgpu

def test_presentation_gate_owns_every_presentation_resize() -> None:
    markup = (FRONTEND / "index.html").read_text(encoding="utf-8")
    webgpu = (FRONTEND / "webgpu-preview.js").read_text(encoding="utf-8")

    assert markup.index("presentation-gate.js") < markup.index("webgpu-preview.js")
    assert webgpu.count("presentationGate.acquire(") == 2
    # The gate's two callbacks are the only places the presented canvas is
    # resized. A resize anywhere else can clear the accepted frame while
    # another generation is encoding against it.
    assert webgpu.count("if (canvas.width !== proxy.width) canvas.width = proxy.width;") == 2
    assert "superseded-before-presentation" in webgpu

def test_failure_taxonomy_replaces_sticky_gpu_disablement() -> None:
    markup = (FRONTEND / "index.html").read_text(encoding="utf-8")
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    webgpu = (FRONTEND / "webgpu-preview.js").read_text(encoding="utf-8")
    taxonomy = (FRONTEND / "render-failure.js").read_text(encoding="utf-8")

    assert markup.index("render-failure.js") < markup.index("app.js")
    assert "new window.HDRRenderFailurePolicy()" in javascript
    assert "state.gpuFailurePolicy.record(error" in javascript
    assert "state.gpuFailurePolicy?.noteSuccess()" in javascript
    # Device loss rebuilds the device instead of disabling the session, and the
    # old device's loss must not clear the rebuilt one's availability.
    assert "hdrfinisher:webgpulost" in javascript
    assert "rebuildGpuPreview" in javascript
    assert "async rebuild()" in webgpu
    assert "this.device !== lostDevice" in webgpu
    # The only sticky decisions are permanent init failure and repeated
    # validation failure, as Section 5.8 allows.
    assert 'failure.kind === "init"' in taxonomy
    assert "consecutiveValidation >= this.validationThreshold" in taxonomy

def test_live_denoise_input_is_coalesced() -> None:
    markup = (FRONTEND / "index.html").read_text(encoding="utf-8")
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    queue = (FRONTEND / "latest-work-queue.js").read_text(encoding="utf-8")

    assert markup.index("latest-work-queue.js") < markup.index("app.js")
    live_control = javascript[
        javascript.index("async function updateLiveDenoiseControl("):
        javascript.index("function denoiseRendererControls(")
    ]
    # The live control path goes through the queue, not straight to the
    # renderer, so a drag costs runs rather than input events.
    assert "denoiseInputQueue().submit(" in live_control
    assert "resolveDenoiseProxy" not in live_control
    assert "denoiseInputStats: () => state.denoiseInputQueue?.stats || null" in javascript
    assert "this.pending = payload;" in queue
    assert "this.stats.coalesced += 1;" in queue

def test_source_transport_carries_abort_and_generation_checks() -> None:
    webgpu = (FRONTEND / "webgpu-preview.js").read_text(encoding="utf-8")

    # A replaced session aborts source work that has nowhere to land.
    assert "this.sourceAbort?.abort();" in webgpu
    assert "sourceAbortSignal()" in webgpu
    # Both source routes take the caller's currency check and stop early.
    assert "supersededSourceError" in webgpu
    assert 'assertCurrent("Source tile stream was superseded")' in webgpu
    assert 'assertCurrent("Source tile probe was superseded")' in webgpu
    assert 'throw supersededSourceError("Source proxy was superseded")' in webgpu
    # The presenting renderers pass their currency into the proxy load. The
    # third site is the ROI region fallback: a viewport request admitted Direct
    # reloads the whole frame and must carry the same checks.
    assert webgpu.count("isCurrent: () => resourceGeneration === this.resourceGeneration") == 3
    assert "{ isCurrent: sourceOptions?.isCurrent }" in webgpu

def test_viewport_request_contract_reaches_the_scheduler() -> None:
    markup = (FRONTEND / "index.html").read_text(encoding="utf-8")
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    webgpu = (FRONTEND / "webgpu-preview.js").read_text(encoding="utf-8")
    contract = (FRONTEND / "viewport-request.js").read_text(encoding="utf-8")

    assert markup.index("viewport-request.js") < markup.index("webgpu-preview.js")
    # The scheduler is given the request instead of assuming Fit.
    assert "{ ...options, viewport: options.viewport, editRevision }" in webgpu
    assert "viewport: viewportRequest.fit ? undefined : viewportRequest.visible," in webgpu
    assert "viewport: sourceOptions?.viewport || null," in webgpu
    # The diagnostics surface can build and compare the contract.
    assert "viewportRequest: (options = {}) =>" in javascript
    assert "static build(options = {})" in contract
    assert "static compareWithLegacy(options = {})" in contract
    # Telemetry for processed/output pixels and halo amplification.
    assert "offscreenTiles: plan.tileCount - plan.visibleCount," in webgpu
    assert "foregroundTiles: processedTiles," in webgpu
    assert "processedPixels: foregroundTiles.reduce(" in webgpu
    assert 'refusals: ["superseded-during-encode"]' in webgpu

def test_processing_scale_contract_is_declared_and_consumed() -> None:
    markup = (FRONTEND / "index.html").read_text(encoding="utf-8")
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    webgpu = (FRONTEND / "webgpu-preview.js").read_text(encoding="utf-8")
    contract = (FRONTEND / "graph-scale.js").read_text(encoding="utf-8")

    # The declared contract loads before the renderer that consumes it.
    assert markup.index("viewport-request.js") < markup.index("graph-scale.js")
    assert markup.index("graph-scale.js") < markup.index("webgpu-preview.js")
    # The renderer delegates every scale-dependent number rather than keeping a
    # second copy of the arithmetic: the halo, the scale and the stage switches.
    assert "return graphScaleContract().detailReach(" in webgpu
    assert "return graphScaleContract().spatialReach(" in webgpu
    assert "return graphScaleContract().composedReach(" in webgpu
    assert "return graphScaleContract().processingScaleFor(" in webgpu
    assert "return graphScaleContract().graphActivity(" in webgpu
    assert "return graphScaleContract().localDetailActive(" in webgpu
    # A build that forgot the script must fail loudly instead of reserving a
    # halo of zero.
    assert "the processing-scale contract is required" in webgpu
    # The declared contract names every scale-sensitive module.
    for module_id in (
        'id: "detail"',
        'id: "detail-local"',
        'id: "denoise"',
        'id: "grain"',
        'id: "bloom"',
        'id: "halation"',
        'id: "softness"',
        'id: "masks"',
        'id: "geometry"',
    ):
        assert module_id in contract
    # The spatial grid the halo converts through is one rule on both sides
    # (1, 2 or 4 pixels a texel by the frame's long edge), so a shader change
    # cannot silently outrun the halo. Halos stay multiples of four.
    assert "return select(select(1.0, 2.0, longEdge >= 2048.0), 4.0, longEdge >= 4096.0);" in webgpu
    assert "if (longEdge >= 4096) return 4;" in contract
    assert "return longEdge >= 2048 ? 2 : 1;" in contract
    assert "const SPATIAL_SCALE = 4;" in contract
    # The viewport request declares the processing scale it will run at, derived
    # from the same contract the renderer and the CPU reference use.
    request = javascript[
        javascript.index("viewportRequest: (options = {}) =>"):
        javascript.index("prepareDenoiseSelectorSeam:")
    ]
    assert "window.HDRGraphScale?.processingScaleFor" in request
    assert "        scale," in request
    # Telemetry states which scale produced the frame.
    assert "processingScale: Number.isFinite(Number(options.sourcePixelScale))" in webgpu

def test_retained_presentation_target_owns_the_tiled_frame() -> None:
    webgpu = (FRONTEND / "webgpu-preview.js").read_text(encoding="utf-8")

    # The target survives between generations and is a copy source; the canvas
    # is configured to be a copy destination.
    assert "ensurePresentationTarget(proxy.width, proxy.height, surface.format)" in webgpu
    assert "usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC," in webgpu
    assert webgpu.count("usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST,") == 2
    # The canvas receives the completed frame in one copy, so it is never
    # presented cleared or half-written.
    assert "encoder.copyTextureToTexture(\n          { texture: presentationTarget.texture }," in webgpu
    assert "presentationTarget.valid = true;" in webgpu
    # Retention needs a tiled frame of the same identity and format. The
    # predicate is the shared helper, so a region source can never be fetched
    # against a frame that would not be retained.
    assert "previousFrame.execution === \"tiled\"" in webgpu
    assert "previousFrame.format === format" in webgpu
    assert "execution: \"direct\"," in webgpu

def test_tiled_encoding_submits_in_small_batches() -> None:
    webgpu = (FRONTEND / "webgpu-preview.js").read_text(encoding="utf-8")

    # Batches are submitted as they are encoded, so the GPU works while the CPU
    # encodes the next batch and a superseded generation stops at a boundary.
    assert "const flushTiles = () => {" in webgpu
    assert "if (batchTiles >= tileBatchSize) flushTiles();" in webgpu
    assert "tileBatchSize," in webgpu
    assert "submissions += 1;" in webgpu
    # The cancel check precedes the flush of the partial batch, so a superseded
    # generation never submits the work it was encoding.
    cancel = webgpu.index("if (cancelled) {")
    flush = webgpu.index("flushTiles();", cancel)
    assert cancel < flush

def test_roi_refinement_is_opt_in_and_tier_limited() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")

    # Off by default, so the shipped behaviour stays whole frame.
    assert 'roiPreviewMode: "fit",' in javascript
    # Only the refinement tier may be ROI-limited; pan and zoom stay whole
    # frame so a newly exposed region always has complete pixels.
    assert 'state.roiPreviewMode === "refinement" && tier === "refinement"' in javascript
    assert "function visibleOutputRect(outputWidth, outputHeight)" in javascript
    # A fully visible frame reports no viewport: Fit has nothing to skip.
    assert "if (x === 0 && y === 0 && visibleWidth >= width && visibleHeight >= height) return null;" in javascript
    # Diagnostics can flip it without a rebuild.
    assert 'setRoiPreviewMode: (mode) => {' in javascript
    assert "visibleOutputRect: () => visibleOutputRect(els.previewCanvas.width, els.previewCanvas.height)," in javascript
    # The renderer distinguishes a requested viewport from Fit's effective one.
    webgpu = (FRONTEND / "webgpu-preview.js").read_text(encoding="utf-8")
    assert "viewportRequested: Boolean(options.viewport)," in webgpu
    assert "outputPixels: proxy.width * proxy.height," in webgpu

def test_display_scale_pan_cache_is_generation_aware() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    webgpu = (FRONTEND / "webgpu-preview.js").read_text(encoding="utf-8")
    contract = (FRONTEND / "viewport-request.js").read_text(encoding="utf-8")
    coordinator = (FRONTEND / "render-coordinator.js").read_text(encoding="utf-8")

    # The cache is the accepted-generation ledger, so the partition is the
    # contract's job and is unit tested there.
    assert "static partitionByGeneration(tiles, acceptedGeneration, generation)" in contract
    assert "const panCache = viewportTiles" in webgpu
    assert "Contract.partitionByGeneration(" in webgpu
    # Only a retained frame may answer from the cache; a new target size or a
    # direct pass redraws whole.
    assert "const viewportTiles = retainedFrame && Contract && foregroundRegion" in webgpu
    assert "const foregroundTiles = panCache ? panCache.pending : plan.tiles;" in webgpu
    # A measurement pass never presents, so it must not make the cache believe
    # its tiles are in the retained frame.
    assert "if (!measureOnly) scheduler.acceptTile(tile.key, plan.generation);" in webgpu
    # Telemetry: what the region asked for, what came from the cache, what ran.
    assert "panPass: Boolean(options.panPass)," in webgpu
    assert "viewportTiles: viewportTiles ? viewportTiles.length : null," in webgpu
    assert "reusedTiles: reusedTiles.length," in webgpu
    assert "reusedPixels: reusedTiles.reduce(" in webgpu
    # The catch-up flag has to reach the encoder or the metric can never be
    # true: the option is forwarded from sourceOptions, exactly like panPass.
    assert "roiCatchUp: sourceOptions?.roiCatchUp," in webgpu
    assert "panPass: sourceOptions?.panPass," in webgpu
    # The deferred pan follow-up exists, is wired to the viewer scroll, and is
    # cancelled by a newer edit like the catch-up. The follow-up lifecycle
    # itself (timers, candidate facts, busy re-arm) lives in the coordinator.
    assert "const ROI_PAN_DELAY_MS = 140;" in javascript
    assert "function noteViewerPan() {" in javascript
    assert "noteViewerPan();" in javascript
    assert "function requestRoiPanRefinement() {" in javascript
    assert "function cancelRoiPanRefinement() {" in javascript
    assert "panPass: true" in coordinator
    assert "cancelRoiPanRefinement();" in javascript
    assert "state.renderCoordinator?.notePan(state.currentView);" in javascript
    assert "state.renderCoordinator?.cancelPan(state.currentView);" in javascript
    # Diagnostics expose the pan state and the same entry point the scroll
    # path uses, so a driver can measure it deterministically.
    assert "roiPanState: () => ({" in javascript
    assert "panRefinement: () => requestRoiPanRefinement()," in javascript

def test_render_coordinator_owns_generations_priority_and_follow_ups() -> None:
    markup = (FRONTEND / "index.html").read_text(encoding="utf-8")
    coordinator = (FRONTEND / "render-coordinator.js").read_text(encoding="utf-8")

    # Loaded after the viewport contract it builds on and before app.js, which
    # consumes it through dispatch and present callbacks.
    assert markup.index("viewport-request.js") < markup.index("render-coordinator.js")
    assert markup.index("render-coordinator.js") < markup.index("/static/app.js")

    # The five generations live in one place.
    assert "class HDRRenderCoordinator" in coordinator
    assert "editGeneration" in coordinator
    assert "viewportGeneration" in coordinator
    assert "scaleGeneration" in coordinator
    assert "sourceGeneration" in coordinator
    assert "laneGeneration" in coordinator
    # Foreground versus background priority and one-in-flight/one-latest.
    assert 'intent.priority === "background" ? "background" : "foreground"' in coordinator
    assert "st.pending = entry;" in coordinator
    assert "foregroundBusy()" in coordinator
    # Cancellation tokens carry an abort signal and a currency check.
    assert "new AbortController()" in coordinator
    assert "token.isCurrent = () => this.tokenCurrent(token);" in coordinator
    assert "token.cancel = (reason) => {" in coordinator
    # Presentation acceptance, the coarse-to-refined lifecycle, and timing.
    assert "noteAccepted(record)" in coordinator
    assert "armCatchUp(lane" in coordinator
    assert "notePan(lane)" in coordinator
    assert "DEFAULT_CATCH_UP_DELAY_MS = 700" in coordinator
    assert "DEFAULT_PAN_DELAY_MS = 140" in coordinator
    assert "dispatchMs" in coordinator

def test_app_emits_intent_to_the_render_coordinator() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")

    # Renders are submitted as intent; the coordinator owns admission.
    assert "coordinator.submit({" in javascript
    assert "dispatch: (request) => renderGpuDraftInner(request.lane, request)," in javascript
    assert "const coordinator = state.renderCoordinator;" in javascript
    assert "coordinator.noteEdit(lane);" in javascript
    assert "state.renderCoordinator?.noteSource(payload.session.session_id);" in javascript
    assert "state.renderCoordinator?.noteSource(null);" in javascript
    assert "state.renderCoordinator?.noteActiveLane(lane);" in javascript
    assert "state.renderCoordinator?.cancelLane(\"hdr\", \"geometry-suspend\");" in javascript
    # The dispatch serial comes from the coordinator, not a second counter.
    assert "const serial = Number(request.dispatchSerial) || 0;" in javascript
    assert "state.gpuRenderSerial = serial;" in javascript
    # The accepted frame is mirrored so follow-up decisions share one record.
    assert "state.renderCoordinator?.noteAccepted(state.acceptedPresentation);" in javascript
    assert "renderCoordinator: () => state.renderCoordinator?.snapshot() || null," in javascript
    # The ROI mode reaches the coordinator from both the preference path and
    # the diagnostics entry.
    assert "state.renderCoordinator?.setRoiMode(state.roiPreviewMode);" in javascript
    assert "state.renderCoordinator?.setRoiMode(state.roiPreviewMode, { cancelFollowUps: false });" in javascript
    # The deferred follow-up lifecycle is delegated, not duplicated.
    assert "state.renderCoordinator?.cancelCatchUp(state.currentView);" in javascript
    assert "state.renderCoordinator.panCandidate(state.currentView)" in javascript
    assert "state.renderCoordinator.requestPanRefinement(state.currentView)" in javascript

def test_roi_parity_diagnostic_compares_legacy_and_roi() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    webgpu = (FRONTEND / "webgpu-preview.js").read_text(encoding="utf-8")
    contract = (FRONTEND / "viewport-request.js").read_text(encoding="utf-8")

    # The A/B path renders the same edit whole frame and ROI, with
    # a newer generation between the passes so the ROI route cannot answer from
    # the legacy pass's accepted tiles, then compares the visible region.
    assert "roiParity: (options = {}) => runRoiParity(options)," in javascript
    assert "async function runRoiParity(options = {}) {" in javascript
    assert 'renderGpuDraft(lane, { tier: "refinement", longEdge, viewport: false })' in javascript
    assert "compareWithLegacy({" in javascript
    assert "roiPixels: roiPixels.values," in javascript
    assert "legacyPixels: legacyPixels.values," in javascript
    # The comparison reads the retained presentation target, which is the frame
    # both routes composite into, not a canvas screenshot.
    assert "async readPresentationRegion(" in webgpu
    assert "static compareWithLegacy(options = {})" in contract

def test_roi_refinement_has_a_settings_surface() -> None:
    markup = (FRONTEND / "index.html").read_text(encoding="utf-8")
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    shell = (FRONTEND / "application-shell.js").read_text(encoding="utf-8")

    # Reachable without devtools, and persisted like the other diagnostics.
    assert 'id="settings-roi-preview"' in markup
    assert 'ROI_PREVIEW_MODES = new Set(["fit", "refinement"])' in shell
    assert 'roiPreview: "fit",' in shell
    assert "roiPreview: ROI_PREVIEW_MODES.has(value.roiPreview) ? value.roiPreview : \"fit\"," in shell
    assert 'byId("settings-roi-preview").value = ROI_PREVIEW_MODES.has(shell.preferences.roiPreview)' in shell
    assert 'byId("settings-roi-preview").addEventListener("change"' in shell
    # The app applies it through the ordinary preferences path.
    assert "applyRoiPreview(preferences.roiPreview);" in javascript
    assert "function applyRoiPreview(value) {" in javascript

def test_perspective_draft_is_bounded_before_authoring_tier_apply() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    draft = javascript[
        javascript.index("function perspectiveDraftLongEdge"):
        javascript.index("function openCropMode")
    ]

    assert "Math.min(previewTargetLongEdge(), 1024)" in draft
    assert "long_edge: perspectiveDraftLongEdge()" in draft

def test_native_exact_peak_is_explicit_opt_in_during_authoring() -> None:
    markup = (FRONTEND / "index.html").read_text(encoding="utf-8")
    script = (FRONTEND / "app.js").read_text(encoding="utf-8")

    exact_peak_input = re.search(r'<input type="checkbox" id="scope-exact-peak"([^>]*)>', markup)
    assert exact_peak_input is not None
    assert "checked" not in exact_peak_input.group(1)
    assert "scopeExactPeak: false" in script
    initialization = script[
        script.index("function initializePreviewPreferences"):
        script.index("function initializePreviewScheduler")
    ]
    assert "state.scopeExactPeak = false;" in initialization

def test_brand_assets_and_fonts_are_bundled_locally() -> None:
    markup = (FRONTEND / "index.html").read_text(encoding="utf-8")
    launcher = (FRONTEND / "launcher.html").read_text(encoding="utf-8")
    css = (FRONTEND / "styles.css").read_text(encoding="utf-8")
    desktop_package = (DESKTOP / "package.json").read_text(encoding="utf-8")

    favicon_url = "/static/assets/brand/hdr-finisher-favicon-small.svg"
    assert f'href="{favicon_url}"' in markup
    assert f'href="{favicon_url}"' in launcher
    assert f'src="{favicon_url}"' in markup
    assert 'class="product-mark"' in markup
    assert 'alt=""' in markup
    assert "data:," not in markup

    required_assets = [
        FRONTEND / "assets" / "brand" / "hdr-finisher-favicon-small.svg",
        FRONTEND / "assets" / "brand" / "hdr-finisher-app-icon.svg",
        FRONTEND / "assets" / "fonts" / "source-sans-3" / "SourceSans3-Variable.ttf",
        FRONTEND / "assets" / "fonts" / "source-sans-3" / "OFL.txt",
        FRONTEND / "assets" / "fonts" / "gabarito" / "Gabarito-Variable.ttf",
        FRONTEND / "assets" / "fonts" / "gabarito" / "OFL.txt",
        FRONTEND / "assets" / "fonts" / "space-mono" / "SpaceMono-Regular.ttf",
        FRONTEND / "assets" / "fonts" / "space-mono" / "SpaceMono-Bold.ttf",
        FRONTEND / "assets" / "fonts" / "space-mono" / "OFL.txt",
        DESKTOP / "assets" / "icon.svg",
        DESKTOP / "assets" / "icon.png",
    ]
    assert all(asset.is_file() and asset.stat().st_size > 0 for asset in required_assets)

    client = TestClient(app)
    for asset_url in (
        favicon_url,
        "/static/assets/fonts/source-sans-3/SourceSans3-Variable.ttf",
        "/static/assets/fonts/gabarito/Gabarito-Variable.ttf",
        "/static/assets/fonts/space-mono/SpaceMono-Bold.ttf",
    ):
        response = client.get(asset_url)
        assert response.status_code == 200
        assert response.content

    assert css.count('font-family: "Source Sans 3";') == 1
    assert css.count('font-family: "Gabarito";') == 1
    assert css.count('font-family: "Space Mono";') == 2
    assert '--font-body: "Source Sans 3"' in css
    assert '--font-display: "Gabarito"' in css
    assert '--font-technical: "Space Mono"' in css
    assert 'font-family: "Source Sans 3";' in launcher
    assert 'font-family: "Space Mono";' in launcher
    assert "/static/assets/fonts/source-sans-3/SourceSans3-Variable.ttf" in launcher
    assert "/static/assets/fonts/space-mono/SpaceMono-Regular.ttf" in launcher
    assert "IBM Plex" not in launcher
    assert "Inter" not in launcher
    assert '"icon": "assets/icon.png"' in desktop_package

def test_file_picker_advertises_avif_round_trip_input() -> None:
    markup = (FRONTEND / "index.html").read_text(encoding="utf-8")
    assert 'accept=".exr,.tif,.tiff,.hdr,.pfm,.heic,.heif,.avif,.jxl,.png,.jpg,.jpeg,.dng,.arw,.cr2,.cr3,.nef,.nrw,.raf,.rw2,.orf,.ori,.pef,.srw"' in markup
