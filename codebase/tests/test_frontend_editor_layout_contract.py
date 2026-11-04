from __future__ import annotations

import re
from pathlib import Path

from frontend_source import frontend_scripts


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
DESKTOP = ROOT / "desktop"


def test_refined_slider_surfaces_full_bleed_sections_and_product_lockup() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    css = "\n".join((FRONTEND / name).read_text(encoding="utf-8") for name in ("styles.css", "visual-tokens.css", "visual-controls.css"))

    assert '<img class="product-logo" src="/static/assets/brand/hdr-finisher-logo.svg" alt="HDR Finisher">' in html
    assert "Cinema Print" not in html
    assert "Exposure dependent" not in html
    product_block = css[css.index("\n.product-logo {"): ]
    assert "object-fit: contain;" in product_block
    assert '[data-theme="default-light"] .product-logo' in product_block

    final_refinement = css[css.index("/* Shared instrument components and panel hierarchy. */"):]
    body_block = final_refinement[
        final_refinement.index(".control-group:not(.collapsed) > .control-group-body {"):
        final_refinement.index(".control-group:not(.collapsed) > .control-group-body > #curve-editor")
    ]
    assert "margin: 0;" in body_block
    assert "border: 0;" in body_block
    assert "border-radius: 0;" in body_block
    assert "box-shadow: none;" in body_block

    # Material appearance and modifier states are exercised in the real-app
    # visual review; retain the layout/asset checks here without pinning gradients.
    assert (FRONTEND / "visual-controls.css").is_file()


def test_hdr_curve_graph_uses_tokenized_exposure_band_styling() -> None:
    css = "\n".join((FRONTEND / name).read_text(encoding="utf-8") for name in ("styles.css", "visual-tokens.css", "visual-controls.css"))

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


def test_sdr_exposure_bands_are_independent_and_offer_one_shot_hdr_match() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")

    assert 'data-group="sdr-equalizer"' in html
    assert 'data-section-path="sdr.tone_equalizer_section_enabled"' in html
    assert 'id="sdr-tone-equalizer-editor"' in html
    assert 'id="sdr-match-hdr-bands"' in html
    assert "Copies once; SDR remains independent." in html


def test_curve_panel_reset_is_visible_when_curves_are_modified() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")

    assert 'id="curve-reset" class="group-reset text-button"' in html


def test_scope_zoom_exposes_1000_4000_and_10000_nit_computation_ranges() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")

    assert '<span>Scope zoom</span>' in html
    assert 'id="scope-zoom"' in html
    assert '<option value="1000">1K nits</option>' in html
    assert '<option value="4000">4K nits</option>' in html
    assert '<option value="10000">10K nits</option>' in html


def test_overlay_ui_explains_reference_nit_zebras_and_has_a_false_color_key() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")

    assert 'id="false-color-key"' in html
    assert "Highlights pixels at or above this reference-nit level." in html
    assert 'id="overlay-threshold" type="range" min="10" max="4000" step="10" value="100"' in html


def test_expanded_controls_use_nested_tiles_and_export_copy_is_clean() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    css = "\n".join((FRONTEND / name).read_text(encoding="utf-8") for name in ("styles.css", "visual-tokens.css", "visual-controls.css"))
    javascript = frontend_scripts()
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
    assert 'value="uint8"' not in html
    assert 'avif_gain_map_chroma_subsampling: "444"' in javascript
    assert 'web_default: { quality: 85' in javascript
    assert 'maximum_fidelity: { quality: 100' in javascript
    assert 'class="export-filename-field"' in html
    assert 'class="export-directory-field"' in html
    assert 'id="directory-browser"' in html
    assert 'id="directory-browser-select"' in html
    assert 'id="directory-browser-filename"' in html
    assert '<strong>Recent</strong><ul id="directory-browser-recents"></ul>' in html
    assert '<strong>Pinned</strong><ul id="directory-browser-pinned"></ul>' in html
    assert '<strong>Locations</strong><ul id="directory-browser-locations"></ul>' in html
    for key, column in (("name", "Name"), ("size", "Size"), ("kind", "Kind"), ("date", "Date Added")):
        assert f'data-media-browser-sort="{key}">{column}</button>' in html
        assert f'data-media-browser-resize="{key}"' in html
    assert 'aria-label="Resize preview panel"' in html
    assert "Loading preview…" in javascript
    assert 'data-preview-state="interpretation-required"' in css
    assert "Preview withheld to avoid misleading color" in javascript
    assert "private, no-cache" in (ROOT / "backend" / "hdr_finisher" / "main.py").read_text(encoding="utf-8")
    assert 'grantProjectPath: (filePath, intent)' in (DESKTOP / "preload.js").read_text(encoding="utf-8")
    assert 'id="directory-browser-kicker"' not in html
    source_summary = html.split('<section class="source-summary">', 1)[1].split("</section>", 1)[0]
    assert source_summary.index('id="badge"') < source_summary.index('id="experimental-dng-note"')
    assert "DNG import is experimental. Some incompatible DNG files may be rejected." in source_summary
    assert '{ role: "reload" }' not in (DESKTOP / "main.js").read_text(encoding="utf-8")
    assert 'if (isMain) window.on("query-session-end"' in (DESKTOP / "main.js").read_text(encoding="utf-8")
    assert "/api/media-browser" in frontend_scripts()
    assert ".control-group-body" in css
    assert "border-top: 2px solid" in css
    assert ".jpeg-advanced-settings" in css
    assert ".export-section-title" in css
    assert 'id="jpeg-advanced-settings" class="jpeg-advanced-settings">' in html
    assert '"quality jpeg"' in css
    assert '"filename folder"' in css


def test_linear_workflow_uses_tab_specific_rails_and_reports_export_readiness() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    javascript = frontend_scripts()
    proofing = frontend_scripts()
    css = "\n".join((FRONTEND / name).read_text(encoding="utf-8") for name in ("styles.css", "visual-tokens.css", "visual-controls.css"))
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
    assert "--panel-collapse-button-background: var(--plate-up)" in css
    assert "--panel-collapse-button-shadow:" in css
    assert ".panel-collapse-button--vertical::before { transform: rotate(90deg); }" in css
    assert '.panel-collapse-button--vertical[aria-expanded="false"]::before { transform: rotate(-90deg); }' in css
    assert 'class="source-file-identity"' in html
    assert 'class="source-file-label">File Name</p>' in html
    assert 'id="session-name-tooltip"' in html
    assert 'id="copy-source-path"' in html
    assert 'id="source-confidence"' not in html
    assert 'id="file-summary"' not in html
    assert 'id="interpretation-summary"' not in html
    assert "Proof generation is intentionally explicit" in proofing
    assert "#chrome-proof-watermark" in css and "opacity: .5;" in css
    assert '.chrome-proof-status[data-state="stale"]' in css
    assert "Chromium proof is stale" not in javascript


def test_grade_rail_keeps_a_readable_minimum_width() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    css = "\n".join((FRONTEND / name).read_text(encoding="utf-8") for name in ("styles.css", "visual-tokens.css", "visual-controls.css"))
    javascript = frontend_scripts()
    assert 'aria-valuemin="320"' in html
    assert 'aria-valuenow="320"' in html
    assert "--grade-w: 320px" in css
    assert "gradeW: 320" in javascript
    assert "gradeW: [320, 420]" in javascript


def test_adjustable_module_headers_expose_consistent_modified_and_reset_affordances() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    groups = (
        "raw-highlights", "denoise", "geometry", "perspective",
        "hdr-tone", "hdr-highlights", "hdr-equalizer", "hdr-color",
        "sdr-tone", "sdr-highlights", "sdr-equalizer", "sdr-color",
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
    javascript = frontend_scripts()
    css = "\n".join((FRONTEND / name).read_text(encoding="utf-8") for name in ("styles.css", "visual-tokens.css", "visual-controls.css"))
    assert '<aside class="source-rail panel" aria-label="Metadata">' in html
    assert 'data-control-mode="global"' in html
    assert 'data-control-mode="local"' in html
    assert 'data-control-mode="retouch"' in html
    assert 'id="grade-mode-global"' in html
    assert 'id="grade-mode-local"' in html
    assert 'id="grade-mode-retouch"' in html
    assert 'id="preview-window-title" class="panel-title"' in html
    assert 'class="preview-metadata-panel"' not in html
    assert 'id="viewer-lane-label"' not in html
    assert ".preview-title-wrap:hover .preview-title-tooltip" in css
    assert 'id="viewer-tier-status"' not in html
    assert 'id="preview-status"' not in html
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
    assert 'class="probe-strip"' not in html
    assert 'id="probe-readout"' not in html
    assert "Move over the image" not in html
    assert '--group-chevron-shape: url("assets/icons/tabler/chevron-right.svg")' in css
    assert 'class="group-toggle"' in html
    assert not re.search(r"\.control-group[^\n{]*::before\s*\{[^}]*content:\s*['\"]\d+", css)
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
    assert ".status-entry-progress" in css
    assert "Processing complete. Decoding preview..." in javascript
    assert "min-width: 0" in css
    assert "height: 100vh" in css
    assert 'id="overlay-toggle"' in html
    assert 'aria-controls="overlay-popover"' in html
    assert '>Overlays</button>' in html
    assert "compact-workspace" in css
    assert "source-overlay-open" in css
    for selector in ("app-shell", "top-bar", "workspace-main", "source-rail", "grade-rail", "viewer-panel"):
        assert len(re.findall(rf"(?m)^\.{selector}\s*\{{", css)) == 1
    assert len(re.findall(r"(?m)^html,\r?\nbody \{", css)) == 1
    matrix = (Path(__file__).parent / "css-app-shell-matrix.js").read_text(encoding="utf-8")
    for state in ("normal-1440", "wide-2200", "compact-1100", "desktop-1440", "native-menu-1440"):
        assert state in matrix
