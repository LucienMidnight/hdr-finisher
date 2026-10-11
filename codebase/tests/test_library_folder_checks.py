"""Folder checks on disposable photos, with a fake clock and no real timer waits."""
from concurrent.futures import Future
from pathlib import Path
import json
import time
from PIL import Image
import pytest
from hdr_finisher.library_index import LibraryIndex
from hdr_finisher.library_marks import LibraryMarks, MarkChange
from hdr_finisher.library_folders import scan_folder
from hdr_finisher.library_metadata import read_metadata
from hdr_finisher.library_worker import LibraryWorker
from hdr_finisher.media_browser import MediaBrowserStore

class Helper:
    def __init__(self):
        self.calls, self.paused = [], False
    def status(self):
        return {"paused": self.paused}
    def submit_library(self, command, **arguments):
        self.calls.append((command, arguments))
        f = Future()
        try:
            f.set_result(scan_folder(arguments["path"], fingerprints=True) if command == "scan" else read_metadata(arguments["paths"]))
        except Exception as error:
            f.set_exception(error)
        return "job", f
    def cancel(self, job):
        pass

@pytest.fixture
def library(tmp_path):
    folder = tmp_path / "Intake"
    folder.mkdir()
    photo = folder / "first.png"
    Image.new("RGB", (10, 10)).save(photo)
    browser = MediaBrowserStore(tmp_path / "app")
    browser.add_pin(str(folder))
    helper = Helper()
    index = LibraryIndex(LibraryMarks(browser.root), browser, helper)
    initial = scan_folder(folder, fingerprints=True)
    index.remember_scan(str(folder), initial["photos"])
    index.remember_facts(read_metadata([str(photo)])["photos"])
    index.checks.seed(initial)
    return index, helper, folder, photo

def test_arrivals_settle_between_checks_and_read_only_new_photo(library):
    index, helper, folder, old = library
    new = folder / "new.png"
    Image.new("RGB", (15, 15)).save(new)
    assert index.checks.check(str(folder))["held"] == 1
    assert len(index.checks.view(str(folder))["photos"]) == 1
    assert index.checks.check(str(folder))["added"] == 1
    reads = [a["paths"] for c, a in helper.calls if c == "metadata"]
    assert reads == [[str(new)]]
    assert index.checks.events[-1]["message"] == "1 new photos in Intake"
    before = index.marks.database.read_bytes()
    helper.calls.clear()
    events = list(index.checks.events)
    assert index.checks.check(str(folder))["added"] == 0
    assert index.marks.database.read_bytes() == before
    assert [c for c, _ in helper.calls] == ["scan"]
    assert list(index.checks.events) == events

def test_growing_photo_never_reads_metadata_or_records_problem(library):
    index, helper, folder, _ = library
    new = folder / "copy.png"
    new.write_bytes(b"half")
    assert index.checks.check(str(folder))["held"] == 1
    new.write_bytes(b"still copying")
    assert index.checks.check(str(folder))["held"] == 1
    assert not any(c == "metadata" for c, _ in helper.calls)
    Image.new("RGB", (8, 8)).save(new)
    assert index.checks.check(str(folder))["held"] == 1
    assert index.checks.check(str(folder))["added"] == 1
    assert not any(row["failure"] for row in index.checks.status()["folders"])

def test_rename_remove_replace_and_external_settings(library):
    index, helper, folder, photo = library
    other = LibraryMarks(folder.parent / "other")
    other.change([photo], MarkChange(rating=4, add_tag="Elsewhere"))
    other.writer.drain()
    assert index.checks.check(str(folder))["changed"] == 0
    assert index.marks._rows([str(photo)])[str(photo)]["marks"]["rating"] == 4
    assert index.marks.tags()[0]["tag"] == "Elsewhere"
    sidecar = Path(str(photo) + ".hdrf")
    sidecar.unlink()
    index.checks.check(str(folder))
    assert not index.marks._rows([str(photo)])
    Image.new("RGB", (21, 12)).save(photo)
    assert index.checks.check(str(folder))["held"] == 1
    assert index.checks.check(str(folder))["changed"] == 1
    renamed = folder / "renamed.png"
    photo.rename(renamed)
    assert index.checks.check(str(folder))["removed"] == 1
    assert index.checks.check(str(folder))["added"] == 1
    renamed.unlink()
    assert index.checks.check(str(folder))["removed"] == 1

def test_pending_marks_win_and_checks_do_not_write_settings(library):
    index, helper, folder, photo = library
    index.marks.change([photo], MarkChange(rating=5))
    before = index.marks.writer.status()["waiting"]
    photo.unlink()
    index.checks.check(str(folder))
    assert index.marks.writer.status()["waiting"] == before
    assert index.marks._rows([str(photo)])[str(photo)]["marks"]["rating"] == 5
    assert not Path(str(photo) + ".hdrf").exists()

def test_schedule_pause_off_foreground_and_per_folder_slowdown(library):
    index, _, folder, _ = library
    checks = index.checks
    now = [1000.]
    checks.clock = lambda: now[0]
    pins = index.browser.pinned()
    checks.folders[str(folder)]["last"] = 1000
    checks.views["dock"] = (str(folder), 2000)
    now[0] = 1016
    assert checks.choose(pins) == (str(folder), False)
    checks.folders[str(folder)].update(last=1016, duration=9)
    now[0] = 1035
    assert checks.choose(pins) is None
    other = str(folder / "Other")
    checks.folders[other] = {"last": 1000, "duration": 0}
    checks.views["popout"] = (other, 2000)
    assert checks.choose(pins) == (other, False)
    checks.views.pop("popout")
    index._paused = True
    assert checks.choose(pins) is None
    checks.requested.append(str(folder))
    assert checks.choose(pins) == (str(folder), True)
    index._paused = False
    # Disable without starting a real thread.
    index.preferences_path.write_text(json.dumps({"background_indexing": False}))
    checks.views.clear()
    now[0] = 1400
    assert checks.choose(pins) is None
    checks.views["dock"] = (str(folder), 1500)
    assert checks.choose(pins) == (str(folder), False)

def test_offline_entries_retained_and_reconnect_runs_immediately(library):
    index, _, folder, _ = library
    checks = index.checks
    gone = folder.with_name("gone")
    folder.rename(gone)
    assert checks.check(str(folder))["failed"]
    assert len(checks.view(str(folder))["photos"]) == 1
    folder_path = str(folder)
    assert checks.folders[folder_path]["offline"]
    gone.rename(folder)
    assert checks.choose(index.browser.pinned()) == (folder_path, False)
    checks.check(folder_path)
    assert not checks.folders[folder_path]["offline"]

def test_requested_empty_check_reports_completion(library):
    index, helper, folder, _ = library
    index.checks.check(str(folder), True)
    assert index.checks.events[-1]["message"] == "Checked Intake: no new photos"
    assert index.checks.status()["folders"][0]["last_checked"] is not None

def test_helper_check_runs_ahead_of_index_and_grade_gate_is_retained(tmp_path):
    large, selected = tmp_path / "large", tmp_path / "selected"
    large.mkdir(); selected.mkdir()
    for i in range(1800):
        (large / f"{i}.jpg").write_bytes(b"photo")
    (selected / "new.jpg").write_bytes(b"photo")
    helper = LibraryWorker(tmp_path / "app")
    order = []
    try:
        helper.pause("grade", True)
        _, background = helper.submit_library("scan", path=str(large), background=True, priority=95)
        _, requested = helper.submit_library("scan", path=str(selected), background=True, checking=True, priority=20)
        background.add_done_callback(lambda f: order.append("index"))
        requested.add_done_callback(lambda f: order.append("check"))
        assert not requested.done()
        started = time.monotonic()
        helper.pause("grade", False)
        assert len(requested.result(timeout=2)["photos"]) == 1
        assert time.monotonic() - started < 2
        assert len(background.result(timeout=15)["photos"]) == 1800
        assert order == ["check", "index"]
    finally:
        helper.close()


def _controlled_worker(connection, root, parent_pid, paused):
    # A slow, read-only folder walk with natural yield points, inside the real helper.
    import hdr_finisher.library_folders as folders
    from hdr_finisher.library_worker import _worker_main
    original = folders.scan_folder
    def scan(value, cancelled=lambda: False, fingerprints=False):
        if Path(value).name == "long-index":
            marker = Path(value).parent / "scan-count.txt"
            with marker.open("a") as stream:
                stream.write("one scan\n")
            (Path(value).parent / "started.txt").touch()
            for _ in range(100):
                if cancelled():
                    from concurrent.futures import CancelledError
                    raise CancelledError()
                time.sleep(.02)
        return original(value, cancelled, fingerprints)
    folders.scan_folder = scan
    _worker_main(connection, root, parent_pid, paused)


def test_requested_check_interrupts_a_running_scan_without_restarting_it(tmp_path, monkeypatch):
    import hdr_finisher.library_worker as workers
    monkeypatch.setattr(workers, "_worker_main", _controlled_worker)
    large, selected = tmp_path / "long-index", tmp_path / "selected"
    large.mkdir(); selected.mkdir()
    (large / "old.jpg").write_bytes(b"photo")
    (selected / "new.jpg").write_bytes(b"photo")
    helper = LibraryWorker(tmp_path / "app")
    try:
        _, background = helper.submit_library("scan", path=str(large), background=True, priority=95)
        deadline = time.monotonic() + 5
        while not (tmp_path / "started.txt").exists() and time.monotonic() < deadline:
            time.sleep(.01)
        assert (tmp_path / "started.txt").exists() and not background.done()
        started = time.monotonic()
        _, requested = helper.submit_library("scan", path=str(selected), background=True, checking=True, priority=20)
        assert len(requested.result(timeout=2)["photos"]) == 1
        assert time.monotonic() - started < 2 and not background.done()
        assert len(background.result(timeout=8)["photos"]) == 1
        assert (tmp_path / "scan-count.txt").read_text() == "one scan\n"
    finally:
        helper.close()


def test_empty_check_has_no_log_and_no_settings_or_metadata_reads(library, monkeypatch, capsys):
    index, helper, folder, _ = library
    capsys.readouterr()
    monkeypatch.setattr(index.marks, "read", lambda *a, **k: pytest.fail("unchanged settings reread"))
    monkeypatch.setattr(index, "remember_scan", lambda *a, **k: pytest.fail("empty check wrote to database"))
    index.checks.check(str(folder))
    assert not capsys.readouterr().err
    assert [c for c, _ in helper.calls] == ["scan"]


def test_external_unreadable_settings_report_and_clear_without_being_written(library):
    index, _, folder, photo = library
    sidecar = Path(str(photo) + ".hdrf")
    sidecar.write_text("broken external settings")
    index.checks.check(str(folder))
    assert "cannot be read" in index.checks.status()["folders"][0]["warnings"][0]
    assert sidecar.read_text() == "broken external settings"
    sidecar.unlink()
    index.checks.check(str(folder))
    assert not index.checks.status()["folders"][0]["warnings"]


def test_subfolder_listing_and_cached_parent_view_stay_current(library):
    index, _, folder, _ = library
    child = folder / "new-subfolder"
    child.mkdir()
    photo = child / "photo.png"
    Image.new("RGB", (10, 10)).save(photo)
    index.checks.check(str(folder))
    index.checks.check(str(folder))
    assert str(child) in index.checks.view(str(folder))["folders"]
    index.checks.seed(scan_folder(child, fingerprints=True))
    another = child / "another.png"
    Image.new("RGB", (10, 10)).save(another)
    index.checks.check(str(child)); index.checks.check(str(child))
    assert str(another) in [p["path"] for p in index.checks.view(str(folder))["photos"]]


def test_removed_subfolder_clears_saved_collection_counts_but_keeps_pending_marks(library):
    import shutil
    index, _, folder, _ = library
    child = folder / "child"
    child.mkdir()
    saved, pending = child / "saved.png", child / "pending.png"
    for p in (saved, pending):
        Image.new("RGB", (10, 10)).save(p)
    index.marks.change([saved], MarkChange(add_tag="Saved"))
    index.marks.album_create("Saved album", [saved])
    index.marks.writer.drain()
    index.marks.change([pending], MarkChange(rating=5))
    index.checks.seed(scan_folder(folder, fingerprints=True))
    shutil.rmtree(child)  # Only this disposable test subfolder.
    assert index.checks.check(str(folder))["removed"] == 2
    assert not index.marks.tag_paths("Saved")
    assert not index.marks.album_paths("Saved album")
    assert index.marks._rows([str(pending)])[str(pending)]["marks"]["rating"] == 5
