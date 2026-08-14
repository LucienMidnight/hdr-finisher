from __future__ import annotations

import numpy as np
import pytest
from pydantic import ValidationError

from hdr_finisher.adjustments import apply_adjustments
from hdr_finisher.finishing import apply_geometry, apply_output_finishing, resolve_output_dimensions
from hdr_finisher.models import AdjustmentState, GeometryAdjustments, OutputFinishingSettings, PreviewKind


def test_geometry_is_shared_and_rotation_crop_dimensions_align_between_lanes() -> None:
    image = np.arange(8 * 12 * 3, dtype=np.float32).reshape(8, 12, 3) / 100
    state = AdjustmentState()
    state.shared.geometry = GeometryAdjustments(
        rotation=90,
        crop={"x": 0.25, "y": 0.125, "width": 0.5, "height": 0.75},
    )
    hdr = apply_adjustments(image, state, PreviewKind.HDR)
    sdr = apply_adjustments(image, state, PreviewKind.SDR)
    assert hdr.shape == sdr.shape == (8, 4, 3)


def test_straighten_returns_only_finite_valid_pixels_without_padding() -> None:
    image = np.ones((40, 60, 3), dtype=np.float32)
    output = apply_geometry(image, GeometryAdjustments(straighten_angle=17.5))
    assert output.shape[0] < image.shape[0]
    assert output.shape[1] < image.shape[1]
    np.testing.assert_allclose(output, 1.0, atol=1e-6)


def test_invalid_crop_and_export_dimensions_are_rejected() -> None:
    with pytest.raises(ValidationError):
        GeometryAdjustments(crop={"x": 0.8, "y": 0, "width": 0.4, "height": 1})
    with pytest.raises(ValidationError):
        OutputFinishingSettings(resize_mode="fit", width=100)


def test_color_grading_tint_preserves_luminance_when_luminance_control_is_neutral() -> None:
    image = np.full((16, 16, 3), 0.18, dtype=np.float32)
    state = AdjustmentState()
    state.hdr.color_grading.shadows.hue = 25
    state.hdr.color_grading.shadows.saturation = 70
    output = apply_adjustments(image, state, PreviewKind.HDR)
    weights = np.array([0.2722287, 0.6740818, 0.0536895], dtype=np.float32)
    np.testing.assert_allclose(output @ weights, image @ weights, rtol=2e-5, atol=2e-6)
    assert not np.allclose(output, image)


def test_vignette_center_and_highlight_protection_behave_independently() -> None:
    image = np.full((65, 65, 3), 0.18, dtype=np.float32)
    image[0, 0] = 4.0
    state = AdjustmentState()
    state.hdr.vignette.amount = -100
    state.hdr.vignette.center_x = 0
    state.hdr.vignette.center_y = 0
    protected = state.model_copy(deep=True)
    protected.hdr.vignette.highlight_protection = 100
    dark = apply_adjustments(image, state, PreviewKind.HDR)
    guarded = apply_adjustments(image, protected, PreviewKind.HDR)
    assert dark[0, 0].mean() == pytest.approx(image[0, 0].mean(), rel=1e-5)
    assert guarded[-1, -1].mean() < guarded[0, 0].mean()


def test_vignette_is_evaluated_in_cropped_output_coordinates() -> None:
    image = np.ones((80, 160, 3), dtype=np.float32)
    cropped_state = AdjustmentState()
    cropped_state.shared.geometry = GeometryAdjustments(
        crop={"x": 0.25, "y": 0.0, "width": 0.5, "height": 1.0},
        ratio_mode="1:1",
    )
    cropped_state.hdr.vignette.amount = -100
    cropped_state.hdr.vignette.midpoint = 25
    cropped_state.hdr.vignette.feather = 50

    cropped_result = apply_adjustments(image, cropped_state, PreviewKind.HDR)

    already_cropped = apply_geometry(image, cropped_state.shared.geometry)
    output_space_state = cropped_state.model_copy(deep=True)
    output_space_state.shared.geometry = GeometryAdjustments()
    output_space_result = apply_adjustments(already_cropped, output_space_state, PreviewKind.HDR)

    assert cropped_result.shape == (80, 80, 3)
    np.testing.assert_allclose(cropped_result, output_space_result, rtol=0.0, atol=0.0)
    assert cropped_result[40, 40].mean() > cropped_result[0, 0].mean()


def test_output_resize_preserves_aspect_and_prevents_enlargement() -> None:
    settings = OutputFinishingSettings(resize_mode="fit", width=500, height=500)
    assert resolve_output_dimensions(1200, 800, settings) == (500, 333)
    no_enlarge = OutputFinishingSettings(resize_mode="long_edge", long_edge=2400, prevent_enlargement=True)
    assert resolve_output_dimensions(1200, 800, no_enlarge) == (1200, 800)


def test_output_sharpening_leaves_flat_fields_unchanged_and_hdr_finite() -> None:
    flat = np.full((48, 64, 3), 2.5, dtype=np.float32)
    settings = OutputFinishingSettings(sharpening="strong")
    output = apply_output_finishing(flat, settings, PreviewKind.HDR)
    np.testing.assert_array_equal(output, flat)
    assert np.isfinite(output).all()
    assert output.min() >= 0
