"""At full size the Denoise noise model is the source's own: one measurement per
source, the one export makes, whatever the geometry."""

from __future__ import annotations

from types import SimpleNamespace

import numpy as np
import pytest

from hdr_finisher import denoise_adaptive as da
from hdr_finisher.models import AdjustmentState, GeometryAdjustments, PreviewKind
from hdr_finisher.render_cache import SessionRenderCache


def _noisy_source(height: int, width: int) -> np.ndarray:
    rng = np.random.default_rng(20261004)
    yy, xx = np.mgrid[0:height, 0:width].astype(np.float32)
    base = 0.02 + 0.3 * xx / width + 0.1 * yy / height
    clean = np.stack([base, base * 0.9, base * 0.8], axis=-1).astype(np.float32)
    sigma = np.sqrt(4e-4 * clean + 1e-5)
    return (clean + rng.standard_normal(clean.shape).astype(np.float32) * sigma).astype(np.float32)


GEOMETRIES = [
    GeometryAdjustments(),
    GeometryAdjustments(straighten_angle=2.0),
    GeometryAdjustments(rotation=90, crop={"x": 0.1, "y": 0.1, "width": 0.5, "height": 0.6}),
    GeometryAdjustments(perspective_horizontal=20.0, perspective_rotate=1.0),
]


@pytest.mark.parametrize("geometry", GEOMETRIES)
def test_full_size_model_source_ignores_geometry(geometry: GeometryAdjustments) -> None:
    image = _noisy_source(600, 900)
    cache = SessionRenderCache(image, None)
    adjustments = AdjustmentState()
    adjustments.shared.geometry = geometry

    for edge in (900, 4096):
        source, epoch = cache.native_denoise_source(PreviewKind.HDR, edge, adjustments)
        assert source is image
        assert epoch == cache._source_epoch
    # The SDR lane grades the same source unless it has a base of its own.
    assert cache.native_denoise_source(PreviewKind.SDR, 900, adjustments)[0] is image


def test_smaller_levels_and_other_bases_keep_their_own_model() -> None:
    image = _noisy_source(600, 900)
    adjustments = AdjustmentState()

    cache = SessionRenderCache(image, None)
    assert cache.native_denoise_source(PreviewKind.HDR, 899, adjustments) is None
    assert cache.native_denoise_source(PreviewKind.HDR, 256, adjustments) is None

    authored = SessionRenderCache(image, image * 0.5)
    adjustments.sdr.use_authored_base = True
    assert authored.native_denoise_source(PreviewKind.SDR, 900, adjustments) is None
    assert authored.native_denoise_source(PreviewKind.HDR, 900, adjustments)[0] is image

    matched = SimpleNamespace(active=True)
    assert cache.native_denoise_source(PreviewKind.SDR, 900, AdjustmentState(), matched) is None
    assert cache.native_denoise_source(PreviewKind.HDR, 900, AdjustmentState(), matched)[0] is image


def test_a_new_source_is_a_new_epoch() -> None:
    cache = SessionRenderCache(_noisy_source(300, 400), None)
    adjustments = AdjustmentState()
    _source, before = cache.native_denoise_source(PreviewKind.HDR, 400, adjustments)
    replacement = _noisy_source(300, 400) * 2.0
    cache.replace_source(replacement, None)
    source, after = cache.native_denoise_source(PreviewKind.HDR, 400, adjustments)
    assert source is replacement and after != before


def test_full_size_model_is_the_export_model() -> None:
    """Export measures ``estimate_adaptive_model`` on the full source; the
    preview at full size is handed that same image to measure."""
    image = _noisy_source(700, 1000)
    cache = SessionRenderCache(image, None)
    adjustments = AdjustmentState()
    adjustments.shared.geometry = GeometryAdjustments(straighten_angle=3.0)
    source, _epoch = cache.native_denoise_source(PreviewKind.HDR, 1000, adjustments)
    assert da.estimate_adaptive_model(source).as_dict() == da.estimate_adaptive_model(image).as_dict()


def test_overlapping_model_requests_measure_once() -> None:
    from concurrent.futures import ThreadPoolExecutor, wait
    from threading import Barrier, Event
    from hdr_finisher.main import _cached_denoise_model

    start = Barrier(8)
    measuring = Event()
    release = Event()
    calls = []
    key = ("singleflight-test", "native", 1)

    def measure():
        calls.append(1)
        measuring.set()
        assert release.wait(5)
        return {"a": 1.0}

    def request():
        start.wait(timeout=5)
        return _cached_denoise_model(key, measure)

    with ThreadPoolExecutor(max_workers=8) as pool:
        requests = [pool.submit(request) for _ in range(8)]
        try:
            assert measuring.wait(5)
            assert not wait(requests, timeout=0.1).done
            assert len(calls) == 1
        finally:
            release.set()
        assert all(item.result(timeout=5) == {"a": 1.0} for item in requests)
    assert _cached_denoise_model(key, measure) == {"a": 1.0}
    assert len(calls) == 1


def test_model_failure_can_retry_and_source_epochs_are_independent() -> None:
    from hdr_finisher.main import _cached_denoise_model

    key = ("retry-test", "native", 1)
    def fail():
        raise ValueError("measurement failed")

    with pytest.raises(ValueError, match="measurement failed"):
        _cached_denoise_model(key, fail)
    assert _cached_denoise_model(key, lambda: {"a": 1}) == {"a": 1}
    assert _cached_denoise_model(("retry-test", "native", 2), lambda: {"a": 2}) == {"a": 2}


def test_concurrent_sizes_wait_for_complete_tail_calibration(monkeypatch) -> None:
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    measuring = Event()
    release = Event()
    calls = []
    monkeypatch.setattr(da, "_TAIL_REFERENCE", {})
    monkeypatch.setattr(da, "_measure_model", lambda noise: (None, []))
    monkeypatch.setattr(da, "_window_energies", lambda *args: [([np.ones(1)] * 6, None)])

    def tails(*args):
        calls.append(1)
        measuring.set()
        assert release.wait(5)
        return [[1.0] * 6], None

    monkeypatch.setattr(da, "_energy_tails", tails)
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(da._tail_reference)
        assert measuring.wait(5)
        second = pool.submit(da._tail_reference)
        try:
            from concurrent.futures import wait
            assert not wait([second], timeout=0.1).done
        finally:
            release.set()
        assert first.result(timeout=5) == second.result(timeout=5)
    assert len(calls) == 1


def test_intermediate_models_are_per_geometry_size_and_source(monkeypatch) -> None:
    from hdr_finisher import main
    from fastapi import HTTPException
    import json

    cache = SessionRenderCache(_noisy_source(600, 900), None)
    session = SimpleNamespace(edit_revision=0, adjustments=AdjustmentState(),
                              sdr_match=None, render_cache=cache)
    monkeypatch.setattr(main.store, "get", lambda _id: session)
    calls = []
    def estimate(*args):
        calls.append(1)
        return SimpleNamespace(as_dict=lambda: {"measurement": len(calls)})
    monkeypatch.setattr(da, "estimate_adaptive_model_from_windows", estimate)
    monkeypatch.setattr(da, "estimate_adaptive_model", estimate)
    def request(edge=400, kind=PreviewKind.HDR, signature=None, revision=None):
        return main.adaptive_denoise_model("intermediate-reuse-test", kind, edge, revision, signature)

    first = request()
    assert request() == first and len(calls) == 1
    session.adjustments.shared.geometry = GeometryAdjustments(straighten_angle=5)
    straightened = request()
    assert straightened != first and len(calls) == 2
    assert request(600) != straightened and len(calls) == 3
    cache.replace_source(_noisy_source(600, 900) * 2, None)
    assert request() != straightened and len(calls) == 4
    # Guards must still reject stale requests even when a model is cached.
    with pytest.raises(HTTPException) as geometry_error:
        request(signature=json.dumps(GeometryAdjustments().model_dump(mode="json")))
    assert geometry_error.value.status_code == 409
    session.edit_revision = 1
    with pytest.raises(HTTPException) as revision_error:
        request(revision=0)
    assert revision_error.value.status_code == 409
    # SDR remains per geometry, including when it grades the main source.
    sdr = request(kind=PreviewKind.SDR)
    session.adjustments.shared.geometry = GeometryAdjustments(straighten_angle=3)
    assert request(kind=PreviewKind.SDR) != sdr


def test_source_epoch_can_be_checked_by_resize_workers_under_cache_lock() -> None:
    from concurrent.futures import ThreadPoolExecutor
    cache = SessionRenderCache(_noisy_source(300, 400), None)
    with ThreadPoolExecutor(max_workers=1) as pool:
        with cache._lock:
            check = pool.submit(lambda: cache.source_epoch)
            assert check.result(timeout=2) == 0
