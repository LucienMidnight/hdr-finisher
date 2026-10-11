"""Stage A recovery/Undo boundaries, using only disposable photos and settings."""
import errno
import json
import os
import subprocess
import sys
from pathlib import Path
from threading import Event, Thread
import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from hdr_finisher.library_marks import LibraryMarks, MarkChange
from hdr_finisher.library_api import create_library_router
from hdr_finisher.media_browser import MediaBrowserStore


def setup(tmp_path, count=3):
    folder = tmp_path / "photos"
    folder.mkdir()
    photos = [folder / f"{i}.png" for i in range(count)]
    for photo in photos:
        photo.write_bytes(b"original")
    return LibraryMarks(tmp_path / "app"), photos


def document(photo):
    return json.loads(Path(str(photo) + ".hdrf").read_text())


def retry(store):
    with store._lock:
        db = store._connect()
        with db:
            db.execute("UPDATE settings_writes SET next_try=0")
        db.close()
        store.writer._group_delays.clear()
    return store.writer.drain()


@pytest.mark.parametrize("written", [0, 1, 3])
def test_restart_after_each_file_boundary_keeps_entire_bulk_change(tmp_path, written):
    store, photos = setup(tmp_path)
    result = store.change(photos, MarkChange(rating=5, add_tag="Keep"))
    assert result["undo_available"] and all(row["storage"] == "database" for row in result["photos"])
    for photo in photos[:written]:
        store.writer._attempt(str(photo))
    restarted = LibraryMarks(tmp_path / "app")
    assert all(row["marks"]["rating"] == 5 for row in restarted.read(photos)["photos"])
    restarted.writer.start()
    try:
        deadline = time.monotonic() + 5
        while restarted.writer.status()["waiting"] and time.monotonic() < deadline:
            time.sleep(.01)
        assert restarted.writer.status()["waiting"] == 0
        assert all(document(photo)["marks"]["rating"] == 5 for photo in photos)
        notices = [event["message"] for event in restarted.writer.status()["events"] if "last session" in event["message"]]
        assert len(notices) == (1 if written < 3 else 0)
        assert not restarted.undo()["undo_available"]
    finally:
        restarted.writer.close()


@pytest.mark.parametrize("written", [0, 1, 3])
def test_undo_before_during_and_after_writer(tmp_path, written):
    store, photos = setup(tmp_path)
    store.change(photos, MarkChange(rating=4))
    for photo in photos[:written]:
        store.writer._attempt(str(photo))
    result = store.undo()
    assert len(result["photos"]) == 3 and not result["undo_available"]
    assert all(row["marks"]["rating"] == 0 for row in result["photos"])
    store.writer.drain()
    for photo in photos[:written]:
        assert document(photo)["marks"]["rating"] == 0
    for photo in photos[written:]:
        assert not Path(str(photo) + ".hdrf").exists()


def test_writer_preparing_a_file_does_not_block_commands_and_cannot_replace_newer_marks(tmp_path, monkeypatch):
    store, photos = setup(tmp_path, 1)
    store.change(photos, MarkChange(rating=1))
    entered, release = Event(), Event()
    real = store._write_sidecar
    def slow(*args, **kwargs):
        entered.set()
        assert release.wait(5)
        return real(*args, **kwargs)
    monkeypatch.setattr(store, "_write_sidecar", slow)
    worker = Thread(target=store.writer.drain)
    worker.start()
    assert entered.wait(5)
    try:
        assert store.read(photos)["photos"][0]["marks"]["rating"] == 1
        store.change(photos, MarkChange(rating=5))
        assert store.undo()["photos"][0]["marks"]["rating"] == 1
        assert store.undo()["photos"][0]["storage"] == "none"
    finally:
        release.set()
        worker.join(5)
    assert not worker.is_alive()
    assert not Path(str(photos[0]) + ".hdrf").exists()
    assert not list(photos[0].parent.glob("*.tmp"))


def test_rapid_changes_write_only_latest_marks_and_album(tmp_path):
    store, photos = setup(tmp_path)
    store.change(photos, MarkChange(rating=1))
    store.album_create("Portfolio", photos)
    store.change(photos, MarkChange(rating=5, add_tag="Latest"))
    store.writer.drain()
    assert all(document(photo)["marks"]["rating"] == 5 and document(photo)["albums"] == ["Portfolio"] for photo in photos)


def test_undo_skips_missing_photo_and_restores_rest(tmp_path):
    store, photos = setup(tmp_path)
    store.change(photos, MarkChange(rating=4))
    store.writer.drain()
    photos[1].unlink()
    result = store.undo()
    assert result["skipped"] == 1 and len(result["photos"]) == 2
    assert "skipped" in result["warnings"][0]
    store.writer.drain()
    assert document(photos[0])["marks"]["rating"] == 0
    assert document(photos[2])["marks"]["rating"] == 0


@pytest.mark.parametrize("error,reason", [
    (OSError(errno.EBUSY, "sync lock"), "locked"),
    (OSError(errno.ENOSPC, "no space"), "disk_full"),
    (PermissionError(errno.EACCES, "read-only folder"), "unwritable"),
    (OSError(errno.EIO, "drive error"), "io"),
])
def test_failure_reason_safe_marks_other_folder_progress_and_recovery(tmp_path, monkeypatch, capsys, error, reason):
    store, photos = setup(tmp_path, 1)
    other = tmp_path / "other" / "good.png"
    other.parent.mkdir()
    other.write_bytes(b"original")
    store.change([*photos, other], MarkChange(rating=5))
    # Treat the two folders as separate drives, so a full drive does not
    # stop writing to the other one. Same-drive pause is checked below.
    monkeypatch.setattr(store.writer, "drive", lambda source: str(source.parent))
    real = store._write_sidecar
    def fail_one(path, *args, **kwargs):
        if path == photos[0]:
            raise error
        return real(path, *args, **kwargs)
    monkeypatch.setattr(store, "_write_sidecar", fail_one)
    store.writer.drain()
    assert store.writer.status()["reasons"] == {reason: 1}
    assert document(other)["marks"]["rating"] == 5
    assert store.read(photos)["photos"][0]["marks"]["rating"] == 5
    if reason == "locked":
        assert store.writer.status()["events"] == []
        for _ in range(3):
            retry(store)
        assert store.writer.status()["events"]
    assert "[library] writer_" + reason in capsys.readouterr().err
    monkeypatch.setattr(store, "_write_sidecar", real)
    retry(store)
    assert store.writer.status()["waiting"] == 0
    assert store.writer.status()["reasons"] == {}
    assert document(photos[0])["marks"]["rating"] == 5
    assert "Finished writing" in store.writer.status()["events"][-1]["message"]


def test_unplugged_folder_waits_then_recovers_without_touching_original(tmp_path):
    store, photos = setup(tmp_path)
    store.change(photos, MarkChange(rating=5))
    disconnected = tmp_path / "disconnected"
    photos[0].parent.rename(disconnected)
    store.writer.drain()
    assert store.writer.status()["reasons"] == {"offline": 3}
    disconnected.rename(photos[0].parent)
    retry(store)
    assert store.writer.status()["waiting"] == 0
    assert all(document(photo)["marks"]["rating"] == 5 and photo.read_bytes() == b"original" for photo in photos)


def test_unreadable_after_commit_is_never_overwritten_and_recovers(tmp_path, capsys):
    store, photos = setup(tmp_path, 2)
    store.change(photos, MarkChange(rating=4))
    bad = Path(str(photos[0]) + ".hdrf")
    bad.write_text("broken")
    store.writer.drain()
    assert bad.read_text() == "broken"
    assert store.writer.status()["reasons"] == {"unreadable": 1}
    assert document(photos[1])["marks"]["rating"] == 4
    assert "writer_unreadable" in capsys.readouterr().err
    bad.unlink()
    retry(store)
    assert document(photos[0])["marks"]["rating"] == 4


def test_external_edit_keeps_every_other_field_and_reports(tmp_path, capsys):
    store, photos = setup(tmp_path, 1)
    store.change(photos, MarkChange(rating=1))
    store.writer.drain()
    store.change(photos, MarkChange(rating=5))
    changed = document(photos[0])
    changed["marks"]["rating"] = 2
    changed["adjustments"] = {"exposure": 1.2}
    changed["unknown"] = [1, 2]
    Path(str(photos[0]) + ".hdrf").write_text(json.dumps(changed))
    store.writer.drain()
    saved = document(photos[0])
    assert saved["marks"]["rating"] == 5
    assert saved["adjustments"] == changed["adjustments"] and saved["unknown"] == [1, 2]
    assert "writer_external_change" in capsys.readouterr().err
    assert "every other setting was kept" in store.writer.status()["events"][-1]["message"]


def test_owned_temporary_cleanup_leaves_all_other_files(tmp_path):
    store, photos = setup(tmp_path, 1)
    store.change(photos, MarkChange(rating=4))
    row = store.read(photos)["photos"][0]
    valid = store._new_document(row)
    owned = photos[0].parent / ("." + photos[0].name + ".hdrf.abcdefgh.tmp")
    owned.write_text(json.dumps(valid))
    incomplete = photos[0].parent / (f".hdrf-settings.{photos[0].name}.hdrf.{store.writer.owner(row['photo_id'])}.12345678.tmp")
    incomplete.write_text("{ half-written")
    unrelated = [photos[0].parent / name for name in (".0.png.hdrf.12345678.tmp", ".other.png.hdrf.abcdefgh.tmp", ".0.png.hdrf.not-ours.tmp")]
    for item in unrelated:
        item.write_text("not our settings")
    assert store.writer.cleanup() == 2
    assert not owned.exists() and not incomplete.exists() and all(item.exists() for item in unrelated)


@pytest.mark.parametrize("boundary", ["before_commit", "temporary", "after_replace"])
def test_interruption_at_atomic_write_boundaries(tmp_path, monkeypatch, boundary):
    store, photos = setup(tmp_path, 1)
    if boundary == "before_commit":
        real = store._index
        def crash(db, row):
            real(db, row)
            raise RuntimeError("interrupted transaction")
        monkeypatch.setattr(store, "_index", crash)
        with pytest.raises(RuntimeError):
            store.change(photos, MarkChange(rating=5))
        assert not store._rows([str(photos[0])])
        return
    store.change(photos, MarkChange(rating=5))
    real_replace = __import__("os").replace
    def interrupted(source, destination):
        if boundary == "after_replace":
            real_replace(source, destination)
        raise RuntimeError("killed")
    monkeypatch.setattr("hdr_finisher.library_marks.os.replace", interrupted)
    with pytest.raises(RuntimeError):
        store.writer.drain()
    monkeypatch.setattr("hdr_finisher.library_marks.os.replace", real_replace)
    restarted = LibraryMarks(tmp_path / "app")
    restarted.writer.drain()
    assert document(photos[0])["marks"]["rating"] == 5 and restarted.writer.status()["waiting"] == 0


def test_failure_flood_is_grouped_and_does_not_block_another_folder(tmp_path, monkeypatch, capsys):
    store, photos = setup(tmp_path, 20)
    store.change(photos, MarkChange(rating=5))
    monkeypatch.setattr(store, "_write_sidecar", lambda *args, **kwargs: (_ for _ in ()).throw(PermissionError(errno.EACCES, "read-only share")))
    store.writer.drain()
    lines = [line for line in capsys.readouterr().err.splitlines() if "writer_unwritable" in line]
    assert len(lines) == 1 and '"count": 20' in lines[0] and "read-only share" in lines[0]
    assert len(store.writer.status()["events"]) == 1


def test_writer_gives_way_to_grade_and_closes_without_draining(tmp_path):
    store, photos = setup(tmp_path)
    store.change(photos, MarkChange(rating=3))
    store.writer._busy = lambda: True
    store.writer.drain()
    assert store.writer.status()["waiting"] == 3
    store.writer.close()
    store.writer.drain()
    assert not any(Path(str(photo) + ".hdrf").exists() for photo in photos)
    restarted = LibraryMarks(tmp_path / "app")
    restarted.writer.drain()
    assert all(document(photo)["marks"]["rating"] == 3 for photo in photos)


def test_router_lifespan_resumes_pending_on_backend_start(tmp_path):
    store, photos = setup(tmp_path, 1)
    store.change(photos, MarkChange(rating=4))
    class Worker:
        def status(self):
            return {"paused": False}
    app = FastAPI()
    app.include_router(create_library_router(Worker(), MediaBrowserStore(tmp_path / "app")))
    with TestClient(app) as client:
        deadline = time.monotonic() + 5
        while client.get("/api/library/settings-status").json()["waiting"] and time.monotonic() < deadline:
            time.sleep(.01)
        assert client.get("/api/library/settings-status").json()["waiting"] == 0
        assert document(photos[0])["marks"]["rating"] == 4


@pytest.mark.parametrize("boundary", ["database", "temporary", "replace"])
def test_hard_process_exit_recovers_database_and_owned_temporary_file(tmp_path, boundary):
    store, photos = setup(tmp_path, 3)
    script = """
import os, sys
from hdr_finisher.library_marks import LibraryMarks, MarkChange
store = LibraryMarks(__import__('pathlib').Path(sys.argv[1]))
paths = sys.argv[3:]
if sys.argv[2] == 'database':
    real_index = store._index
    def interrupted(db, row):
        real_index(db, row)
        os._exit(81)
    store._index = interrupted
store.change(paths, MarkChange(rating=5))
real_replace = os.replace
replaced = 0
def interrupted(source, destination):
    global replaced
    if replaced == 1:
        if sys.argv[2] == 'replace':
            real_replace(source, destination)
        os._exit(81)
    real_replace(source, destination)
    replaced += 1
os.replace = interrupted
store.writer.drain()
"""
    result = subprocess.run([sys.executable, "-c", script, str(tmp_path / "app"), boundary, *map(str, photos)],
        env={**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[1] / "backend")}, timeout=10)
    assert result.returncode == 81
    restarted = LibraryMarks(tmp_path / "app")
    if boundary == "database":
        assert not restarted._rows(list(map(str, photos)))
        assert not any(Path(str(photo) + ".hdrf").exists() for photo in photos)
    else:
        restarted.writer.cleanup()
        restarted.writer.drain()
        assert all(document(photo)["marks"]["rating"] == 5 for photo in photos)
        assert not list(photos[0].parent.glob("*.tmp"))
    assert all(photo.read_bytes() == b"original" for photo in photos)


def test_disk_full_pauses_whole_drive_and_reports_once(tmp_path, monkeypatch):
    store, photos = setup(tmp_path)
    store.change(photos, MarkChange(rating=5))
    calls = []
    def full(path, *args, **kwargs):
        calls.append(path)
        raise OSError(errno.ENOSPC, "disk full")
    monkeypatch.setattr(store, "_write_sidecar", full)
    store.writer.drain()
    assert len(calls) == 1
    assert store.writer.status()["reasons"] == {"disk_full": 3}
    assert len(store.writer.status()["events"]) == 1


def test_external_edit_during_temporary_preparation_is_reread(tmp_path, monkeypatch):
    store, photos = setup(tmp_path, 1)
    store.change(photos, MarkChange(rating=1))
    store.writer.drain()
    store.change(photos, MarkChange(rating=5))
    real = __import__("os").fsync
    def external_edit(fd):
        real(fd)
        changed = document(photos[0])
        changed["unknown"] = {"keep": 42}
        Path(str(photos[0]) + ".hdrf").write_text(json.dumps(changed))
    monkeypatch.setattr("hdr_finisher.library_marks.os.fsync", external_edit)
    store.writer.drain()
    assert document(photos[0])["marks"]["rating"] == 1
    assert store.writer.status()["waiting"] == 1
    monkeypatch.setattr("hdr_finisher.library_marks.os.fsync", real)
    store.writer.drain()
    assert document(photos[0])["marks"]["rating"] == 5
    assert document(photos[0])["unknown"] == {"keep": 42}


def test_missing_pending_photo_is_removed_without_delaying_other_files(tmp_path):
    store, photos = setup(tmp_path)
    store.change(photos, MarkChange(rating=5))
    photos[1].unlink()
    store.writer.drain()
    assert not store._rows([str(photos[1])])
    assert store.writer.status()["waiting"] == 0
    assert document(photos[0])["marks"]["rating"] == document(photos[2])["marks"]["rating"] == 5
    assert "library entries were removed" in store.writer.status()["events"][-1]["message"]


def test_file_lock_while_reading_is_retried_as_lock_not_bad_json(tmp_path, monkeypatch):
    store, photos = setup(tmp_path, 1)
    store.change(photos, MarkChange(rating=5))
    error = PermissionError("settings locked by another program")
    error.winerror = 32
    def unreadable(path):
        raise ValueError("Settings cannot be read") from error
    monkeypatch.setattr(store, "_document", unreadable)
    store.writer.drain()
    assert store.writer.status()["reasons"] == {"locked": 1}
    assert not store.writer.status()["events"]


def test_arbitrary_valid_photo_id_is_preserved_and_safe_for_temporary_name(tmp_path):
    store, photos = setup(tmp_path, 1)
    row = {"path": str(photos[0]), "photo_id": "other/app:id.with.dots"}
    saved = store._new_document(row)
    saved["marks"] = {"rating": 1, "pick": "unmarked", "label": "", "tags": []}
    Path(str(photos[0]) + ".hdrf").write_text(json.dumps(saved))
    store.change(photos, MarkChange(rating=5))
    store.writer.drain()
    assert document(photos[0])["photo_id"] == saved["photo_id"]
    assert document(photos[0])["marks"]["rating"] == 5


def test_new_command_after_replacement_uses_written_file_as_baseline(tmp_path, monkeypatch):
    store, photos = setup(tmp_path, 1)
    store.change(photos, MarkChange(rating=1))
    real = store._write_sidecar
    def followed_by_command(*args, **kwargs):
        result = real(*args, **kwargs)
        store.change(photos, MarkChange(rating=5))
        return result
    monkeypatch.setattr(store, "_write_sidecar", followed_by_command)
    store.writer.drain()
    assert store.read(photos)["photos"][0]["marks"]["rating"] == 5
    assert store.writer.status()["waiting"] == 1
    monkeypatch.setattr(store, "_write_sidecar", real)
    store.writer.drain()
    assert document(photos[0])["marks"]["rating"] == 5
    assert not store.writer.status()["events"]


def test_existing_pending_rows_are_kept_without_inventing_external_edit(tmp_path):
    store, photos = setup(tmp_path, 1)
    store.change(photos, MarkChange(rating=5))
    db = store._connect()
    with db:
        db.execute("DROP TABLE settings_writes")
    db.close()
    restarted = LibraryMarks(tmp_path / "app")
    restarted.writer.drain()
    assert document(photos[0])["marks"]["rating"] == 5
    assert "Earlier file changes could not be checked" in restarted.writer.status()["events"][-1]["message"]


def test_unwritable_single_settings_file_does_not_hold_up_same_folder(tmp_path, monkeypatch):
    store, photos = setup(tmp_path, 2)
    store.change(photos, MarkChange(rating=5))
    real = store._write_sidecar
    def deny_first(path, *args, **kwargs):
        if path == photos[0]:
            raise PermissionError(errno.EACCES, "one settings file is read-only")
        return real(path, *args, **kwargs)
    monkeypatch.setattr(store, "_write_sidecar", deny_first)
    store.writer.drain()
    assert store.writer.status()["reasons"] == {"unwritable": 1}
    assert document(photos[1])["marks"]["rating"] == 5
