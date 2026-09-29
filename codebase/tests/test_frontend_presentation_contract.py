from __future__ import annotations

import re
from pathlib import Path

from fastapi.testclient import TestClient

from hdr_finisher.main import app


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
DESKTOP = ROOT / "desktop"


def _webgpu_source() -> str:
    return "\n".join((
        (FRONTEND / "webgpu-preview.js").read_text(encoding="utf-8"),
        (FRONTEND / "webgpu-shaders.js").read_text(encoding="utf-8"),
    ))


def test_interaction_holds_the_selected_tier_once_it_has_produced_a_result() -> None:
    """A gesture may not lower the processing resolution.

    The previous contract deliberately dropped interaction to a 512-1024
    display-bounded proxy and refined afterwards. The stable-tier contract
    replaces that with exact-tier processing, and keeps the bounded proxy only
    as a bootstrap path for a tier that has not produced a result yet.
    """
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    resident = javascript[javascript.index("function residentAuthoringLongEdge()") : javascript.index("function scopeLongEdge(tier)")]
    assert 'accepted?.transport !== "WebGPU"' in resident
    assert "accepted.geometrySignature !== geometrySignature()" in resident
    # The comparison is against the resolution the frame was *processed* at.
    # Geometry trims the presented frame, so comparing the presented edge
    # made a straightened or cropped image never resident, and every gesture
    # re-rendered the whole frame.
    assert "(accepted.processedLongEdge ?? accepted.longEdge) !== target" in resident

    bootstrap = resident[resident.index("function bootstrapProxyLongEdge()") : resident.index("function interactiveProxyLongEdge()")]
    interactive = resident[resident.index("function interactiveProxyLongEdge()") : resident.index("function globalDetailActive")]
    settled = resident[resident.index("function settledProxyLongEdge()") : resident.index("function refinementProxyLongEdge")]

    assert "clamp(displayedLongEdge(), 512, 1024)" in bootstrap
    assert "residentAuthoringLongEdge" not in interactive
    assert "if (selectedTierReady()) return requiredProcessingLongEdge();" in interactive
    assert "return bootstrapProxyLongEdge();" in interactive
    # The bounded proxy is reachable only through the bootstrap helper.
    assert "clamp(displayedLongEdge()" not in interactive

    assert "const resident = residentAuthoringLongEdge();" in settled
    assert "if (resident) return resident;" in settled
    # The settled pass aims at the selected tier, not at a display-bounded edge.
    assert "return Math.round(requiredProcessingLongEdge());" in settled
    assert "clamp(displayedLongEdge()" not in settled

def test_viewer_state_is_derived_and_names_the_four_states() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    derive = javascript[javascript.index("function deriveViewerState(") : javascript.index("function viewerState(")]

    assert 'return { status: "unavailable"' in derive
    assert 'return { status: "preparing"' in derive
    assert 'return { status: current ? "ready" : "updating"' in derive
    # Preparing is decided by whether the selected tier itself produced an
    # exact result, never by whether some image happens to be on screen.
    assert "accepted.exact === true && accepted.requestedTier === tier" in derive
    assert "accepted.generation === currentGeneration" in derive
    assert "accepted.geometrySignature === currentGeometrySignature" in derive

def test_accepted_presentation_records_what_it_actually_is() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    accept = javascript[javascript.index("function acceptPresentation(") : javascript.index("function markPreviewUnavailable(")]

    assert 'const requestedTier = state.previewResolutionOverride === false ? "display" : normalizedPreviewResolution();' in accept
    # Exactness is a fact about the resolution the frame was processed at,
    # not about the size of the picture that came out. Geometry trims the
    # frame: a straighten at the 4K tier processes at 4096 and presents
    # 4011, and that is still an exact 4K result.
    assert "const processedEdge = Number(processedLongEdge) > 0 ? Number(processedLongEdge) : longEdge;" in accept
    # Equality, not "at least". A frame processed above the selected tier is
    # not that tier either -- a resident Full frame satisfying ">=" reported
    # "Ready - 1K" over it and told the scheduler there was nothing to do.
    assert "const exact = longEdge > 0 && processedEdge === requiredProcessingLongEdge();" in accept
    assert "processedLongEdge: processedEdge," in accept
    assert 'tier: exact ? (requestedTier === "display" ? "display"' in accept
    assert "requestedTier," in accept
    assert "exact," in accept

def test_preparing_state_labels_the_placeholder_tier_truthfully() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    label = javascript[javascript.index("function viewerStatusLabel(") : javascript.index("function renderViewerStatus(")]

    assert "showing previous ${previewResolutionLabel(viewer.presentedTier)} result" in label
    assert "return `Preparing ${tierLabel}${showing}`;" in label
    assert "return `Updating — ${tierLabel}`;" in label
    assert "return `Ready — ${tierLabel}`;" in label
    assert "unavailable" in label

def test_changing_preview_tier_does_not_reset_the_renderer_or_clear_the_viewport() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    apply_tier = javascript[javascript.index("function applyPreviewResolution(") : javascript.index("function acceptPresentation(")]

    assert "resetSession" not in apply_tier
    assert "clearPreviewImage" not in apply_tier
    assert "state.gpuPreparedLane" not in apply_tier
    assert 'invalidatePreview(state.currentView, { markDirty: false });' in apply_tier

def test_cpu_preview_failure_retains_the_last_valid_presentation() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    render = javascript[javascript.index("async function renderPreviewForLane(") : javascript.index("async function renderRawPreviewForLane(")]
    failure = render[render.index("if (!response.ok) {") :]

    assert "markPreviewUnavailable(detail)" in failure
    assert failure.index("if (state.acceptedPresentation?.lane === lane) markPreviewUnavailable(detail);") < failure.index("clearPreviewImage()")

def test_raw_preview_failure_reports_unavailable_without_clearing() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    raw = javascript[javascript.index("async function renderRawPreviewForLane(") :]
    raw = raw[: raw.index("const width = Number(response.headers.get(\"X-Image-Width\"));")]
    failure = raw[raw.index("if (!response.ok) {") :]

    assert "markPreviewUnavailable(" in failure
    assert "clearPreviewImage" not in failure

def test_overlay_acceptance_is_generation_and_geometry_safe() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    overlay = javascript[javascript.index("async function refreshOverlay(") :]
    overlay = overlay[: overlay.index("const requestIsCurrent = () => controller === state.overlayAbortController") + 2000]

    assert "const overlayGeneration = state.previewGeneration[lane];" in overlay
    assert "const overlaySignature = geometrySignature();" in overlay
    assert "state.previewGeneration[lane] === overlayGeneration" in overlay
    assert "geometrySignature() === overlaySignature" in overlay

def test_stale_overlay_remains_continuously_visible_until_replacement_arrives() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    invalidate = javascript[javascript.index("function invalidatePreview(") : javascript.index("function markGlobalEditDirty(")]
    apply_overlay = javascript[javascript.index("async function applyOverlayUrl(") : javascript.index("function clearPreviewImage(")]
    clear_overlay = javascript[javascript.index("function clearPreviewOverlay(") : javascript.index("function syncViewerStatusEntry(")]

    assert 'els.previewOverlay.style.opacity = "0.5";' not in invalidate
    assert 'els.previewOverlay.dataset.stale = "true";' in invalidate
    assert "state.overlayPresented.generation !== state.previewGeneration[lane]" in invalidate
    assert "delete els.previewOverlay.dataset.stale;" in apply_overlay
    assert 'els.previewOverlay.style.opacity = "1";' in apply_overlay
    assert "delete els.previewOverlay.dataset.stale;" in clear_overlay
    assert 'els.previewOverlay.style.opacity = "";' in clear_overlay

def test_generation_change_reports_updating_immediately() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    invalidate = javascript[javascript.index("function invalidatePreview(") : javascript.index("function markGlobalEditDirty(")]

    # The 100 ms Updating/Preparing feedback target is met by reporting on the
    # generation bump, not by waiting for the render that follows it.
    assert "state.previewGeneration[lane] += 1;" in invalidate
    assert "if (lane === state.currentView) renderViewerStatus();" in invalidate
    assert invalidate.index("state.previewGeneration[lane] += 1;") < invalidate.index("renderViewerStatus();")

def test_detail_interaction_backpressures_the_gpu_queue() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    webgpu = _webgpu_source()

    scheduler = javascript[javascript.index("function initializePreviewScheduler()") : javascript.index("function observeScopeSize()")]
    assert 'tier: tiled && decision.coarse ? "refinement" : "interactive"' in scheduler
    assert "const detailActive = gpuDetailGraphActive(task.lane);" in scheduler
    assert "const detailInteraction = state.detailInteractionRestore?.lane === task.lane;" in scheduler
    assert "if (detailInteraction && !state.previewScheduler?.interacting) return false;" in scheduler
    # Every drag frame waits for GPU completion (one frame in flight).
    assert "if (rendered) await state.gpuPreview?.waitForSubmittedWork?.();" in scheduler
    assert "waitForSubmittedWork" in scheduler
    assert "state.detailInteractionRestore = { lane: task.lane, longEdge: residentLongEdge }" in scheduler
    assert "async waitForSubmittedWork()" in webgpu
    assert "await this.device.queue.onSubmittedWorkDone()" in webgpu

    settle = javascript[javascript.index("async function settlePreview") : javascript.index("async function refinePreview")]
    assert "const longEdge = detailRestore || settledProxyLongEdge();" in settle
    assert "globalDetailActive(lane)" not in settle
    assert 'const tier = longEdge >= refinementProxyLongEdge() ? "refinement" : "settled";' in settle

    gesture = javascript[javascript.index("function beginGlobalDetailInteraction") : javascript.index("function settledProxyLongEdge")]
    assert '/^(hdr|sdr)\\.detail\\./' in gesture
    assert "state.detailInteractionRestore = null;" in gesture
    assert "longEdge: residentAuthoringLongEdge()" in gesture

    graph = javascript[javascript.index("function gpuDetailGraphActive") : javascript.index("function beginGlobalDetailInteraction")]
    assert "globalDetailActive(lane)" in graph
    assert "localAdjustments().some" in graph
    assert "detail.texture_amount, detail.clarity_amount, detail.sharpen_amount" in graph

    local_binding = javascript[javascript.index("function bindLocalPreviewInteraction") : javascript.index("function scheduleLocalPreview")]
    assert "beginLocalDetailInteraction(control);" in local_binding
    local_marker = javascript[javascript.index("function beginLocalDetailInteraction") : javascript.index("function brushOutputSpaceMapper")]
    assert 'startsWith("detail.")' in local_marker

def test_curve_canvas_left_clicks_add_or_select_and_right_click_removes() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    curve_binding = javascript[javascript.index("function bindCurveEditor"):javascript.index("function updateCurveFromPointer")]

    assert "Left-click the curve to add a point" in html
    assert "right-click an interior point to remove it" in html
    assert "curvePointIndexAtPointer(event.clientX, event.clientY, rect)" in curve_binding
    assert 'if (!dragged && event.type !== "pointercancel") removeCurvePoint(pointIndex);' not in curve_binding
    assert "const curveHit = curveHitAtPointer(event.clientX, event.clientY, rect);" in curve_binding
    assert "const insertedIndex = addCurvePoint(curveHit.x);" in curve_binding
    assert "beginDrag(event, insertedIndex);" in curve_binding
    assert "const pointerDelta = createPrecisionPointerDelta(startEvent);" in curve_binding
    assert 'canvas.addEventListener("lostpointercapture", stop);' in curve_binding
    assert 'canvas.addEventListener("contextmenu"' in curve_binding
    assert "removeCurvePoint(pointIndex);" in curve_binding
    assert "const layout = curveEditorLayout();" in javascript

def test_ctrl_fine_adjustment_and_shift_semantic_snapping_are_shared() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    shell = (FRONTEND / "application-shell.js").read_text(encoding="utf-8")

    assert "const FINE_ADJUSTMENT_SCALE = 0.1" in javascript
    assert 'control.dataset.instrumentStep = String(declaredStep)' in javascript
    assert '"Hold Ctrl for 10× finer adjustment. Hold Shift to snap to semantic landing positions."' not in javascript
    assert javascript.count("createPrecisionPointerDelta(startEvent)") >= 2
    assert "function rangeSnapProfile(control)" in javascript
    assert "adjacentRangeSnap(control, Number(control.value), direction)" in javascript
    assert 'event.shiftKey ? "snap" : event.ctrlKey ? "fine" : "ordinary"' in javascript
    assert 'const step = event.ctrlKey ? 0.001 : 0.01' in javascript
    assert 'const step = event.ctrlKey ? 0.01 : 0.05' in javascript
    assert '(event.ctrlKey || event.metaKey) && (event.key === "ArrowLeft" || event.key === "ArrowRight")' in javascript
    assert 'ui.bandValue.min = String(legalMinimum)' in javascript
    assert 'ui.bandValue.max = String(Math.max(legalMinimum, legalMaximum))' in javascript
    assert 'className = "slider-ticks"' not in javascript
    assert "function renderRangeSnapTicks" not in javascript
    assert "function rangeSnapProfile(control)" in javascript
    assert 'shell.style.setProperty("--fill-start"' in javascript
    assert "event?.altKey" not in javascript[javascript.index("function pointerAdjustmentScale"):javascript.index("function fineRangeStep")]
    assert "if (event.ctrlKey)" in shell
    assert "ctrlKey: false" in shell
