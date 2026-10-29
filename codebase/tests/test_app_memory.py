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
    assert not app_memory.admit('b',700_000_000)['granted']
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


def test_busy_working_slot_does_not_reclaim_inflight_pictures(monkeypatch):
    monkeypatch.setattr(app_memory,'process_tree',lambda root:[{'pid':1,'workingSetBytes':2_900_000_000}])
    monkeypatch.setattr(app_memory,'system_pressure',lambda:'none')
    monkeypatch.setattr(app_memory,'_waiting_until',0)
    assert app_memory.admit('drawing',app_memory.WORKING)['granted']
    assert not app_memory.admit('queued',app_memory.WORKING)['granted']
    assert not app_memory.snapshot()['reclaim']


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
