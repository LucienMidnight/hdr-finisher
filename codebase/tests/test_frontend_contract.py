from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from hdr_finisher.main import app


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"


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
    assert 'data-path="sdr.match_hdr_color"' in html
    assert 'data-path="sdr.saturation"' in html
    assert 'data-path="sdr.red_hue"' in html
    assert "/api/export-directory/default" in script
    assert "window.confirm" in script
    assert "overwrite," in script


def test_equalizer_interactions_include_non_scrolling_wheel_and_keyboard_alternatives() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    assert 'canvas.addEventListener("wheel"' in javascript
    assert "event.preventDefault();" in javascript
    assert "{ passive: false }" in javascript
    assert 'event.key === "[" || event.key === "]"' in javascript
    assert "moveToneEqualizerNodeHorizontally" in javascript
    assert "pointerenter" in javascript and "focusin" in javascript
    assert "drawZoneScopeOverlay" in javascript


def test_expanded_controls_use_nested_tiles_and_export_copy_is_clean() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    css = (FRONTEND / "styles.css").read_text(encoding="utf-8")
    assert "Export..." in html
    assert "Export file" not in html
    assert "JPEG XL" not in html
    assert "not in this build" not in html
    assert "Selected fixed-headroom reference" in html
    assert 'id="jpeg-gain-map-quality"' in html
    assert 'id="jpeg-gain-map-scale"' in html
    assert 'class="export-filename-field"' in html
    assert 'class="export-directory-field"' in html
    assert ".control-group-body" in css
    assert "border-top: 2px solid" in css
    assert ".jpeg-advanced-settings" in css
    assert '"quality jpeg"' in css
    assert '"filename folder"' in css


def test_grade_rail_keeps_a_readable_minimum_width() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    assert "gradeW: [300, 420]" in javascript


def test_webgpu_pipeline_preserves_cpu_section_order_and_fixed_hdr_curve_domain() -> None:
    shader = (FRONTEND / "webgpu-preview.js").read_text(encoding="utf-8")
    assert "const PARAM_COUNT = 73" in shader
    assert "hdrPrimaries(hdrToneEqualizer(sceneColor(hdrContrast(hdrBase(source)))))" in shader
    assert "sdrReferenceColor(sdrContrast(highlightRecovery(rgb)))" in shader
    assert "toneMap(sceneColor(rgb))" in shader
    assert "sdrPrimaries(sdrContrast(highlightRecovery(toneMap(sceneColor(rgb)))))" in shader
    assert "retoneMapSdrReference(rgb)" in shader
    assert "if (value <= 0.18) { return 0.5 * value / 0.18; }" in shader
    assert "log2(value / 0.18) / log2(100.0)" in shader
    assert "let amount = p[3] / 50.0" in shader
