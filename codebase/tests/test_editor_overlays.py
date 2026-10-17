import numpy as np
from hdr_finisher.color_context import RenderColorContext
from hdr_finisher.models import AdjustmentState, PreviewKind
from hdr_finisher.overlay import FALSE_COLOR_PALETTE, build_overlay_rgba


def test_false_color_anchor_moves_bands_without_rescaling_the_photo():
    image = np.full((1, 1, 3), .2, dtype=np.float32)  # About 226 nit, away from band boundaries.
    grade = AdjustmentState.model_validate({"shared": {"overlay_mode": "false_color"}})
    context = RenderColorContext(203)
    project = build_overlay_rgba(image, grade, PreviewKind.HDR, color_context=context)
    grade.shared.false_color_band_anchor = "100_nits"
    fixed = build_overlay_rgba(image, grade, PreviewKind.HDR, color_context=context)
    assert np.array_equal(project[0, 0, :3], np.round(FALSE_COLOR_PALETTE[4] * 255).astype(np.uint8))
    assert np.array_equal(fixed[0, 0, :3], np.round(FALSE_COLOR_PALETTE[5] * 255).astype(np.uint8))
    assert fixed[0, 0, 3] == project[0, 0, 3]
