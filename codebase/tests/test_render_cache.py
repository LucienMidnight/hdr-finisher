from __future__ import annotations

import numpy as np

from hdr_finisher.models import AdjustmentState, OverlayMode, PreviewKind
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
