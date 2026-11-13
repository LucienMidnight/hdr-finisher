from hdr_finisher import library_diagnostics as d


def test_fast_locks_summarized_and_slow_locks_preserved(monkeypatch):
    events = []
    clock = [0]
    monkeypatch.setattr(d.time, 'monotonic', lambda: clock[0])
    monkeypatch.setattr(d, 'log', lambda event, **fields: events.append((event, fields)))
    monkeypatch.setattr(d, '_lock_samples', {})
    for _ in range(100):
        d._log_lock_timing('test', 1, 2)
    assert not events
    clock[0] = 61
    d._log_lock_timing('test', 15, 20)
    assert events[0][0] == 'lock_timing'
    assert events[1][0] == 'lock_timing_summary'
    assert events[1][1]['count'] == 101
    assert events[1][1]['max_wait_ms'] == 15
    assert events[1][1]['max_hold_ms'] == 20


def test_helper_hold_only_logs_owner_changes(monkeypatch):
    from threading import RLock
    from hdr_finisher import library_worker as w
    worker = w.LibraryWorker.__new__(w.LibraryWorker)
    worker._lock = RLock()
    worker._paused = set()
    worker._requests = {}
    worker._native_caches = []
    commands, events = [], []
    worker._send = commands.append
    monkeypatch.setattr(w, 'log', lambda event, **fields: events.append((event, fields)))
    for active in (False, True, True, False, False):
        worker.pause('test', active)
    assert [fields['acquired'] for event, fields in events if event == 'helper_hold'] == [True, False]
    assert [event for event, _ in events if event != 'helper_hold'] == ['helper_pause', 'helper_resume']
    assert len(commands) == 5
