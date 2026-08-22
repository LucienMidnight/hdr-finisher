from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import time

import numpy as np
import pytest

import hdr_finisher.render_cache as render_cache_module
from hdr_finisher.loader import _display_p3_to_linear_srgb
from hdr_finisher.models import AdjustmentState, PreviewKind
from hdr_finisher.render_cache import SessionRenderCache, encode_rgba_proxy
from hdr_finisher.scopes import _waveform_grid, build_scope


def test_half_float_proxy_is_aligned_and_guarded_by_range() -> None:
    image = np.array([[[0.25, 0.5, 1.0], [2.0, 3.0, 4.0]]], dtype=np.float32)
    body, bytes_per_row, pixel_format = encode_rgba_proxy(image)
    packed = np.frombuffer(body, dtype="<f2").reshape(1, bytes_per_row // 2)

    assert pixel_format == "rgba16float"
    assert bytes_per_row == 256
    assert len(body) == 256
    np.testing.assert_allclose(packed[0, :8], [0.25, 0.5, 1.0, 1.0, 2.0, 3.0, 4.0, 1.0], rtol=1e-3)

    extreme = image.copy()
    extreme[0, 0, 0] = 70000.0
    _body, _stride, fallback_format = encode_rgba_proxy(extreme)
    assert fallback_format == "rgba32float"


def test_half_float_1600_by_1200_payload_is_exactly_aligned() -> None:
    image = np.zeros((1200, 1600, 3), dtype=np.float32)

    body, bytes_per_row, pixel_format = encode_rgba_proxy(image)

    assert pixel_format == "rgba16float"
    assert bytes_per_row == 1600 * 8
    assert bytes_per_row % 256 == 0
    assert len(body) == 1600 * 1200 * 8


def test_adjusted_frame_singleflight_shares_expensive_work(monkeypatch) -> None:
    source = np.full((48, 64, 3), 0.18, dtype=np.float32)
    cache = SessionRenderCache(source, None)
    adjustments = AdjustmentState()
    original = render_cache_module.apply_adjustments
    calls = 0

    def slow_apply(*args, **kwargs):
        nonlocal calls
        calls += 1
        time.sleep(0.03)
        return original(*args, **kwargs)

    monkeypatch.setattr(render_cache_module, "apply_adjustments", slow_apply)
    with ThreadPoolExecutor(max_workers=4) as pool:
        frames = list(pool.map(lambda _index: cache.adjusted_frame(adjustments, PreviewKind.HDR, 512), range(4)))

    assert calls == 1
    assert all(frame is frames[0] for frame in frames)
    assert cache.diagnostics()["singleflight_waits"] == 3


def test_cache_budget_evicts_old_frames_and_reports_managed_bytes() -> None:
    source = np.full((64, 64, 3), 0.18, dtype=np.float32)
    cache = SessionRenderCache(source, None, max_frames=12, max_cache_bytes=130_000)
    for exposure in range(5):
        adjustments = AdjustmentState()
        adjustments.hdr.exposure = float(exposure)
        cache.adjusted_frame(adjustments, PreviewKind.HDR, 256)

    diagnostics = cache.diagnostics()
    assert diagnostics["evictions"] >= 1
    assert diagnostics["frame_bytes"] + diagnostics["proxy_bytes"] <= cache.max_cache_bytes
    assert diagnostics["managed_bytes"] >= diagnostics["source_bytes"]
    assert diagnostics["entries"] >= 1


def test_vectorized_waveform_matches_column_histogram_reference() -> None:
    rng = np.random.default_rng(7)
    values = rng.random((19, 37), dtype=np.float32)
    edges = np.linspace(0.0, 1.0, 17, dtype=np.float32)
    columns = 13
    actual = np.asarray(_waveform_grid(values, edges, columns))
    column_edges = np.linspace(0, values.shape[1], columns + 1, dtype=np.int32)
    expected = np.zeros_like(actual)
    for target_x in range(columns):
        start = int(column_edges[target_x])
        stop = max(start + 1, int(column_edges[target_x + 1]))
        expected[:, target_x] = np.histogram(values[:, start:stop].reshape(-1), bins=edges)[0]

    np.testing.assert_array_equal(actual, expected)


def test_scope_prioritizes_tiny_highlight_peak_and_normalization() -> None:
    image = np.full((32, 32, 3), 0.018, dtype=np.float32)
    image[3, 5] = np.float32(4000.0 * 0.18 / 203.0)
    scope = build_scope(image, AdjustmentState(), PreviewKind.HDR)

    assert scope.peak_value == pytest.approx(4000.0, rel=1e-4)
    assert scope.normalization_peak >= 1
    assert scope.clipped is False


def test_fixed_float32_display_p3_transform_matches_reference() -> None:
    colour = pytest.importorskip("colour")
    rng = np.random.default_rng(11)
    encoded = rng.random((32, 32, 3), dtype=np.float32)
    expected = np.clip(
        colour.models.RGB_to_RGB(
            colour.models.eotf_sRGB(encoded),
            "Display P3",
            "sRGB",
            chromatic_adaptation_transform="CAT02",
        ),
        0.0,
        1.0,
    ).astype(np.float32)

    actual = _display_p3_to_linear_srgb(encoded)
    np.testing.assert_allclose(actual, expected, rtol=4e-3, atol=2.5e-4)
