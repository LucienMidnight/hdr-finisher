from __future__ import annotations

import re
from pathlib import Path

from fastapi.testclient import TestClient

from hdr_finisher.main import app


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
DESKTOP = ROOT / "desktop"


def test_refined_slider_surfaces_full_bleed_sections_and_product_lockup() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    css = (FRONTEND / "styles.css").read_text(encoding="utf-8")
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")

    assert '<p class="product-name">HDR FINISHER</p>' in html
    assert "Cinema Print" not in html
    assert "Exposure dependent" not in html
    product_block = css[css.rindex(".product-name {"):]
    assert "font-family: var(--font-display);" in product_block
    assert "text-transform: uppercase;" in product_block

    final_refinement = css[css.index("/* Shared instrument components and panel hierarchy. */"):]
    body_block = final_refinement[
        final_refinement.index(".control-group:not(.collapsed) > .control-group-body {"):
        final_refinement.index(".control-group:not(.collapsed) > .control-group-body > #curve-editor")
    ]
    assert "margin: 0;" in body_block
    assert "border: 0;" in body_block
    assert "border-radius: 0;" in body_block
    assert "box-shadow: none;" in body_block

    assert "--instrument-slider-channel-shadow: inset" in css
    assert "--instrument-slider-channel-background: linear-gradient(180deg" in css
    assert "--instrument-slider-channel-background: linear-gradient(180deg, #cbcbcb 0%, #d4d4d4 38%, #d9d9d9 100%);" in css
    assert "inset 0 -1px 0 rgba(0, 0, 0, 0.08)" in css
    assert "--instrument-slider-thumb-focus-shadow:" in css
    assert "--segment-channel-background: linear-gradient(180deg" in css
    assert "--segment-selected-background: linear-gradient(180deg" in css
    assert "--segment-selected-shadow: inset" in css
    assert "--color-rail-spectrum: linear-gradient(90deg" in css
    assert ".button-primary {\n  appearance: none;\n  border: 0;\n  background: linear-gradient(180deg" in final_refinement
    assert ".button-secondary,\n.tool-button {\n  border-color: transparent;\n  background: var(--panel-collapse-button-background);" in final_refinement
    assert '.control-row[data-control-path$=".white_balance_kelvin"]' in css
    assert '.control-row[data-control-path$=".tint"]' in css
    assert "--instrument-slider-tick-top" not in css
    assert "input[type=\"range\"]:focus-visible {\n  outline: 0;" in final_refinement
    assert ".zoom-slider:disabled {\n  opacity: 1;" in final_refinement
    toggle_block = final_refinement[
        final_refinement.index('.checkbox-row > input[type="checkbox"],'):
        final_refinement.index('.checkbox-row > input[type="checkbox"]:checked,')
    ]
    checked_toggle_block = final_refinement[
        final_refinement.index('.checkbox-row > input[type="checkbox"]:checked,'):
        final_refinement.index("/* Five genuine Tabler tools")
    ]
    assert "border: 2px solid transparent;" in toggle_block
    assert "border-color: transparent;" in checked_toggle_block
    assert "background-color: var(--accent);" in checked_toggle_block
    assert 'input[type="checkbox"]::before' in final_refinement
    assert 'input[type="checkbox"]::after' not in final_refinement
    toggle_knob_block = toggle_block[toggle_block.index('input[type="checkbox"]::before'):]
    assert "width: 46px;" in toggle_block
    assert "height: 20px;" in toggle_block
    assert "top: 50%;" in toggle_knob_block
    assert "left: 0;" in toggle_knob_block
    assert "width: 16px;" in toggle_knob_block
    assert "height: 16px;" in toggle_knob_block
    assert "border: 0;" in toggle_knob_block
    assert "background: linear-gradient(180deg" in toggle_knob_block
    assert 'content: "ON";' not in checked_toggle_block
    assert "transform: translate(28px, -50%);" in checked_toggle_block
    film_module_header_block = css[css.index(".film-module-header {"):css.index(".film-module-header > span")]
    assert "font-size: 10px;" in film_module_header_block
    select_label_block = css[css.index("label.select-control {"):css.index("[data-film-grain-custom][hidden]")]
    assert "font-family: var(--sans);" in select_label_block
    assert "font-size: 10.5px;" in select_label_block
    assert "letter-spacing: 0;" in select_label_block
    assert "text-transform: none;" in select_label_block
    assert '.compact-subrail input[type="range"]::-webkit-slider-runnable-track' in final_refinement
    assert "height: var(--instrument-compact-slider-track-h);" in final_refinement
    product_mark_block = css[css.rindex(".product-mark {"):css.index(".workflow-tabs {", css.rindex(".product-mark {"))]
    assert "border: 1px solid #fff;" in product_mark_block
    assert 'className = "slider-ticks"' not in javascript
    assert "function renderRangeSnapTicks" not in javascript

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
    assert "maxNits: state.scopeMaxNits" in javascript

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
    assert '"project_save",\n          initialDirectory' in javascript
    assert 'desktop.grantProjectPath(requestedPath' in javascript
    assert 'mode === "project_save" && selection.exists' in javascript
    assert 'addEventListener("click", () => openProjectFromPath())' in javascript
    # MINOR-10: likewise for the project-open failure report.
    assert 'responseErrorMessage(payload, "The project could not be opened.")' in javascript
    assert 'status.post({' in javascript
    assert 'id: "project-open"' in javascript
    assert "window.HDRDialogs.alert(" not in javascript
    assert "window.alert(" not in javascript
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
    assert 'class="proof-explainer"' not in html
    assert 'data-tooltip="Renders the actual delivered file through this app\'s Chromium HDR pipeline."' in html
    assert 'data-tooltip="Proofs refresh on demand. Grading changes mark the result stale without interrupting editing."' in html
    assert 'id="chrome-proof-popover"' not in html
    assert 'id="chrome-proof-image"' in html
    assert 'id="review-chrome-proof"' not in html
    assert 'id="export-preflight"' not in html
    assert 'data-preflight=' not in html
    assert "function updateExportAvailability()" in javascript
    assert "function renderExportPreflight()" not in javascript
    assert '<dialog id="export-sheet"' not in html
    assert 'id="export-sheet" class="export-sheet workflow-side-panel panel"' in html
    assert "Delivery Matrix" not in html
    assert "Live Browser" not in html
    assert 'id="delivery-matrix-view"' not in html
    assert 'id="live-browser-view"' not in html
    assert "Global finishing only" not in html
    assert 'id="source-rail-expand"' in html
    assert 'class="source-rail-expand panel-collapse-button"' in html
    assert 'id="dock-collapse" class="panel-collapse-button panel-collapse-button--vertical"' in html
    assert '>Collapse</button>' not in html
    assert "--panel-collapse-button-background: linear-gradient" in css
    assert "--panel-collapse-button-shadow:" in css
    assert ".panel-collapse-button--vertical::before { transform: rotate(90deg); }" in css
    assert '.panel-collapse-button--vertical[aria-expanded="false"]::before { transform: rotate(-90deg); }' in css
    assert 'els.dockCollapse.setAttribute("aria-label", `${action} Scopes panel`);' in javascript
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
    assert "renderProofPreflight" not in javascript
    assert "Chromium proof is stale" not in javascript
    assert "Proofed ${formatName}, not selected ${exportName}" not in javascript

def test_grade_rail_keeps_a_readable_minimum_width() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    css = (FRONTEND / "styles.css").read_text(encoding="utf-8")
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    assert 'aria-valuemin="340"' in html
    assert 'aria-valuenow="340"' in html
    assert "--grade-w: 340px" in css
    assert "min-width: 340px" in css
    assert "gradeW: 340" in javascript
    assert "gradeW: [340, 420]" in javascript

def test_adjustable_module_headers_expose_consistent_modified_and_reset_affordances() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    groups = (
        "raw-highlights", "denoise", "geometry", "perspective",
        "hdr-tone", "hdr-highlights", "hdr-equalizer", "hdr-color", "hdr-zones",
        "sdr-tone", "sdr-highlights", "sdr-equalizer", "sdr-color", "sdr-zones",
        "curves", "color-grading", "detail", "film-look", "vignette",
    )
    for group in groups:
        start = html.index(f'data-group="{group}"')
        header_end = html.index('</div>', start)
        header = html[start:header_end]
        assert 'class="group-toggle"' in header, group
        assert '<span' in header, group
        assert 'class="group-reset text-button"' in header, group

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
    assert 'id="viewer-tier-status"' not in html
    assert 'id="preview-status"' not in html
    assert 'nodeId: "preview-status"' in javascript
    assert 'copyId: "preview-status-copy"' in javascript
    assert 'progressId: "preview-progress"' in javascript
    assert '{ id: "cancel-import", label: "Cancel import", run: cancelActiveImport }' in javascript
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
    assert "--group-index-font-size: 11px" in css
    assert "--group-disclosure-leading: 38px" in css
    assert ".control-group-header > .group-toggle" in css
    assert "margin-left: calc(var(--group-index-left) - var(--group-disclosure-leading))" in css
    assert "pointer-events: none" in css.split(".control-group-header::before", 1)[1].split("}", 1)[0]
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
    assert ".status-entry-progress" in css
    assert "Processing complete. Decoding preview..." in javascript
    assert "{ showProgress: false }" in javascript
    assert "renderPreviewForLane(lane, true, longEdge, { showProgress: false })" in javascript
    assert "min-width: 0" in css
    assert "height: 100vh" in css
    assert 'const COMPACT_WORKSPACE_QUERY = "(max-width: 1499px)"' in javascript
    assert 'id="overlay-toggle"' in html
    assert 'aria-controls="overlay-popover"' in html
    assert '>Overlays</button>' in html
    assert 'id="preview-toggle"' in html
    assert 'aria-controls="preview-popover"' in html
    assert '>Preview</button>' in html
    assert 'id="preview-faster-dragging"' in html
    assert '["Current Preview Size", currentPreviewSizeLabel()]' in javascript
    assert "compact-workspace" in css
    assert "source-overlay-open" in css
    for selector in ("app-shell", "top-bar", "workspace-main", "source-rail", "grade-rail", "viewer-panel"):
        assert len(re.findall(rf"(?m)^\.{selector}\s*\{{", css)) == 1
    assert len(re.findall(r"(?m)^html,\r?\nbody \{", css)) == 1
    matrix = (Path(__file__).parent / "css-app-shell-matrix.js").read_text(encoding="utf-8")
    for state in ("normal-1440", "wide-2200", "compact-1100", "desktop-1440", "native-menu-1440"):
        assert state in matrix
