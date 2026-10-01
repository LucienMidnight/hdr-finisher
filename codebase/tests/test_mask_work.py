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
        assert cache._singleflight_waits == 1
    finally:
        release.set()
        owner.join(2)
    assert len(cache._masks) == 1


def test_stale_frame_waiter_exits_without_releasing_valid_owner():
    from hdr_finisher.render_cache import StaleRender
    cache = SessionRenderCache(np.ones((32, 48, 3), dtype=np.float32), None)
    key = ('fixture',)
    flight_key = ('frame', *key)
    _, owner = cache._acquire_frame_flight(key, flight_key, None)
    stale = Event()
    errors = []
    def wait():
        try:
            cache._acquire_frame_flight(key, flight_key, lambda: not stale.is_set())
        except StaleRender as error:
            errors.append(error)
    waiter = Thread(target=wait, daemon=True)
    waiter.start()
    deadline = time.monotonic() + 2
    while cache._singleflight_waits == 0 and time.monotonic() < deadline:
        time.sleep(.01)
    stale.set()
    waiter.join(1)
    assert not waiter.is_alive()
    assert len(errors) == 1
    assert cache._inflight[flight_key] is owner
    assert not owner.is_set()
    assert cache._singleflight_waits == 1
    owner.set()


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


def _serve(app):
    import socket
    import uvicorn
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        port = probe.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=port, log_level='warning'))
    Thread(target=server.run, daemon=True).start()
    deadline = time.monotonic() + 10
    while not server.started and time.monotonic() < deadline:
        time.sleep(.02)
    assert server.started
    return server, port


def test_client_abort_reaches_the_worker_through_the_desktop_boundary(monkeypatch):
    """The real middleware stack and a real socket, not a stand-in request.

    The boundary used to be an ``@app.middleware("http")`` function, which
    hides the disconnect from ``Request.is_disconnected()``: the worker of an
    aborted request then ran to completion.
    """
    import socket
    from fastapi import FastAPI
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import Response
    import hdr_finisher.main as main
    from hdr_finisher.mask_work import checkpoint
    monkeypatch.setattr(main, 'desktop_authoring_secret', 'secret')
    outcome = {}
    app = FastAPI()
    app.add_middleware(main.DesktopRequestBoundary)
    app.add_middleware(CORSMiddleware, allow_origins=['*'], allow_methods=['*'], allow_headers=['*'])
    @app.get('/api/mask')
    @main._cancellable_mask_request
    def endpoint():
        started = time.perf_counter()
        try:
            while time.perf_counter() - started < 3:
                checkpoint()
                time.sleep(.01)
            outcome['result'] = 'completed'
        except Exception:
            outcome['result'] = 'cancelled'
            raise
        return Response('done')
    @app.get('/api/quick')
    def quick():
        return Response('ok')
    server, port = _serve(app)
    try:
        def exchange(request):
            with socket.create_connection(('127.0.0.1', port)) as client:
                client.sendall(request)
                client.settimeout(5)
                return client.recv(65536).decode('latin1').lower()
        denied = exchange(b'GET /api/quick HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n')
        allowed = exchange(b'GET /api/quick HTTP/1.1\r\nHost: x\r\nConnection: close\r\nx-hdr-finisher-token: secret\r\n\r\n')
        assert denied.startswith('http/1.1 401') and 'content-security-policy' not in denied
        assert allowed.startswith('http/1.1 200')
        assert 'content-security-policy' in allowed and 'x-content-type-options: nosniff' in allowed
        client = socket.create_connection(('127.0.0.1', port))
        client.sendall(b'GET /api/mask HTTP/1.1\r\nHost: x\r\nx-hdr-finisher-token: secret\r\n\r\n')
        time.sleep(.2)
        client.close()
        deadline = time.monotonic() + 2.5
        while 'result' not in outcome and time.monotonic() < deadline:
            time.sleep(.02)
        assert outcome.get('result') == 'cancelled'
    finally:
        server.should_exit = True


def test_abandoned_owner_finishes_for_a_waiter_and_stops_without_one(monkeypatch):
    cache = SessionRenderCache(np.ones((32, 48, 3), dtype=np.float32), None)
    started, release, left = Event(), Event(), Event()
    original = module.compile_geometry_fixed_mask
    from hdr_finisher.mask_work import checkpoint
    def compile(*args, **kwargs):
        started.set()
        deadline = time.monotonic() + 2
        while not release.is_set() and time.monotonic() < deadline:
            checkpoint()
            time.sleep(.005)
        return original(*args, **kwargs)
    monkeypatch.setattr(module, 'compile_geometry_fixed_mask', compile)
    def abandon():
        if left.is_set():
            raise Cancelled()
    request = lambda: cache.compiled_local_mask(AdjustmentState(), LocalAdjustment(id='one'), 256)
    owner_error = []
    def own():
        try:
            with request_work(None, {}, abandon=abandon):
                request()
        except Cancelled as error:
            owner_error.append(error)
    owner = Thread(target=own)
    owner.start()
    assert started.wait(2)
    results = []
    waiter = Thread(target=lambda: results.append(request()))
    waiter.start()
    deadline = time.monotonic() + 2
    while not cache._flight_waiters and time.monotonic() < deadline:
        time.sleep(.005)
    left.set()
    time.sleep(.1)
    assert owner.is_alive(), 'an owner with a waiter must not abandon the shared compile'
    release.set()
    owner.join(2)
    waiter.join(2)
    assert len(results) == 1 and len(cache._masks) == 1
    assert owner_error, 'the owner still ends its own abandoned request'
    assert not cache._flight_waiters and not cache._inflight

    # With nobody waiting the same abandoned owner stops and caches nothing.
    release.clear()
    started.clear()
    cache._masks.clear()
    owner_error.clear()
    owner = Thread(target=own)
    owner.start()
    owner.join(2)
    assert not owner.is_alive() and owner_error
    assert not cache._masks and not cache._inflight


def test_finished_mask_is_cached_when_its_requester_left_but_not_when_obsolete(monkeypatch):
    cache = SessionRenderCache(np.ones((32, 48, 3), dtype=np.float32), None)
    done = False
    original = module.compile_geometry_fixed_mask
    def compile(*args, **kwargs):
        nonlocal done
        result = original(*args, **kwargs)
        done = True
        return result
    monkeypatch.setattr(module, 'compile_geometry_fixed_mask', compile)
    def late():
        if done:
            raise Cancelled()
    with pytest.raises(Cancelled), request_work(None, {}, abandon=late):
        cache.compiled_local_mask(AdjustmentState(), LocalAdjustment(id='one'), 256)
    assert len(cache._masks) == 1 and not cache._inflight
    cache._masks.clear()
    done = False
    with pytest.raises(Cancelled), request_work(late, {}):
        cache.compiled_local_mask(AdjustmentState(), LocalAdjustment(id='one'), 256)
    assert not cache._masks and not cache._inflight


def test_revision_change_only_stops_work_whose_mask_changed():
    from types import SimpleNamespace
    from fastapi import HTTPException
    from hdr_finisher.main import _compile_current_mask
    from hdr_finisher.mask_work import checkpoint
    session = SimpleNamespace(edit_revision=4)
    identity = ['shape-a']
    def work(bump, change):
        session.edit_revision += bump
        if change:
            identity[0] = 'shape-b'
        checkpoint()
        return 'mask'
    # A grade edit moved the revision; the mask is the one the client will ask for again.
    assert _compile_current_mask(session, work, 1, False, expected_revision=4, identity=lambda: identity[0]) == 'mask'
    with pytest.raises(HTTPException) as error:
        _compile_current_mask(session, work, 1, True, expected_revision=5, identity=lambda: identity[0])
    assert error.value.status_code == 409
    # A draft has no committed identity: any newer revision still makes it obsolete.
    with pytest.raises(HTTPException):
        _compile_current_mask(session, work, 1, False, expected_revision=6)


def test_grade_edit_keeps_mask_flights_and_mask_clear_detaches_them():
    cache = SessionRenderCache(np.ones((32, 48, 3), dtype=np.float32), None)
    mask_flight, frame_flight = Event(), Event()
    cache._inflight[('mask', 0, 256, '{}', 'one', 'sig')] = mask_flight
    cache._inflight[('frame', 'key')] = frame_flight
    cache.clear_adjusted()
    assert frame_flight.is_set() and not mask_flight.is_set()
    assert list(cache._inflight) == [('mask', 0, 256, '{}', 'one', 'sig')]
    cache.clear_adjusted(clear_masks=True)
    assert mask_flight.is_set() and not cache._inflight


def test_mask_eviction_drops_superseded_shapes_before_live_masks():
    cache = SessionRenderCache(np.ones((32, 48, 3), dtype=np.float32), None)
    megabyte = 1024 * 1024
    def put(edge, local, signature, size):
        cache._masks[(0, edge, '{}', local, signature)] = np.zeros(size * megabyte, dtype=np.uint8)
    # Oldest first: two untouched locals, then three successive shapes of the edited one.
    put(7362, 'untouched-a', 'a', 40)
    put(7362, 'untouched-b', 'b', 40)
    put(7362, 'edited', 'v1', 40)
    put(7362, 'edited', 'v2', 40)
    put(7362, 'edited', 'v3', 40)
    put(1600, 'edited', 'v3', 1)
    with cache._lock:
        # A Fit-sized insert does not shrink the budget under native masks.
        assert cache._mask_budget_locked() == 160 * megabyte
        cache._evict_masks_locked(cache._mask_budget_locked())
    remaining = {(key[3], key[4]) for key in cache._masks if key[1] == 7362}
    assert remaining == {('untouched-a', 'a'), ('untouched-b', 'b'), ('edited', 'v3')}
    assert (0, 1600, '{}', 'edited', 'v3') in cache._masks
    with cache._lock:
        cache._masks.clear()
        put(1600, 'edited', 'v3', 1)
        assert cache._mask_budget_locked() == 96 * megabyte


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
