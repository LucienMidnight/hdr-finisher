from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from hdr_finisher.main import app

from frontend_source import frontend_declarations, frontend_scripts


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"


def test_left_metadata_panel_renders_complete_camera_and_lens_identity() -> None:
    script = frontend_scripts()
    for label in (
        "Camera make",
        "Camera model",
        "Lens make",
        "Lens model",
        "ISO",
        "Shutter",
        "Focal length",
        "Aperture",
    ):
        assert f'["{label}",' in script
    assert "formatFocalLength(session.metadata.focal_length_mm)" in script
    assert "formatAperture(session.metadata.aperture)" in script
    assert '["RAW pipeline", session.metadata.extra.raw_pipeline]' in script
    assert '["RAW compatibility fallback", session.metadata.extra.raw_fallback_reason]' in script


def test_grading_ui_exposes_variable_equalizer_targeting_and_bypass_controls() -> None:
    response = TestClient(app).get("/")
    assert response.status_code == 200
    html = response.text
    assert "Lift, Gamma, Gain" in html
    assert "Legacy Primaries" not in html
    assert 'id="tone-equalizer-add"' in html
    assert 'id="tone-equalizer-remove"' in html
    assert 'id="tone-equalizer-radius"' in html
    assert html.count("data-section-path=") == 16
    css = (FRONTEND / "styles.css").read_text(encoding="utf-8")
    assert "--bypass-icon-shape:" in css
    assert "--bypass-icon-visible: var(--accent)" in css
    assert "--bypass-icon-hidden: var(--quiet)" in css
    assert 'id="local-bypass"' not in html
    assert html.count("data-zone-hover=") == 6
    assert "Highlight Compression" in html
    assert 'data-group="hdr-highlights"' in html
    assert 'data-section-path="hdr.highlight_section_enabled"' in html
    # The painted module index has to ascend in display order in both lanes, so
    # Curves and Highlight Compression swap numbers when HDR is active.
    assert 'body[data-active-lane="hdr"] .control-group[data-group="curves"] > .control-group-header::before { content: "09"; }' in css
    assert '.control-group[data-group="hdr-highlights"] > .control-group-header::before { content: "10"; }' in css
    assert '.control-group[data-group="curves"] > .control-group-header::before { content: "10"; }' in css
    assert "Output target" in html
    assert "Sets the final peak after grading" in html
    assert '<option value="clip">Clip</option>' in html
    assert 'data-path="hdr.highlight_compression_start_nits"' in html
    assert 'data-path="hdr.highlight_compression_target_nits"' in html
    assert 'data-path="hdr.highlight_compression_softness"' in html
    assert 'data-path="hdr.highlight_compression_mode"' in html
    mode_options = html.split('id="hdr-compression-mode"', 1)[1].split("</select>", 1)[0]
    assert '<option value="off">Off</option>' not in mode_options
    assert 'data-path="hdr.highlight_compression_peak_detail"' in html
    assert 'data-path="hdr.highlight_compression_color_handling"' in html
    assert html.index('data-path="hdr.highlight_compression_color_handling"') < html.index('data-path="hdr.highlight_compression_peak_detail"')
    assert "Smooth color rolloff" in html
    assert "Neutralize peak" in html
    assert 'id="highlight-compression-graph"' in html
    assert '<figcaption id="highlight-compression-summary">' not in html
    assert 'id="highlight-compression-summary" class="tooltip-trigger"' in html
    assert '<p class="helper">Sets the peak at this module.' not in html
    assert "Advanced highlight controls" in html
    assert 'data-group="sdr-highlights"' in html
    assert 'data-section-path="sdr.highlight_section_enabled"' in html
    assert 'data-path="sdr.highlight_compression_start_percent"' in html
    assert 'data-path="sdr.highlight_compression_color_handling"' in html
    assert 'id="sdr-highlight-compression-graph"' in html
    assert 'data-group="sdr-base"' not in html
    assert 'data-path="sdr.highlight_recovery"' not in html
    assert '>Tone Mapper<' not in html
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
    assert 'id="sdr-reset-colors" class="group-reset text-button" type="button" data-reset-group="sdr-color"' in html


def test_panel_titles_and_scope_description_follow_shared_design_contract() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    css = (FRONTEND / "styles.css").read_text(encoding="utf-8")
    scope_ui = frontend_scripts()

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
    # The short Technical readout and the full list under Diagnostics share one panel.
    assert '<option value="diagnostics">Diagnostics</option>' in html
    assert 'id="technical-summary"' in html and 'id="technical-diagnostics"' in html
    assert 'class="dock-tabs"' not in html
    assert 'id="scope-note" class="visually-hidden"' in html
    assert 'id="histogram" width="720" height="220" aria-label="Image scope" aria-describedby="scope-note"' in html
    assert "RW means active HDR reference white" in scope_ui
    assert "--panel-title-font-family:" in css
    assert "--panel-title-font-size:" in css
    assert "--group-title-font-family: var(--display)" in css
    assert "--group-title-font-size: 12px" in css
    assert "--group-title-font-weight: 600" in css
    assert ".disclosure-trigger > span:first-child" in css
    assert "transition-delay: 2s" in css
    assert "justify-content: flex-start" in css


def test_default_shortcuts_are_conservative_and_warn_about_macos_system_bindings() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    app = frontend_scripts()

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


def test_preview_resolution_and_gpu_memory_are_persisted_application_preferences() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    shell = frontend_scripts()
    desktop = (ROOT / "desktop" / "main.js").read_text(encoding="utf-8")

    assert 'new Set(["1024", "2048", "4096", "full"])' in shell
    assert "GPU_MEMORY_PRESETS_GIB = [1, 2, 3, 4, 6, 8, 12]" in shell
    assert 'id="settings-preview-resolution"' in html
    assert 'id="settings-faster-dragging" type="checkbox"' in html
    assert 'id="settings-preview-preference"' not in html
    # Execution, the legacy tier and region of interest are diagnostics now.
    diagnostics = html.split('data-settings-panel="diagnostics"', 1)[1].split("</section>", 1)[0]
    for control in ("settings-execution-override", "settings-preview-resolution", "settings-roi-preview"):
        assert f'id="{control}"' in diagnostics
    general = html.split('data-settings-panel="general"', 1)[1].split("</section>", 1)[0]
    assert 'id="settings-gpu-memory-limit"' in general
    # Help in user terms: what you see and when, not millisecond targets.
    for target in ("33 ms", "66 ms", "150 ms"):
        assert target not in html
    for value, label in [("1024", "1K"), ("2048", "2K"), ("4096", "4K")]:
        assert f'<option value="{value}">{label}</option>' in html
    assert 'id="settings-gpu-memory-limit"' in html
    for value in ["1", "2", "3", "4", "6", "8", "12"]:
        assert f'<option value="{value}">{value} GiB</option>' in html
    assert '<option value="custom">Custom…</option>' in html
    assert 'id="settings-gpu-memory-custom" type="number" min="0.25" max="64" step="0.25"' in html
    assert 'previewResolution: "auto"' in desktop
    assert "fasterDragging: false," in desktop
    assert 'maximumGpuMemoryGiB: "auto"' in desktop
    assert 'schemaVersion: 3' in shell
    assert 'schemaVersion: 3' in desktop


def test_rendition_descriptions_are_delayed_title_tooltips() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    css = (FRONTEND / "styles.css").read_text(encoding="utf-8")

    assert 'id="lane-note"' not in html
    assert 'aria-describedby="hdr-controls-tooltip"' in html
    assert 'aria-describedby="sdr-controls-tooltip"' in html
    assert 'id="hdr-controls-tooltip" class="title-tooltip lane-title-tooltip" role="tooltip"' in html
    assert 'id="sdr-controls-tooltip" class="title-tooltip lane-title-tooltip" role="tooltip"' in html
    assert ".lane-switch button:hover .lane-title-tooltip" in css
    assert "transition-delay: 2s" in css


def test_help_tooltips_are_portaled_and_clamped_to_the_visible_app_bounds() -> None:
    javascript = frontend_scripts()
    css = (FRONTEND / "styles.css").read_text(encoding="utf-8")

    assert "initializeBoundedTooltips();" in javascript
    assert 'const selector = ".help-tip[data-tooltip], .help-tip[data-tip], .tooltip-trigger[data-tooltip], .group-toggle[data-tooltip], .disclosure-trigger[data-tooltip]"' in javascript
    assert 'tooltip.className = "bounded-help-tooltip"' in javascript
    assert "const visualViewport = window.visualViewport" in javascript
    assert "viewport.width - margin * 2" in javascript
    assert "viewport.height - margin - tooltipRect.height" in javascript
    assert "const preferredTop = below <= maximumTop ? below : above" in javascript
    assert "document.addEventListener(\"scroll\", position, true)" in javascript
    assert ".help-tip::after" in css
    assert "content: none !important" in css
    assert ".bounded-help-tooltip" in css
    assert "position: fixed" in css
    assert "max-height: calc(100vh - 16px)" in css


def test_explanatory_copy_uses_title_hover_without_persistent_helper_rows() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    javascript = frontend_scripts()

    assert 'class="disclosure-trigger" type="button" aria-expanded="false" aria-controls="raw-settings-panel" disabled data-tooltip=' in html
    assert html.count('class="group-toggle" type="button" aria-expanded="false" data-tooltip=') >= 7
    assert 'data-tooltip="Adjust exposure by scene brightness.' in html
    assert 'data-tooltip="Adjust the tone-mapped SDR image by brightness.' in html
    assert html.count('data-tooltip="Range controls how wide a luminance zone is;') == 2
    assert 'data-tooltip="Scale-selective detail:' in html
    assert 'data-tooltip="Controls physical enlargement for halation, resolution, and grain.' in html
    assert 'data-tooltip="Strip modes anchor the cross-scan dimension' in html
    assert 'class="help-tip' not in html
    assert 'id="raw-highlight-status"' not in html
    assert 'id="curve-status"' not in html
    assert "Curve edits affect only the" not in javascript


def test_grade_readouts_support_bounded_direct_numeric_entry() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    javascript = frontend_scripts()
    css = (FRONTEND / "styles.css").read_text(encoding="utf-8")

    assert html.count("data-value-path=") >= 50
    assert '"hdr.highlight_compression_start_nits": { min: 1, max: 9999' in javascript
    assert '"hdr.highlight_compression_target_nits": { min: 2, max: 10000' in javascript
    assert '"hdr.exposure": { min: -8, max: 8' in javascript
    assert '"sdr.highlight_compression_start_percent": { min: 1, max: 99' in javascript
    assert '"sdr.highlight_compression_manual_peak_percent": { min: 1, max: 1000000' in javascript
    assert 'entryScale: 100' in javascript
    assert "Double-click any value to type it." in html
    assert ".editable-value[data-editing=\"true\"]" in css
    assert ".range-shell.manual-overflow" in css


def test_highlight_compression_softness_uses_half_percent_slider_steps() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    javascript = frontend_scripts()

    assert 'id="hdr-compression-softness" type="range" min="0" max="100" step="0.5"' in html
    assert 'id="sdr-compression-softness" type="range" min="0" max="100" step="0.5"' in html
    assert javascript.count('"hdr.highlight_compression_softness": [0, 100, 0.5]') == 3
    assert javascript.count('"sdr.highlight_compression_softness": [0, 100, 0.5]') == 3
    assert '"hdr.highlight_compression_softness": { min: 0, max: 100, decimals: 1 }' in javascript
    assert 'numeric.toFixed(1)' in javascript


def test_tint_controls_follow_darktable_hue_mapping() -> None:
    css = (FRONTEND / "styles.css").read_text(encoding="utf-8")
    javascript = frontend_scripts()

    assert ".primary-tint-hue .slider-track { background: linear-gradient(90deg, #53a7b1, #5368b5, #b84f9a, #e05273, #d3ad5b, #54a579, #53a7b1); }" in css
    assert "const DARKTABLE_TINT_HUE_STOPS" in javascript
    assert "function syncTintPurityVisuals()" in javascript
    assert "darktableTintHueColor(state.adjustments[lane].tint_hue)" in javascript


def test_equalizer_interactions_include_non_scrolling_wheel_and_keyboard_alternatives() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")

    assert "Left-click the curve to add a band" in html
    assert "right-click an interior band to remove it" in html


def test_redundant_enable_controls_are_removed_and_equalizer_schedules_live_scopes() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")

    assert 'id="tone-equalizer-enabled"' not in html
    assert 'id="curves-enabled"' not in html
    assert 'id="sdr-match-hdr-color"' not in html
    assert "Enable equalizer" not in html
    assert "Enable curves" not in html


def test_curve_drag_uses_live_preview_scheduler_and_three_point_default_shape() -> None:
    javascript = frontend_scripts()
    curve_binding = frontend_declarations("bindCurveEditor", "updateCurveFromPointer", "curveVerticalAdjustmentScale")

    assert "return index === 0 || index === pointCount - 1 ? 0.18 : 0.35" in curve_binding
    assert "const verticalStep = step * Math.min(1, curveVerticalAdjustmentScale(index, curve.length) / 0.35)" in curve_binding
    assert "return [[0, 0], [0.25, 0.25], [0.5, 0.5], [0.75, 0.75], [1, 1]]" in javascript
