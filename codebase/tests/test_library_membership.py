"""Pins/album scope on disposable photos and app data only."""
import json
from pathlib import Path
from PIL import Image
from hdr_finisher.library_marks import LibraryMarks, MarkChange
from hdr_finisher.library_index import LibraryIndex
from hdr_finisher.library_smart_albums import SmartAlbums
from hdr_finisher.library_folders import scan_folder, check_kept
from hdr_finisher.library_metadata import read_metadata
from hdr_finisher.media_browser import MediaBrowserStore
from test_library_grades import setup


def library(tmp_path):
    folder = tmp_path / "shoot"; folder.mkdir()
    photos = [folder / f"{i}.png" for i in range(3)]
    for photo in photos: Image.new("RGB", (8,8)).save(photo)
    browser = MediaBrowserStore(tmp_path / "app"); browser.add_pin(str(folder))
    marks = LibraryMarks(browser.root); index = LibraryIndex(marks, browser, None)
    index.remember_scan(str(folder), scan_folder(folder)["photos"])
    return folder, photos, browser, marks, index


def candidates(index):
    return {p["path"] for p in SmartAlbums(index.marks,index).candidates()["photos"]}


def test_unpin_really_cleans_index_but_keeps_album_marks_and_disk(tmp_path):
    folder, photos, browser, marks, index = library(tmp_path)
    marks.change(photos, MarkChange(add_tag="Shoot", rating=5)); marks.writer.drain()
    marks.album_create("Keep", [photos[0]]); marks.writer.drain()
    before = {p:Path(str(p)+".hdrf").read_bytes() for p in photos}
    assert index.membership.impact(folder=str(folder)) == {"leaving":2,"kept":1}
    browser.remove_pin(str(folder)); index.membership.reconcile()
    assert candidates(index) == {str(photos[0])}
    assert marks.tags()[0]["count"] == 1
    assert {p for p, in marks._query("SELECT path FROM photos")} == {str(photos[0])}
    assert all(Path(str(p)+".hdrf").read_bytes() == before[p] for p in photos)
    assert all(p.exists() for p in photos)
    browser.add_pin(str(folder)); index.remember_scan(str(folder), scan_folder(folder)["photos"]); marks.read(photos)
    assert candidates(index) == {str(p) for p in photos}
    assert marks.tags()[0]["count"] == 3


def test_last_album_removal_and_delete_leave_and_undo_returns(tmp_path):
    folder, photos, browser, marks, index = library(tmp_path)
    marks.album_create("Keep", [photos[0]]); marks.writer.drain()
    browser.remove_pin(str(folder)); index.membership.reconcile()
    marks.album_change("Keep", [photos[0]], False)
    assert candidates(index) == set()
    marks.undo(); assert candidates(index) == {str(photos[0])}
    marks.album_delete("Keep"); assert candidates(index) == set()
    marks.undo(); assert marks.album_paths("Keep") == [str(photos[0])]
    assert candidates(index) == {str(photos[0])}


def test_overlapping_pins_and_temporary_browsing(tmp_path):
    folder, photos, browser, marks, index = library(tmp_path)
    browser.add_pin(str(tmp_path)); browser.remove_pin(str(folder)); index.membership.reconcile()
    assert candidates(index) == {str(p) for p in photos}
    browser.remove_pin(str(tmp_path)); index.membership.reconcile()
    index.remember_scan(str(folder), scan_folder(folder)["photos"])
    marks.read(photos)
    assert candidates(index) == set()
    marks.change([photos[1]], MarkChange(add_tag="Temporary")); marks.writer.drain()
    assert not candidates(index) and marks.tags()[0]["count"] == 0
    marks.album_create("Kept from browsing", [photos[1]])
    assert candidates(index) == {str(photos[1])}


def test_kept_album_rebuild_including_offline_pending_state(tmp_path):
    folder, photos, browser, marks, index = library(tmp_path)
    marks.album_create("Keep", [photos[0]])
    browser.remove_pin(str(folder)); index.membership.reconcile()
    gone = folder.with_name("unplugged"); folder.rename(gone)
    marks.database.unlink()
    rebuilt = LibraryMarks(browser.root); restored = LibraryIndex(rebuilt, browser, None)
    assert rebuilt.album_paths("Keep") == [str(photos[0])]
    assert candidates(restored) == {str(photos[0])}
    assert rebuilt._rows([str(photos[0])])[str(photos[0])]["storage"] == "database"
    gone.rename(folder); rebuilt.writer.drain()
    assert json.loads(Path(str(photos[0])+".hdrf").read_text())["albums"] == ["Keep"]


def test_detached_pending_marks_grade_recovery_and_history_survive(tmp_path):
    folder, photos, browser, marks, index = library(tmp_path)
    marks.change([photos[0]], MarkChange(rating=4))
    # Real Grade state is owned by its existing writer. Scope must preserve it
    # byte for byte, including unsaved recovery and retained previous work.
    state = {"pending": True, "desired":{"saved":"grade"}, "recovery":{"unsaved":"work"}, "previous_grade":{"previous":"grade"}}
    db=marks._connect()
    with db:
        db.execute("CREATE TABLE photo_grades (path TEXT PRIMARY KEY, state TEXT NOT NULL)")
        db.execute("INSERT INTO photo_grades VALUES (?,?)", (str(photos[0]),json.dumps(state)))
    db.close()
    gone = folder.with_name("unplugged"); folder.rename(gone)
    browser.remove_pin(str(folder)); index.membership.reconcile()
    assert not candidates(index)
    marks.writer.drain()
    assert json.loads(marks._query("SELECT state FROM photo_grades")[0][0]) == state
    assert marks._rows([str(photos[0])])[str(photos[0])]["marks"]["rating"] == 4
    marks.database.unlink(); restored = LibraryMarks(browser.root); rebuilt=LibraryIndex(restored,browser,None)
    assert not candidates(rebuilt)
    assert json.loads(restored._query("SELECT state FROM photo_grades")[0][0]) == state
    gone.rename(folder); restored.writer.drain()
    assert json.loads(Path(str(photos[0])+".hdrf").read_text())["marks"]["rating"] == 4


def test_kept_check_only_known_paths_and_sidecar_changes_and_delete(tmp_path):
    folder, photos, browser, marks, index = library(tmp_path)
    marks.album_create("Keep", [photos[0]]); marks.writer.drain()
    browser.remove_pin(str(folder)); index.membership.reconcile()
    class Checks:
        def __init__(self): self.calls=[]
        def _job(self,command,**args):
            self.calls.append((command,args["paths"]))
            return check_kept(args["paths"]) if command == "kept-check" else read_metadata(args["paths"])
    checks=Checks()
    index.wait_for_grade = lambda: None
    assert index.membership.check(checks)
    assert not index.membership.check(checks)
    assert all(paths == [str(photos[0])] for _,paths in checks.calls)
    sidecar=Path(str(photos[0])+".hdrf"); data=json.loads(sidecar.read_text()); data["marks"]["rating"]=5; sidecar.write_text(json.dumps(data))
    assert index.membership.check(checks)
    assert marks._rows([str(photos[0])])[str(photos[0])]["marks"]["rating"] == 5
    photos[0].unlink(); assert index.membership.check(checks)
    assert not candidates(index) and not marks.album_paths("Keep")


def test_real_unwritten_grade_flushes_after_unpin_and_reconnection(setup,tmp_path):
    from test_library_grades import edit, settings
    from hdr_finisher.library_grades import LibraryGrades
    photo, store, session, marks, grades = setup
    browser=MediaBrowserStore(marks.database.parent); browser.add_pin(str(photo.parent))
    index=LibraryIndex(marks,browser,None)
    index.remember_scan(str(photo.parent),scan_folder(photo.parent)["photos"])
    desired=edit(store,session)
    grades.save(str(session.session_id))
    marks.change([photo],MarkChange(rating=4))
    # Rename only the disposable source, leaving its containing volume offline
    # as observed by the established writer's parent-directory probe.
    detached=photo.parent / "disposable-volume"; detached.mkdir()
    target=detached/photo.name; photo.rename(target)
    # Move the source identity in a disposable DB to a disconnected folder.
    missing=photo.parent/"missing-volume"/photo.name
    db=marks._connect()
    with db:
        for table in ("photos","settings_writes","photo_grades","files"):
            db.execute(f"UPDATE {table} SET path=? WHERE path=?",(str(missing),str(photo)))
    db.close()
    browser.remove_pin(str(photo.parent));index.membership.reconcile()
    assert not candidates(index)
    marks.writer.drain()
    assert grades._get(str(missing))["desired"] == desired
    missing.parent.mkdir();target.rename(missing)
    marks.writer.retry(str(missing.parent), "offline");marks.writer.drain()
    value=settings(missing)
    assert value["grade"] == desired and value["marks"]["rating"] == 4
    assert not grades._get(str(missing))["pending"]


def test_undo_album_removal_after_flush_while_disconnected(tmp_path):
    folder,photos,browser,marks,index=library(tmp_path)
    marks.album_create("Keep",[photos[0]]);marks.writer.drain()
    browser.remove_pin(str(folder));index.membership.reconcile()
    marks.album_change("Keep",[photos[0]],False);marks.writer.drain()
    assert not marks._rows([str(photos[0])])
    gone=folder.with_name("unplugged");folder.rename(gone)
    marks.undo()
    assert candidates(index)=={str(photos[0])}
    assert marks.album_paths("Keep")==[str(photos[0])]


def test_virtual_copy_album_keeps_original_family_and_survives_rebuild(tmp_path):
    from hdr_finisher.library_copies import LibraryCopies
    folder,photos,browser,marks,index=library(tmp_path)
    copies=LibraryCopies(marks)
    doc={"format":"HDR Finisher Photo","schema_version":1,"photo_id":"original","source":{"filename":photos[0].name},"contains_source_pixels":False,"marks":{},"virtual_copies":[{"photo_id":"alternative","name":"Alternative","marks":{},"albums":["Copies"]}]}
    Path(str(photos[0])+".hdrf").write_text(json.dumps(doc))
    marks.read([photos[0]])
    browser.remove_pin(str(folder));index.membership.reconcile()
    key=str(photos[0])+"|copy|alternative"
    assert candidates(index)=={str(photos[0]),key}
    marks.database.unlink();rebuilt=LibraryMarks(browser.root);restored=LibraryIndex(rebuilt,browser,None);LibraryCopies(rebuilt)
    assert candidates(restored)=={str(photos[0]),key}
