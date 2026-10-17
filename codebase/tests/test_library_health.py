"""Stage B health, controls and diagnostics on disposable photos only."""
import errno
import json
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from hdr_finisher.library_api import create_library_router
from hdr_finisher.library_marks import LibraryMarks, MarkChange
from hdr_finisher.library_pictures import LibraryPictureCache
from hdr_finisher.library_metadata import read_metadata, _facts
from hdr_finisher.media_browser import MediaBrowserStore


class Helper:
    def status(self):
        return {"running": True, "paused": False, "pending": 0, "failure": None}


@pytest.fixture
def library(tmp_path):
    root = tmp_path / "app"
    photos = [tmp_path / "folder" / f"{i}.png" for i in range(3)]
    photos[0].parent.mkdir()
    for path in photos:
        path.write_bytes(b"original")
    store = LibraryMarks(root)
    app = FastAPI()
    app.include_router(create_library_router(Helper(), MediaBrowserStore(root)))
    return store, photos, TestClient(app)


@pytest.mark.parametrize("reason,number", [("disk_full", errno.ENOSPC), ("unwritable", errno.EACCES), ("locked", errno.EBUSY)])
def test_health_groups_live_problems_retry_and_clears_after_recovery(library, monkeypatch, reason, number):
    store, photos, client = library
    store.change(photos, MarkChange(rating=4))
    real_write = store._write_sidecar
    def fail(*args, **kwargs):
        raise OSError(number, "system failure detail")
    monkeypatch.setattr(store, "_write_sidecar", fail)
    store.writer.drain()
    health = client.get("/api/library/health").json()
    assert health["writer"]["waiting"] == 3
    assert health["writer"]["reasons"] == {reason: 3}
    assert health["helper"]["running"] and health["helper"]["restarts"] == 0
    group, = health["writer"]["attention"]
    assert group["folder"] == str(photos[0].parent) and group["count"] == 3
    assert "system failure detail" not in group["explanation"]
    assert health["index"]["state"] == "idle"
    paused = client.post("/api/library/writer", json={"action": "pause"}).json()
    assert paused["writer"]["paused"]
    # Control acts on the live database group without claiming it has recovered.
    response = client.post("/api/library/writer", json={"action": "retry", "folder": group["folder"], "reason": reason})
    assert response.json()["writer"]["attention"]
    assert all(row[0] == 0 for row in store._query("SELECT next_try FROM settings_writes"))
    assert not client.post("/api/library/writer", json={"action": "resume"}).json()["writer"]["paused"]
    monkeypatch.setattr(store, "_write_sidecar", real_write)
    store.writer._group_delays.clear()
    store.writer.drain()
    final = client.get("/api/library/health").json()
    assert final["writer"]["waiting"] == 0 and not final["writer"]["attention"]
    assert all(json.loads(Path(str(path) + ".hdrf").read_text())["marks"]["rating"] == 4 for path in photos)


def test_writer_pause_and_progress_do_not_claim_unwritten_files(library):
    store, photos, client = library
    store.change(photos, MarkChange(rating=3))
    store.writer.pause(True)
    assert store.writer.drain()["waiting"] == 3
    assert not Path(str(photos[0]) + ".hdrf").exists()
    assert store.writer.status()["total"] == 3
    store.writer.pause(False)
    store.writer._attempt(str(photos[0]))
    status = store.writer.status()
    assert (status["done"], status["total"], status["waiting"]) == (1, 3, 2)


def test_failure_flood_is_one_group_with_three_examples(library, monkeypatch, capsys):
    store, photos, _ = library
    def broken(path):
        raise ValueError("invalid settings") from OSError(errno.EACCES, "system says no")
    monkeypatch.setattr(store, "_document", broken)
    store.read([photos[0].parent / f"{i}.png" for i in range(10000)])
    lines = [line for line in capsys.readouterr().err.splitlines() if "settings_read_failed" in line]
    assert len(lines) == 1
    fields = json.loads(lines[0].split("settings_read_failed ", 1)[1])
    assert fields["count"] == 10000 and len(fields["examples"]) == 3
    assert "system says no" in fields["reason"]


def test_command_failures_log_names_and_system_reason_without_raw_user_text(library, capsys):
    store, photos, client = library
    missing = photos[0].parent / "missing.png"
    response = client.post("/api/library/marks", json={"paths": [str(missing)], "change": {"rating": 3}})
    assert response.status_code == 400 and "safe" in response.json()["detail"]
    invalid = client.post("/api/library/marks", json={"paths": [str(photos[0])], "change": {"rating": 90}})
    assert invalid.status_code == 400 and "validation error" not in invalid.text
    logs = capsys.readouterr().err
    failures = [json.loads(line.split("change_failed ", 1)[1]) for line in logs.splitlines() if line.startswith("[library] change_failed ")]
    assert failures and str(missing) in failures[0]["context"][0]
    assert "request_invalid" in logs
    assert "request_invalid" in {row["event"] for row in client.get("/api/library/health").json()["problems"]}
    class Busy(Helper):
        def submit_library(self, *args, **kwargs):
            raise RuntimeError("Library helper queue is full.")
    app = FastAPI()
    app.include_router(create_library_router(Busy(), MediaBrowserStore(store.database.parent)))
    busy = TestClient(app).post("/api/library/tree", json={"path": str(photos[0].parent)})
    assert busy.status_code == 503
    assert busy.json()["detail"] == "The Library helper is busy. Saved marks are safe; try again in a moment."


def test_unreadable_marks_are_plain_named_and_logged(library, capsys):
    store, photos, _ = library
    path = Path(str(photos[0]) + ".hdrf")
    path.write_text(json.dumps({"format": "HDR Finisher Photo", "schema_version": 1, "photo_id": "test", "marks": {"rating": 20}}))
    before = path.read_bytes()
    result = store.read([photos[0]])
    assert result["warnings"] == [f"Settings for {photos[0].name} have unreadable marks; they were left untouched."]
    assert "validation error" in capsys.readouterr().err and path.read_bytes() == before


def test_cache_corruption_and_exif_fallback_leave_diagnostics(tmp_path, capsys, monkeypatch):
    from PIL import Image
    path = tmp_path / "photo.png"
    Image.new("RGB", (20, 20)).save(path)
    cache = LibraryPictureCache(tmp_path)
    from hdr_finisher.library_pictures import picture_key
    cache.managed.prepare();cache.root.mkdir()
    cache.file(picture_key(path, 64, "quick")).write_bytes(b"broken")
    assert cache.cached(path, 64, "quick") is None
    import exifread
    _facts.cache_clear()
    monkeypatch.setattr(exifread, "process_file", lambda *args, **kwargs: (_ for _ in ()).throw(OSError("bad EXIF")))
    assert read_metadata([path])["photos"][0]["camera"] is None
    logs = capsys.readouterr().err
    assert "cache_corrupt" in logs and "metadata_read_failed" in logs and "bad EXIF" in logs


def test_index_failure_retries_and_recovers_beyond_five_failures(tmp_path, monkeypatch, capsys):
    from hdr_finisher.library_index import LibraryIndex
    folder = tmp_path / "photos"
    folder.mkdir()
    browser = MediaBrowserStore(tmp_path / "app")
    browser.add_pin(str(folder))
    class Broken(Helper):
        def submit_library(self, *args, **kwargs):
            raise RuntimeError("helper system failure")
    index = LibraryIndex(LibraryMarks(browser.root), browser, Broken())
    index._retry_seconds = .001
    calls = []
    def attempt(generation):
        calls.append(generation)
        if len(calls) <= 6:
            raise RuntimeError("helper system failure")
        assert index.status()["state"] == "retrying"
        index._set(passes=1)
        index.close()
    monkeypatch.setattr(index, "_pass", attempt)
    index._wake.set()
    index._run()
    assert len(calls) == 7 and index.status()["passes"] == 1
    logs = capsys.readouterr().err
    assert "index_failed" in logs and "index_recovered" in logs and "helper system failure" in logs


def test_helper_problems_are_forwarded_into_backend_health(tmp_path, capsys):
    from hdr_finisher.library_worker import LibraryWorker
    from hdr_finisher.library_diagnostics import recent
    path = tmp_path / "broken.png"
    path.write_bytes(b"not a picture")
    helper = LibraryWorker(tmp_path / "app")
    try:
        _, future = helper.submit_library("picture", path=str(path), edge=64, quality="quick")
        with pytest.raises(Exception):
            future.result(timeout=15)
        assert any(row["event"] == "helper_job_failed" and row["paths"] == str(path) for row in recent())
        assert helper.status()["restarts"] == 0
        logs = capsys.readouterr().err
        assert "helper_start" in logs and "helper_job_failed" in logs
    finally:
        helper.close()
