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
