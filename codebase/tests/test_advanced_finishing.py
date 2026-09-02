from __future__ import annotations

import numpy as np
import pytest
from pydantic import ValidationError

from hdr_finisher.adjustments import apply_adjustments
from hdr_finisher.finishing import (
    apply_geometry,
    apply_output_finishing,
    geometry_coordinate_map,
    resolve_output_dimensions,
    solve_perspective_guides,
)
from hdr_finisher.models import (
    AdjustmentState,
    GeometryAdjustments,
    OutputFinishingSettings,
    PerspectiveGuideLine,
    PreviewKind,
)


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


def test_neutral_perspective_preserves_the_exact_existing_geometry_path() -> None:
    image = np.random.default_rng(7).random((47, 71, 3), dtype=np.float32) * np.float32(5.0)
    neutral = apply_geometry(image, GeometryAdjustments())
    explicit = apply_geometry(
        image,
        GeometryAdjustments(perspective_horizontal=0.0, perspective_vertical=0.0),
    )
    assert neutral is image
    assert explicit is image


@pytest.mark.parametrize(
    ("horizontal", "vertical"),
    [(100.0, 0.0), (-100.0, 0.0), (0.0, 100.0), (0.0, -100.0), (85.0, -70.0)],
)
def test_perspective_retains_hdr_headroom_and_never_introduces_padding(horizontal: float, vertical: float) -> None:
    image = np.full((96, 144, 3), 4.0, dtype=np.float32)
    output = apply_geometry(
        image,
        GeometryAdjustments(
            straighten_angle=8.0,
            perspective_horizontal=horizontal,
            perspective_vertical=vertical,
        ),
    )
    assert output.dtype == np.float32
    assert output.size > 0
    assert np.isfinite(output).all()
    np.testing.assert_allclose(output, 4.0, atol=2e-5)


@pytest.mark.parametrize(
    "geometry",
    [
        GeometryAdjustments(rotation=90),
        GeometryAdjustments(rotation=270, flip_horizontal=True),
        GeometryAdjustments(straighten_angle=17.0),
        GeometryAdjustments(perspective_horizontal=38.0, perspective_vertical=-24.0),
        GeometryAdjustments(
            rotation=90,
            flip_vertical=True,
            straighten_angle=-6.7,
            crop={"x": 0.1, "y": 0.08, "width": 0.76, "height": 0.81},
        ),
    ],
)
def test_geometry_coordinate_map_round_trips_source_and_display_points(geometry: GeometryAdjustments) -> None:
    output_to_source, source_to_output, width, height = geometry_coordinate_map(131, 79, geometry)
    output_matrix = np.asarray(output_to_source, dtype=np.float64).reshape(3, 3)
    source_matrix = np.asarray(source_to_output, dtype=np.float64).reshape(3, 3)
    product = output_matrix @ source_matrix
    product /= product[2, 2]
    np.testing.assert_allclose(product, np.eye(3), atol=2e-6)
    assert width > 0 and height > 0

    points = np.array([[0.23, 0.31, 1.0], [0.5, 0.5, 1.0], [0.78, 0.62, 1.0]]).T
    displayed = source_matrix @ points
    displayed /= displayed[2]
    restored = output_matrix @ displayed
    restored /= restored[2]
    np.testing.assert_allclose(restored, points, atol=2e-6)


def test_quarter_turn_coordinate_map_matches_clockwise_editor_semantics() -> None:
    output_to_source, source_to_output, _width, _height = geometry_coordinate_map(
        131,
        79,
        GeometryAdjustments(rotation=90),
    )
    source_matrix = np.asarray(source_to_output, dtype=np.float64).reshape(3, 3)
    displayed = source_matrix @ np.array([0.23, 0.31, 1.0])
    displayed /= displayed[2]
    np.testing.assert_allclose(displayed[:2], [0.69, 0.23], atol=2e-6)


def test_vertical_guides_solve_to_supported_perspective_and_level() -> None:
    guides = [
        PerspectiveGuideLine(start={"x": 0.28, "y": 0.12}, end={"x": 0.31, "y": 0.88}),
        PerspectiveGuideLine(start={"x": 0.72, "y": 0.12}, end={"x": 0.69, "y": 0.88}),
    ]
    horizontal, vertical, straighten, residual = solve_perspective_guides(
        1200,
        800,
        GeometryAdjustments(),
        guides,
        [],
    )
    assert horizontal == 0.0
    assert abs(vertical) > 1.0
    assert abs(straighten) < 45.0
    assert residual <= 0.25


def test_combined_guides_jointly_solve_both_axes_and_straighten() -> None:
    vertical_guides = [
        PerspectiveGuideLine(start={"x": 0.28, "y": 0.12}, end={"x": 0.31, "y": 0.88}),
        PerspectiveGuideLine(start={"x": 0.72, "y": 0.12}, end={"x": 0.69, "y": 0.88}),
    ]
    horizontal_guides = [
        PerspectiveGuideLine(start={"x": 0.12, "y": 0.28}, end={"x": 0.88, "y": 0.31}),
        PerspectiveGuideLine(start={"x": 0.12, "y": 0.72}, end={"x": 0.88, "y": 0.69}),
    ]
    horizontal, vertical, straighten, residual = solve_perspective_guides(
        1200,
        800,
        GeometryAdjustments(),
        vertical_guides,
        horizontal_guides,
    )
    assert abs(horizontal) > 1.0
    assert abs(vertical) > 1.0
    assert abs(straighten) < 45.0
    assert residual <= 0.25


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
