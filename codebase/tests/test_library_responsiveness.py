"""Foreground results and lock isolation, using disposable data only."""
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path

from hdr_finisher.library_documents import LibraryDocuments, identity
from hdr_finisher.library_copies import LibraryCopies
from hdr_finisher.library_marks import MarkChange
from test_library_grades import setup, edit
from test_library_membership import library
from hdr_finisher.library_folders import scan_folder


def test_grade_reader_finishes_while_library_and_database_writer_are_busy(setup):
    photo, store, session, marks, grades = setup
    desired = edit(store, session)
    grades.save(str(session.session_id))
    documents = LibraryDocuments(marks)
    # An uncommitted maintenance write and the shared Library lock must not
    # delay the reader, or hide the last committed pending grade.
    with ThreadPoolExecutor() as pool:
        with marks._lock:
            db = marks._connect()
            try:
                db.execute("BEGIN IMMEDIATE")
                db.execute("UPDATE photo_grades SET state=state")
                result = pool.submit(documents.request, photo).result(timeout=2)
                opened = pool.submit(grades.open_settings, photo).result(timeout=2)
            finally:
                db.rollback(); db.close()
    assert result["grade"] == desired
    assert result["grade_identity"] == identity(desired)
    assert opened.model_dump(mode="json") == desired
    marks.writer.drain()
    assert documents.request(photo)["grade"] == desired


def test_virtual_grade_reader_uses_pending_copy_and_sees_sidecar_after_ack(setup):
    photo, store, session, marks, grades = setup
    copies = LibraryCopies(marks)
    key = copies.create(str(photo))["photos"][0]["path"]
    grades.attach(str(session.session_id), key)
    expected = edit(store, session)
    grades.save(str(session.session_id))
    documents = LibraryDocuments(marks)
    with ThreadPoolExecutor() as pool:
        with marks._lock:
            result = pool.submit(documents.request, key).result(timeout=2)
    assert result["grade"] == expected
    marks.writer.drain()
    assert documents.request(key)["grade"] == expected
    saved = json.loads(Path(str(photo)+".hdrf").read_text())
    assert saved["virtual_copies"][0]["grade"] == expected
    assert documents.request(photo)["grade"] is None


def test_scoped_ratings_listing_and_recovery_equal_full_reconcile(tmp_path):
    folder, photos, browser, marks, index = library(tmp_path)
    marks.album_create("Keep", photos[:2]); marks.writer.drain()
    unchanged = {p.name: p.read_bytes() for p in index.membership.records.glob("*.json")}
    marks.change([photos[0]], MarkChange(rating=5, add_tag="Winner"))
    marks.writer.drain()
    scan = scan_folder(folder)
    index.remember_scan(str(folder), scan["photos"], reconcile=False)
    rows = marks.read([p["path"] for p in scan["photos"]])["photos"]
    assert [r["marks"]["rating"] for r in rows] == [5, 0, 0]
    assert rows[0]["marks"]["tags"] == ["Winner"]
    assert rows[0]["albums"] == ["Keep"]
    assert json.loads(Path(str(photos[0])+".hdrf").read_text())["marks"] == rows[0]["marks"]
    scoped = {p.name: p.read_bytes() for p in index.membership.records.glob("*.json")}
    assert any(scoped[name] == data for name, data in unchanged.items())
    manifest = index.membership.path.read_bytes()
    index.membership.reconcile()
    assert scoped == {p.name: p.read_bytes() for p in index.membership.records.glob("*.json")}
    assert manifest == index.membership.path.read_bytes()
    assert marks.read(photos)["photos"] == rows

def test_maintenance_batches_leave_unrelated_families_alone(tmp_path):
    folder, photos, browser, marks, index = library(tmp_path)
    # An unrelated detached entry awaits its own maintenance. A metadata batch
    # and a changed-folder delta must not retire it as a whole pass would.
    detached = str(tmp_path / "elsewhere" / "offline.png")
    db = marks._connect()
    with db:
        db.execute("INSERT INTO files VALUES (?,1,1,NULL)", (detached,))
    db.close()
    index.remember_facts([{"path": str(photos[0]), "bytes": 1, "mtime_ns": 2}])
    index.remember_scan(str(folder), [], removed=[str(photos[1])])
    assert marks._query("SELECT path FROM files WHERE path=?", (detached,))
    assert not marks._query("SELECT path FROM files WHERE path=?", (str(photos[1]),))
    assert marks._query("SELECT path FROM files WHERE path=?", (str(photos[2]),))


def test_kept_check_retires_only_the_missing_member(tmp_path):
    from hdr_finisher.library_folders import check_kept
    folder, photos, browser, marks, index = library(tmp_path)
    marks.album_create("Keep", photos[:2]); marks.writer.drain()
    browser.remove_pin(str(folder)); index.membership.reconcile()
    records = {p.name: p.read_bytes() for p in index.membership.records.glob("*.json")}
    class Checks:
        def _job(self, command, **args):
            assert command == "kept-check"
            return check_kept(args["paths"])
    index.wait_for_grade = lambda: None
    index.membership.check(Checks())
    photos[0].unlink()
    assert index.membership.check(Checks())
    assert marks.album_paths("Keep") == [str(photos[1])]
    remaining = {p.name: p.read_bytes() for p in index.membership.records.glob("*.json")}
    assert len(remaining) == 1
    assert all(records[name] == value for name, value in remaining.items())


def test_full_maintenance_yields_to_foreground_between_pages(tmp_path, monkeypatch):
    from threading import Event
    folder, photos, browser, marks, index = library(tmp_path)
    browser.remove_pin(str(folder))
    entered, foreground = Event(), Event()
    original = index.membership.reconcile
    def reconcile(paths=None):
        if paths is None: return original()
        original(paths)
        if paths and not entered.is_set():
            entered.set()
            assert foreground.wait(2)
    monkeypatch.setattr(index.membership, "reconcile", reconcile)
    with ThreadPoolExecutor() as pool:
        maintenance = pool.submit(index.membership.reconcile)
        assert entered.wait(2)
        with marks._lock:
            foreground.set()
        maintenance.result(timeout=3)
    assert not marks._query("SELECT path FROM files")


def test_restart_does_not_reconcile_before_helper_start(tmp_path, monkeypatch):
    from hdr_finisher.library_index import LibraryIndex
    from hdr_finisher.library_membership import LibraryMembership
    folder, photos, browser, marks, index = library(tmp_path)
    calls = []
    monkeypatch.setattr(LibraryMembership, "reconcile", lambda *args: calls.append(args))
    restarted = LibraryIndex(marks, browser, None)
    assert restarted.membership.marks is marks
    assert calls == []
