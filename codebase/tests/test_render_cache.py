from __future__ import annotations

import numpy as np

from hdr_finisher.finishing import apply_geometry
from hdr_finisher.models import AdjustmentState, GeometryAdjustments, LocalAdjustment, MaskExpression, MaskLeaf, OverlayMode, PreviewKind
from hdr_finisher.render_cache import SessionRenderCache, adjustment_signature, encode_rgba32f_proxy


def test_adjusted_proxy_is_downsampled_before_processing_and_reused() -> None:
    image = np.linspace(0.0, 4.0, 800 * 1200 * 3, dtype=np.float32).reshape(800, 1200, 3)
    adjustments = AdjustmentState()
    adjustments.hdr.exposure = 1.0
    cache = SessionRenderCache(image, None)

    first = cache.adjusted_frame(adjustments, PreviewKind.HDR, 600)
    second = cache.adjusted_frame(adjustments, PreviewKind.HDR, 600)

    assert first.shape == (400, 600, 3)
    assert second is first
    assert not first.flags.writeable


def test_scope_request_counts_one_top_level_miss_then_one_hit() -> None:
    image = np.full((64, 96, 3), 0.18, dtype=np.float32)
    cache = SessionRenderCache(image, None)
    adjustments = AdjustmentState()

    cache.scope_result(adjustments, PreviewKind.HDR, 256, "histogram", 64, 64)
    after_miss = cache.diagnostics()
    cache.scope_result(adjustments, PreviewKind.HDR, 256, "histogram", 64, 64)
    after_hit = cache.diagnostics()

    assert after_miss["misses"] == 1
    assert after_miss["hits"] == 0
    assert after_hit["misses"] == 1
    assert after_hit["hits"] == 1


def test_overlay_only_changes_do_not_invalidate_adjusted_pixels() -> None:
    first = AdjustmentState()
    second = first.model_copy(deep=True)
    second.shared.overlay_mode = OverlayMode.FALSE_COLOR
    second.shared.overlay_opacity = 0.25

    assert adjustment_signature(first) == adjustment_signature(second)


def test_webgpu_proxy_rows_are_aligned_rgba32f() -> None:
    image = np.array([[[0.25, 0.5, 1.0], [2.0, 3.0, 4.0]]], dtype=np.float32)
    body, bytes_per_row = encode_rgba32f_proxy(image)
    packed = np.frombuffer(body, dtype="<f4").reshape(1, bytes_per_row // 4)

    assert bytes_per_row == 256
    assert len(body) == 256
    np.testing.assert_allclose(packed[0, :8], [0.25, 0.5, 1.0, 1.0, 2.0, 3.0, 4.0, 1.0])


def test_webgpu_source_proxy_applies_committed_geometry_before_grading() -> None:
    image = np.arange(8 * 12 * 3, dtype=np.float32).reshape(8, 12, 3)
    adjustments = AdjustmentState()
    adjustments.shared.geometry = GeometryAdjustments(
        rotation=90,
        crop={"x": 0.25, "y": 0.125, "width": 0.5, "height": 0.75},
    )
    cache = SessionRenderCache(image, None)

    source, _working_space = cache.source_proxy(PreviewKind.HDR, 256)
    proxy, working_space, geometry_signature = cache.geometry_source_proxy(
        PreviewKind.HDR,
        256,
        adjustments,
    )

    np.testing.assert_array_equal(proxy, apply_geometry(source, adjustments.shared.geometry))
    assert proxy.shape == (8, 4, 3)
    assert working_space == "acescg"
    assert geometry_signature == adjustments.shared.geometry.model_dump_json()


def test_geometry_cannot_expand_cpu_or_gpu_preview_past_both_dimension_caps() -> None:
    image = np.full((180, 420, 3), 0.18, dtype=np.float32)
    adjustments = AdjustmentState()
    adjustments.shared.geometry = GeometryAdjustments(straighten_angle=25)
    cache = SessionRenderCache(image, None)

    proxy, _working_space, _signature = cache.geometry_source_proxy(PreviewKind.HDR, 256, adjustments)
    frame = cache.adjusted_frame(adjustments, PreviewKind.HDR, 256)

    assert proxy.shape[0] <= 256 and proxy.shape[1] <= 256
    assert frame.shape[0] <= 256 and frame.shape[1] <= 256


def test_simple_mask_opacity_reuses_the_spatial_mask_cache() -> None:
    image = np.full((256, 256, 3), 0.18, dtype=np.float32)
    adjustments = AdjustmentState()
    cache = SessionRenderCache(image, None)
    expression = MaskExpression(
        operator="leaf",
        leaf=MaskLeaf(type="luminance_range", mask_opacity=1.0),
    )
    local = LocalAdjustment(id="luma-cache", mask=expression)

    first = cache.compiled_local_mask(adjustments, local, 256, spatial_only=True)
    changed = local.model_copy(
        update={"mask": expression.model_copy(update={"leaf": expression.leaf.model_copy(update={"mask_opacity": 0.25})})},
        deep=True,
    )
    second = cache.compiled_local_mask(adjustments, changed, 256, spatial_only=True)
    exact = cache.compiled_local_mask(adjustments, changed, 256)

    assert second is first
    assert cache.diagnostics()["local_mask_entries"] == 1
    assert np.max(exact) <= np.ceil(np.max(first) * 0.25)


def test_clear_adjusted_preserves_masks_but_source_replacement_does_not() -> None:
    image = np.full((256, 256, 3), 0.18, dtype=np.float32)
    cache = SessionRenderCache(image, None)
    local = LocalAdjustment(id="mask-lifetime")
    cache.compiled_local_mask(AdjustmentState(), local, 256, spatial_only=True)

    cache.clear_adjusted()
    assert cache.diagnostics()["local_mask_entries"] == 1
    cache.replace_source(image * 2, None)
    assert cache.diagnostics()["local_mask_entries"] == 0


def test_interactive_proxy_and_mask_work_do_not_change_authoritative_local_output() -> None:
    rows = np.linspace(0.001, 8.0, 384, dtype=np.float32)[:, None, None]
    columns = np.linspace(0.75, 1.25, 512, dtype=np.float32)[None, :, None]
    image = np.repeat(rows * columns, 3, axis=2)
    adjustments = AdjustmentState()
    expression = MaskExpression(
        operator="leaf",
        leaf=MaskLeaf(
            type="luminance_range",
            fade_in_start_ev=-2,
            full_start_ev=-1,
            full_end_ev=1,
            fade_out_end_ev=2,
            mask_feather=0.05,
        ),
    )
    local = LocalAdjustment(id="export-invariance", mask=expression)
    local.hdr_grade.exposure = 1.5

    exercised = SessionRenderCache(image, None)
    exercised.source_proxy(PreviewKind.HDR, 256)
    exercised.compiled_local_mask(adjustments, local, 256, spatial_only=True)
    after_interaction = exercised.adjusted_frame(
        adjustments,
        PreviewKind.HDR,
        512,
        local_adjustments=[local],
    )

    fresh = SessionRenderCache(image, None)
    authoritative = fresh.adjusted_frame(
        adjustments,
        PreviewKind.HDR,
        512,
        local_adjustments=[local],
    )

    np.testing.assert_array_equal(after_interaction, authoritative)
