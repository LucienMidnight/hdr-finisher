from copy import deepcopy
import json
from types import SimpleNamespace
from threading import RLock
import pytest
from hdr_finisher.library_smart_albums import SmartAlbums, SmartCommand
from hdr_finisher.library_marks import LibraryMarks, MarkChange
from hdr_finisher.library_grades import LibraryGrades
from hdr_finisher.library_copies import LibraryCopies
from test_library_grades import setup, saved, settings

@pytest.fixture
def smart(tmp_path):
    marks=LibraryMarks(tmp_path/"app")
    index=SimpleNamespace(preferences_path=tmp_path/"app"/"library-preferences.json",_state=RLock())
    return SmartAlbums(marks,index)


def create(smart,name="Picked",filters=None):
    return smart.command(SmartCommand(action="create",name=name,filters=filters or {"rules":[{"field":"pick","value":"pick"}]}))


def test_rules_survive_database_loss_and_each_command_undo(smart):
    smart.index.preferences_path.parent.mkdir(parents=True)
    smart.index.preferences_path.write_text(json.dumps({"label_names":{"green":"Ready"},"pin_labels":{"x":"Shoot"},"future":8}))
    create(smart);original=smart.list();identifier=original[0]["id"]
    smart.marks._connect().close();smart.marks.database.unlink()
    assert smart.list()==original
    smart.command(SmartCommand(action="edit",id=identifier,name="Five stars",filters={"rules":[{"field":"rating","op":"at-least","value":5}]}))
    assert smart.list()[0]["name"]=="Five stars"
    smart.marks.undo();assert smart.list()==original
    smart.command(SmartCommand(action="delete",id=identifier));assert smart.list()==[]
    smart.marks.undo();assert smart.list()==original
    smart.marks.undo();assert smart.list()==[]
    value=json.loads(smart.index.preferences_path.read_text())
    assert value["future"]==8 and value["pin_labels"]=={"x":"Shoot"} and value["label_names"]=={"green":"Ready"}


def test_invalid_rules_or_unreadable_preferences_never_replace(smart):
    create(smart);before=smart.index.preferences_path.read_bytes()
    for filters in [{"rules":[{"field":"pick","op":"guess","value":"pick"}]},{"rules":[{"field":"rating","value":{"x":1}}]},{"rules":[{"field":"","value":"x"}]}]:
        with pytest.raises(ValueError):create(smart,"Invalid",filters)
        assert smart.index.preferences_path.read_bytes()==before
    with pytest.raises(ValueError):create(smart,"picked")
    smart.index.preferences_path.write_text("broken")
    with pytest.raises(ValueError):create(smart,"New")
    assert smart.index.preferences_path.read_text()=="broken"


def test_undo_never_overwrites_outside_rules(smart):
    create(smart)
    value=json.loads(smart.index.preferences_path.read_text());value["smart_albums"][0]["name"]="Outside"
    smart.index.preferences_path.write_text(json.dumps(value))
    with pytest.raises(ValueError):smart.marks.undo()
    assert smart.list()[0]["name"]=="Outside" and smart.marks._undo


def test_index_candidates_update_marks_tags_grade_and_virtual_copy(setup,tmp_path):
    photo,store,session,marks,grades=setup
    smart=SmartAlbums(marks,SimpleNamespace(preferences_path=tmp_path/"preferences.json",_state=RLock()))
    db=marks._connect()
    with db:db.execute("INSERT INTO files VALUES (?,?,?,?)",(str(photo),photo.stat().st_size,photo.stat().st_mtime_ns,json.dumps({"camera":"Camera","iso":800})))
    db.close()
    before=smart.candidates();assert len(before["photos"])==1 and before["photos"][0]["marks"]["rating"]==0
    assert smart.candidates(before["version"])["photos"] is None
    marks.change([photo],MarkChange(rating=5,pick="pick",add_tag="Kids"))
    marked=smart.candidates();assert marked["version"]!=before["version"]
    assert marked["photos"][0]["marks"]["tags"]==["Kids"] and marked["photos"][0]["marks"]["rating"]==5
    grade=saved(setup);assert smart.candidates()["photos"][0]["edited"]
    # Candidate reads use only the index, not original or settings files.
    photo.unlink()
    assert smart.candidates()["photos"][0]["path"]==str(photo)
    assert smart.candidates()["photos"][0]["camera"]=="Camera"


def test_scope_is_saved_as_paths_without_touching_photos(smart,tmp_path):
    folder=tmp_path/"disconnected";before=deepcopy(smart.list())
    create(smart,filters={"any":True,"rules":[{"field":"name","op":"contains","value":"holiday","not":True}],"folders":[str(folder)]})
    assert smart.list()[0]["filters"]["folders"]==[str(folder)]
    assert not folder.exists()


def test_virtual_candidate_marks_follow_pending_virtual_marks(setup,tmp_path):
    photo,store,session,marks,grades=setup
    copies=LibraryCopies(marks)
    db=marks._connect()
    with db:db.execute("INSERT INTO files VALUES (?,?,?,NULL)",(str(photo),photo.stat().st_size,photo.stat().st_mtime_ns))
    db.close()
    copies.create(str(photo), "clean")
    smart=SmartAlbums(marks,SimpleNamespace(preferences_path=tmp_path/"preferences.json",_state=RLock()))
    items=smart.candidates()["photos"];assert len(items)==2
    key=items[1]["path"]
    marks.change([key],MarkChange(rating=4,add_tag="Copy"))
    assert smart.candidates()["photos"][1]["marks"]["rating"]==4
    assert smart.candidates()["photos"][0]["marks"]["rating"]==0


def test_same_timestamp_database_write_invalidates_snapshot(smart,tmp_path):
    import os
    db=smart.marks._connect()
    with db:db.execute("INSERT INTO files VALUES (?,?,?,NULL)",(str(tmp_path/"a.jpg"),100,1))
    db.close()
    before=smart.candidates();info=smart.marks.database.stat()
    db=smart.marks._connect()
    with db:db.execute("UPDATE files SET bytes=101")
    db.close();os.utime(smart.marks.database,ns=(info.st_atime_ns,info.st_mtime_ns))
    after=smart.candidates(before["version"])
    assert after["photos"][0]["bytes"]==101 and after["version"]!=before["version"]


def test_rebuild_candidates_from_saved_settings_after_database_loss(setup,tmp_path):
    photo,store,session,marks,grades=setup
    saved(setup)
    preference=SimpleNamespace(preferences_path=tmp_path/"preferences.json",_state=RLock())
    service=SmartAlbums(marks,preference);create(service,name="Edited",filters={"rules":[{"field":"state","value":"edited"}]})
    before=service.list();marks.database.unlink()
    rebuilt=LibraryMarks(marks.database.parent);LibraryGrades(rebuilt,store);LibraryCopies(rebuilt)
    rebuilt.read([photo])
    db=rebuilt._connect()
    with db:db.execute("INSERT INTO files VALUES (?,?,?,NULL)",(str(photo),photo.stat().st_size,photo.stat().st_mtime_ns))
    db.close()
    fresh=SmartAlbums(rebuilt,preference)
    assert fresh.list()==before and fresh.candidates()["photos"][0]["edited"]


def test_multi_tick_rules_round_trip_without_fixed_properties(smart):
    filters={"rules":[{"field":"camera","op":"in","values":["alpha","beta",""],"labels":["Alpha","Beta","Not recorded"]},{"field":"search","op":"contains","value":"holiday"}]}
    create(smart,filters=filters)
    stored=smart.list()[0]["filters"]
    assert stored["rules"]==filters["rules"]
    assert set(stored)=={"rules","any","folders"}
    for values in [[],[{}],"alpha",[1]]:
        with pytest.raises(ValueError):create(smart,"Invalid",{"rules":[{"field":"camera","op":"in","values":values}]})


def test_index_open_never_probes_pinned_source_availability(smart, tmp_path, monkeypatch):
    from pathlib import Path
    from hdr_finisher.media_browser import MediaBrowserStore
    from hdr_finisher.library_membership import LibraryMembership
    browser = MediaBrowserStore(tmp_path / "browser")
    folder = str(tmp_path / "disconnected")
    browser._write_paths(browser.pinned_path, [folder])
    scope = object.__new__(LibraryMembership)
    scope.index = SimpleNamespace(browser=browser)
    smart.marks.membership = scope
    photo = str(Path(folder) / "last-known.jpg")
    db = smart.marks._connect()
    with db:
        db.execute("INSERT INTO files VALUES (?,?,?,NULL)", (photo, 100, 1))
    db.close()
    def forbidden(*args, **kwargs):
        raise AssertionError("Indexed Smart Album opening probed a source folder")
    monkeypatch.setattr(Path, "is_dir", forbidden)
    before = smart.candidates()
    assert before["photos"][0]["path"] == photo
    assert before["photos"][0]["library_pins"] == [folder]
    assert smart.candidates(before["version"])["photos"] is None
    # New indexed membership is picked up without touching the source disk.
    db = smart.marks._connect()
    with db:
        db.execute("DELETE FROM files WHERE path=?", (photo,))
    db.close()
    assert smart.candidates(before["version"])["photos"] == []


def test_large_candidate_response_renders_off_event_loop(smart, monkeypatch):
    import asyncio
    import threading
    from fastapi import FastAPI
    from httpx import AsyncClient, ASGITransport
    from hdr_finisher.library_smart_albums import add_smart_album_routes
    # A serialization gate makes the concurrency guarantee deterministic, with
    # no speed threshold or dependency on the machine's current load.
    entered, release = threading.Event(), threading.Event()
    threads = []
    original = json.dumps
    batches = []
    def encode(content, *args, **kwargs):
        if isinstance(content, list):
            batches.append(len(content))
            if not entered.is_set():
                threads.append(threading.get_ident())
                entered.set()
                assert release.wait(5), "Event loop could not release serialization"
        return original(content, *args, **kwargs)
    monkeypatch.setattr(json, "dumps", encode)
    rows = [{"path": f"offline/{i}.jpg", "marks": {"rating": 5}} for i in range(155000)]
    monkeypatch.setattr(SmartAlbums, "candidates", lambda self, version="": {"version": "large", "photos": None if version == "large" else rows})
    smart.index.status = lambda: {"state": "idle"}
    app = FastAPI()
    add_smart_album_routes(app, smart.marks, smart.index)
    @app.get("/heartbeat")
    async def heartbeat():
        return {"alive": True}
    async def check():
        main_thread = threading.get_ident()
        client = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
        task = asyncio.create_task(client.get("/smart-candidates"))
        try:
            assert await asyncio.to_thread(entered.wait, 5)
            assert threads == [threads[0]] and threads[0] != main_thread
            # Another HTTP request completes while serialization is held.
            pulse = await asyncio.wait_for(client.get("/heartbeat"), 2)
            assert pulse.json() == {"alive": True}
            release.set()
            response = await task
            assert response.status_code == 200
            assert response.headers["content-type"] == "application/json"
            body = response.json()
            assert len(body["photos"]) == 155000
            assert body["photos"][-1]["path"] == "offline/154999.jpg"
            assert body["version"] == "large"
            assert len(batches) > 1 and max(batches) < len(rows)
            unchanged = await client.get("/smart-candidates?version=large")
            assert unchanged.status_code == 200
            assert unchanged.json()["photos"] is None
        finally:
            release.set()
            await task
            await client.aclose()
    asyncio.run(check())


def test_matched_grid_survives_restart_without_candidate_rebuild(smart, monkeypatch):
    create(smart)
    identifier = smart.list()[0]["id"]
    first = smart.grid(identifier)
    assert first["photos"] is None
    rows = [{"path": "offline/photo.jpg", "marks": {"pick": "pick"}}]
    assert smart.grid(identifier, first["token"], rows)["saved"]
    restarted = SmartAlbums(LibraryMarks(smart.marks.database.parent), smart.index)
    monkeypatch.setattr(restarted, "candidates", lambda *a: pytest.fail("candidate rebuild before grid"))
    assert restarted.grid(identifier)["photos"] == rows
    # Empty membership is a valid durable result too.
    assert restarted.grid(identifier, first["token"], [])["saved"]
    assert restarted.grid(identifier)["photos"] == []


def test_grid_rejects_inflight_rules_edits_undo_and_deleted_album(smart):
    create(smart)
    identifier = smart.list()[0]["id"]
    token = smart.grid(identifier)["token"]
    smart.grid(identifier, token, [{"path": "old.jpg"}])
    smart.command(SmartCommand(action="edit", id=identifier, name="Changed", filters={"rules": []}))
    assert smart.grid(identifier)["photos"] is None
    assert not smart.grid(identifier, token, [])["saved"]
    smart.marks.undo()
    assert smart.grid(identifier)["photos"] is None
    assert not smart.grid(identifier, token, [])["saved"]
    smart.command(SmartCommand(action="delete", id=identifier))
    with pytest.raises(ValueError): smart.grid(identifier, token, [])


def test_grid_invalidates_when_saved_pins_change(smart):
    create(smart)
    identifier = smart.list()[0]["id"]
    pins = ["offline/one"]
    smart.marks.membership = SimpleNamespace(pins=lambda check_available: list(pins))
    token = smart.grid(identifier)["token"]
    smart.grid(identifier, token, [{"path": "offline/one/a.jpg"}])
    pins.append("offline/two")
    assert smart.grid(identifier)["photos"] is None
    assert not smart.grid(identifier, token, [])["saved"]


def test_candidate_snapshot_allows_writes_without_mixing_versions(smart, tmp_path, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event
    path = str(tmp_path / "offline.jpg")
    db = smart.marks._connect()
    with db:
        db.execute("INSERT INTO files VALUES (?,?,?,NULL)", (path, 100, 1))
        db.execute("INSERT INTO photos VALUES (?,?,?,0)", (path, "one", '{"rating":1}'))
    db.close()
    entered, release = Event(), Event()
    original = smart.marks._rows
    def read(paths, **kwargs):
        entered.set()
        assert release.wait(5)
        return original(paths, **kwargs)
    monkeypatch.setattr(smart.marks, "_rows", read)
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(smart.candidates)
        try:
            assert entered.wait(5)
            # A real concurrent commit must complete while preparation waits.
            assert smart.marks._lock.acquire(timeout=1)
            try:
                db = smart.marks._connect()
                with db:
                    db.execute("UPDATE files SET bytes=200")
                    db.execute("UPDATE photos SET marks=?", ('{"rating":5}',))
                db.close()
            finally:
                smart.marks._lock.release()
        finally:
            release.set()
        before = pending.result(timeout=5)
    assert before["photos"][0]["bytes"] == 100
    assert before["photos"][0]["marks"]["rating"] == 1
    after = smart.candidates(before["version"])
    assert after["version"] != before["version"]
    assert after["photos"][0]["bytes"] == 200
    assert after["photos"][0]["marks"]["rating"] == 5
    after["photos"][0]["marks"]["rating"] = 0
    assert smart.candidates()["photos"][0]["marks"]["rating"] == 5


def test_missing_candidate_database_stays_missing(smart):
    assert smart.candidates()["photos"] == []
    assert not smart.marks.database.exists()
