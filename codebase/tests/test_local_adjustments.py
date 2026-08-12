from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from hdr_finisher.adjustments import apply_adjustments
from hdr_finisher.local_adjustments import apply_local_stack, compile_preview_mask, evaluate_mask, source_coordinate_grid
from hdr_finisher.models import (
    AdjustmentState,
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
    np.testing.assert_allclose(evaluate_mask(intersect, reference, x, y), x * (1.0 - x))
    np.testing.assert_allclose(evaluate_mask(subtract, reference, x, y), x * x)
    np.testing.assert_allclose(evaluate_mask(_gradient().model_copy(update={"inverted": True}), reference, x, y), 1.0 - x)


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

    assert hdr[8, -1].mean() > hdr[8, 0].mean()
    assert sdr[8, -1].mean() < sdr[8, 0].mean()


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
