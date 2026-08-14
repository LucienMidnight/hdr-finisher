from __future__ import annotations

import numpy as np

from hdr_finisher.models import AdjustmentState, LocalAdjustment, MaskExpression, MaskLeaf, OverlayMode, PreviewKind
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
