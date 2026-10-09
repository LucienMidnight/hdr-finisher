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
    assert worker.info["decode_workers"] == 1
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
    assert order == ["visible", "background"]
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


def test_process_failure_fails_pending_jobs_instead_of_hanging(worker, tmp_path):
    worker.pause("grading", True)
    _job_id, future = worker.submit_thumbnail(str(source(tmp_path)))
    worker._process.terminate()
    worker._process.join(timeout=5)
    with pytest.raises(RuntimeError, match="stopped unexpectedly"):
        future.result(timeout=5)
    with pytest.raises(RuntimeError, match="stopped unexpectedly"):
        worker.start()


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
