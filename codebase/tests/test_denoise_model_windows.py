"""The Denoise noise model reads a few sample windows, so the preview corrects
only those for geometry. The model must be the one the whole corrected frame
gives."""

from __future__ import annotations

import numpy as np
import pytest

import hdr_finisher.render_cache as render_cache_module
from hdr_finisher import denoise_adaptive as da
from hdr_finisher.models import AdjustmentState, GeometryAdjustments, PreviewKind
from hdr_finisher.render_cache import SessionRenderCache

# A windowed resample differs from the whole-frame one in the last float bits
# (tests/test_geometry_region.py), so the models agree closely, not bit for bit.
MODEL_RTOL = 1e-4


def _noisy_source(height: int, width: int) -> np.ndarray:
    rng = np.random.default_rng(20261003)
    yy, xx = np.mgrid[0:height, 0:width].astype(np.float32)
    base = 0.02 + 0.3 * xx / width + 0.1 * yy / height
    base += 0.15 * ((xx // 180 + yy // 140) % 2)
    clean = np.stack([base, base * 0.9, base * 0.8], axis=-1).astype(np.float32)
    sigma = np.sqrt(4e-4 * clean + 1e-5)
    return (clean + rng.standard_normal(clean.shape).astype(np.float32) * sigma).astype(np.float32)


def _model_values(model: da.AdaptiveNoiseModel) -> np.ndarray:
    return np.asarray([model.a, model.b, model.c, *np.ravel(model.band_sigmas)], dtype=np.float64)


GEOMETRIES = {
    "straighten": GeometryAdjustments(straighten_angle=1.0),
    "perspective": GeometryAdjustments(
        straighten_angle=1.0, perspective_horizontal=-12.0, perspective_vertical=-9.0, perspective_rotate=-2.0
    ),
    "quarter turn, flip and crop": GeometryAdjustments(
        rotation=90, flip_horizontal=True, crop={"x": 0.02, "y": 0.03, "width": 0.95, "height": 0.94}
    ),
    "neutral": GeometryAdjustments(),
}


@pytest.fixture
def small_windows(monkeypatch):
    """Smaller windows keep the frame small while it still samples as windows.
    The white-noise reference is measured through the same windows, so it is
    dropped on the way in and out."""
    monkeypatch.setattr(da, "ESTIMATION_TILE", 96)
    da._TAIL_REFERENCE.clear()
    yield
    da._TAIL_REFERENCE.clear()


@pytest.mark.parametrize("name", GEOMETRIES)
def test_windowed_model_equals_the_whole_frame_model(name: str, small_windows) -> None:
    adjustments = AdjustmentState()
    adjustments.shared.geometry = GEOMETRIES[name]
    edge = 1400
    cache = SessionRenderCache(_noisy_source(1100, edge), None)

    proxy, _space, _signature = cache.geometry_source_proxy(PreviewKind.HDR, edge, adjustments)
    whole = da.estimate_adaptive_model(proxy)

    height, width, read = cache.geometry_source_windows(PreviewKind.HDR, edge, adjustments)
    reads: list[tuple[int, int, int, int]] = []

    def counted(*window: int) -> np.ndarray:
        reads.append(window)
        return read(*window)

    windowed = da.estimate_adaptive_model_from_windows(height, width, counted)

    assert (height, width) == proxy.shape[:2]
    assert reads == da._sample_tiles(height, width) and len(reads) == da.ESTIMATION_MAX_TILES
    np.testing.assert_allclose(_model_values(windowed), _model_values(whole), rtol=MODEL_RTOL, atol=0)


def test_small_frame_is_read_as_one_window() -> None:
    adjustments = AdjustmentState()
    adjustments.shared.geometry = GEOMETRIES["perspective"]
    cache = SessionRenderCache(_noisy_source(300, 420), None)

    proxy, _space, _signature = cache.geometry_source_proxy(PreviewKind.HDR, 420, adjustments)
    height, width, read = cache.geometry_source_windows(PreviewKind.HDR, 420, adjustments)

    np.testing.assert_allclose(read(0, 0, height, width), proxy, rtol=1e-6, atol=1e-6)
    windowed = da.estimate_adaptive_model_from_windows(height, width, read)
    np.testing.assert_allclose(
        _model_values(windowed), _model_values(da.estimate_adaptive_model(proxy)), rtol=MODEL_RTOL, atol=0
    )


def test_geometry_that_needs_a_downsample_keeps_the_whole_frame_path(monkeypatch) -> None:
    # A per-window downsample does not reproduce a whole-frame one.
    adjustments = AdjustmentState()
    adjustments.shared.geometry = GeometryAdjustments(straighten_angle=25)
    cache = SessionRenderCache(np.full((180, 420, 3), 0.18, dtype=np.float32), None)
    assert cache.geometry_source_windows(PreviewKind.HDR, 256, adjustments) is not None

    monkeypatch.setattr(render_cache_module, "geometry_output_dimensions", lambda *_: (257, 100))

    assert cache.geometry_source_windows(PreviewKind.HDR, 256, adjustments) is None
