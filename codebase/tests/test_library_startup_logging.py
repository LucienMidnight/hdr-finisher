from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

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


@pytest.mark.serial
@pytest.mark.posix_only
@pytest.mark.skipif(os.name != "posix", reason="POSIX named semaphore check")
def test_backend_startup_allocates_no_named_semaphores(tmp_path):
    # A fresh interpreter sees import-time allocations. sitecustomize also
    # installs the probe in the real spawned Library helper before its imports.
    trace = tmp_path / "semaphores.log"
    (tmp_path / "sitecustomize.py").write_text(f"""
from multiprocessing.synchronize import SemLock
import os

original_init = SemLock.__init__

def record(message):
    with open({str(trace)!r}, "a", encoding="utf-8") as handle:
        handle.write(f"{{os.getpid()}} {{message}}\\n")

def tracked_init(self, *args, **kwargs):
    original_init(self, *args, **kwargs)
    if self._semlock.name is not None:
        record(f"semaphore {{self._semlock.name}}")

SemLock.__init__ = tracked_init
record("tracking")
""", encoding="utf-8")
    backend = Path(__file__).resolve().parents[1] / "backend"
    run = subprocess.run([sys.executable, "-c", """
from fastapi.testclient import TestClient
from hdr_finisher.main import app, library_worker
import os

with TestClient(app) as client:
    library_worker.start()  # Wait for the lifespan's background startup.
    assert library_worker.status()["running"]
    assert client.get("/health").json()["status"] == "ok"
    print(os.getpid(), library_worker.status()["pid"])
"""], env={**os.environ, "PYTHONPATH": os.pathsep.join([str(tmp_path), str(backend)]),
           "HDR_FINISHER_APP_DATA_DIR": str(tmp_path / "profile")},
        capture_output=True, text=True, timeout=45)
    assert run.returncode == 0, run.stderr
    backend_pid, helper_pid = run.stdout.strip().splitlines()[-1].split()
    records = trace.read_text(encoding="utf-8").splitlines()
    assert {f"{backend_pid} tracking", f"{helper_pid} tracking"} <= set(records)
    assert not [record for record in records if " semaphore " in record]
