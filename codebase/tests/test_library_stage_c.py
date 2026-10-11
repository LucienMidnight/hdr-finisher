"""Stage C recovery on disposable photos, folders, databases and processes."""
from concurrent.futures import Future
import json
import os
from pathlib import Path
import time

import pytest

from hdr_finisher.library_marks import LibraryMarks, MarkChange
from hdr_finisher.library_index import LibraryIndex
from hdr_finisher.library_worker import LibraryWorker
from hdr_finisher.media_browser import MediaBrowserStore


def setup(tmp_path):
    folder = tmp_path / "external"
    folder.mkdir()
    photo = folder / "one.png"
    photo.write_bytes(b"original")
    marks = LibraryMarks(tmp_path / "app")
    marks.change([photo], MarkChange(rating=2, add_tag="Old"))
    marks.album_create("Old album", [photo])
    marks.writer.drain()
    return marks, folder, photo


def settings(photo):
    return json.loads(Path(str(photo) + ".hdrf").read_text())


@pytest.mark.parametrize("operation", ["marks", "rename", "merge", "remove", "album_rename", "album_delete", "membership"])
def test_offline_changes_survive_restart_and_reconnect(tmp_path, operation):
    marks, folder, photo = setup(tmp_path)
    folder.rename(tmp_path / "unplugged")
    operations = {
        "marks": lambda: marks.change([photo], MarkChange(rating=5)),
        "rename": lambda: marks.tag_rename("Old", "New"),
        "merge": lambda: marks.tag_merge(["Old"], "New"),
        "remove": lambda: marks.tag_remove(["Old"]),
        "album_rename": lambda: marks.album_rename("Old album", "New album"),
        "album_delete": lambda: marks.album_delete("Old album"),
        "membership": lambda: marks.album_change("Old album", [photo], False),
    }
    result = operations[operation]()
    assert len(result["photos"]) == 1
    assert "waiting" in result["warnings"][0]
    desired = result["photos"][0]
    assert marks.writer.status()["waiting"] == 1
    assert marks.writer.status()["attention"][0]["reason"] == "offline"
    if operation in {"rename", "merge", "remove"}:
        assert "Old" not in [row["tag"] for row in marks.tags()]
    if operation in {"album_rename", "album_delete"}:
        assert "Old album" not in [row["name"] for row in marks.albums()]
    restarted = LibraryMarks(tmp_path / "app")
    assert restarted.read([photo])["photos"][0]["marks"] == desired["marks"]
    # Automatic worker retry needs no user action after the folder returns.
    (tmp_path / "unplugged").rename(folder)
    restarted.writer.start()
    try:
        deadline = time.monotonic() + 5
        while restarted.writer.status()["waiting"] and time.monotonic() < deadline:
            time.sleep(.02)
        assert restarted.writer.status()["waiting"] == 0
        assert settings(photo)["marks"] == desired["marks"]
        assert settings(photo).get("albums", []) == desired["albums"]
        assert photo.read_bytes() == b"original"
    finally:
        restarted.writer.close()


def test_offline_unmarked_indexed_photo_can_be_marked_but_unknown_photo_cannot(tmp_path):
    marks, folder, _ = setup(tmp_path)
    photo = folder / "unmarked.png"
    photo.write_bytes(b"original")
    db = marks._connect()
    with db:
        db.execute("INSERT INTO files VALUES (?, 8, 1, NULL)", (str(photo),))
    db.close()
    folder.rename(tmp_path / "unplugged")
    assert marks.change([photo], MarkChange(rating=4))["photos"][0]["marks"]["rating"] == 4
    with pytest.raises(FileNotFoundError):
        marks.change([folder / "unknown.png"], MarkChange(rating=3))
    marks.undo()
    assert marks.writer.status()["waiting"] == 0
    assert not marks._rows([str(photo)])


def test_offline_undo_restores_collection_and_marks(tmp_path):
    marks, folder, photo = setup(tmp_path)
    folder.rename(tmp_path / "unplugged")
    marks.tag_rename("Old", "New")
    assert marks.undo()["skipped"] == 0
    assert marks.read([photo])["photos"][0]["marks"]["tags"] == ["Old"]
    assert [row["tag"] for row in marks.tags()] == ["Old"]


def test_conflict_copies_report_both_names_and_never_change_files(tmp_path, capsys):
    marks, folder, photo = setup(tmp_path)
    canonical = Path(str(photo) + ".hdrf")
    copy = folder / "one.png (Steve's conflicted copy).hdrf"
    copy.write_bytes(canonical.read_bytes())
    before = canonical.read_bytes(), copy.read_bytes(), photo.read_bytes()
    marks.read([photo])
    group = marks.conflicts.status()[0]
    assert set(group["files"]) == {str(canonical), str(copy)}
    assert "settings_conflict" in capsys.readouterr().err
    assert before == (canonical.read_bytes(), copy.read_bytes(), photo.read_bytes())
    copy.unlink()
    marks.read([photo])
    assert marks.conflicts.status() == []
    assert "settings_conflict_cleared" in capsys.readouterr().err


def test_connected_invalid_settings_stop_mixed_offline_command_before_any_change(tmp_path):
    marks, folder, offline = setup(tmp_path)
    connected = tmp_path / "connected.png"
    connected.write_bytes(b"original")
    marks.change([connected], MarkChange(rating=1, add_tag="Old"))
    marks.writer.drain()
    Path(str(connected) + ".hdrf").write_text("broken")
    folder.rename(tmp_path / "unplugged")
    with pytest.raises(ValueError, match="left untouched"):
        marks.tag_rename("Old", "New")
    assert marks._rows([str(offline)])[str(offline)]["marks"]["tags"] == ["Old"]
    assert marks.writer.status()["waiting"] == 0
    assert Path(str(connected) + ".hdrf").read_text() == "broken"


def test_unreadable_named_conflict_is_detected_without_reading_canonical_peers(tmp_path, monkeypatch):
    marks, folder, photo = setup(tmp_path)
    peer = folder / "peer.png"
    peer.write_bytes(b"original")
    marks.change([peer], MarkChange(rating=1))
    marks.writer.drain()
    conflict = folder / "one.png.hdrf (sync conflicted copy)"
    conflict.write_bytes(b"broken conflict settings")
    original_read = Path.read_text
    def read(path, *args, **kwargs):
        assert path != Path(str(peer) + ".hdrf"), "Unrelated canonical settings should not be read"
        return original_read(path, *args, **kwargs)
    monkeypatch.setattr(Path, "read_text", read)
    marks.read([photo])
    assert str(conflict) in marks.conflicts.status()[0]["files"]
    assert conflict.read_bytes() == b"broken conflict settings"


@pytest.mark.skipif(os.name != "nt", reason="Windows case-insensitive filename semantics")
def test_uppercase_canonical_settings_suffix_is_not_a_conflict(tmp_path):
    marks, folder, photo = setup(tmp_path)
    Path(str(photo) + ".hdrf").rename(Path(str(photo) + ".HDRF"))
    marks.read([photo])
    assert marks.conflicts.status() == []


def test_reads_queue_during_helper_restart_without_waiting_on_request_thread(tmp_path, monkeypatch):
    worker = LibraryWorker(tmp_path / "cache")
    worker._recovering = True
    monkeypatch.setattr(worker._ready, "wait", lambda *a: pytest.fail("Request thread waited for helper restart"))
    try:
        job, future = worker.submit_library("scan", path=str(tmp_path))
        assert not future.done() and job in worker._requests
        with worker.busy():
            assert worker.status()["paused"]
        assert worker.cancel(job)
        assert job not in worker._requests
    finally:
        worker.close()


def test_index_retries_offline_pin_and_rescan_wakes_long_retry(tmp_path):
    marks, folder, photo = setup(tmp_path)
    browser = MediaBrowserStore(tmp_path / "app")
    browser.add_pin(str(folder))
    class Helper:
        def status(self):
            return {"paused": False}
        def submit_library(self, command, **arguments):
            from hdr_finisher.library_folders import scan_folder
            future = Future()
            future.set_result(scan_folder(arguments["path"]) if command == "scan" else {"photos": []})
            return "job", future
        def cancel(self, job):
            pass
    index = LibraryIndex(marks, browser, Helper())
    index._retry_seconds = 60
    folder.rename(tmp_path / "unplugged")
    try:
        index.kick()
        deadline = time.monotonic() + 5
        while index.status()["state"] != "retrying" and time.monotonic() < deadline:
            time.sleep(.02)
        assert index.status()["state"] == "retrying"
        (tmp_path / "unplugged").rename(folder)
        index.kick()
        deadline = time.monotonic() + 5
        while not index.status()["passes"] and time.monotonic() < deadline:
            time.sleep(.02)
        assert index.status()["passes"] == 1
    finally:
        index.close()


def test_helper_restart_limit_fails_waiters_and_leaves_grade_gate_available(tmp_path, capsys):
    worker = LibraryWorker(tmp_path / "cache")
    worker._restart_limit = 1
    worker.pause("Grade", True)
    try:
        job, future = worker.submit_library("scan", path=str(tmp_path))
        for restart in (1, 2):
            worker._process.terminate()
            worker._process.join(timeout=5)
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                status = worker.status()
                if status["failure"] or (status["restarts"] == restart and status["running"] and not status["recovering"]):
                    break
                time.sleep(.02)
        with pytest.raises(RuntimeError, match="repeated problems"):
            future.result(timeout=5)
        assert worker.status()["restarts"] == 1
        assert not worker.status()["running"]
        with worker.busy():
            pass
        assert "helper_restart_exhausted" in capsys.readouterr().err
    finally:
        worker.close()
