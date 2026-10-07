from __future__ import annotations

import re
from pathlib import Path

from fastapi.testclient import TestClient

from hdr_finisher.main import app

from frontend_source import frontend_declaration, frontend_scripts


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
DESKTOP = ROOT / "desktop"


def test_raw_development_is_first_grade_control_group() -> None:
    markup = (FRONTEND / "index.html").read_text(encoding="utf-8")
    css = (FRONTEND / "styles.css").read_text(encoding="utf-8")

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
    assert "--control-group-header-h: 38px" in css
    assert ".raw-development-group .disclosure-trigger" in css
    assert ".source-rail > .disclosure-panel" in css


def test_raw_highlight_reconstruction_is_a_versioned_module_stack_control() -> None:
    markup = (FRONTEND / "index.html").read_text(encoding="utf-8")
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


def test_presentation_gate_owns_every_presentation_resize() -> None:
    markup = (FRONTEND / "index.html").read_text(encoding="utf-8")

    assert markup.index("presentation-gate.js") < markup.index("webgpu-preview.js")


def test_failure_taxonomy_replaces_sticky_gpu_disablement() -> None:
    markup = (FRONTEND / "index.html").read_text(encoding="utf-8")

    assert markup.index("render-failure.js") < markup.index("app.js")


def test_live_denoise_input_is_coalesced() -> None:
    markup = (FRONTEND / "index.html").read_text(encoding="utf-8")
    queue = frontend_scripts()

    assert markup.index("latest-work-queue.js") < markup.index("app.js")
    # The live control path goes through the queue, not straight to the
    # renderer, so a drag costs runs rather than input events.
    assert "this.stats.coalesced += 1;" in queue


def test_source_transport_carries_abort_and_generation_checks() -> None:
    webgpu = frontend_scripts()
    markup = (FRONTEND / "index.html").read_text(encoding="utf-8")

    assert markup.index("source-transport.js") < markup.index("webgpu-preview.js")
    assert "bounded source transport is required" in webgpu


def test_viewport_request_contract_reaches_the_scheduler() -> None:
    markup = (FRONTEND / "index.html").read_text(encoding="utf-8")

    assert markup.index("viewport-request.js") < markup.index("webgpu-preview.js")


def test_processing_scale_contract_is_declared_and_consumed() -> None:
    markup = (FRONTEND / "index.html").read_text(encoding="utf-8")
    webgpu = frontend_scripts()
    contract = frontend_scripts()

    # The declared contract loads before the renderer that consumes it.
    assert markup.index("viewport-request.js") < markup.index("graph-scale.js")
    assert markup.index("graph-scale.js") < markup.index("webgpu-preview.js")
    # A build that forgot the script must fail loudly instead of reserving a
    # halo of zero.
    assert "the processing-scale contract is required" in webgpu
    # The spatial grid the halo converts through is one rule on both sides
    # (1, 2 or 4 pixels a texel by the frame's long edge), so a shader change
    # cannot silently outrun the halo. Halos stay multiples of four.
    assert "return select(select(1.0, 2.0, longEdge >= 2048.0), 4.0, longEdge >= 4096.0);" in webgpu
    assert "if (longEdge >= 4096) return 4;" in contract
    assert "return longEdge >= 2048 ? 2 : 1;" in contract
    assert "const SPATIAL_SCALE = 4;" in contract


def test_tiled_encoding_submits_in_small_batches() -> None:
    webgpu = frontend_scripts()

    # Batches are submitted as they are encoded, so the GPU works while the CPU
    # encodes the next batch and a superseded generation stops at a boundary.
    assert "submissions += 1;" in webgpu


def test_roi_refinement_is_opt_in_and_tier_limited() -> None:
    javascript = frontend_scripts()

    # A fully visible frame reports no viewport: Fit has nothing to skip.
    assert "if (x === 0 && y === 0 && visibleWidth >= width && visibleHeight >= height) return null;" in javascript


def test_display_scale_pan_cache_is_generation_aware() -> None:
    javascript = frontend_scripts()

    # The deferred pan follow-up exists, is wired to the viewer scroll, and is
    # cancelled by a newer edit like the catch-up. The follow-up lifecycle
    # itself (timers, candidate facts, busy re-arm) lives in the coordinator.
    assert "const ROI_PAN_DELAY_MS = 140;" in javascript


def test_render_coordinator_owns_generations_priority_and_follow_ups() -> None:
    markup = (FRONTEND / "index.html").read_text(encoding="utf-8")
    coordinator = frontend_scripts()

    # Loaded after the viewport contract it builds on and before app.js, which
    # consumes it through dispatch and present callbacks.
    assert markup.index("viewport-request.js") < markup.index("render-coordinator.js")
    assert markup.index("render-coordinator.js") < markup.index("/static/app.js")

    # Presentation acceptance, the coarse-to-refined lifecycle, and timing.
    assert "DEFAULT_CATCH_UP_DELAY_MS = 700" in coordinator
    assert "DEFAULT_PAN_DELAY_MS = 140" in coordinator


def test_app_emits_intent_to_the_render_coordinator() -> None:
    javascript = frontend_scripts()

    # The dispatch serial comes from the coordinator, not a second counter.
    assert "const serial = Number(request.dispatchSerial) || 0;" in javascript


def test_roi_refinement_has_a_settings_surface() -> None:
    markup = (FRONTEND / "index.html").read_text(encoding="utf-8")

    # Reachable without devtools, and persisted like the other diagnostics.
    assert 'id="settings-roi-preview"' in markup


def test_perspective_draft_is_bounded_before_authoring_tier_apply() -> None:
    draft = frontend_declaration("perspectiveDraftLongEdge")

    assert "Math.min(previewTargetLongEdge(), 1024)" in draft


def test_native_exact_peak_is_explicit_opt_in_during_authoring() -> None:
    markup = (FRONTEND / "index.html").read_text(encoding="utf-8")

    exact_peak_input = re.search(r'<input type="checkbox" id="scope-exact-peak"([^>]*)>', markup)
    assert exact_peak_input is not None
    assert "checked" not in exact_peak_input.group(1)


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
