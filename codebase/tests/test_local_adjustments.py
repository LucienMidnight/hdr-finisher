from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from hdr_finisher.adjustments import apply_adjustments
from hdr_finisher import local_adjustments as local_mask_module
from hdr_finisher.local_adjustments import apply_local_stack, compile_preview_mask, evaluate_mask, source_coordinate_grid
from hdr_finisher.models import (
    AdjustmentState,
    BrushStroke,
    EditCommand,
    GeometryAdjustments,
    LocalAdjustment,
    LocalGrade,
    MaskExpression,
    MaskLeaf,
    MaskPoint,
    PreviewKind,
)
from hdr_finisher.projects import open_project, save_project
from hdr_finisher.render_cache import SessionRenderCache
from hdr_finisher.sessions import RevisionConflictError, SessionStore


def _leaf(leaf: MaskLeaf, *, inverted: bool = False) -> MaskExpression:
    return MaskExpression(leaf=leaf, inverted=inverted)


def _gradient() -> MaskExpression:
    return _leaf(
        MaskLeaf(
            type="linear_gradient",
            start=MaskPoint(x=0.0, y=0.5),
            end=MaskPoint(x=1.0, y=0.5),
        )
    )


def test_mask_algebra_uses_soft_union_intersection_subtraction_and_inversion() -> None:
    reference = np.full((1, 5, 3), 0.18, dtype=np.float32)
    x = np.linspace(0.0, 1.0, 5, dtype=np.float32)[None, :]
    y = np.full_like(x, 0.5)
    forward = _gradient()
    backward = _leaf(
        MaskLeaf(
            type="linear_gradient",
            start=MaskPoint(x=1.0, y=0.5),
            end=MaskPoint(x=0.0, y=0.5),
        )
    )

    union = MaskExpression(operator="union", children=[forward, backward])
    intersect = MaskExpression(operator="intersect", children=[forward, backward])
    subtract = MaskExpression(operator="subtract", children=[forward, backward])

    np.testing.assert_allclose(evaluate_mask(union, reference, x, y), np.maximum(x, 1.0 - x))
    np.testing.assert_allclose(evaluate_mask(intersect, reference, x, y), x * (1.0 - x), atol=1e-6)
    np.testing.assert_allclose(evaluate_mask(subtract, reference, x, y), (1.0 - x) ** 2, atol=1e-6)
    np.testing.assert_allclose(evaluate_mask(_gradient().model_copy(update={"inverted": True}), reference, x, y), x, atol=1e-6)


def test_gradient_starts_full_fades_to_zero_and_uses_two_falloff_anchors() -> None:
    reference = np.full((1, 7, 3), 0.18, dtype=np.float32)
    x = np.linspace(0.0, 1.0, 7, dtype=np.float32)[None, :]
    y = np.full_like(x, 0.5)
    mask = evaluate_mask(_gradient(), reference, x, y)

    np.testing.assert_allclose(mask, [[1.0, 5 / 6, 2 / 3, 1 / 2, 1 / 3, 1 / 6, 0.0]], atol=1e-6)

    compressed = _leaf(MaskLeaf(
        type="linear_gradient",
        start=MaskPoint(x=0.0, y=0.5),
        end=MaskPoint(x=1.0, y=0.5),
        gradient_midpoint_1=0.1,
        gradient_midpoint_2=0.2,
    ))
    compressed_mask = evaluate_mask(compressed, reference, x, y)
    assert compressed_mask[0, 1] < mask[0, 1]
    assert compressed_mask[0, 0] == pytest.approx(1.0)
    assert compressed_mask[0, -1] == pytest.approx(0.0)


def test_gradient_fan_curves_the_zero_end_without_moving_the_center_anchors() -> None:
    reference = np.full((5, 5, 3), 0.18, dtype=np.float32)
    x = np.linspace(0.0, 1.0, 5, dtype=np.float32)[None, :].repeat(5, axis=0)
    y = x.T
    plain = evaluate_mask(_gradient(), reference, x, y)
    fanned = evaluate_mask(_leaf(MaskLeaf(
        type="linear_gradient",
        start=MaskPoint(x=0.0, y=0.5),
        end=MaskPoint(x=1.0, y=0.5),
        gradient_fan=1.0,
    )), reference, x, y)

    np.testing.assert_allclose(fanned[2], plain[2], atol=1e-6)
    assert fanned[0, 3] > plain[0, 3]


def test_gradient_luminance_range_can_preserve_deep_blacks() -> None:
    ev = np.array([-12.0, -8.0, -4.0, 0.0], dtype=np.float32)
    values = 0.18 * np.exp2(ev)
    reference = np.repeat(values[None, :, None], 3, axis=-1).astype(np.float32)
    x = np.zeros((1, 4), dtype=np.float32)
    y = np.full_like(x, 0.5)
    gradient = _leaf(MaskLeaf(
        type="linear_gradient",
        start=MaskPoint(x=0.0, y=0.5),
        end=MaskPoint(x=1.0, y=0.5),
        gradient_luma_enabled=True,
        fade_in_start_ev=-12,
        full_start_ev=-8,
        full_end_ev=8,
        fade_out_end_ev=12,
    ))
    mask = evaluate_mask(gradient, reference, x, y)

    assert mask[0, 0] == pytest.approx(0.0)
    assert mask[0, 1] == pytest.approx(1.0)
    assert mask[0, 2] == pytest.approx(1.0)


def test_luminance_range_is_an_ev_trapezoid_relative_to_diffuse_white() -> None:
    ev = np.array([-4.0, -2.0, 0.0, 2.0, 4.0], dtype=np.float32)
    values = 0.18 * np.exp2(ev)
    reference = np.repeat(values[None, :, None], 3, axis=-1).astype(np.float32)
    x = np.linspace(0.0, 1.0, 5, dtype=np.float32)[None, :]
    y = np.full_like(x, 0.5)
    expression = _leaf(
        MaskLeaf(
            type="luminance_range",
            fade_in_start_ev=-4,
            full_start_ev=-2,
            full_end_ev=2,
            fade_out_end_ev=4,
        )
    )
    np.testing.assert_allclose(evaluate_mask(expression, reference, x, y), [[0.0, 1.0, 1.0, 1.0, 0.0]], atol=1e-5)


def test_empty_brush_starts_clear_and_flow_builds_to_the_opacity_ceiling() -> None:
    reference = np.full((5, 5, 3), 0.18, dtype=np.float32)
    x = np.linspace(0.0, 1.0, 5, dtype=np.float32)[None, :].repeat(5, axis=0)
    y = x.T
    empty = _leaf(MaskLeaf(type="brush"))
    np.testing.assert_array_equal(evaluate_mask(empty, reference, x, y), np.zeros((5, 5), dtype=np.float32))

    stroke = BrushStroke(
        points=[MaskPoint(x=0.5, y=0.5)],
        radius=0.3,
        hardness=1.0,
        flow=0.2,
        opacity=0.5,
    )
    brush = _leaf(MaskLeaf(type="brush", strokes=[stroke, stroke, stroke]))
    assert evaluate_mask(brush, reference, x, y)[2, 2] == pytest.approx(0.5)


def test_brush_eraser_subtracts_from_existing_coverage() -> None:
    reference = np.full((3, 3, 3), 0.18, dtype=np.float32)
    x = np.linspace(0.0, 1.0, 3, dtype=np.float32)[None, :].repeat(3, axis=0)
    y = x.T
    point = [MaskPoint(x=0.5, y=0.5)]
    paint = BrushStroke(points=point, radius=0.4, hardness=1.0)
    erase = BrushStroke(points=point, radius=0.4, hardness=1.0, flow=0.5, erase=True)
    brush = _leaf(MaskLeaf(type="brush", strokes=[paint, erase]))
    assert evaluate_mask(brush, reference, x, y)[1, 1] == pytest.approx(0.5)


@pytest.mark.parametrize(
    ("shift_edge", "feather"),
    [(0.0, 0.04), (0.026, 0.024)],
)
def test_brush_eraser_cannot_strengthen_a_post_processed_mask(
    shift_edge: float,
    feather: float,
) -> None:
    reference = np.full((129, 129, 3), 0.18, dtype=np.float32)
    x = np.linspace(0.0, 1.0, 129, dtype=np.float32)[None, :].repeat(129, axis=0)
    y = x.T
    paint = BrushStroke(
        points=[MaskPoint(x=0.25, y=0.5), MaskPoint(x=0.75, y=0.5)],
        radius=0.07,
        hardness=0.64,
        flow=0.35,
        opacity=0.7,
    )
    erase = BrushStroke(
        points=[MaskPoint(x=0.42, y=0.5), MaskPoint(x=0.56, y=0.5)],
        radius=0.07,
        hardness=0.64,
        flow=0.35,
        opacity=0.7,
        erase=True,
    )
    painted = evaluate_mask(
        _leaf(MaskLeaf(
            type="brush",
            strokes=[paint],
            mask_shift_edge=shift_edge,
            mask_feather=feather,
        )),
        reference,
        x,
        y,
    )
    erased = evaluate_mask(
        _leaf(MaskLeaf(
            type="brush",
            strokes=[paint, erase],
            mask_shift_edge=shift_edge,
            mask_feather=feather,
        )),
        reference,
        x,
        y,
    )

    assert np.all(erased <= painted + 1e-6)
    assert float(np.sum(erased)) < float(np.sum(painted))
    assert erased[64, 64] < painted[64, 64] * 0.8


@pytest.mark.parametrize(
    ("shift_edge", "feather", "mask_opacity", "inverted"),
    [
        (0.04, 0.0, 1.0, False),
        (0.0, 0.04, 1.0, False),
        (0.04, 0.02, 0.42, False),
        (0.04, 0.02, 1.0, True),
        (0.04, 0.02, 0.42, True),
    ],
)
def test_brush_eraser_is_applied_after_every_mask_control(
    shift_edge: float,
    feather: float,
    mask_opacity: float,
    inverted: bool,
) -> None:
    size = 257
    reference = np.full((size, size, 3), 0.18, dtype=np.float32)
    x = np.linspace(0.0, 1.0, size, dtype=np.float32)[None, :].repeat(size, axis=0)
    y = x.T
    paint = BrushStroke(
        points=[MaskPoint(x=0.5, y=0.5)],
        radius=0.08,
        hardness=1.0,
        flow=1.0,
        opacity=1.0,
    )
    erase = BrushStroke(
        points=[MaskPoint(x=0.60, y=0.5)],
        radius=0.045,
        hardness=1.0,
        flow=1.0,
        opacity=1.0,
        erase=True,
    )

    def mask(strokes: list[BrushStroke]) -> MaskExpression:
        return _leaf(
            MaskLeaf(
                type="brush",
                strokes=strokes,
                mask_shift_edge=shift_edge,
                mask_feather=feather,
                mask_opacity=mask_opacity,
            ),
            inverted=inverted,
        )

    painted = evaluate_mask(mask([paint]), reference, x, y)
    erased = evaluate_mask(mask([paint, erase]), reference, x, y)
    target_column = round(0.60 * (size - 1))

    # This point is beyond the original 0.08-radius paint dab. Its coverage is
    # created by Shift Edge, Feather, or Invert, so erasing it proves that the
    # eraser is the final operation rather than being clipped to raw paint.
    assert local_mask_module._brush_mask(MaskLeaf(type="brush", strokes=[paint]), x, y)[128, target_column] == 0.0
    assert painted[128, target_column] > 0.05
    assert erased[128, target_column] < painted[128, target_column] * 0.1
    assert np.all(erased <= painted + 1e-6)
    assert float(np.max(erased)) <= mask_opacity + 1e-6


def test_painted_mask_feather_opacity_and_inversion_apply_after_stroke_composition() -> None:
    reference = np.full((65, 65, 3), 0.18, dtype=np.float32)
    x = np.linspace(0.0, 1.0, 65, dtype=np.float32)[None, :].repeat(65, axis=0)
    y = x.T
    stroke = BrushStroke(
        points=[MaskPoint(x=0.5, y=0.5)],
        radius=0.1,
        hardness=1.0,
    )
    leaf = MaskLeaf(type="brush", strokes=[stroke], mask_feather=0.025, mask_opacity=0.5)
    normal = evaluate_mask(_leaf(leaf), reference, x, y)
    inverted = evaluate_mask(_leaf(leaf, inverted=True), reference, x, y)

    assert 0.0 < normal[32, 40] < 0.5
    assert normal[32, 32] == pytest.approx(0.5)
    assert inverted[0, 0] == pytest.approx(0.5, abs=1 / 255)
    assert inverted[32, 32] < inverted[0, 0]


def test_painted_mask_feather_preserves_peak_density_while_smoothing_the_edge() -> None:
    reference = np.full((129, 129, 3), 0.18, dtype=np.float32)
    x = np.linspace(0.0, 1.0, 129, dtype=np.float32)[None, :].repeat(129, axis=0)
    y = x.T
    stroke = BrushStroke(points=[MaskPoint(x=0.5, y=0.5)], radius=0.08, hardness=1.0)
    plain = evaluate_mask(_leaf(MaskLeaf(type="brush", strokes=[stroke])), reference, x, y)
    feathered = evaluate_mask(
        _leaf(MaskLeaf(type="brush", strokes=[stroke], mask_feather=0.02)),
        reference,
        x,
        y,
    )

    assert feathered[64, 64] == pytest.approx(plain[64, 64])
    assert feathered[64, 80] > plain[64, 80]
    assert feathered[64, 73] < plain[64, 73]


def test_painted_mask_feather_does_not_amplify_a_low_density_core() -> None:
    reference = np.full((257, 257, 3), 0.18, dtype=np.float32)
    x = np.linspace(0.0, 1.0, 257, dtype=np.float32)[None, :].repeat(257, axis=0)
    y = x.T
    stroke = BrushStroke(
        points=[MaskPoint(x=0.5, y=0.5)],
        radius=0.12,
        hardness=1.0,
        opacity=0.25,
    )
    plain = evaluate_mask(_leaf(MaskLeaf(type="brush", strokes=[stroke])), reference, x, y)
    feathered = evaluate_mask(
        _leaf(MaskLeaf(type="brush", strokes=[stroke], mask_feather=0.025)),
        reference,
        x,
        y,
    )

    assert feathered[128, 128] == pytest.approx(plain[128, 128], abs=1 / 255)
    assert feathered[128, 164] > plain[128, 164]


def test_painted_mask_feather_does_not_strengthen_the_grade_inside_the_core() -> None:
    image = np.full((257, 257, 3), 0.18, dtype=np.float32)
    stroke = BrushStroke(
        points=[MaskPoint(x=0.5, y=0.5)],
        radius=0.12,
        hardness=1.0,
        opacity=0.25,
    )
    plain = LocalAdjustment(
        mask=_leaf(MaskLeaf(type="brush", strokes=[stroke])),
        hdr_grade=LocalGrade(exposure=-1.0),
    )
    feathered = LocalAdjustment(
        mask=_leaf(MaskLeaf(type="brush", strokes=[stroke], mask_feather=0.025)),
        hdr_grade=LocalGrade(exposure=-1.0),
    )

    plain_result = apply_local_stack(image, image, [plain], PreviewKind.HDR, GeometryAdjustments(), tile_size=257)
    feathered_result = apply_local_stack(image, image, [feathered], PreviewKind.HDR, GeometryAdjustments(), tile_size=257)

    np.testing.assert_allclose(feathered_result[128, 128], plain_result[128, 128], atol=1e-4)
    assert np.all(feathered_result[128, 164] < plain_result[128, 164])


def test_painted_mask_feather_responds_within_each_former_level_plateau() -> None:
    reference = np.full((129, 129, 3), 0.18, dtype=np.float32)
    x = np.linspace(0.0, 1.0, 129, dtype=np.float32)[None, :].repeat(129, axis=0)
    y = x.T
    stroke = BrushStroke(points=[MaskPoint(x=0.5, y=0.5)], radius=0.08, hardness=1.0)
    masks = [
        evaluate_mask(_leaf(MaskLeaf(type="brush", strokes=[stroke], mask_feather=value)), reference, x, y)
        for value in (0.0005, 0.002, 0.004)
    ]

    soft_pixel_counts = [np.count_nonzero((mask > 2 / 255) & (mask < 253 / 255)) for mask in masks]
    assert soft_pixel_counts[0] < soft_pixel_counts[1] < soft_pixel_counts[2]
    for previous, current in zip(masks, masks[1:]):
        assert not np.array_equal(current, previous)


def test_painted_mask_feather_builds_a_progressively_wider_soft_transition() -> None:
    reference = np.full((129, 129, 3), 0.18, dtype=np.float32)
    x = np.linspace(0.0, 1.0, 129, dtype=np.float32)[None, :].repeat(129, axis=0)
    y = x.T
    stroke = BrushStroke(points=[MaskPoint(x=0.5, y=0.5)], radius=0.08, hardness=1.0)
    masks = [
        evaluate_mask(_leaf(MaskLeaf(type="brush", strokes=[stroke], mask_feather=value)), reference, x, y)
        for value in (0.0, 0.0125, 0.025, 0.0375, 0.05)
    ]

    soft_pixel_counts = [np.count_nonzero((mask > 2 / 255) & (mask < 253 / 255)) for mask in masks]
    assert all(current > previous for previous, current in zip(soft_pixel_counts, soft_pixel_counts[1:]))
    assert soft_pixel_counts[-1] > soft_pixel_counts[1] * 2
    assert all(mask[64, 64] == pytest.approx(masks[0][64, 64]) for mask in masks)


@pytest.mark.parametrize("resolution", [257, 513])
@pytest.mark.parametrize("shift_edge", [-0.033, 0.0, 0.033])
@pytest.mark.parametrize("feather", [0.0125, 0.025, 0.05])
@pytest.mark.parametrize("painted_density", [0.35, 1.0])
def test_shift_feather_matrix_retains_smooth_alpha_precision(
    resolution: int,
    shift_edge: float,
    feather: float,
    painted_density: float,
) -> None:
    reference = np.full((resolution, resolution, 3), 0.18, dtype=np.float32)
    stroke = BrushStroke(
        points=[MaskPoint(x=0.5, y=0.5)],
        radius=0.08,
        hardness=1.0,
        flow=painted_density,
    )
    expression = _leaf(MaskLeaf(
        type="brush",
        strokes=[stroke],
        mask_shift_edge=shift_edge,
        mask_feather=feather,
    ))

    compiled = compile_preview_mask(reference, expression, GeometryAdjustments())

    # The former uint8 intermediate collapsed the contracted/max-feather case
    # to five plateaus. A useful mask transition should retain most r8 levels.
    expected_peak = round(255 * painted_density)
    assert len(np.unique(compiled)) >= min(200, round(expected_peak * 0.9))
    assert compiled.max() == pytest.approx(expected_peak, abs=1)


@pytest.mark.parametrize("resolution", [257, 513])
@pytest.mark.parametrize("shift_edge", [-0.033, 0.0, 0.033])
def test_maximum_feather_stays_radially_smooth_after_shift(
    resolution: int,
    shift_edge: float,
) -> None:
    reference = np.full((resolution, resolution, 3), 0.18, dtype=np.float32)
    x, y = source_coordinate_grid(
        resolution,
        resolution,
        0,
        0,
        resolution,
        resolution,
        GeometryAdjustments(),
    )
    stroke = BrushStroke(points=[MaskPoint(x=0.5, y=0.5)], radius=0.08, hardness=1.0)
    mask = evaluate_mask(
        _leaf(MaskLeaf(
            type="brush",
            strokes=[stroke],
            mask_shift_edge=shift_edge,
            mask_feather=0.05,
        )),
        reference,
        x,
        y,
    )
    angular_spreads: list[float] = []
    for radius in np.linspace(0.03, 0.35, 100):
        samples = []
        for angle in np.linspace(0.0, 2.0 * np.pi, 64, endpoint=False):
            row = int(round((0.5 + radius * np.sin(angle)) * resolution - 0.5))
            column = int(round((0.5 + radius * np.cos(angle)) * resolution - 0.5))
            samples.append(mask[np.clip(row, 0, resolution - 1), np.clip(column, 0, resolution - 1)])
        if 0.03 < float(np.mean(samples)) < 0.97:
            angular_spreads.append(float(np.max(samples) - np.min(samples)))

    assert angular_spreads
    assert max(angular_spreads) < 0.04


@pytest.mark.parametrize("shift_edge", [-0.033, 0.0, 0.033])
@pytest.mark.parametrize("feather", [0.0125, 0.025, 0.05])
def test_shift_feather_matrix_is_stable_on_widescreen_preview(
    shift_edge: float,
    feather: float,
) -> None:
    height, width = 271, 481
    reference = np.full((height, width, 3), 0.18, dtype=np.float32)
    stroke = BrushStroke(
        points=[MaskPoint(x=0.3, y=0.46), MaskPoint(x=0.65, y=0.55)],
        radius=0.07,
        hardness=0.64,
        flow=0.35,
        opacity=0.7,
    )
    compiled = compile_preview_mask(
        reference,
        _leaf(MaskLeaf(
            type="brush",
            strokes=[stroke],
            mask_shift_edge=shift_edge,
            mask_feather=feather,
        )),
        GeometryAdjustments(),
    )

    assert compiled.max() == pytest.approx(round(255 * 0.35), abs=1)
    assert np.count_nonzero(compiled) > 0
    if feather == 0.05:
        assert len(np.unique(compiled)) >= 75


def test_shift_edge_expands_and_contracts_before_feathering() -> None:
    reference = np.full((129, 129, 3), 0.18, dtype=np.float32)
    x = np.linspace(0.0, 1.0, 129, dtype=np.float32)[None, :].repeat(129, axis=0)
    y = x.T
    stroke = BrushStroke(points=[MaskPoint(x=0.5, y=0.5)], radius=0.12, hardness=1.0)
    plain = evaluate_mask(_leaf(MaskLeaf(type="brush", strokes=[stroke])), reference, x, y)
    expanded = evaluate_mask(
        _leaf(MaskLeaf(type="brush", strokes=[stroke], mask_shift_edge=0.025)),
        reference,
        x,
        y,
    )
    contracted = evaluate_mask(
        _leaf(MaskLeaf(type="brush", strokes=[stroke], mask_shift_edge=-0.025)),
        reference,
        x,
        y,
    )

    assert expanded.sum() > plain.sum() > contracted.sum()
    assert expanded[64, 64] == pytest.approx(plain[64, 64])


@pytest.mark.parametrize(
    "geometry",
    [
        GeometryAdjustments(),
        GeometryAdjustments(straighten_angle=17.0, flip_horizontal=True),
        GeometryAdjustments(rotation=90, flip_vertical=True),
    ],
)
def test_brush_roi_matches_full_frame_segment_evaluation(geometry: GeometryAdjustments) -> None:
    x, y = source_coordinate_grid(93, 71, 0, 0, 93, 71, geometry)
    stroke = BrushStroke(
        points=[MaskPoint(x=0.17, y=0.24), MaskPoint(x=0.79, y=0.68)],
        radius=0.071,
        hardness=0.43,
        flow=0.62,
        opacity=0.81,
    )
    actual = local_mask_module._brush_mask(MaskLeaf(type="brush", strokes=[stroke]), x, y)
    expected_shape = local_mask_module._soft_segment(
        x,
        y,
        stroke.points[0].x,
        stroke.points[0].y,
        stroke.points[1].x,
        stroke.points[1].y,
        stroke.radius,
        stroke.hardness,
    )
    expected = np.minimum(np.float32(stroke.opacity), expected_shape * np.float32(stroke.flow))
    np.testing.assert_allclose(actual, expected, atol=1e-6)


def test_painted_mask_feather_is_consistent_across_processing_tile_sizes() -> None:
    image = np.full((73, 97, 3), 0.18, dtype=np.float32)
    stroke = BrushStroke(
        points=[MaskPoint(x=0.31, y=0.43), MaskPoint(x=0.77, y=0.61)],
        radius=0.08,
        hardness=1.0,
    )
    local = LocalAdjustment(
        name="Feathered brush",
        mask=_leaf(MaskLeaf(type="brush", strokes=[stroke], mask_feather=0.035)),
        hdr_grade=LocalGrade(exposure=1.0),
    )
    geometry = GeometryAdjustments()
    small_tiles = apply_local_stack(image, image, [local], PreviewKind.HDR, geometry, tile_size=16)
    full_frame = apply_local_stack(image, image, [local], PreviewKind.HDR, geometry, tile_size=128)
    np.testing.assert_allclose(small_tiles, full_frame, atol=1e-6)


def test_local_mask_selection_is_fixed_while_lane_grades_are_independent() -> None:
    image = np.full((16, 16, 3), 0.18, dtype=np.float32)
    local = LocalAdjustment(
        mask=_gradient(),
        hdr_grade=LocalGrade(exposure=1.0),
        sdr_grade=LocalGrade(exposure=-1.0),
    )
    state = AdjustmentState()
    hdr = apply_adjustments(image, state, PreviewKind.HDR, local_adjustments=[local])
    sdr = apply_adjustments(image, state, PreviewKind.SDR, local_adjustments=[local])

    assert hdr[8, 0].mean() > hdr[8, -1].mean()
    assert sdr[8, 0].mean() < sdr[8, -1].mean()


def test_local_bypass_gates_the_entire_adjustment_after_mask_and_grade() -> None:
    image = np.full((32, 32, 3), 0.18, dtype=np.float32)
    local = LocalAdjustment(
        mask=_leaf(MaskLeaf(type="brush", strokes=[BrushStroke(
            points=[MaskPoint(x=0.5, y=0.5)],
            radius=0.3,
            hardness=0.5,
        )], mask_shift_edge=0.03, mask_feather=0.02, mask_opacity=0.6)),
        opacity=0.75,
        hdr_grade=LocalGrade(exposure=1.0, saturation=0.4),
    )
    enabled = apply_local_stack(image, image, [local], PreviewKind.HDR, GeometryAdjustments())
    bypassed_local = local.model_copy(deep=True)
    bypassed_local.enabled = False
    bypassed = apply_local_stack(image, image, [bypassed_local], PreviewKind.HDR, GeometryAdjustments())

    assert not np.array_equal(enabled, image)
    np.testing.assert_array_equal(bypassed, image)
    overlay_mask = SessionRenderCache(image, None).compiled_local_mask(
        AdjustmentState(),
        bypassed_local,
        256,
    )
    assert np.any(overlay_mask > 0)


def test_tiled_local_stack_is_deterministic_across_tile_sizes() -> None:
    rng = np.random.default_rng(12)
    image = rng.uniform(0.02, 1.5, size=(37, 53, 3)).astype(np.float32)
    local = LocalAdjustment(mask=_gradient(), hdr_grade=LocalGrade(exposure=0.7, saturation=0.2))
    geometry = GeometryAdjustments()
    first = apply_local_stack(image, image, [local], PreviewKind.HDR, geometry, tile_size=8)
    second = apply_local_stack(image, image, [local], PreviewKind.HDR, geometry, tile_size=19)
    np.testing.assert_allclose(first, second, rtol=2e-6, atol=2e-6)


def test_preview_mask_quantization_stays_within_one_r8_step() -> None:
    image = np.full((7, 17, 3), 0.18, dtype=np.float32)
    geometry = GeometryAdjustments()
    x, y = source_coordinate_grid(17, 7, 0, 0, 17, 7, geometry)
    floating = evaluate_mask(_gradient(), image, x, y)
    compiled = compile_preview_mask(image, _gradient(), geometry).astype(np.float32) / 255.0
    assert float(np.max(np.abs(floating - compiled))) <= (1.0 / 255.0 + 1e-7)


def test_preview_cache_reuses_compiled_mask_when_only_grade_changes() -> None:
    image = np.full((32, 48, 3), 0.18, dtype=np.float32)
    cache = SessionRenderCache(image, None)
    first = LocalAdjustment(mask=_gradient(), hdr_grade=LocalGrade(exposure=0.2))
    second = first.model_copy(deep=True)
    second.hdr_grade.exposure = 0.8
    cache.adjusted_frame(AdjustmentState(), PreviewKind.HDR, 256, local_adjustments=[first])
    first_diagnostics = cache.diagnostics()
    cache.adjusted_frame(AdjustmentState(), PreviewKind.HDR, 256, local_adjustments=[second])
    second_diagnostics = cache.diagnostics()
    assert first_diagnostics["local_mask_entries"] == 1
    assert second_diagnostics["local_mask_entries"] == 1
    assert second_diagnostics["local_mask_bytes"] == first_diagnostics["local_mask_bytes"]


def test_source_coordinates_follow_crop_and_quarter_rotation() -> None:
    geometry = GeometryAdjustments.model_validate(
        {"rotation": 90, "crop": {"x": 0.25, "y": 0.0, "width": 0.5, "height": 1.0}}
    )
    x, y = source_coordinate_grid(2, 2, 0, 0, 2, 2, geometry)
    np.testing.assert_allclose(x, [[0.25, 0.25], [0.75, 0.75]], atol=1e-6)
    np.testing.assert_allclose(y, [[0.625, 0.375], [0.625, 0.375]], atol=1e-6)


def test_revisioned_commands_reject_stale_edits_and_support_undo(tmp_path: Path) -> None:
    source = tmp_path / "source.png"
    Image.fromarray(np.full((8, 8, 3), 128, dtype=np.uint8)).save(source)
    store = SessionStore()
    payload = store.create_session(source, owns_source_path=False)
    local = LocalAdjustment(mask=_gradient())
    result = store.apply_edit_commands(
        payload.session_id,
        [EditCommand(expected_revision=0, command_type="create_local", payload={"local": local.model_dump(mode="json")})],
    )
    assert result.revision == 1
    assert [item.id for item in result.document.local_adjustments] == [local.id]

    with pytest.raises(RevisionConflictError):
        store.apply_edit_commands(
            payload.session_id,
            [EditCommand(expected_revision=0, command_type="delete_local", target_id=local.id)],
        )

    undone = store.apply_edit_commands(
        payload.session_id,
        [EditCommand(expected_revision=1, command_type="undo")],
    )
    assert undone.revision == 2
    assert undone.document.local_adjustments == []


def test_project_round_trip_keeps_vector_state_and_references_source(tmp_path: Path) -> None:
    source = tmp_path / "durable-source.png"
    Image.fromarray(np.full((12, 10, 3), 96, dtype=np.uint8)).save(source)
    store = SessionStore()
    payload = store.create_session(source, owns_source_path=False)
    local = LocalAdjustment(name="Sky", mask=_gradient(), hdr_grade=LocalGrade(exposure=-0.4))
    store.apply_edit_commands(
        payload.session_id,
        [EditCommand(expected_revision=0, command_type="create_local", payload={"local": local.model_dump(mode="json")})],
    )
    project_path = tmp_path / "edit.hdrfinisher"
    saved = save_project(store.get(payload.session_id), project_path)
    assert saved.document.source.durable_path == str(source.resolve())

    reopened = open_project(store, project_path)
    assert reopened.local_adjustments[0].name == "Sky"
    assert reopened.local_adjustments[0].hdr_grade.exposure == pytest.approx(-0.4)
    assert reopened.source_path == source.resolve()
