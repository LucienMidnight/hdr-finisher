from __future__ import annotations

import re
from pathlib import Path

from fastapi.testclient import TestClient

from hdr_finisher.main import app


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
DESKTOP = ROOT / "desktop"


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
        FRONTEND / "assets" / "fonts" / "ibm-plex-sans" / "IBMPlexSans-Variable.ttf",
        FRONTEND / "assets" / "fonts" / "ibm-plex-sans" / "OFL.txt",
        FRONTEND / "assets" / "fonts" / "ibm-plex-mono" / "IBMPlexMono-Regular.ttf",
        FRONTEND / "assets" / "fonts" / "ibm-plex-mono" / "IBMPlexMono-Medium.ttf",
        FRONTEND / "assets" / "fonts" / "ibm-plex-mono" / "IBMPlexMono-SemiBold.ttf",
        FRONTEND / "assets" / "fonts" / "ibm-plex-mono" / "IBMPlexMono-Bold.ttf",
        FRONTEND / "assets" / "fonts" / "ibm-plex-mono" / "OFL.txt",
        DESKTOP / "assets" / "icon.svg",
        DESKTOP / "assets" / "icon.png",
    ]
    assert all(asset.is_file() and asset.stat().st_size > 0 for asset in required_assets)

    client = TestClient(app)
    for asset_url in (
        favicon_url,
        "/static/assets/fonts/ibm-plex-sans/IBMPlexSans-Variable.ttf",
        "/static/assets/fonts/ibm-plex-mono/IBMPlexMono-Bold.ttf",
    ):
        response = client.get(asset_url)
        assert response.status_code == 200
        assert response.content

    assert css.count('font-family: "IBM Plex Sans";') >= 1
    assert css.count('font-family: "IBM Plex Mono";') == 4
    for weight in (400, 500, 600, 700):
        assert f"font-weight: {weight};" in css
    assert "Inter" not in launcher
    assert '"icon": "assets/icon.png"' in desktop_package


def test_file_picker_advertises_avif_round_trip_input() -> None:
    markup = (FRONTEND / "index.html").read_text(encoding="utf-8")
    assert 'accept=".exr,.tif,.tiff,.hdr,.pfm,.heic,.heif,.avif,.jxl,.png,.jpg,.jpeg,.dng,.arw,.cr2,.cr3,.nef,.nrw,.raf,.rw2,.orf,.ori,.pef,.srw"' in markup


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
    assert html.count("data-section-path=") == 14
    css = (FRONTEND / "styles.css").read_text(encoding="utf-8")
    assert "--bypass-icon-shape:" in css
    assert "--bypass-icon-visible: var(--accent)" in css
    assert "--bypass-icon-hidden: var(--quiet)" in css
    assert 'id="local-bypass"' not in html
    assert "data-local-bypass-id" in script
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
    assert "Compress channels toward white" in html
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


def test_panel_titles_and_scope_description_follow_shared_design_contract() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    css = (FRONTEND / "styles.css").read_text(encoding="utf-8")
    app = (FRONTEND / "app.js").read_text(encoding="utf-8")

    assert '<h1 class="panel-title">Metadata</h1>' in html
    assert 'id="preview-window-title" class="panel-title" tabindex="0" aria-describedby="viewer-branch-note"' in html
    assert 'id="viewer-branch-note" class="title-tooltip preview-title-tooltip" role="tooltip"' in html
    assert "Switch renditions in the Control Panel or use the layout buttons to view them side-by-side." in html
    assert 'class="preview-metadata-panel"' not in html
    assert html.count('<h1 class="panel-title">Control Panel</h1>') == 4
    assert '<h1 class="panel-title dock-panel-title">Scopes</h1>' in html
    assert 'id="scope-title" class="visually-hidden"' in html
    assert 'class="scope-header-controls field-inline"' in html
    assert '<option value="technical">Technical</option>' in html
    assert 'class="dock-tabs"' not in html
    assert 'id="scope-note" class="visually-hidden"' in html
    assert 'id="histogram" width="720" height="220" aria-label="Image scope" aria-describedby="scope-note"' in html
    assert "compactScopeGuideLabel(scope, guide)" in app
    assert "RW means active HDR reference white" in app
    assert "--panel-title-font-family:" in css
    assert "--panel-title-font-size:" in css
    assert "--group-title-font-family: var(--sans)" in css
    assert "--group-title-font-size: 12px" in css
    assert "--group-title-font-weight: 600" in css
    assert ".disclosure-trigger > span:first-child" in css
    assert "transition-delay: 2s" in css
    assert "justify-content: flex-start" in css


def test_default_shortcuts_are_conservative_and_warn_about_macos_system_bindings() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    app = (FRONTEND / "application-shell.js").read_text(encoding="utf-8")

    assert '"edit.redo": "Mod+Shift+Z"' in app
    assert '"file.exportStandard": "Mod+E"' in app
    assert '"view.scopeRegion": "Shift+R"' in app
    assert '"view.analysis": "S"' not in app
    assert '"file.export": "X"' not in app
    assert '["Mod+Shift+3", "a full-screen screenshot"]' in app
    assert '["Mod+Shift+4", "a selection screenshot"]' in app
    assert '["Mod+Shift+5", "Screenshot and screen recording options"]' in app
    assert "is normally used by macOS" in app
    assert "if (!exact) return undefined;" in app
    assert "Only standard application commands are assigned by default." in html


def test_rendition_descriptions_are_delayed_title_tooltips() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    css = (FRONTEND / "styles.css").read_text(encoding="utf-8")

    assert 'id="lane-note"' not in html
    assert "laneNote:" not in javascript
    assert 'aria-describedby="hdr-controls-tooltip"' in html
    assert 'aria-describedby="sdr-controls-tooltip"' in html
    assert 'id="hdr-controls-tooltip" class="title-tooltip lane-title-tooltip" role="tooltip"' in html
    assert 'id="sdr-controls-tooltip" class="title-tooltip lane-title-tooltip" role="tooltip"' in html
    assert ".lane-switch button:hover .lane-title-tooltip" in css
    assert "transition-delay: 2s" in css


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
    assert "toneEqualizerNodeIndexAtPointer(event.clientX, event.clientY, rect, lane)" in equalizer_binding
    assert "toneEqualizerCurveHitAtPointer(event.clientX, event.clientY, rect, lane)" in equalizer_binding
    assert 'canvas.addEventListener("contextmenu"' in equalizer_binding
    assert "removeToneEqualizerNode(bandIndex, lane)" in equalizer_binding
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
    assert javascript.count("debouncePreview(lane);") >= 5


def test_equalizer_chart_drag_syncs_the_selected_band_range_visual() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    sync_controls = javascript[
        javascript.index("function syncToneEqualizerControls"):
        javascript.index("function drawToneEqualizerEditor")
    ]

    assert "ui.bandValue.value = String(value);" in sync_controls
    assert "updateRangeVisual(ui.bandValue);" in sync_controls


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
    assert 'return Math.min(profile.interactiveEdge, interactiveProxyLongEdge())' in javascript


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


def test_shift_fine_adjustment_is_shared_by_ranges_and_graphs() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")

    assert "const FINE_ADJUSTMENT_SCALE = 0.1" in javascript
    assert 'control.dataset.instrumentStep = String(declaredStep)' in javascript
    assert '"Hold Shift while dragging or using arrow keys for 10× finer adjustment."' in javascript
    assert javascript.count("createPrecisionPointerDelta(startEvent)") >= 2
    assert "Control wheels and Stream Decks" not in html
    assert "Any slider can be assigned Increase, Decrease, and Reset actions." in html
    assert "Shift or Alt/Option makes an adjustment 10× finer." in html


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


def test_sdr_exposure_bands_are_independent_and_offer_one_shot_hdr_match() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")

    assert 'data-group="sdr-equalizer"' in html
    assert 'data-section-path="sdr.tone_equalizer_section_enabled"' in html
    assert 'id="sdr-tone-equalizer-editor"' in html
    assert 'id="sdr-match-hdr-bands"' in html
    assert "Copies once; SDR remains independent." in html
    assert 'state.adjustments.sdr.tone_equalizer_nodes = currentToneEqualizerNodes("hdr")' in javascript
    assert 'state.adjustments[lane].tone_equalizer_nodes = normalizeToneEqualizerNodes(nodes)' in javascript


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
    overlay_commit = javascript[javascript.index("function commitAdjustmentValue") : javascript.index("function syncControlsFromState")]
    assert "markGlobalEditDirty();" in overlay_commit
    assert 'if (path === "shared.overlay_mode") refreshOverlayAndScopesImmediately();' in overlay_commit
    assert 'if (state.adjustments.shared.overlay_mode === "off") clearPreviewOverlay();' in javascript


def test_expanded_controls_use_nested_tiles_and_export_copy_is_clean() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    css = (FRONTEND / "styles.css").read_text(encoding="utf-8")
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    assert "Export..." in html
    assert "Export file" not in html
    assert "JPEG XL HDR" in html
    assert 'id="export-format"' in html
    assert 'id="export-preset"' in html
    assert "JPEG XL (SDR)" in html
    assert "not in this build" not in html
    assert "Chromium Proof" in html
    assert 'data-proof-preview="delivered"' in html
    assert "Browser delivery" in html
    assert "Reference target" in html
    assert '<option value="jpegxl_hdr">JPEG XL HDR</option>' in html
    assert '["avif_gain_map", "jpeg_ultrahdr", "jpegxl_hdr"]' in javascript
    assert 'id="chrome-proof-target"' in html
    assert 'id="jpeg-gain-map-quality"' in html
    assert 'id="jpeg-gain-map-scale"' in html
    assert 'id="jpegxl-precision"' in html
    assert 'id="avif-bit-depth"' in html
    assert 'id="avif-chroma-subsampling"' in html
    assert 'id="avif-gain-map-chroma-subsampling"' not in html
    assert 'id="avif-gain-map-quality"' in html
    assert 'id="avif-gain-map-scale"' in html
    assert 'id="jpeg-ultrahdr-chroma-subsampling"' in html
    assert 'id="sdr-png-bit-depth"' in html
    assert 'id="export-dithering"' in html
    assert 'id="export-metadata-policy"' in html
    assert '<option value="uint12" selected>12-bit integer</option>' in html
    assert '<option value="float32">32-bit float</option>' in html
    assert '<option value="422">4:2:2</option>' in html
    assert '<option value="444">4:4:4</option>' in html
    assert "Full color resolution" not in html
    assert "Reduced color resolution" not in html
    assert "Small color detail" not in html
    assert "More color detail" not in html
    assert "High-precision interchange" not in html
    assert 'id="export-format-note" class="helper visually-hidden"' in html
    assert 'id="avif-gain-map-chroma-note"' not in html
    assert "const exportOptionTooltips =" in javascript
    assert "option.title = descriptions[option.value]" in javascript
    assert 'value="uint8"' not in html
    assert "jpegxl_precision: els.jpegxlPrecision.value" in javascript
    assert "avif_bit_depth: Number(els.avifBitDepth.value)" in javascript
    assert "avif_chroma_subsampling: els.avifChromaSubsampling.value" in javascript
    assert 'avif_gain_map_chroma_subsampling: "444"' in javascript
    assert "avifGainMapChromaSubsampling" not in javascript
    assert 'avifGainMapScale: "half"' in javascript
    assert "const exportPresetMappings" in javascript
    assert 'web_default: { quality: 85' in javascript
    assert 'maximum_fidelity: { quality: 100' in javascript
    assert "function markExportPresetCustom()" in javascript
    assert " · Web Default`" in javascript
    assert "sdr_png_bit_depth: Number(els.sdrPngBitDepth.value)" in javascript
    assert "document.documentElement.style.setProperty(\"--grade-w\"" in javascript
    assert "els.appShell.style.setProperty(cssVar" not in javascript
    assert 'sdr_jpegxl: "jpegxl_export"' in javascript
    assert 'jpegUltrahdrChromaSubsampling' in javascript
    assert 'jpegChromaSubsampling' in javascript
    assert 'class="export-filename-field"' in html
    assert 'class="export-directory-field"' in html
    assert 'id="directory-browser"' in html
    assert 'id="directory-browser-select"' in html
    assert 'id="directory-browser-filename"' in html
    assert '<strong>Recent</strong><ul id="directory-browser-recents"></ul>' in html
    assert '<strong>Pinned</strong><ul id="directory-browser-pinned"></ul>' in html
    assert '<strong>Locations</strong><ul id="directory-browser-locations"></ul>' in html
    assert "payload.recents || []" in javascript
    assert "payload.pinned || []" in javascript
    assert "payload.locations || []" in javascript
    assert "handleMediaBrowserListKeydown" in javascript
    for key, column in (("name", "Name"), ("size", "Size"), ("kind", "Kind"), ("date", "Date Added")):
        assert f'data-media-browser-sort="{key}">{column}</button>' in html
        assert f'data-media-browser-resize="{key}"' in html
    assert "sortMediaBrowserBy" in javascript
    assert "beginMediaBrowserColumnResize" in javascript
    assert 'aria-label="Resize preview panel"' in html
    assert "beginMediaBrowserPreviewResize" in javascript
    assert 'els.directoryBrowserPreview.removeAttribute("src")' in javascript
    assert "const request = new AbortController()" in javascript
    assert "state.mediaPreviewRequest !== request" in javascript
    assert "entry.thumbnail_key || \"\"" in javascript
    assert "Loading preview…" in javascript
    assert 'detail?.code === "interpretation_required"' in javascript
    assert 'dataset.previewState = "interpretation-required"' in javascript
    assert 'data-preview-state="interpretation-required"' in css
    assert "Preview withheld to avoid misleading color" in javascript
    assert "private, no-cache" in (ROOT / "backend" / "hdr_finisher" / "main.py").read_text(encoding="utf-8")
    assert 'fetch("/api/media-browser/recents"' in javascript
    assert "await recordSuccessfulMediaImport(selection.path)" in javascript
    assert 'await chooseProjectPath(\n      "project_open"' in javascript
    assert 'await chooseProjectPath(\n        "project_save"' in javascript
    assert 'desktop.grantProjectPath(requestedPath' in javascript
    assert 'mode === "project_save" && selection.exists' in javascript
    assert 'addEventListener("click", () => openProjectFromPath())' in javascript
    assert 'window.alert(responseErrorMessage(payload, "The project could not be opened."))' in javascript
    assert 'grantProjectPath: (filePath, intent)' in (DESKTOP / "preload.js").read_text(encoding="utf-8")
    assert 'id="directory-browser-kicker"' not in html
    source_summary = html.split('<section class="source-summary">', 1)[1].split("</section>", 1)[0]
    assert source_summary.index('id="badge"') < source_summary.index('id="experimental-dng-note"')
    assert "DNG import is experimental. Some incompatible DNG files may be rejected." in source_summary
    assert "function isDngImportCandidate(candidate)" in javascript
    assert "renderExperimentalDngNote(file);" in javascript
    assert "renderExperimentalDngNote(entry);" in javascript
    assert "renderExperimentalDngNote(selection);" in javascript
    assert '{ role: "reload" }' not in (DESKTOP / "main.js").read_text(encoding="utf-8")
    assert 'mainWindow.on("query-session-end"' in (DESKTOP / "main.js").read_text(encoding="utf-8")
    assert "/api/media-browser" in (FRONTEND / "app.js").read_text(encoding="utf-8")
    assert ".control-group-body" in css
    assert "border-top: 2px solid" in css
    assert ".jpeg-advanced-settings" in css
    assert ".export-section-title" in css
    assert 'id="jpeg-advanced-settings" class="jpeg-advanced-settings">' in html
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
    assert 'class="source-file-label">File Name</p>' in html
    assert 'id="session-name-tooltip"' in html
    assert 'id="copy-source-path"' in html
    assert 'id="source-confidence"' not in html
    assert 'id="file-summary"' not in html
    assert 'id="interpretation-summary"' not in html
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
    assert html.count('<h1 class="panel-title">Control Panel</h1>') == 4
    assert "HDR Controls" in html
    assert "SDR Controls" in html
    assert 'id="preview-window-title" class="panel-title"' in html
    assert 'class="preview-metadata-panel"' not in html
    assert 'id="viewer-lane-label"' not in html
    assert ".preview-title-wrap:hover .preview-title-tooltip" in css
    assert 'id="preview-status-copy"' in html
    assert '<progress id="preview-progress"' in html
    assert 'id="cancel-import"' in html
    assert 'els.cancelImport?.addEventListener("click", cancelActiveImport);' in javascript
    assert "Import cancelled. Current image kept." in javascript
    assert 'id="override-warning"' not in html
    assert 'id="apply-interpretation" class="button-primary"' in html
    assert "Source Interpretation" in html
    assert "<span>Details</span>" not in html
    assert "Auto detection found an ambiguous source interpretation." in javascript
    assert "Manual override is recommended before trusting export decisions." not in javascript
    assert "#source-settings-note.warning::before" in css
    assert "var(--attention)" in css
    assert ".source-filename-wrap.has-overflow:hover .source-filename-tooltip" in css
    assert "await writeClipboardText(sourcePath)" in javascript
    assert "if (desktop?.writeClipboardText) return desktop.writeClipboardText(value);" in javascript
    assert 'class="probe-strip"' not in html
    assert 'id="probe-readout"' not in html
    assert "Move over the image" not in html
    assert "sourceSettingsOpen: false" in javascript
    assert "metadataOpen: false" in javascript
    assert '--group-chevron-shape: url("assets/icons/tabler/chevron-right.svg")' in css
    assert "Segoe Fluent Icons" not in css
    for icon in (
        "arrow-down.svg",
        "arrow-up.svg",
        "brightness-half.svg",
        "brush.svg",
        "copy.svg",
        "crop.svg",
        "eraser.svg",
        "eye.svg",
        "folder.svg",
        "pencil.svg",
        "rotate-clockwise.svg",
        "square-half.svg",
    ):
        assert f'url("assets/icons/tabler/{icon}")' in css
    assert '.directory-browser-entry .directory-browser-entry-name::before' in css
    assert ".media-browser-list-header" in css
    assert ".media-browser-preview-image-frame" in css
    assert "aspect-ratio: 1;" not in css.split(".media-browser-preview img", 1)[1].split("}", 1)[0]
    assert 'height: clamp(300px, 58vh, 520px);' in css
    assert 'scrollbar-gutter: stable;' in css
    assert '.media-browser-sidebar {' in css
    assert 'overflow-y: auto;' in css
    assert 'content: "▸"' not in css
    assert ".disclosure-trigger::before" in css
    assert '.disclosure-trigger[aria-expanded="true"]::before' in css
    assert "dockH: [240, 340]" in javascript
    assert "dockH: 252" in javascript
    assert "updateProbeReadout" not in javascript
    assert ".preview-progress" in css
    assert "Processing complete. Decoding preview..." in javascript
    assert "{ showProgress: false }" in javascript
    assert "renderPreviewForLane(lane, true, longEdge, { showProgress: false })" in javascript
    assert "min-width: 0" in css
    assert "height: 100vh" in css
    assert 'const COMPACT_WORKSPACE_QUERY = "(max-width: 1499px)"' in javascript
    assert 'id="viewer-options-toggle"' in html
    assert 'aria-controls="viewer-options-popover"' in html
    assert 'aria-haspopup="true">Viewer options</button>' in html
    assert "compact-workspace" in css
    assert "source-overlay-open" in css


def test_webgpu_pipeline_preserves_cpu_section_order_and_lane_specific_exposure_bands() -> None:
    shader = (FRONTEND / "webgpu-preview.js").read_text(encoding="utf-8")
    assert "const PARAM_COUNT = 140" in shader
    assert "hdrPrimaries(toneEqualizer(sceneColor(hdrPeakFit(hdrSoftCeiling(hdrContrast(hdrBase(source)))))))" in shader
    assert "sdrReferenceColor(sdrContrast(toneEqualizer(highlightRecovery(rgb))))" in shader
    assert "toneMap(sceneColor(rgb))" in shader
    assert "sdrPrimaries(sdrContrast(toneEqualizer(highlightRecovery(toneMap(sceneColor(rgb))))))" in shader
    assert "let y = max(select(lumaSrgb(input), lumaAces(input), p[0] > 0.5), 0.0)" in shader
    assert "retoneMapSdrReference(rgb)" in shader
    assert "let displayReferenceWhite = 100.0 / 203.0" in shader
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
    assert "let signal = select(y, max(channelPeak, 0.0), p[110] > 0.5)" in shader
    assert "(mappedRgb - vec3f(targetValue)) * (1.0 - progress)" in shader
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
    assert 'id="crop-tool-toggle" class="geometry-tool-crop"' in html
    assert 'id="rotate-tool-toggle" class="geometry-tool-rotate"' in html
    assert 'id="crop-tool-settings" class="geometry-tool-settings hidden"' in html
    assert 'id="rotate-tool-settings" class="geometry-tool-settings hidden"' in html
    assert 'id="straighten-grid-overlay" class="straighten-grid-overlay hidden"' in html
    assert html.index('id="crop-tool-toggle"') > html.index('data-group="geometry"')
    assert "updateStraightenInteractive" in script and "clearInteractiveStraightenPreview" in script
    assert "showStraightenGrid" in script and "hideStraightenGrid" in script
    assert "cropEditBaseCrop" in script
    assert "cropAuthoringFrameAspect" in script
    assert 'data-group="color-grading"' in html
    assert 'id="color-grading-match-hdr"' in html
    assert 'data-group="vignette"' in html
    assert 'id="vignette-center-handle"' in html
    assert "vignetteCenterGesture" in script
    assert "grabOffsetX" in script and "grabOffsetY" in script
    assert "globalEditGeneration" in script and "preserveNewerGlobalEdit" in script
    assert "globalEditSyncPending" in script
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
    assert 'id="film-reference-model"' not in html
    for label in ["Large Format Fine", "35mm Fine", "35mm Balanced", "35mm Fast", "16mm Fine"]:
        assert label in javascript
    assert "builtInGroupPresets" in javascript
    assert "if (!preset.builtIn)" in javascript
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


def test_rgb_primary_purity_slider_zeroes_align_with_hue_centers() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")

    for lane in ["hdr", "sdr"]:
        for primary in ["red", "green", "blue"]:
            assert f'id="{lane}-{primary}-purity" type="range" min="-95" max="95"' in html


def test_interactive_preview_scheduler_and_quality_preference_contract() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    scheduler = (FRONTEND / "preview-scheduler.js").read_text(encoding="utf-8")
    webgpu = (FRONTEND / "webgpu-preview.js").read_text(encoding="utf-8")
    css = (FRONTEND / "styles.css").read_text(encoding="utf-8")

    assert 'id="preview-resolution" aria-label="Preview resolution"' in html
    for value, label in [("1024", "1K"), ("2048", "2K"), ("4096", "4K"), ("full", "Full")]:
        assert f'<option value="{value}">{label}</option>' in html
    assert "Sets the maximum preview width and height." in html
    assert html.index('id="overlay-toggle"') < html.index('id="preview-resolution"') < html.index('id="overlay-popover"')
    assert ".toolbar-preview-resolution::after" in css
    assert "overflow-wrap: anywhere;" in css
    assert "white-space: normal;" in css
    assert 'id="scope-freshness"' in html and 'aria-live="polite"' in html
    assert '/static/preview-scheduler.js' in html
    assert 'const DEFAULT_PREVIEW_RESOLUTION = "1024"' in javascript
    assert "function previewTargetLongEdge" in javascript
    assert "function fullPreviewSafety" in javascript
    assert "FULL_PREVIEW_GPU_BUDGET_BYTES" in javascript
    assert "preview-raw" in javascript
    assert 'tier: "interactive"' in scheduler
    assert "requestAnimationFrame" in scheduler
    assert "cancelIdleWork" in scheduler
    assert "rgba16f" in webgpu and "X-Pixel-Format" in webgpu
    assert "this.paramBuffer" in webgpu and "this.curveBuffer" in webgpu
    assert "this.curveSampleCache" in webgpu
    assert "Settled WebGPU authoring preview" in javascript


def test_electron_preview_correctness_contract() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    main = (DESKTOP / "main.js").read_text(encoding="utf-8")
    preload = (DESKTOP / "preload.js").read_text(encoding="utf-8")

    assert 'id="preview-quality-status"' in html and 'aria-live="polite"' in html
    assert 'document.addEventListener("drop"' in javascript
    assert 'document.addEventListener(eventName' in javascript
    assert 'desktop.resolveDroppedFile(file)' in javascript
    assert "Windows shell integrations and catalog applications" in javascript
    assert "await uploadFile(file);" in javascript
    assert 'const nativeOverwriteApproved = process.platform === "win32" || process.platform === "darwin"' in main
    assert "Boolean(nativeOverwrite)" in javascript
    assert 'id="rotate-apply"' in html and 'id="rotate-cancel"' in html
    assert "function gpuPreviewEligible()" in javascript
    gpu_eligibility = javascript[
        javascript.index("function gpuPreviewEligible()"):
        javascript.index("function acceptPresentation")
    ]
    assert "defaultGeometry" not in gpu_eligibility
    assert "geometrySignature" not in gpu_eligibility
    assert "cached.geometrySignature === geometrySignature()" in javascript
    assert "state.comparisonRenderedGeometry === signature" in javascript
    assert 'renderGpuDraft(lane, { longEdge: targetLongEdge, tier: "refinement" })' in javascript
    assert 'renderPreviewForLane(lane, true, targetLongEdge, { showProgress: false })' in javascript
    assert "function closeRotateMode(commit)" in javascript
    assert "function useHdrSafeGeometryDraft()" in javascript
    assert 'transient_adjustments: true' in javascript
    assert 'blob.type.startsWith("image/avif")' in javascript
    assert "state.globalEditDirty && state.acceptedPresentation?.geometrySignature !== geometrySignature()" in javascript
    assert "if (error?.recoverable)" in javascript
    clear_straighten = javascript[
        javascript.index("function clearInteractiveStraightenPreview()"):
        javascript.index("function rotateGeometry(delta)")
    ]
    assert "if (state.rotateDraftGeometry)" in clear_straighten
    assert "renderRotateDraftTransform();" in clear_straighten
    assert 'preview?.style.setProperty("--interactive-straighten-angle", `${-straightenDelta}deg`)' in javascript
    assert 'label: "Rendering Mode"' in main
    assert all(label in main for label in ("Auto (Recommended)", "GPU Preferred", "CPU Compatibility"))
    assert "const activeBackend = backend;" in main
    assert 'activeBackend.authoringSecret' in main
    assert 'details.requestHeaders["X-HDR-Finisher-Token"] = backend.authoringSecret' not in main
    assert 'setRenderingMode: (mode)' in preload
    assert 'writeClipboardText: (value)' in preload
    assert 'resolveDroppedFile: async (file)' in preload
    assert 'webUtils.getPathForFile(file)' in preload
    assert 'await desktop.resolveDroppedFile(file)' in javascript
    assert 'desktop.resolveDroppedFiles(files)' not in javascript
    assert 'handle("desktop:write-clipboard-text"' in main
    assert "clipboard.writeText(value)" in main
    assert "var highlightMask = smoothRange" in (FRONTEND / "webgpu-preview.js").read_text(encoding="utf-8")


def test_preview_viewport_keeps_a_stable_aspect_across_interactive_and_settled_tiers() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    clear_preview_cache = javascript[
        javascript.index("function clearPreviewCache()"):
        javascript.index("function cacheReady")
    ]
    zoom_geometry = javascript[
        javascript.index("function applyZoomGeometry()"):
        javascript.index("function updateZoomReadout()")
    ]

    assert "state.zoomReferenceFrame = null" in clear_preview_cache
    assert "aspect: renderedAspect" in zoom_geometry
    assert "state.zoomReferenceFrame.geometrySignature === geometrySignature" in zoom_geometry
    assert "? state.zoomReferenceFrame.aspect" in zoom_geometry
    assert "const referenceAspect = renderedAspect;" not in zoom_geometry


def test_export_format_dropdown_does_not_claim_a_provisional_or_alternative_ranking() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")

    assert "Mainstream alternative" not in html
    assert "Provisional default" not in html
    assert '<option value="avif_gain_map">AVIF + gain map</option>' in html
    assert '<option value="jpeg_ultrahdr" selected>JPEG Ultra HDR</option>' in html
    assert 'avif_gain_map: "avif_gain_map_encoder"' in javascript
    assert 'jpeg_ultrahdr: "ultrahdr_encoder"' in javascript


def test_manual_source_interpretation_status_contract() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")

    assert 'session.source.interpretation_mode === "manual"' in javascript
    assert "Manual source interpretation applied: ${colorSpace} primaries + ${transfer} transfer + ${reference}." in javascript
    assert 'id="interpretation-linear-reference"' in html
    assert 'value="diffuse_white_1_0">1.0 = diffuse white (Affinity)' in html
    assert "els.sourceSettingsNote.textContent = sourceInterpretationStatus(session);" in javascript
    assert "if (session.source.interpretation_mode === \"manual\") return sourceInterpretationStatus(session);" in javascript


def test_developed_dng_distinguishes_source_profile_from_working_space() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    assert 'if (isDevelopedDngSession(session)) return "auto";' in javascript
    assert "Camera-native LinearRaw developed through the embedded DNG profile into the ACEScg working space." in javascript
    assert 'return "Auto: camera-native DNG profile → ACEScg working";' in javascript
    assert "els.interpretationMode.disabled = developedDng;" in javascript


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

    assert 'this.loadProxy(sessionId, "hdr", longEdge, geometrySignature, editRevision)' in webgpu
    assert "geometry_signature=${encodeURIComponent(geometrySignature)}" in webgpu
    assert "acceptedGeometry !== geometrySignature" in webgpu
    assert "${sessionId}:${longEdge}:${geometrySignature}" in webgpu
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

    assert 'this.loadGpuMaskGraph(sessionId, local, longEdge, editRevision, geometrySignature, isCurrent)' in webgpu
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
    assert html.count('class="viewer-tool-divider"') == 4
    assert 'class="zoom-presets" role="group" aria-label="Zoom presets"' in html
    assert 'state.compareLayout = "single"' in javascript
    assert 'els.compareStatus' not in javascript
    assert 'refreshScopes(scopeLongEdge("settled"), { tier: "settled", lane })' in javascript
    switch_lane = javascript[
        javascript.index("async function switchLane(lane)"):
        javascript.index("function renderLaneChrome()")
    ]
    assert switch_lane.index("await previewTask;") < switch_lane.index('refreshScopes(scopeLongEdge("settled")')
    assert "state.acceptedPresentation?.lane === lane" in javascript
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
    assert ".geometry-tool-strip" in css


def test_path_mask_exposes_draft_bezier_and_independent_feather_contract() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    css = (FRONTEND / "styles.css").read_text(encoding="utf-8")

    assert 'id="local-mask-overlay" class="local-mask-overlay" tabindex="0"' in html
    for contract in [
        'feather_mode: "outer_boundary"',
        'feather_nodes: []',
        "function finishLocalPathDraft()",
        "function splitPathSegment(nodes, segmentIndex, t = 0.5)",
        "function materializeFeatherNodes(leaf)",
        "function validFeatherGeometry(innerNodes, outerNodes)",
        "function handlePathCanvasKeydown(event)",
        "function hideLocalMaskOverlayForGradePreview()",
        "state.localPathCreatePendingId === local.id",
        'state.localPathEditMode === "feather" || !state.localPathDraft',
    ]:
        assert contract in javascript
    assert '.path-edit-mode' in css
    assert '.path-node-mode' in css
    assert 'matchMedia("(prefers-reduced-motion: reduce)")' in javascript


def test_local_mask_authoring_uses_bidirectional_authoritative_geometry_mapping() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")

    assert 'fetch(`/api/session/${state.session.session_id}/geometry-map`' in javascript
    assert "affinePoint(coordinateMap.outputToSource, point)" in javascript
    assert "affinePoint(coordinateMap.sourceToOutput, point)" in javascript
    assert "applySourceGeometryCanvasTransform(context, imageRect, rect, coordinateMap.sourceToOutput)" in javascript
    assert 'if (state.gradeMode === "local") void ensureGeometryCoordinateMap();' in javascript
    assert 'renderPhase: "mask"' in javascript
    assert 'renderPhase: "gizmo"' in javascript
    assert 'gesture?.type === "luminance_sample"' in javascript


def test_frontend_assets_use_the_application_version_for_cache_busting() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")

    assert html.count("__HDR_FINISHER_ASSET_VERSION__") == 6
    assert '/static/app.js?v=__HDR_FINISHER_ASSET_VERSION__' in html
    assert '/static/styles.css?v=__HDR_FINISHER_ASSET_VERSION__' in html


def test_manual_interpretation_action_reveals_the_source_rail() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")

    reveal_rail = javascript[javascript.index("function revealSourceRail()") : javascript.index("function closeCompactSourceRail")]
    open_manual = javascript[javascript.index("function openManualInterpretation()") : javascript.index("function renderInterpretationGate")]

    assert "state.compactSourceOpen = true" in reveal_rail
    assert "state.wideSourceCollapsed = false" in reveal_rail
    assert "applyResponsiveWorkspaceState();" in reveal_rail
    assert "revealSourceRail();" in open_manual
    assert 'els.interpretationMode.value = "manual";' in open_manual
    assert "els.interpretationColorSpace.focus();" in open_manual


def test_export_action_remains_in_normal_scroll_flow() -> None:
    css = (FRONTEND / "styles.css").read_text(encoding="utf-8")

    sheet_actions = css[css.index(".export-sheet .sheet-actions {") : css.index(".export-sheet .sheet-actions .button-primary")]
    assert "position: sticky" not in sheet_actions
    assert "bottom: 0" not in sheet_actions
    assert "display: grid" in sheet_actions


def test_modified_status_uses_only_the_group_dot_without_text_counts() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    css = (FRONTEND / "styles.css").read_text(encoding="utf-8")

    assert "`${count} Mod`" not in javascript
    assert 'curvesModified ? "Mod" : ""' not in javascript
    assert 'els.gradeModifiedSummary.textContent = ""' in javascript
    assert 'output.textContent = ""' in javascript
    assert ".group-toggle span {" in css
    assert ".control-group.modified .group-toggle span::after" in css


def test_adjustment_group_presets_are_scoped_persistent_and_available_in_headers() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    css = (FRONTEND / "styles.css").read_text(encoding="utf-8")
    main = (DESKTOP / "main.js").read_text(encoding="utf-8")
    preload = (DESKTOP / "preload.js").read_text(encoding="utf-8")

    assert 'id="group-preset-dialog"' in html
    assert 'id="group-preset-list"' in html
    assert 'id="group-preset-name"' in html
    assert 'id="film-reference-model"' not in html
    assert 'button.textContent = "Preset"' in javascript
    assert "function groupPresetPaths(groupId)" in javascript
    assert "function builtInGroupPresets(context)" in javascript
    assert 'kind.textContent = "Built-in"' in javascript
    assert "if (!preset.builtIn)" in javascript
    assert '"35mm_fast": "35mm Fast"' in javascript
    assert "function applyFilmLookPreset" not in javascript
    assert "context.paths.forEach((path)" in javascript
    assert "sectionPathForGroup" not in javascript[javascript.index("function applyGroupPreset"):javascript.index("function laneCurvesModified")]
    assert ".group-preset { order: 2;" in css
    assert ".control-group-header:has(.group-preset) {" in css
    assert "grid-template-columns: minmax(0, 1fr) 54px 44px 26px;" in css
    assert ".group-preset { grid-column: 2;" in css
    assert ".group-reset { grid-column: 3;" in css
    assert ".section-bypass { grid-column: 4;" in css
    assert 'path.join(library, "Grading")' in main
    assert 'schemaVersion: 1, ...preset' in main
    assert 'listGradingPresets: (groupId)' in preload
    assert 'saveGradingPreset: (preset)' in preload
    assert 'deleteGradingPreset: (presetId)' in preload


def test_waveform_detail_profiles_raise_default_quality_with_performance_fallback() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")

    assert "waveformRequestResolution(tier)" in javascript
    assert 'const DEFAULT_SCOPE_QUALITY = "detailed"' in javascript
    assert 'id="scope-detail"' in html
    assert '<option value="performance">Performance</option>' in html
    assert '<option value="detailed" selected>Detailed</option>' in html
    assert '<option value="reference">Reference</option>' in html
    assert "columns: Math.round(clamp(width / 2, 320, 384))" in javascript
    assert 'bins: tier === "interactive" ? 64 : tier === "refinement" ? 160 : 128' in javascript
    assert 'clamp(width * 0.75, 512, 768)' in javascript
    assert 'bins: tier === "interactive" ? 96 : 256' in javascript
    assert 'clamp(width, 768, 1024)' in javascript
    assert 'bins: tier === "interactive" ? 128 : 384' in javascript
    assert '&channels=${requestedChannels}' in javascript
    assert "smoothedWaveformPopulation(row, columnIndex, horizontalSpread)" in javascript
    assert "performance: { densityGain: 1.35, horizontalSpread: 1" in javascript
    assert "detailed: { densityGain: 1.9, horizontalSpread: 2" in javascript
    assert "reference: { densityGain: 2.15, horizontalSpread: 3" in javascript
    assert "1: { weights: [1, 2, 1], total: 4 }" in javascript
    assert "2: { weights: [1, 4, 6, 4, 1], total: 16 }" in javascript
    assert "3: { weights: [1, 6, 15, 20, 15, 6, 1], total: 64 }" in javascript
    assert "1 - Math.exp(-densityGain * Math.pow(density, 0.72))" in javascript


def test_vectorscope_uses_display_signal_targets_in_cpu_and_gpu_paths() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    scopes = (ROOT / "backend" / "hdr_finisher" / "scopes.py").read_text(encoding="utf-8")

    assert "acescg_to_linear_bt2020(working_rgb)" in scopes
    assert "signal_rgb = _scope_pq_oetf(normalized_nits)" in scopes
    assert "signal_rgb = _scope_srgb_oetf(linear_srgb)" in scopes
    assert "0.5 + (signal_rgb[..., 2] - signal_luma)" in scopes
    assert "0.5 + 0.5 * (signal_rgb" not in scopes
    assert "vectorscopeTransferLut(hdr, referenceWhite)" in javascript
    assert "1.0260187082 * workingR - 0.0221655448 * workingG" in javascript
    assert "const [kr, kg, kb] = hdr ? [0.2627, 0.6780, 0.0593]" in javascript
    assert "0.5 + (b - y) / (2 * (1 - kb))" in javascript
    assert "0.5 + 0.5 * (b - y)" not in javascript
    assert "const normalizationPeak = robustScopePopulationPeak(grid)" in javascript
    assert "function renderScopeControlAvailability()" in javascript
    assert 'els.scopeChannelMode?.classList.toggle("hidden", technical || vectorscope)' in javascript
    assert 'const rangeRelevant = !technical && !vectorscope && state.currentView === "hdr"' in javascript


def test_scope_region_is_an_optional_remappable_post_geometry_scope_tool() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    shell = (FRONTEND / "application-shell.js").read_text(encoding="utf-8")
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    css = (FRONTEND / "styles.css").read_text(encoding="utf-8")

    assert 'id="scope-region-toggle"' in html
    assert 'aria-label="Toggle Scope Region (Shift+R)"' in html
    assert 'class="scope-region-icon-frame"' in html
    assert 'id="scope-region-overlay" class="scope-region-overlay hidden"' in html
    assert html.count('data-scope-region-handle=') == 5
    assert 'id="scope-region-badge"' in html
    assert '"view.scopeRegion": "Shift+R"' in shell
    assert 'id: "view.scopeRegion"' in javascript
    assert "scope_region: scopeRegion" in javascript
    assert "function scopeAnalysisBounds" in javascript
    assert "function beginScopeRegionDrag" in javascript
    assert "function handleScopeRegionKeydown" in javascript
    assert "var(--curve-selected-ring)" in css
    assert "var(--curve-selected)" in css
    assert "var(--accent)" in css
