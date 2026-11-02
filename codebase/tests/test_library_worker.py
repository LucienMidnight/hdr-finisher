from __future__ import annotations

from concurrent.futures import CancelledError
import os
from pathlib import Path
from threading import Event
import time

import pytest
from PIL import Image

from hdr_finisher.library_worker import LibraryWorker
from hdr_finisher.media_browser import MediaBrowserError, MediaBrowserStore


@pytest.fixture
def worker(tmp_path):
    helper = LibraryWorker(tmp_path / "cache")
    try:
        yield helper
    finally:
        helper.close()


def source(tmp_path, name="photo.png", color=(80, 120, 160)):
    output = tmp_path / name
    Image.new("RGB", (320, 160), color).save(output)
    return output


def test_thumbnail_runs_in_low_priority_process_and_cache_survives_pause(worker, tmp_path, monkeypatch):
    image = source(tmp_path)
    browser = MediaBrowserStore(worker.root, thumbnail_worker=worker)
    monkeypatch.setattr("hdr_finisher.media_browser._read_thumbnail_source",
                        lambda *a, **k: pytest.fail("Thumbnail decoded in grading process"))
    output = browser.thumbnail(str(image), 128)
    assert output.is_file()
    assert Image.open(output).size == (128, 64)
    assert worker.info["pid"] != os.getpid()
    assert worker.info["priority"] in {"below_normal", "nice_10"}
    assert worker.info["decode_workers"] >= 1
    assert worker.info["decode_workers"] * worker.info["native_threads"] <= (os.cpu_count() or 1)
    worker.pause("grading", True)
    assert browser.thumbnail(str(image), 128) == output
    worker.pause("grading", False)


def test_paused_jobs_prioritize_visible_work_and_cancel_without_decoding(worker, tmp_path):
    worker.pause("grading", True)
    worker.pause("export", True)
    background = source(tmp_path, "background.png")
    visible = source(tmp_path, "visible.png")
    cancelled = source(tmp_path, "cancelled.png")
    order = []
    _one, first = worker.submit_thumbnail(str(background), priority=100)
    _two, second = worker.submit_thumbnail(str(visible), priority=10)
    third_id, third = worker.submit_thumbnail(str(cancelled), priority=1)
    first.add_done_callback(lambda f: order.append("background"))
    second.add_done_callback(lambda f: order.append("visible"))
    assert worker.cancel(third_id)
    assert third.cancelled()
    assert not worker.cancel(third_id)
    worker.pause("grading", False)
    time.sleep(0.15)
    assert not first.done() and not second.done()  # Export still holds its pause.
    worker.pause("export", False)
    assert second.result(timeout=10).is_file()
    assert first.result(timeout=10).is_file()
    deadline = time.monotonic() + 1
    while len(order) < 2 and time.monotonic() < deadline:
        time.sleep(0.01)
    assert set(order) == {"visible", "background"}
    assert len(list((worker.root / "thumbnails").glob("*.jpg"))) == 2


def test_waiting_thumbnail_observes_import_cancellation(worker, tmp_path):
    worker.pause("grading", True)
    cancelled = Event()
    cancelled.set()
    with pytest.raises(CancelledError):
        worker.thumbnail(str(source(tmp_path)), cancel_event=cancelled)
    assert not worker._pending


def test_worker_reports_decode_errors_and_continues(worker, tmp_path):
    broken = tmp_path / "broken.jpg"
    broken.write_bytes(b"not an image")
    with pytest.raises(MediaBrowserError):
        worker.thumbnail(str(broken))
    assert worker.thumbnail(str(source(tmp_path))).is_file()


def test_process_failure_restarts_and_recovers_pending_jobs(worker, tmp_path, capsys):
    worker.pause("grading", True)
    _job_id, future = worker.submit_thumbnail(str(source(tmp_path)))
    old = worker._process
    old.terminate()
    old.join(timeout=5)
    deadline = time.monotonic() + 10
    while worker.status()["restarts"] < 1 and time.monotonic() < deadline:
        time.sleep(.05)
    worker.start()
    assert worker.status()["restarts"] == 1
    assert worker.status()["paused"]
    assert not future.done()
    worker.pause("grading", False)
    assert future.result(timeout=10).is_file()
    assert worker.info["pid"] != old.pid
    logs = capsys.readouterr().err
    assert "helper_stopped" in logs and "helper_restart" in logs


def test_close_stops_process_and_cancels_pending_work(worker, tmp_path):
    worker.pause("grading", True)
    _job_id, future = worker.submit_thumbnail(str(source(tmp_path)))
    worker.close()
    assert future.cancelled()
    assert not worker._process.is_alive()
    worker.close()


def test_paused_http_thumbnail_releases_connection_and_retries(worker, tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from hdr_finisher import main
    monkeypatch.setattr(main, "library_worker", worker)
    monkeypatch.setattr(main, "media_browser_store", MediaBrowserStore(worker.root, thumbnail_worker=worker))
    image = source(tmp_path)
    client = TestClient(main.app)
    worker.pause("test", True)
    response = client.get("/api/media-browser/thumbnail", params={"path": str(image), "size": 128})
    assert response.status_code == 202
    assert response.json()["detail"] == "thumbnail_pending"
    assert worker.status()["pending"] == 0
    worker.pause("test", False)
    response = client.get("/api/media-browser/thumbnail", params={"path": str(image), "size": 128})
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/jpeg"


def test_native_helper_retention_is_charged_to_parent_owner_and_pressure_releases_it(worker,tmp_path):
    from hdr_finisher import app_memory
    image=source(tmp_path)
    _,future=worker.submit_library('native',path=str(image),center_x=.5,center_y=.5,width=100,height=100)
    future.result(timeout=15)
    prefix='helper-'+str(worker._process.pid)+'-'
    def retained():
        with app_memory._lock:
            return sum(v['bytes'] for k,v in app_memory._caches.items() if k.startswith(prefix))
    assert retained()>0
    worker._send(dict(command='memory-pressure',level='critical'))
    until=time.monotonic()+5
    while retained() and time.monotonic()<until:time.sleep(.01)
    assert retained()==0


def _faulting_decoder_stub(connection, root, parent_pid, paused):
    """Disposable native-decoder boundary: crafted bytes crash or hang."""
    import os
    connection.send({'event': 'ready', 'pid': os.getpid()})
    while True:
        message = connection.recv()
        if message.get('command') == 'stop': return
        if message.get('command') != 'thumbnail': continue
        path = Path(message['path'])
        connection.send({'event': 'job-started', 'id': message['id']})
        connection.send({'event': 'work', 'id': message['id'], 'path': str(path), 'stage': 'Reading photo'})
        if path.read_bytes() == b'CRAFTED-CRASH': os._exit(17)
        if path.read_bytes() == b'HANG':
            while True: time.sleep(1)
        connection.send({'event': 'work', 'id': message['id'], 'done': True})
        connection.send({'id': message['id'], 'path': str(path)})


@pytest.mark.parametrize('payload', [b'CRAFTED-CRASH', b'HANG'])
def test_identified_bad_decoder_is_not_replayed_and_next_file_recovers(tmp_path, monkeypatch, payload):
    from hdr_finisher import library_worker
    monkeypatch.setattr(library_worker, '_worker_main', _faulting_decoder_stub)
    monkeypatch.setattr(library_worker.LibraryWorker, 'decoder_timeout', staticmethod(lambda path: .1))
    bad = tmp_path / 'bad.jpg'; bad.write_bytes(payload)
    good = tmp_path / 'good.jpg'; good.write_bytes(b'good')
    helper = library_worker.LibraryWorker(tmp_path / 'profile')
    try:
        bad_id, failed = helper.submit_thumbnail(str(bad))
        good_id, recovered = helper.submit_thumbnail(str(good))
        with pytest.raises(ValueError, match='took too long' if payload == b'HANG' else 'set aside'):
            failed.result(timeout=10)
        assert recovered.result(timeout=10) == good
        assert bad_id not in helper._requests
        assert helper.status()['restarts'] == 1
    finally:
        helper.close()


def test_decoder_deadline_does_not_count_queued_or_grade_pause_time(tmp_path, monkeypatch):
    from concurrent.futures import Future
    from hdr_finisher.library_worker import LibraryWorker
    helper = LibraryWorker(tmp_path)
    helper._requests = {'queued': {'command': 'thumbnail', 'path': 'a.jpg'},
                        'active': {'command': 'thumbnail', 'path': 'b.jpg'}}
    helper._pending = {key: Future() for key in helper._requests}
    helper._work['active'] = {'elapsed': 0}
    helper._paused.add('Grade')
    helper._deadline_sample -= 1000
    helper._check_deadlines()
    assert helper._work['active']['elapsed'] == 0
    assert not any(f.done() for f in helper._pending.values())


def test_helper_attaches_another_tier_to_the_active_source(worker, tmp_path):
    from hdr_finisher.library_live import quality
    image=source(tmp_path); before=image.read_bytes()
    _,small=worker.submit_library('live-scene',path=str(image),edge=640)
    worker.require_scene_tier(str(image),quality(None),2560)
    assert small.result(timeout=30)['edge']==640
    _,large=worker.submit_library('live-scene',path=str(image),edge=2560)
    result=large.result(timeout=30)
    assert result['edge']==2560 and result['cache_hit']
    assert image.read_bytes()==before and not Path(str(image)+'.hdrf').exists()
