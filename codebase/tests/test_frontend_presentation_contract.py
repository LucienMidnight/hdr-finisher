from __future__ import annotations

from pathlib import Path

from frontend_source import frontend_declaration, frontend_scripts


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"


def test_interaction_holds_the_selected_tier_once_it_has_produced_a_result() -> None:
    """A gesture may not lower the processing resolution.

    The previous contract deliberately dropped interaction to a 512-1024
    display-bounded proxy and refined afterwards. The stable-tier contract
    replaces that with exact-tier processing, and keeps the bounded proxy only
    as a bootstrap path for a tier that has not produced a result yet.
    """
    bootstrap = frontend_declaration("bootstrapProxyLongEdge")

    assert "clamp(displayedLongEdge(), 512, 1024)" in bootstrap


def test_accepted_presentation_records_what_it_actually_is() -> None:
    accept = frontend_declaration("acceptPresentation")

    # Exactness is a fact about the resolution the frame was processed at,
    # not about the size of the picture that came out. Geometry trims the
    # frame: a straighten at the 4K tier processes at 4096 and presents
    # 4011, and that is still an exact 4K result.
    assert "const processedEdge = Number(processedLongEdge) > 0 ? Number(processedLongEdge) : longEdge;" in accept
    # Equality, not "at least". A frame processed above the selected tier is
    # not that tier either -- a resident Full frame satisfying ">=" reported
    # "Ready - 1K" over it and told the scheduler there was nothing to do.
    assert "const exact = longEdge > 0 && processedEdge === requiredProcessingLongEdge();" in accept


def test_stale_overlay_remains_continuously_visible_until_replacement_arrives() -> None:
    invalidate = frontend_declaration("invalidatePreview")
    apply_overlay = frontend_declaration("applyOverlayUrl")

    assert 'els.previewOverlay.style.opacity = "0.5";' not in invalidate
    assert 'els.previewOverlay.style.opacity = "1";' in apply_overlay


def test_generation_change_reports_updating_immediately() -> None:
    invalidate = frontend_declaration("invalidatePreview")

    # The 100 ms Updating/Preparing feedback target is met by reporting on the
    # generation bump, not by waiting for the render that follows it.
    assert "state.previewGeneration[lane] += 1;" in invalidate
    assert invalidate.index("state.previewGeneration[lane] += 1;") < invalidate.index("renderViewerStatus();")


def test_curve_canvas_left_clicks_add_or_select_and_right_click_removes() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")

    assert "Left-click the curve to add a point" in html
    assert "right-click an interior point to remove it" in html


def test_ctrl_fine_adjustment_and_shift_semantic_snapping_are_shared() -> None:
    javascript = frontend_scripts()

    assert "const FINE_ADJUSTMENT_SCALE = 0.1" in javascript
    assert '"Hold Ctrl for 10× finer adjustment. Hold Shift to snap to semantic landing positions."' not in javascript
    assert 'const step = event.ctrlKey ? 0.001 : 0.01' in javascript
    assert 'const step = event.ctrlKey ? 0.01 : 0.05' in javascript
