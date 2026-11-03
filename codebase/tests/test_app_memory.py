import os
import pytest

@pytest.fixture(autouse=True)
def reset_budget(monkeypatch):
    monkeypatch.setattr(app_memory,'_sample',(0,None))
    monkeypatch.setattr(app_memory,'_caches',{})
    monkeypatch.setattr(app_memory,'_reservations',{})
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from hdr_finisher import app_memory
from hdr_finisher.library_marks import LibraryMarks


def test_memory_includes_full_tree_and_reservations(monkeypatch):
    monkeypatch.setenv('HDR_FINISHER_DESKTOP_PID','123')
    roots=[]
    def tree(root):
        roots.append(root)
        return [{'pid':1,'workingSetBytes':1_000_000_000},{'pid':2,'workingSetBytes':1_000_000_000}]
    monkeypatch.setattr(app_memory,'process_tree',tree)
    monkeypatch.setattr(app_memory,'_reservations',{})
    assert app_memory.snapshot()['totalBytes']==2_000_000_000
    assert roots==[123]
    assert app_memory.admit('a',700_000_000)['granted']
    assert app_memory.admit('b',700_000_000)['granted']
    assert not app_memory.admit('c',700_000_000)['granted']
    app_memory.admit('a',0,True)
    assert app_memory.admit('b',700_000_000)['granted']
    app_memory.admit('b',0,True)


def test_slow_conflict_disk_read_does_not_own_marks_lock(tmp_path,monkeypatch):
    marks=LibraryMarks(tmp_path/'app')
    photo=tmp_path/'photo.png';photo.write_bytes(b'original')
    entered,release=Event(),Event()
    def scan(paths):
        entered.set();assert release.wait(5)
    monkeypatch.setattr(marks.conflicts,'scan',scan)
    with ThreadPoolExecutor(1) as pool:
        task=pool.submit(marks.read,[photo])
        try:
            assert entered.wait(5)
            assert marks._lock.acquire(timeout=.2)
            marks._lock.release()
        finally:release.set()
        assert task.result()['photos'][0]['storage']=='none'


def test_process_sampler_counts_current_process():
    rows=app_memory.process_tree(os.getpid())
    assert any(row['pid']==os.getpid() and row['workingSetBytes']>0 for row in rows)

def test_recovery_disk_publication_does_not_own_marks_lock(tmp_path,monkeypatch):
    import hdr_finisher.library_membership as module
    from test_library_membership import library
    folder,photos,browser,marks,index=library(tmp_path)
    entered,release=Event(),Event()
    original=module.atomic_json
    def slow(path,value):
        entered.set();assert release.wait(5)
        return original(path,value)
    monkeypatch.setattr(module,'atomic_json',slow)
    index.membership._saved=None
    with ThreadPoolExecutor(1) as pool:
        task=pool.submit(index.membership.reconcile,[str(photos[0])])
        try:
            assert entered.wait(5)
            assert marks._lock.acquire(timeout=.2)
            marks._lock.release()
        finally:release.set()
        task.result()


def test_one_source_can_progress_above_parallel_admission_floor(monkeypatch):
    monkeypatch.setattr(app_memory,'process_tree',lambda root:[{'pid':1,'workingSetBytes':2_900_000_000}])
    monkeypatch.setattr(app_memory,'_reservations',{})
    assert app_memory.admit('visible',700_000_000)['granted']
    assert not app_memory.admit('nearby',700_000_000)['granted']
    app_memory.admit('visible',0,True)


def test_status_database_reads_do_not_own_marks_lock(tmp_path,monkeypatch):
    marks=LibraryMarks(tmp_path/'app')
    entered,release=Event(),Event()
    query=marks._query
    def slow(statement,*args):
        entered.set();assert release.wait(5)
        return query(statement,*args)
    monkeypatch.setattr(marks,'_query',slow)
    with ThreadPoolExecutor(1) as pool:
        task=pool.submit(marks.writer.status)
        try:
            assert entered.wait(5)
            assert marks._lock.acquire(timeout=.2)
            marks._lock.release()
        finally:release.set()
        assert task.result()['waiting']==0


def test_fixed_shares_and_small_machine_ceiling():
    ceiling,shares=app_memory.budgets(64*1024**3)
    assert ceiling==4_000_000_000
    assert shares['raw']==768_000_000
    assert shares['handoff']==256_000_000
    assert shares['working']==600_000_000
    small,cache=app_memory.budgets(8*1024**3)
    assert small==2_500_000_000
    assert cache['working']==shares['working']
    assert cache['thumbnails']==shares['thumbnails']
    assert cache['raw']<shares['raw']


def test_shared_pages_charged_once_and_aggregate_cache_limit(monkeypatch):
    monkeypatch.setattr(app_memory,'process_tree',lambda root:[dict(pid=1,workingSetBytes=200,chargedBytes=150),dict(pid=2,workingSetBytes=200,chargedBytes=150)])
    assert app_memory.snapshot()['totalBytes']==300
    assert app_memory.claim('a','handoff',200_000_000)
    assert not app_memory.claim('b','handoff',100_000_000)
    assert app_memory.claim('a','handoff',0)
    assert app_memory.claim('b','handoff',100_000_000)


def test_pressure_trims_old_entries_to_half_then_zero():
    class Cache:
        def __init__(self):self.bytes=100
        def trim(self,target):self.bytes=target;app_memory.claim('cache','camera',target)
    cache=Cache();app_memory.register('cache','camera',cache.trim)
    assert app_memory.claim('cache','camera',100)
    app_memory.reclaim('moderate');assert cache.bytes==50
    app_memory.reclaim('critical');assert cache.bytes==0


def test_parallel_work_uses_free_total_without_reclaiming_pictures(monkeypatch):
    monkeypatch.setattr(app_memory,'process_tree',lambda root:[{'pid':1,'workingSetBytes':1_800_000_000}])
    monkeypatch.setattr(app_memory,'system_pressure',lambda:'none')
    monkeypatch.setattr(app_memory,'_waiting_until',0)
    assert app_memory.admit('drawing',app_memory.WORKING)['granted']
    assert app_memory.admit('queued',app_memory.WORKING)['granted']
    assert app_memory.admit('third',app_memory.WORKING)['granted']
    assert not app_memory.snapshot()['reclaim']


def test_refused_admission_is_not_memory_pressure(monkeypatch):
    # 2 GB measured is under the target; a request too big for the ceiling is
    # refused, and that refusal alone must not report pressure or a reclaim.
    monkeypatch.setattr(app_memory,'process_tree',lambda root:[{'pid':1,'workingSetBytes':2_000_000_000}])
    monkeypatch.setattr(app_memory,'system_pressure',lambda:'none')
    assert not app_memory.admit('huge',app_memory.CEILING)['granted']
    value=app_memory.snapshot()
    assert value['waiting'] and value['level']=='none'
    assert not value['budgetPressure'] and not value['reclaim']


def test_pressure_level_comes_from_measurement_and_os_only(monkeypatch):
    level=app_memory.pressure_level
    assert level(app_memory.TARGET)=='none'
    assert level(app_memory.TARGET+1)=='moderate'
    # Over our own ceiling stays moderate: pictures dropped then can't be remade.
    assert level(app_memory.CEILING+1_000_000_000)=='moderate'
    assert level(0,'moderate')=='moderate'
    assert level(0,'critical')=='critical'
    monkeypatch.setattr(app_memory,'process_tree',lambda root:[{'pid':1,'workingSetBytes':app_memory.TARGET+1}])
    monkeypatch.setattr(app_memory,'system_pressure',lambda:'none')
    monkeypatch.setattr(app_memory,'_waiting_until',0)
    value=app_memory.snapshot(refresh=True)
    assert value['level']=='moderate' and value['reclaim'] and not value['waiting']


def test_grade_sessions_share_working_room_and_pressure_discards_frames(monkeypatch):
    import numpy as np
    from hdr_finisher.render_cache import SessionRenderCache
    from hdr_finisher.models import AdjustmentState, PreviewKind
    monkeypatch.setattr(app_memory, 'LIMITS', dict(app_memory.LIMITS, working=130_000))
    a = SessionRenderCache(np.full((64,64,3), .18, dtype=np.float32), None)
    b = SessionRenderCache(np.full((64,64,3), .18, dtype=np.float32), None)
    a.adjusted_frame(AdjustmentState(), PreviewKind.HDR, 256)
    b.adjusted_frame(AdjustmentState(), PreviewKind.HDR, 256)
    assert 0 < app_memory.cache_snapshot()['working']['bytes'] <= 130_000
    app_memory.reclaim('critical')
    assert app_memory.cache_snapshot()['working']['bytes'] == 0
    assert not a._frames and not b._frames
    assert a.adjusted_frame(AdjustmentState(), PreviewKind.HDR, 256).shape == (64,64,3)


def test_jobs_do_not_evict_grade_cache_when_total_has_room(monkeypatch):
    monkeypatch.setattr(app_memory,'process_tree',lambda root:[dict(pid=1,workingSetBytes=1_800_000_000)])
    class Cache:
        def trim(self,target):
            pytest.fail("Free total RAM must preserve retained Grade levels")
    cache=Cache()
    app_memory.register('grade','working',cache.trim)
    assert app_memory.claim('grade','working',100_000_000)
    assert app_memory.admit('first',700_000_000)['granted']
    assert app_memory.admit('second',700_000_000)['granted']
    assert app_memory.admit('first',700_000_000)['granted']
    assert app_memory.cache_snapshot()['working']['bytes']==100_000_000


def test_concurrent_memory_requests_share_one_process_census(monkeypatch):
    entered, release = Event(), Event()
    calls = []
    def tree(root):
        calls.append(root); entered.set()
        assert release.wait(2)
        return [dict(pid=1, workingSetBytes=100)]
    monkeypatch.setattr(app_memory, 'process_tree', tree)
    with ThreadPoolExecutor(8) as pool:
        first = pool.submit(app_memory.snapshot)
        assert entered.wait(2)
        rest = [pool.submit(app_memory.snapshot) for _ in range(7)]
        release.set()
        assert all(task.result(timeout=2)['totalBytes'] == 100 for task in [first, *rest])
    assert len(calls) == 1


def test_memory_control_answers_while_default_request_workers_are_full():
    import asyncio
    import anyio
    from hdr_finisher.library_api import memory_control
    async def run():
        limiter = anyio.to_thread.current_default_thread_limiter()
        previous = limiter.total_tokens
        limiter.total_tokens = 1
        entered, release = Event(), Event()
        def blocked():
            entered.set(); assert release.wait(2)
        task = asyncio.create_task(anyio.to_thread.run_sync(blocked))
        try:
            while not entered.is_set(): await asyncio.sleep(.001)
            assert await asyncio.wait_for(memory_control(lambda: 'responsive'), .5) == 'responsive'
        finally:
            release.set(); await task; limiter.total_tokens = previous
    asyncio.run(run())


def test_memory_endpoint_answers_during_coalesced_slow_reclaim(tmp_path, monkeypatch):
    import asyncio
    import httpx
    from fastapi import FastAPI
    from hdr_finisher.library_api import create_library_router
    from hdr_finisher.library_worker import LibraryWorker
    from hdr_finisher.media_browser import MediaBrowserStore
    entered, release = Event(), Event()
    calls = []
    def reclaim(level):
        calls.append(level); entered.set(); assert release.wait(3)
    monkeypatch.setattr(app_memory, 'reclaim', reclaim)
    monkeypatch.setattr(app_memory, 'process_tree', lambda root: [dict(pid=1, workingSetBytes=100)])
    worker = LibraryWorker(tmp_path)
    monkeypatch.setattr(worker, '_send', lambda command: None)
    app = FastAPI(); app.include_router(create_library_router(worker, MediaBrowserStore(tmp_path)))
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            try:
                result = await asyncio.wait_for(client.post('/api/library/memory-reclaim', json={}), .5)
                assert result.json() == {'reclaiming': True}
                while not entered.is_set(): await asyncio.sleep(.001)
                for _ in range(5):
                    assert (await client.post('/api/library/memory-reclaim', json={})).is_success
                sample = await asyncio.wait_for(client.get('/api/library/memory'), .5)
                assert sample.json()['totalBytes'] == 100
                assert calls == ['moderate']
            finally:
                release.set()
                await asyncio.sleep(.05)
    asyncio.run(run())


def test_memory_reader_uses_completed_census_during_refresh(monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event
    import time
    entered, release = Event(), Event()
    old = [dict(pid=1, workingSetBytes=100, chargedBytes=100)]
    monkeypatch.setattr(app_memory, '_sample', (0, old))
    monkeypatch.setattr(app_memory, 'system_pressure', lambda: 'none')
    def census(root):
        entered.set()
        assert release.wait(2)
        return [dict(pid=1, workingSetBytes=200, chargedBytes=200)]
    monkeypatch.setattr(app_memory, 'process_tree', census)
    with ThreadPoolExecutor() as pool:
        future = pool.submit(app_memory.snapshot, refresh=True)
        try:
            assert entered.wait(1)
            started = time.monotonic()
            assert app_memory.snapshot()['totalBytes'] == 100
            assert time.monotonic() - started < .5
        finally: release.set()
        assert future.result()['totalBytes'] == 200


def test_memory_telemetry_does_not_start_a_slow_census(monkeypatch):
    monkeypatch.setattr(app_memory, '_sample', (0, [dict(workingSetBytes=100)]))
    monkeypatch.setattr(app_memory, 'system_pressure', lambda: 'none')
    def forbidden(root):
        raise AssertionError('Telemetry must use the scheduler census')
    monkeypatch.setattr(app_memory, 'process_tree', forbidden)
    assert app_memory.snapshot(cached_only=True)['totalBytes'] == 100


def test_waiting_job_reclamation_releases_decoded_caches_without_camera_or_visible_surfaces(monkeypatch):
    from hdr_finisher import app_memory
    monkeypatch.setattr(app_memory, "_caches", {})
    calls = []
    for share in ("raw", "handoff", "working", "camera", "thumbnails", "sharp"):
        app_memory.register(share, share, lambda target, share=share: calls.append((share, target)))
        app_memory.report(share, share, 100)
    app_memory.reclaim("shortage")
    assert calls == [("raw", 0), ("handoff", 0), ("working", 0)]


def test_shortage_releases_only_needed_bytes_and_stops_before_next_owner(monkeypatch):
    from hdr_finisher import app_memory
    monkeypatch.setattr(app_memory, "_caches", {})
    released = []
    def owner(name, share, size):
        def trim(target):
            released.append((name, target))
            app_memory.report(name, share, target)
        app_memory.register(name, share, trim)
        app_memory.report(name, share, size)
        return trim
    callbacks = [owner("raw", "raw", 500), owner("working", "working", 200)]
    assert app_memory.reclaim("shortage", 100) == 100
    assert released == [("working", 100)]
    assert app_memory.cache_snapshot()["raw"]["bytes"] == 500


def test_memory_polls_never_wait_for_grade_lock(tmp_path, monkeypatch):
    import asyncio, httpx, time
    import numpy as np
    from types import SimpleNamespace
    from fastapi import FastAPI
    from hdr_finisher.sessions import SessionStore
    from hdr_finisher.library_api import create_library_router
    from hdr_finisher.library_worker import LibraryWorker
    from hdr_finisher.media_browser import MediaBrowserStore
    store = SessionStore()
    pixels = np.ones((4, 4, 3), dtype=np.float32)
    session = SimpleNamespace(image=pixels, retouch_original=pixels, sdr_reference_image=None,
                              source=SimpleNamespace(filename='test.raw'), to_payload=lambda: None,
                              owns_source_path=False, retouch_worker=None)
    store.activate_session(session)
    assert store._retained_session_bytes() == pixels.nbytes
    monkeypatch.setattr(app_memory, 'grade_bytes_provider', store._retained_session_bytes)
    monkeypatch.setattr(app_memory, 'process_tree', lambda root: [dict(pid=1, workingSetBytes=100)])
    worker = LibraryWorker(tmp_path)
    app = FastAPI(); app.include_router(create_library_router(worker, MediaBrowserStore(tmp_path)))
    entered, release = Event(), Event()
    def hold():
        with store._lock:
            entered.set(); assert release.wait(5)
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            for _ in range(8):
                at = time.monotonic()
                response = await asyncio.wait_for(client.get('/api/library/memory'), .5)
                assert response.is_success
                assert response.json()['gradeBytes'] == pixels.nbytes
                assert time.monotonic()-at < .5
                await asyncio.sleep(.3)
    with ThreadPoolExecutor(1) as pool:
        task = pool.submit(hold)
        try:
            assert entered.wait(1)
            asyncio.run(run())
        finally: release.set()
        task.result()
    store.clear()
    assert store._retained_session_bytes() == 0


def test_memory_endpoint_coalesces_a_stuck_sample(tmp_path, monkeypatch):
    import asyncio, httpx
    from fastapi import FastAPI
    from hdr_finisher.library_api import create_library_router
    from hdr_finisher.library_worker import LibraryWorker
    from hdr_finisher.media_browser import MediaBrowserStore
    entered, release = Event(), Event()
    calls = []
    def sample(**kwargs):
        calls.append(1)
        if len(calls)>1: entered.set(); assert release.wait(4)
        return {'totalBytes': 100}
    monkeypatch.setattr(app_memory, 'snapshot', sample)
    app = FastAPI(); app.include_router(create_library_router(LibraryWorker(tmp_path), MediaBrowserStore(tmp_path)))
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            try:
                assert (await client.get('/api/library/memory')).json()['totalBytes'] == 100
                for _ in range(10):
                    assert (await asyncio.wait_for(client.get('/api/library/memory'), .3)).is_success
                    await asyncio.sleep(.01)
                assert entered.is_set()
                assert len(calls) == 2
            finally:
                release.set(); await asyncio.sleep(.05)
    asyncio.run(run())


def test_loop_lag_heartbeat_reports_delayed_loop(monkeypatch):
    import asyncio, time
    from hdr_finisher import library_api
    logs = []
    monkeypatch.setattr(library_api, 'log', lambda stage, **fields: logs.append((stage, fields)))
    async def run():
        task = asyncio.create_task(library_api.loop_lag_heartbeat())
        try:
            await asyncio.sleep(.02)
            time.sleep(.4)
            await asyncio.sleep(.02)
        finally:
            task.cancel(); await asyncio.gather(task, return_exceptions=True)
    asyncio.run(run())
    assert len(logs) == 1
    assert logs[0][0] == 'event_loop_lag'
    assert logs[0][1]['lag_ms'] > 250


def test_preview_acceptance_does_not_block_memory_poll(tmp_path, monkeypatch):
    import asyncio, httpx
    from fastapi import FastAPI
    from hdr_finisher.library_api import create_library_router
    from hdr_finisher.library_worker import LibraryWorker
    from hdr_finisher.media_browser import MediaBrowserStore
    from hdr_finisher.library_live import LivePictures
    from hdr_finisher.library_pictures import LibraryPictureCache
    photo = tmp_path/'test.raw'; photo.write_bytes(b'test')
    entered, release = Event(), Event()
    def accept(self, result):
        entered.set(); assert release.wait(3)
    monkeypatch.setattr(LivePictures, 'document', lambda *args: None)
    monkeypatch.setattr(LivePictures, 'describe', lambda *args: {'key': 'accepted'})
    monkeypatch.setattr(LibraryPictureCache, 'cached', lambda *args: {'key': 'cached'})
    monkeypatch.setattr(LibraryPictureCache, 'accept_transient', accept)
    monkeypatch.setattr(app_memory, 'process_tree', lambda root: [dict(pid=1, workingSetBytes=100)])
    app = FastAPI(); app.include_router(create_library_router(LibraryWorker(tmp_path), MediaBrowserStore(tmp_path)))
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            task = asyncio.create_task(client.post('/api/library/live-scene', json={'path':str(photo), 'edge':640}))
            try:
                for _ in range(100):
                    if entered.is_set(): break
                    await asyncio.sleep(.005)
                assert entered.is_set()
                response = await asyncio.wait_for(client.get('/api/library/memory'), .5)
                assert response.is_success
            finally: release.set()
            assert (await task).json()['key'] == 'accepted'
    asyncio.run(run())
