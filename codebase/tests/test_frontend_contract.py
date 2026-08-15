from __future__ import annotations

import re
from pathlib import Path

from fastapi.testclient import TestClient

from hdr_finisher.main import app


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"


def test_file_picker_advertises_avif_round_trip_input() -> None:
    markup = (FRONTEND / "index.html").read_text(encoding="utf-8")
    assert 'accept=".exr,.tif,.tiff,.hdr,.pfm,.heic,.heif,.avif,.png,.jpg,.jpeg"' in markup


def test_grading_ui_exposes_variable_equalizer_targeting_and_bypass_controls() -> None:
    response = TestClient(app).get("/")
    assert response.status_code == 200
    html = response.text
    script = (FRONTEND / "app.js").read_text(encoding="utf-8")
    assert "Lift, Gamma, Gain" in html
    assert "Legacy Primaries" not in html
    assert 'id="tone-equalizer-add"' in html
    assert 'id="tone-equalizer-remove"' in html
    assert 'id="tone-equalizer-radius"' in html
    assert html.count("data-section-path=") == 13
    assert html.count("data-zone-hover=") == 6
    assert "Highlight Compression" in html
    assert 'data-group="hdr-highlights"' in html
    assert 'data-section-path="hdr.highlight_section_enabled"' in html
    assert html.index('data-group="hdr-highlights"') > html.index('data-group="hdr-tone"')
    assert html.index('data-group="hdr-highlights"') < html.index('data-group="hdr-equalizer"')
    assert "Target Peak" in html
    assert 'data-path="hdr.highlight_compression_start_nits"' in html
    assert 'data-path="hdr.highlight_compression_target_nits"' in html
    assert 'data-path="hdr.highlight_compression_softness"' in html
    assert 'data-path="hdr.highlight_compression_mode"' in html
    assert 'data-path="hdr.highlight_compression_peak_detail"' in html
    assert 'data-path="hdr.highlight_compression_color_handling"' in html
    assert "AgX-style path to white" in html
    assert 'id="highlight-compression-graph"' in html
    assert "Advanced highlight controls" in html
    assert "RGB Primaries" in html
    assert 'data-path="hdr.saturation"' in html
    assert 'data-path="hdr.vibrance"' in html
    assert 'data-path="hdr.red_hue"' in html
    assert 'data-path="hdr.tint_purity"' in html
    assert 'data-path="sdr.match_hdr_color"' not in html
    assert 'data-path="sdr.saturation"' in html
    assert 'data-path="sdr.red_hue"' in html
    assert 'id="sdr-match-hdr-colors"' in html
    assert 'id="sdr-reset-colors"' in html
    assert 'const COLOR_CONTROL_KEYS = controlGroups["hdr-color"]' in script
    assert "function matchHdrColorsToSdr()" in script
    assert "function resetSdrColorSliders()" in script
    assert "/api/export-directory/default" in script
    assert "window.confirm" in script
    assert "overwrite," in script


def test_grade_readouts_support_bounded_direct_numeric_entry() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    css = (FRONTEND / "styles.css").read_text(encoding="utf-8")

    assert html.count("data-value-path=") >= 50
    assert "const MANUAL_VALUE_RULES" in javascript
    assert "function enhanceEditableGradeValues()" in javascript
    assert "function normalizeManualControlValue(path, text)" in javascript
    assert "function syncRangeControlFromState(path" in javascript
    assert 'event.key === "Enter" || event.key === "F2"' in javascript
    assert 'event.key === "Escape"' in javascript
    assert '"hdr.highlight_compression_start_nits": { min: 1, max: 9999' in javascript
    assert '"hdr.highlight_compression_target_nits": { min: 2, max: 10000' in javascript
    assert '"hdr.exposure": { min: -8, max: 8' in javascript
    assert '"sdr.highlight_recovery": { min: 0, max: 4' in javascript
    assert 'entryScale: 100' in javascript
    assert "Double-click any value to type it." in html
    assert "Double-click any value to type it." in javascript
    assert ".editable-value[data-editing=\"true\"]" in css
    assert ".range-shell.manual-overflow" in css


def test_highlight_compression_softness_uses_half_percent_slider_steps() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")

    assert 'id="hdr-compression-softness" type="range" min="0" max="100" step="0.5"' in html
    assert javascript.count('"hdr.highlight_compression_softness": [0, 100, 0.5]') == 3
    assert '"hdr.highlight_compression_softness": { min: 0, max: 100, decimals: 1 }' in javascript
    assert 'numeric.toFixed(1)' in javascript


def test_tint_controls_follow_darktable_hue_mapping() -> None:
    css = (FRONTEND / "styles.css").read_text(encoding="utf-8")
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")

    assert ".primary-tint-hue .slider-track { background: linear-gradient(90deg, #53a7b1, #5368b5, #b84f9a, #e05273, #d3ad5b, #54a579, #53a7b1); }" in css
    assert "const DARKTABLE_TINT_HUE_STOPS" in javascript
    assert "function syncTintPurityVisuals()" in javascript
    assert "darktableTintHueColor(state.adjustments[lane].tint_hue)" in javascript


def test_equalizer_interactions_include_non_scrolling_wheel_and_keyboard_alternatives() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    equalizer_binding = javascript[javascript.index("function bindToneEqualizerEditor"):javascript.index("function updateToneEqualizerFromPointer")]

    assert "Left-click the curve to add a band" in html
    assert "right-click an interior band to remove it" in html
    assert "toneEqualizerNodeIndexAtPointer(event.clientX, event.clientY, rect)" in equalizer_binding
    assert "toneEqualizerCurveHitAtPointer(event.clientX, event.clientY, rect)" in equalizer_binding
    assert 'canvas.addEventListener("contextmenu"' in equalizer_binding
    assert "removeToneEqualizerNode(bandIndex)" in equalizer_binding
    assert 'canvas.addEventListener("wheel"' in javascript
    assert "event.preventDefault();" in javascript
    assert "{ passive: false }" in javascript
    assert 'event.key === "[" || event.key === "]"' in javascript
    assert "moveToneEqualizerNodeHorizontally" in javascript
    assert "pointerenter" in javascript and "focusin" in javascript
    assert "drawZoneScopeOverlay" in javascript


def test_redundant_enable_controls_are_removed_and_equalizer_schedules_live_scopes() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")

    assert 'id="tone-equalizer-enabled"' not in html
    assert 'id="curves-enabled"' not in html
    assert 'id="sdr-match-hdr-color"' not in html
    assert "Enable equalizer" not in html
    assert "Enable curves" not in html
    assert "queueGpuDraft(\"hdr\");" not in javascript[javascript.index("function updateToneEqualizerFromPointer"):javascript.index("function toneEqualizerBandLimits")]
    assert javascript.count('debouncePreview("hdr");') >= 2


def test_equalizer_chart_drag_syncs_the_selected_band_range_visual() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    sync_controls = javascript[
        javascript.index("function syncToneEqualizerControls"):
        javascript.index("function drawToneEqualizerEditor")
    ]

    assert "els.toneEqualizerBandValue.value = String(value);" in sync_controls
    assert "updateRangeVisual(els.toneEqualizerBandValue);" in sync_controls


def test_curve_drag_uses_live_preview_scheduler_and_three_point_default_shape() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    curve_binding = javascript[javascript.index("function bindCurveEditor"):javascript.index("function drawCurveEditor")]

    assert "state.previewScheduler?.beginInteraction()" in curve_binding
    assert "debouncePreview(state.currentView)" in curve_binding
    assert "state.previewScheduler?.endInteraction()" in curve_binding
    assert "queueGpuDraft(state.currentView)" not in curve_binding
    assert "const verticalScale = curveVerticalAdjustmentScale(index, curve.length)" in curve_binding
    assert "return index === 0 || index === pointCount - 1 ? 0.18 : 0.35" in curve_binding
    assert "const verticalStep = step * Math.min(1, curveVerticalAdjustmentScale(index, curve.length) / 0.35)" in curve_binding
    assert "return [[0, 0], [0.25, 0.25], [0.5, 0.5], [0.75, 0.75], [1, 1]]" in javascript
    assert 'if (tier === "interactive") return Math.min(384, interactiveProxyLongEdge())' in javascript


def test_curve_canvas_left_clicks_add_or_select_and_right_click_removes() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    curve_binding = javascript[javascript.index("function bindCurveEditor"):javascript.index("function updateCurveFromPointer")]

    assert "Left-click the curve to add a point" in html
    assert "right-click an interior point to remove it" in html
    assert "curvePointIndexAtPointer(event.clientX, event.clientY, rect)" in curve_binding
    assert 'if (!dragged && event.type !== "pointercancel") removeCurvePoint(pointIndex);' not in curve_binding
    assert "const curveHit = curveHitAtPointer(event.clientX, event.clientY, rect);" in curve_binding
    assert "addCurvePoint(curveHit.x);" in curve_binding
    assert 'canvas.addEventListener("contextmenu"' in curve_binding
    assert "removeCurvePoint(pointIndex);" in curve_binding
    assert "const layout = curveEditorLayout();" in javascript


def test_hdr_curve_graph_uses_tokenized_exposure_band_styling() -> None:
    css = (FRONTEND / "styles.css").read_text(encoding="utf-8")
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")

    for token in (
        "--curve-line-width",
        "--curve-node-radius",
        "--curve-endpoint-radius",
        "--curve-selected-radius",
        "--curve-selected-ring",
        "--graph-home-cue-opacity",
        "--graph-home-epsilon",
        "--equalizer-curve",
        "--equalizer-node-radius",
        "--equalizer-selected-radius",
        "--curve-band-opacity",
        "--exposure-band-deep-shadow",
        "--exposure-band-peak",
    ):
        assert token in css
    assert "drawCurveExposureBands" in javascript
    assert "curveExposureGradient" in javascript
    assert "curveDomainPositionForNits" in javascript
    assert "compactCurveNitLabel" in javascript
    assert javascript.count("drawGraphHomeCue") >= 3
    assert "drawGraphHomeCue(ctx, x, y, radius, node.adjustment_ev)" in javascript


def test_curve_panel_reset_is_visible_when_curves_are_modified() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")

    assert 'id="curve-reset" class="group-reset text-button"' in html
    assert 'els.curveReset.closest(".control-group")?.classList.toggle("modified", curvesModified)' in javascript


def test_scope_zoom_exposes_1000_4000_and_10000_nit_computation_ranges() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")

    assert '<span>Scope zoom</span>' in html
    assert 'id="scope-zoom"' in html
    assert '<option value="1000">1K nits</option>' in html
    assert '<option value="4000">4K nits</option>' in html
    assert '<option value="10000">10K nits</option>' in html
    assert "max_nits=${maxNits}" in javascript
    assert "request.maxNits" in javascript


def test_overlay_ui_explains_reference_nit_zebras_and_has_a_false_color_key() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")

    assert 'id="false-color-key"' in html
    assert "Highlights pixels at or above this reference-nit level." in html
    assert 'id="overlay-threshold" type="range" min="10" max="4000" step="10" value="100"' in html
    assert "function renderFalseColorKey" in javascript
    assert 'if (path === "shared.overlay_threshold") return `${Math.round(numeric)} nit`;' in javascript


def test_expanded_controls_use_nested_tiles_and_export_copy_is_clean() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    css = (FRONTEND / "styles.css").read_text(encoding="utf-8")
    assert "Export..." in html
    assert "Export file" not in html
    assert "JPEG XL" not in html
    assert "not in this build" not in html
    assert "Chromium Proof" in html
    assert 'id="chrome-proof-target"' in html
    assert 'id="jpeg-gain-map-quality"' in html
    assert 'id="jpeg-gain-map-scale"' in html
    assert 'class="export-filename-field"' in html
    assert 'class="export-directory-field"' in html
    assert 'id="directory-browser"' in html
    assert 'id="directory-browser-select"' in html
    assert "/api/export-directories" in (FRONTEND / "app.js").read_text(encoding="utf-8")
    assert ".control-group-body" in css
    assert "border-top: 2px solid" in css
    assert ".jpeg-advanced-settings" in css
    assert '"quality jpeg"' in css
    assert '"filename folder"' in css


def test_linear_workflow_uses_tab_specific_rails_and_reports_export_readiness() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    proofing = (FRONTEND / "proofing-ui.js").read_text(encoding="utf-8")
    css = (FRONTEND / "styles.css").read_text(encoding="utf-8")
    assert 'data-workflow-tab="import"' in html
    assert 'data-workflow-tab="grade"' in html
    assert 'data-workflow-tab="proof"' in html
    assert 'data-workflow-tab="export"' in html
    assert 'data-workflow-panel="import"' in html
    assert 'data-workflow-panel="grade"' in html
    assert 'data-workflow-panel="proof"' in html
    assert 'data-workflow-panel="export"' in html
    assert 'id="chrome-proof-toggle"' in html
    assert 'id="chrome-proof-refresh"' in html
    assert 'id="chrome-proof-watermark-toggle"' in html
    assert 'id="chrome-proof-watermark"' in html
    assert html.index('id="chrome-proof-refresh"') < html.index('id="chrome-proof-status"')
    assert 'id="chrome-proof-popover"' not in html
    assert 'id="chrome-proof-image"' in html
    assert 'id="review-chrome-proof"' in html
    assert 'data-preflight="proof"' in html
    assert '<dialog id="export-sheet"' not in html
    assert 'id="export-sheet" class="export-sheet workflow-side-panel panel"' in html
    assert "Delivery Matrix" not in html
    assert "Live Browser" not in html
    assert 'id="delivery-matrix-view"' not in html
    assert 'id="live-browser-view"' not in html
    assert "Global finishing only" not in html
    assert 'id="source-rail-expand"' in html
    assert 'class="source-file-identity"' in html
    assert '["import", "grade", "proof", "export"]' in javascript
    assert "/api/proof/reconstruction" in proofing
    assert "async function parseProofResponse" in proofing
    assert "const body = await response.text();" in proofing
    assert "Proof generation is intentionally explicit" in proofing
    assert "PROOF_IDLE_MS" not in proofing
    assert "requestGeneration" in proofing
    assert "state.proofWatermarkEnabled" in proofing
    assert "localStorage" not in proofing
    assert 'els.scopeKindLabel.textContent = "HDR";' in proofing
    assert "AUTHORED" not in proofing
    assert "#chrome-proof-watermark" in css and "opacity: .5;" in css
    assert '.chrome-proof-status[data-state="stale"]' in css
    assert 'state.activeWorkflow !== "proof"' in proofing
    assert 'state.currentView !== "hdr"' in proofing
    assert "renderProofPreflight" in javascript
    assert "Chromium proof is stale" in javascript
    assert "Proofed ${formatName}, not selected ${exportName}" in javascript


def test_grade_rail_keeps_a_readable_minimum_width() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    assert "gradeW: [300, 420]" in javascript


def test_annotation_refinements_keep_metadata_and_scopes_useful() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    css = (FRONTEND / "styles.css").read_text(encoding="utf-8")
    assert '<aside class="source-rail panel" aria-label="Metadata">' in html
    assert html.count("<h1>Control Panel</h1>") == 4
    assert "HDR Controls" in html
    assert "SDR Controls" in html
    assert '<span>Preview Window</span>' in html
    assert 'class="preview-metadata-panel"' in html
    assert 'id="preview-status-copy"' in html
    assert '<progress id="preview-progress"' in html
    assert 'id="override-warning"' not in html
    assert 'id="apply-interpretation" class="button-primary"' in html
    assert 'class="probe-strip"' not in html
    assert 'id="probe-readout"' not in html
    assert "Move over the image" not in html
    assert "sourceSettingsOpen: false" in javascript
    assert "metadataOpen: false" in javascript
    assert '--group-chevron-glyph: "\\E76C"' in css
    assert ".disclosure-trigger::before" in css
    assert '.disclosure-trigger[aria-expanded="true"]::before' in css
    assert "dockH: [240, 340]" in javascript
    assert "dockH: 252" in javascript
    assert "updateProbeReadout" not in javascript
    assert ".preview-progress" in css
    assert "Processing complete. Decoding preview..." in javascript
    assert "{ showProgress: false }" in javascript
    assert "renderPreviewForLane(lane, true, longEdge, { showProgress: false })" in javascript
    assert "min-height: 720px" in css


def test_webgpu_pipeline_preserves_cpu_section_order_and_fixed_hdr_curve_domain() -> None:
    shader = (FRONTEND / "webgpu-preview.js").read_text(encoding="utf-8")
    assert "const PARAM_COUNT = 140" in shader
    assert "hdrPrimaries(hdrToneEqualizer(sceneColor(hdrPeakFit(hdrSoftCeiling(hdrContrast(hdrBase(source)))))))" in shader
    assert "sdrReferenceColor(sdrContrast(highlightRecovery(rgb)))" in shader
    assert "toneMap(sceneColor(rgb))" in shader
    assert "sdrPrimaries(sdrContrast(highlightRecovery(toneMap(sceneColor(rgb)))))" in shader
    assert "retoneMapSdrReference(rgb)" in shader
    assert "if (value <= 0.18) { return 0.5 * pow(value / 0.18, 1.0 / log(100.0)); }" in shader
    assert "if (value <= 0.5) { return 0.18 * pow(2.0 * value, log(100.0)); }" in shader
    assert "log2(value / 0.18) / log2(100.0)" in shader
    assert "let curveLuma = select(clamp(sourceLuma, 0.0, 1.0), curveEncodeChannel(sourceLuma), hdr)" in shader
    assert "let mappedLuma = select(mappedCurveLuma, curveDecodeChannel(mappedCurveLuma), hdr)" in shader
    assert "rgb = curveEncode(rgb, hdr)" in shader
    assert "let targetLevel = max(p[73], start + 0.0018)" in shader
    assert "let target =" not in shader
    assert "let softness = clamp(p[3] / 100.0, 0.0, 1.0)" in shader
    assert 'branch.highlight_compression_mode === "peak_fit" ? 1' in shader
    assert 'branch.highlight_compression_color_handling === "path_to_white"' in shader
    assert "fn hdrPeakFit(input: vec3f) -> vec3f" in shader
    assert "fn hdrSoftCeiling(input: vec3f) -> vec3f" in shader
    assert "let chromaScale = min(pathScale, channelScale)" in shader
    assert "let requiredRatio = clamp(" in shader
    assert "let targetValue = exp2(effectiveStartStop + stopSpan * mapped)" in shader
    assert 'entryPoint: "baseFragmentMain"' in shader
    assert 'entryPoint: "filmResponseFragmentMain"' in shader
    assert 'entryPoint: "fragmentMain"' in shader
    assert "filmResponse(textureLoad(sourceTexture" in shader
    assert "spatialExtractFragmentMain" in shader
    assert "fn applyColorGrading" in shader
    assert "srgbEncode(sourceY)" in shader
    assert "srgbEncode(vec3f(sourceY))" not in shader
    assert "fn applyVignette" in shader


def test_advanced_finishing_controls_are_wired_to_the_editor_and_export_contract() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    script = (FRONTEND / "app.js").read_text(encoding="utf-8")
    css = (FRONTEND / "styles.css").read_text(encoding="utf-8")
    shader = (FRONTEND / "webgpu-preview.js").read_text(encoding="utf-8")
    assert 'data-group="geometry"' in html
    assert 'id="crop-guide"' in html
    assert 'id="crop-grid-density"' in html
    assert 'data-group="color-grading"' in html
    assert 'id="color-grading-match-hdr"' in html
    assert 'data-group="vignette"' in html
    assert 'id="vignette-center-handle"' in html
    assert 'id="export-sharpening"' in html
    assert 'id="export-resize-mode"' in html
    assert 'method: "edge_aware_multiscale"' in script
    assert 'const guides = ["none", "thirds", "golden", "grid", "x", "diagonals"]' in script
    assert "Â" not in html and "Ã" not in html
    assert "Â" not in script and "Ã" not in script
    assert "90&deg;" in html and "8&times;8" in html
    assert "\\u00b0" in script and "\\u00d7" in script
    assert ".color-wheel-pad::before" in css
    assert "inset: 4px" in css
    assert "inset 0 0 0 50px #7778" not in css
    for wheel in ["shadows", "midtones", "highlights"]:
        assert f'max="360" step="1" value="0" data-path="current.color_grading.{wheel}.hue"' in html
        assert f'max="100" step="1" value="0" data-path="current.color_grading.{wheel}.saturation"' in html
    assert "/color_grading\\..+\\.(hue|saturation)$/" in script
    assert "spatialBlurHorizontalFragmentMain" in shader
    assert "spatialBlurVerticalFragmentMain" in shader
    assert "let diffusion = (spatial.rgb - qualified)" in shader
    assert "chromaHighlightGuard" in shader
    assert "rgb *= exp2(vec3f(mono * amount))" in shader


def test_film_look_panel_exposes_cinema_controls_and_branch_matching() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")

    assert html.index('data-group="film-look"') > html.index('data-group="curves"')
    for label in ["Large Format Fine", "35mm Fine", "35mm Balanced", "35mm Fast", "16mm Fine"]:
        assert label in html
    for path in [
        "print_strength", "color_density", "grain_amount", "grain_shadow_response",
        "grain_midtone_response", "grain_highlight_response", "halation_amount",
        "bloom_amount", "image_softness", "microcontrast",
    ]:
        assert f'data-path="current.film_look.{path}"' in html
    assert 'id="film-look-match-hdr"' in html
    assert "state.adjustments.sdr.film_look = JSON.parse(JSON.stringify(state.adjustments.hdr.film_look))" in javascript
    assert "const topLevelEnabled = state.adjustments.sdr.film_look_section_enabled" in javascript
    assert "film_grain_seed: 271828" in javascript


def test_interactive_preview_scheduler_and_quality_preference_contract() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    scheduler = (FRONTEND / "preview-scheduler.js").read_text(encoding="utf-8")
    webgpu = (FRONTEND / "webgpu-preview.js").read_text(encoding="utf-8")
    css = (FRONTEND / "styles.css").read_text(encoding="utf-8")

    assert 'id="high-quality-preview" type="checkbox"' in html
    assert "High-res Preview" in html
    assert "Uses more GPU memory for a larger preview. Export quality is unchanged." in html
    assert html.index('id="overlay-toggle"') < html.index('id="high-quality-preview"') < html.index('id="overlay-popover"')
    assert ".toolbar-preview-toggle::after" in css
    assert "overflow-wrap: anywhere;" in css
    assert "white-space: normal;" in css
    assert 'id="scope-freshness"' in html and 'aria-live="polite"' in html
    assert '/static/preview-scheduler.js' in html
    assert "state.highQualityPreview = false" in javascript
    assert "preview-raw" in javascript
    assert 'tier: "interactive"' in scheduler
    assert "requestAnimationFrame" in scheduler
    assert "cancelIdleWork" in scheduler
    assert "rgba16f" in webgpu and "X-Pixel-Format" in webgpu
    assert "this.paramBuffer" in webgpu and "this.curveBuffer" in webgpu
    assert "this.curveSampleCache" in webgpu
    assert "Settled WebGPU authoring preview" in javascript


def test_phase_one_local_influence_and_latest_generation_contract() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    scheduler = (FRONTEND / "preview-scheduler.js").read_text(encoding="utf-8")
    webgpu = (FRONTEND / "webgpu-preview.js").read_text(encoding="utf-8")

    assert 'const influenceOnly = name === "mask_opacity"' in javascript
    assert "scheduleLocalPreview();" in javascript
    assert "bindLocalPreviewInteraction(input);" in javascript
    assert "active.controller?.abort();" in javascript
    assert "window.requestAnimationFrame(flushAuthoritativeLocalMaskDraft)" in javascript
    assert "signature !== JSON.stringify(selectedLocal()?.mask)" in javascript
    assert "local_adjustments: requestLocals" in javascript
    assert "local_adjustments: state.localPreviewDirty" in javascript
    assert 'conflict?.detail === "Stale scope request dropped."' in javascript
    assert "generation !== state.scopeGeneration" in javascript
    assert "Math.max(state.scopeGeneration + 1, generation ?? 0)" in javascript
    assert "preserveLocalDraft: state.localPreviewDirty" in javascript
    assert "const adjustmentsSnapshot = JSON.parse(JSON.stringify(state.adjustments));" in javascript
    assert "JSON.parse(JSON.stringify(localAdjustments()))" in javascript
    assert "recordStaleResult" in scheduler
    assert "gpuMaskIdentity(expression)" in webgpu
    assert "p[1] * p[13]" in webgpu
    assert "spatial_only=true${pathQuery}" in webgpu


def test_export_waits_for_pending_edits_and_formats_structured_errors() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")

    assert "const pendingApplied = await (state.editCommandQueue || Promise.resolve(true));" in javascript
    assert "const globalsApplied = pendingApplied === false ? false : await syncGlobalEditState();" in javascript
    assert 'responseErrorMessage(payload, "Export failed.")' in javascript
    assert 'responseErrorMessage(payload, "Could not open that folder.")' in javascript


def test_phase_two_gpu_luma_retained_mask_contract() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    webgpu = (FRONTEND / "webgpu-preview.js").read_text(encoding="utf-8")

    assert 'this.loadProxy(sessionId, "hdr", longEdge)' in webgpu
    assert 'entryPoint: "sceneLuminanceFragmentMain"' not in webgpu
    assert 'this.createMaskPipeline("sceneLuminanceFragmentMain")' in webgpu
    assert 'this.createMaskPipeline("lumaQualificationFragmentMain")' in webgpu
    assert 'this.createMaskPipeline("maskRefinementFragmentMain")' in webgpu
    assert "gpuLumaBaseIdentity(local.mask)" in webgpu
    assert "mask_feather: 0" in webgpu and "mask_opacity: 1" in webgpu
    assert "entry.baseTexture" in webgpu and "entry.horizontalTexture" in webgpu
    assert "entry.refinedTexture" in webgpu
    assert "sigmaX = 0.09 * amount * entry.width" in webgpu
    assert "sceneLuminanceTextures: this.sceneLuminance.size" in webgpu
    assert "cpuMaskRequest: false" in webgpu
    assert "textureSampleLevel(spatialTexture, spatialSampler, uv, 0.0)" in webgpu
    assert "params[129] = vignette.center_x" in webgpu
    assert "params[130] = vignette.center_y" in webgpu
    assert "params[131] = overlayMask ? 1 : 0" in webgpu
    assert "vec3f(p[133], p[134], p[135])" in webgpu
    assert "if (!isCurrent()) return null" in webgpu
    assert "gpuLumaMaskPreviewActive" in javascript
    assert "scheduleSpatialMaskPreview(selectedLocal())" in javascript
    assert "if (!gpuLumaMaskPreviewActive(local)) void queueAuthoritativeLocalMask(local)" in javascript
    assert "gpuResident: true" in javascript


def test_phase_four_retained_boolean_mask_graph_contract() -> None:
    webgpu = (FRONTEND / "webgpu-preview.js").read_text(encoding="utf-8")

    assert 'this.loadGpuMaskGraph(sessionId, local, longEdge, editRevision, isCurrent)' in webgpu
    assert 'this.createMaskPipeline("maskCombineFragmentMain")' in webgpu
    assert 'mask_path=${encodeURIComponent(maskPath)}' in webgpu
    assert 'spatial_only=true${pathQuery}' in webgpu
    assert 'kind: "gpu-mask-graph"' in webgpu
    assert "gpuMaskGraphPassCount" in webgpu
    assert "gpuMaskOperatorCode" in webgpu
    assert "left * (1.0 - right)" in webgpu
    assert "entry?.influenceIdentity === influenceIdentity" in webgpu
    assert "maskGraphs:" in webgpu


def test_viewer_exposes_icon_comparison_layouts_with_active_lane_scopes() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    css = (FRONTEND / "styles.css").read_text(encoding="utf-8")
    webgpu = (FRONTEND / "webgpu-preview.js").read_text(encoding="utf-8")

    for layout in ["single", "split-vertical", "split-horizontal", "side-horizontal", "side-vertical"]:
        assert f'data-compare-layout="{layout}"' in html
    assert html.count('class="tool-button compare-mode-button') == 5
    assert html.count('<svg viewBox="0 0 20 16"') == 5
    assert 'id="comparison-canvas"' in html
    assert 'id="comparison-image"' in html
    assert 'id="compare-button"' in html and "A/B" not in html
    assert 'id="compare-status"' not in html
    assert html.count('class="viewer-tool-divider"') == 3
    assert 'class="zoom-presets" role="group" aria-label="Zoom presets"' in html
    assert 'state.compareLayout = "single"' in javascript
    assert 'els.compareStatus' not in javascript
    assert 'refreshScopes(scopeLongEdge("settled"), { tier: "settled", lane })' in javascript
    assert "renderComparisonPreview(other, { force: true })" in javascript
    assert "state.gpuPreview.renderTo(" in javascript
    assert "async renderTo(canvas" in webgpu
    assert '.preview-stage[data-compare-layout="split-vertical"]' in css
    assert '.preview-stage[data-compare-layout="side-vertical"]' in css
    assert ".tool-button.compare-mode-button" in css
    assert "flex: 0 0 7ch;" in css
    assert "width: clamp(120px, 13vw, 190px);" in css
    assert ".viewer-tool-divider" in css
    assert ".zoom-presets" in css


def test_startup_is_ephemeral_and_all_grade_groups_begin_collapsed() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    proofing = (FRONTEND / "proofing-ui.js").read_text(encoding="utf-8")

    group_sections = re.findall(r'<section class="control-group[^"]*"[^>]*>', html)
    group_toggles = re.findall(r'<button class="group-toggle"[^>]*aria-expanded="([^"]+)"', html)
    assert group_sections and all("collapsed" in section for section in group_sections)
    assert len(group_toggles) == len(group_sections)
    assert set(group_toggles) == {"false"}
    assert "clearLegacyUiPreferences();" in javascript
    assert "localStorage.setItem" not in javascript
    assert "localStorage.getItem" not in javascript
    assert "localStorage" not in proofing


def test_local_adjustments_use_group_and_folder_hierarchy_with_immediate_tool_state() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    css = (FRONTEND / "styles.css").read_text(encoding="utf-8")

    assert 'class="control-group collapsed local-adjustments-group"' in html
    assert 'id="grade-mode-global"' not in html
    assert 'class="lane-folder-shell"' in html
    assert html.count('role="tablist"') >= 2
    assert 'class="local-lane-folder"' in html
    assert 'class="local-stack-surface"' in html
    assert 'aria-pressed="false" title="Create a linear-gradient adjustment"' in html
    assert "function updateLocalToolState()" in javascript
    assert "updateLocalToolState();\n    if (!state.editDocument) await refreshEditState();" in javascript
    assert 'if (!state.editDocument) await refreshEditState();' in javascript
    assert 'button.disabled = false;' in javascript
    assert 'els.localEraser.disabled = !brushSelected;' in javascript
    assert 'if (group === els.localAdjustmentGroup) setGradeMode(collapsed ? "global" : "local");' in javascript
    assert 'body[data-grade-mode="local"] #grade-workflow-panel > :not(.grade-header):not(.local-adjustments-group)' not in css
    assert 'if (response.status === 409)' in javascript
    assert 'response = await requestScope(state.editRevision);' in javascript
    assert ".lane-folder-shell > .lane-switch button.active" in css
    assert '.control-group[data-group="geometry"] #crop-open' in css


def test_frontend_assets_use_the_application_version_for_cache_busting() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")

    assert html.count("__HDR_FINISHER_ASSET_VERSION__") == 5
    assert '/static/app.js?v=__HDR_FINISHER_ASSET_VERSION__' in html
    assert '/static/styles.css?v=__HDR_FINISHER_ASSET_VERSION__' in html


def test_modified_status_uses_one_unabbreviated_term() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")

    assert "`${count} modified`" in javascript
    assert "`${count} mod`" not in javascript


def test_waveform_resolution_policy_reduces_payload_without_coarse_refresh_columns() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")

    assert "waveformRequestResolution(tier)" in javascript
    assert "columns: Math.round(clamp(width / 2, 320, 384))" in javascript
    assert 'bins: tier === "interactive" ? 64 : tier === "refinement" ? 160 : 128' in javascript
    assert 'if (tier === "interactive") return Math.min(requestedLongEdge, 512)' in javascript
    assert 'if (tier === "refinement") return Math.min(requestedLongEdge, 960)' in javascript
    assert "return Math.min(requestedLongEdge, 768)" in javascript
    assert "smoothedWaveformPopulation(row, columnIndex)" in javascript
    assert "return (left + 2 * center + right) * 0.25" in javascript
