from concurrent.futures import ThreadPoolExecutor
import json
from hdr_finisher import library_diagnostics as diagnostics


def test_concurrent_entries_each_have_one_complete_write(monkeypatch):
    class Sink:
        def __init__(self): self.writes = []
        def write(self, value): self.writes.append(value)
        def flush(self): pass
    sink = Sink()
    monkeypatch.setattr(diagnostics, '_sink', None)
    monkeypatch.setattr(diagnostics.sys, 'stderr', sink)
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(lambda index: diagnostics.log('parallel', index=index), range(100)))
    assert len(sink.writes) == 100
    rows = []
    for value in sink.writes:
        assert value.endswith('\n') and value.count('\n') == 1
        rows.append(json.loads(value.split(' ', 2)[2]))
    assert {row['index'] for row in rows} == set(range(100))


def test_summary_recovers_joined_historical_events(tmp_path, monkeypatch):
    import importlib.util
    from pathlib import Path
    spec = importlib.util.spec_from_file_location('summary', Path(__file__).resolve().parents[1] / 'tools/summarize_library_log.py')
    summary = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(summary)
    log = tmp_path / 'backend.log'
    log.write_text('[library] app_start {"time": 1}\n[library] one {"time": 2}[library] two {"time": 3}\n')
    monkeypatch.setattr(summary, 'LOG', str(log))
    assert list(summary.events(2)) == [('one', {'time': 2}), ('two', {'time': 3})]
    assert summary.latest_session_start() == 1
