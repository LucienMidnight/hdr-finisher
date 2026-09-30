from threading import Event, Thread
import time

import numpy as np
import pytest

from hdr_finisher.mask_work import request_work
from hdr_finisher.local_adjustments import _gaussian_blur_float
from hdr_finisher.models import AdjustmentState, LocalAdjustment
from hdr_finisher.render_cache import SessionRenderCache
import hdr_finisher.render_cache as module


class Cancelled(Exception):
    pass


def test_blur_cancels_between_strips_without_changing_live_output():
    source = np.random.default_rng(42).random((600, 800), dtype=np.float32)
    expected = _gaussian_blur_float(source, 30)
    with request_work(lambda: None, {}):
        assert np.array_equal(expected, _gaussian_blur_float(source, 30))
    calls = 0
    def check():
        nonlocal calls
        calls += 1
        if calls == 4:
            raise Cancelled()
    with pytest.raises(Cancelled), request_work(check, {}):
        _gaussian_blur_float(source, 30)
    assert calls == 4
    # Context must be restored even on failure.
    assert np.array_equal(expected, _gaussian_blur_float(source, 30))


def test_cancelled_owner_releases_flight_and_does_not_cache(monkeypatch):
    cache = SessionRenderCache(np.ones((32, 48, 3), dtype=np.float32), None)
    obsolete = False
    original = module.compile_geometry_fixed_mask
    def compile(*args, **kwargs):
        nonlocal obsolete
        result = original(*args, **kwargs)
        obsolete = True
        return result
    def check():
        if obsolete:
            raise Cancelled()
    monkeypatch.setattr(module, 'compile_geometry_fixed_mask', compile)
    with pytest.raises(Cancelled), request_work(check, {}):
        cache.compiled_local_mask(AdjustmentState(), LocalAdjustment(id='one'), 256)
    assert not cache._inflight
    assert not cache._masks
    monkeypatch.setattr(module, 'compile_geometry_fixed_mask', original)
    cache.compiled_local_mask(AdjustmentState(), LocalAdjustment(id='one'), 256)
    assert len(cache._masks) == 1


def test_obsolete_waiter_leaves_owner_running_and_wait_is_separate(monkeypatch):
    cache = SessionRenderCache(np.ones((32, 48, 3), dtype=np.float32), None)
    started, release = Event(), Event()
    original = module.compile_geometry_fixed_mask
    def compile(*args, **kwargs):
        started.set()
        assert release.wait(2)
        return original(*args, **kwargs)
    monkeypatch.setattr(module, 'compile_geometry_fixed_mask', compile)
    owner = Thread(target=lambda: cache.compiled_local_mask(AdjustmentState(), LocalAdjustment(id='one'), 256))
    owner.start()
    assert started.wait(2)
    deadline = time.perf_counter() + .08
    timing = {}
    def check():
        if time.perf_counter() >= deadline:
            raise Cancelled()
    try:
        with pytest.raises(Cancelled), request_work(check, timing):
            cache.compiled_local_mask(AdjustmentState(), LocalAdjustment(id='one'), 256)
        assert timing['singleflight_wait'] >= 50
        assert timing['lock_wait'] < timing['singleflight_wait']
        assert 'compute' not in timing
        assert owner.is_alive()
    finally:
        release.set()
        owner.join(2)
    assert len(cache._masks) == 1


def test_http_disconnect_cancels_worker_and_preserves_http_error_shape():
    import asyncio
    from fastapi import HTTPException
    from hdr_finisher.main import _cancellable_mask_request
    from hdr_finisher.mask_work import checkpoint
    class Disconnected:
        async def is_disconnected(self):
            return True
    @_cancellable_mask_request
    def endpoint():
        for _ in range(100):
            checkpoint()
            time.sleep(.01)
        pytest.fail('Disconnected mask worker was not cancelled')
    with pytest.raises(HTTPException) as error:
        asyncio.run(endpoint(http_request=Disconnected()))
    assert error.value.status_code == 409


def test_http_wrapper_preserves_query_binding_and_reports_worker_queue():
    from fastapi import FastAPI
    from fastapi.responses import Response
    from fastapi.testclient import TestClient
    from hdr_finisher.main import _cancellable_mask_request
    app = FastAPI()
    @app.get('/mask')
    @_cancellable_mask_request
    def endpoint(edge: int = 256):
        return Response(str(edge))
    response = TestClient(app).get('/mask?edge=512')
    assert response.status_code == 200
    assert response.text == '512'
    assert float(response.headers['X-Mask-Worker-Queue-Ms']) >= 0
