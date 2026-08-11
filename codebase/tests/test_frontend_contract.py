from __future__ import annotations

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
    assert html.count("data-section-path=") == 9
    assert html.count("data-zone-hover=") == 6
    assert "Rolloff Start" in html
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


def test_tint_controls_follow_darktable_hue_mapping() -> None:
    css = (FRONTEND / "styles.css").read_text(encoding="utf-8")
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")

    assert ".primary-tint-hue .slider-track { background: linear-gradient(90deg, #53a7b1, #5368b5, #b84f9a, #e05273, #d3ad5b, #54a579, #53a7b1); }" in css
    assert "const DARKTABLE_TINT_HUE_STOPS" in javascript
    assert "function syncTintPurityVisuals()" in javascript
    assert "darktableTintHueColor(state.adjustments[lane].tint_hue)" in javascript


def test_equalizer_interactions_include_non_scrolling_wheel_and_keyboard_alternatives() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
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


def test_curve_drag_uses_live_preview_scheduler_and_broad_default_shape() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    curve_binding = javascript[javascript.index("function bindCurveEditor"):javascript.index("function drawCurveEditor")]

    assert "state.previewScheduler?.beginInteraction()" in curve_binding
    assert "debouncePreview(state.currentView)" in curve_binding
    assert "state.previewScheduler?.endInteraction()" in curve_binding
    assert "queueGpuDraft(state.currentView)" not in curve_binding
    assert "const verticalScale = curveVerticalAdjustmentScale(index, curve.length)" in curve_binding
    assert "return index === 0 || index === pointCount - 1 ? 0.18 : 0.35" in curve_binding
    assert "const verticalStep = step * Math.min(1, curveVerticalAdjustmentScale(index, curve.length) / 0.35)" in curve_binding
    assert "return [[0, 0], [0.5, 0.5], [1, 1]]" in javascript
    assert 'if (tier === "interactive") return Math.min(384, interactiveProxyLongEdge())' in javascript


def test_curve_panel_reset_is_visible_when_curves_are_modified() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")

    assert 'id="curve-reset" class="group-reset text-button"' in html
    assert 'els.curveReset.closest(".control-group")?.classList.toggle("modified", curvesModified)' in javascript


def test_scope_zoom_exposes_4000_and_10000_nit_computation_ranges() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")

    assert '<span>Scope zoom</span>' in html
    assert 'id="scope-zoom"' in html
    assert '<option value="4000">4K nits</option>' in html
    assert '<option value="10000">10K nits</option>' in html
    assert "max_nits=${maxNits}" in javascript
    assert "request.maxNits" in javascript


def test_expanded_controls_use_nested_tiles_and_export_copy_is_clean() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    css = (FRONTEND / "styles.css").read_text(encoding="utf-8")
    assert "Export..." in html
    assert "Export file" not in html
    assert "JPEG XL" not in html
    assert "not in this build" not in html
    assert "Chrome Proof" in html
    assert 'id="chrome-proof-target"' in html
    assert 'id="jpeg-gain-map-quality"' in html
    assert 'id="jpeg-gain-map-scale"' in html
    assert 'class="export-filename-field"' in html
    assert 'class="export-directory-field"' in html
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
    assert "showWatermark: state.proofWatermarkEnabled" in proofing
    assert 'els.scopeKindLabel.textContent = "HDR";' in proofing
    assert "AUTHORED" not in proofing
    assert "#chrome-proof-watermark" in css and "opacity: .5;" in css
    assert '.chrome-proof-status[data-state="stale"]' in css
    assert 'state.activeWorkflow !== "proof"' in proofing
    assert 'state.currentView !== "hdr"' in proofing
    assert "renderProofPreflight" in javascript
    assert "Chrome proof is stale" in javascript
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
    assert "sourceSettingsOpen: true" in javascript
    assert "metadataOpen: true" in javascript
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
    assert "const PARAM_COUNT = 73" in shader
    assert "hdrPrimaries(hdrToneEqualizer(sceneColor(hdrContrast(hdrBase(source)))))" in shader
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
    assert "let amount = p[3] / 50.0" in shader


def test_interactive_preview_scheduler_and_quality_preference_contract() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    scheduler = (FRONTEND / "preview-scheduler.js").read_text(encoding="utf-8")
    webgpu = (FRONTEND / "webgpu-preview.js").read_text(encoding="utf-8")

    assert 'id="high-quality-preview" type="checkbox"' in html
    assert "Uses more GPU memory for a larger preview. Export quality is unchanged." in html
    assert 'id="scope-freshness"' in html and 'aria-live="polite"' in html
    assert '/static/preview-scheduler.js' in html
    assert "HIGH_QUALITY_PREVIEW_KEY" in javascript
    assert "preview-raw" in javascript
    assert 'tier: "interactive"' in scheduler
    assert "requestAnimationFrame" in scheduler
    assert "cancelIdleWork" in scheduler
    assert "rgba16f" in webgpu and "X-Pixel-Format" in webgpu
    assert "this.paramBuffer" in webgpu and "this.curveBuffer" in webgpu
    assert "this.curveSampleCache" in webgpu
    assert "Settled WebGPU authoring preview" in javascript


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
    assert 'COMPARE_LAYOUT_KEY = "hdr-finisher:compare-layout:v1"' in javascript
    assert 'HDR + SDR · scopes: ${state.currentView.toUpperCase()}' in javascript
    assert 'refreshScopes(scopeLongEdge("settled"), { tier: "settled", lane })' in javascript
    assert "renderComparisonPreview(other, { force: true })" in javascript
    assert "state.gpuPreview.renderTo(" in javascript
    assert "async renderTo(canvas" in webgpu
    assert '.preview-stage[data-compare-layout="split-vertical"]' in css
    assert '.preview-stage[data-compare-layout="side-vertical"]' in css


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
