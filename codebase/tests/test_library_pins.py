from fastapi import FastAPI
from fastapi.testclient import TestClient

from hdr_finisher.library_api import create_library_router
from hdr_finisher.media_browser import MediaBrowserStore


def test_unpin_offline_folder_keeps_other_pins_and_source(tmp_path):
    store = MediaBrowserStore(tmp_path / 'preferences')
    app = FastAPI()
    app.include_router(create_library_router(None, store))
    client = TestClient(app)
    first, second = tmp_path / 'first', tmp_path / 'second'
    first.mkdir()
    second.mkdir()
    photo = second / 'photo.jpg'
    photo.write_bytes(b'original photo bytes')
    assert client.post('/api/library/pins', json={'paths': [str(first), str(second)]}).status_code == 200
    first.rmdir()
    response = client.post('/api/library/pins/remove', json={'path': str(first)})
    assert response.status_code == 200
    assert [pin['path'] for pin in response.json()['pinned']] == [str(second.resolve())]
    assert photo.read_bytes() == b'original photo bytes'
    # Removing again is harmless, and reopening the store retains the removal.
    assert client.post('/api/library/pins/remove', json={'path': str(first)}).json() == response.json()
    assert MediaBrowserStore(store.root).pinned() == response.json()['pinned']


def test_pin_commands_return_while_upkeep_is_blocked(tmp_path, monkeypatch):
    from threading import Event
    from time import perf_counter
    from hdr_finisher.library_index import LibraryIndex
    from hdr_finisher.library_membership import LibraryMembership
    from hdr_finisher.library_marks import LibraryMarks
    gate, entered = Event(), Event()
    indices = []
    def wait(index):
        indices.append(index) if index not in indices else None
        entered.set()
        assert gate.wait(10)
    monkeypatch.setattr(LibraryIndex, "wait_for_upkeep", wait)
    def no_full_pass(*args, **kwargs):
        raise AssertionError("Pin commands must never reconcile the whole Library")
    monkeypatch.setattr(LibraryMembership, "_reconcile_all", no_full_pass)
    store = MediaBrowserStore(tmp_path / "app")
    folder = tmp_path / "photos"; folder.mkdir()
    app = FastAPI(); app.include_router(create_library_router(None, store))
    marks = LibraryMarks(store.root)
    db = marks._connect()
    with db:
        db.executemany("INSERT INTO files VALUES (?,0,0,NULL)",
            [(str(folder / f"{n:06}.png"),) for n in range(140000)])
    db.close()
    try:
        with TestClient(app) as client:
            timings = {}
            for action, route, body in [
                ("pin", "/pins", {"paths": [str(folder)]}),
                ("impact", "/pins/impact", {"path": str(folder)}),
                ("unpin", "/pins/remove", {"path": str(folder)})]:
                start = perf_counter()
                response = client.post("/api/library" + route, json=body)
                timings[action] = perf_counter() - start
                assert response.status_code == 200, response.text
                assert timings[action] < 1
                if action == "impact":
                    assert response.json() == {"leaving": 140000, "kept": 0}
            assert entered.wait(1)
            assert store.pinned() == []
            print("140k Windows request seconds:", timings)
    finally:
        for index in indices: index.close()
        gate.set()
        for index in indices:
            thread = index._membership_thread
            if thread: thread.join(10)
