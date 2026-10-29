import os
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
