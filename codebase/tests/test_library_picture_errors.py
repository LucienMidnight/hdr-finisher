"""Failed pictures are durable cache results, never repeated decoder jobs."""
from concurrent.futures import CancelledError
import json
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image
import pytest

from hdr_finisher.library_api import create_library_router
from hdr_finisher.library_marks import LibraryMarks, MarkChange
from hdr_finisher.library_picture_errors import PictureErrors
from hdr_finisher.media_browser import MediaBrowserStore
from hdr_finisher.sessions import SessionStore


class Helper:
    def __init__(self):
        self.calls = []

    def status(self):
        return {"running": True, "paused": False, "pending": 0, "failure": None}

    def submit_library(self, *args, **kwargs):
        self.calls.append((args, kwargs))
        raise AssertionError("Invalid saved edits must be rejected before a decoder starts")


def client(root, helper):
    app = FastAPI()
    app.include_router(create_library_router(helper, MediaBrowserStore(root), SessionStore()))
    return TestClient(app)


@pytest.fixture
def broken(tmp_path):
    path = tmp_path / "broken.png"
    Image.new("RGB", (64, 32), (100, 120, 80)).save(path)
    root = tmp_path / "app"
    marks = LibraryMarks(root)
    marks.change([path], MarkChange(rating=4, add_tag="keep"))
    marks.album_create("Keep album", [path])
    marks.writer.drain()
    sidecar = Path(str(path) + ".hdrf")
    document = json.loads(sidecar.read_text())
    document["grade"] = SessionStore().prepare_session(path, owns_source_path=False).edit_document().model_dump(mode="json")
    document["grade"]["global_adjustments"]["hdr"]["film_look"]["removed_control"] = 1
    sidecar.write_text(json.dumps(document), encoding="utf-8")
    return root, path, sidecar


def test_all_picture_routes_remember_bad_grade_and_other_photos_continue(broken):
    root, path, _ = broken
    helper = Helper()
    api = client(root, helper)
    first = api.post("/api/library/live-plan", json={"path": str(path)})
    assert first.status_code == 422
    error = first.json()["library_error"]
    assert "Saved edits" in error["reason"] and "removed_control" in error["details"]
    for route in ("live-scene", "fallback-picture", "live-plan"):
        response = api.post("/api/library/" + route, json={"path": str(path)})
        assert response.status_code == 422
        assert response.json()["library_error"] == error
    other = path.with_name("healthy.png")
    Image.new("RGB", (64, 32)).save(other)
    assert api.post("/api/library/live-plan", json={"path": str(other)}).status_code == 200
    assert helper.calls == []
    assert api.get("/api/library/health").json()["picture_errors"] == [error]
    assert client(root, helper).post("/api/library/live-plan", json={"path": str(path)}).json()["library_error"] == error


def test_ignore_survives_restart_and_retry_clears_only_the_error(broken):
    root, path, sidecar = broken
    before = sidecar.read_bytes()
    api = client(root, Helper())
    record = api.post("/api/library/live-plan", json={"path": str(path)}).json()["library_error"]
    command = {"path": str(path), "revision": record["revision"], "action": "ignore"}
    assert api.post("/api/library/picture-error", json=command).json()["error"]["ignored"]
    api = client(root, Helper())
    assert api.post("/api/library/live-plan", json={"path": str(path)}).json()["library_error"]["ignored"]
    command["action"] = "retry"
    assert api.post("/api/library/picture-error", json=command).status_code == 200
    assert not api.get("/api/library/health").json()["picture_errors"]
    assert sidecar.read_bytes() == before


def test_revert_preserves_original_marks_and_previous_grade_and_requeues(broken):
    root, path, sidecar = broken
    source = path.read_bytes()
    previous = json.loads(sidecar.read_text())["grade"]
    api = client(root, Helper())
    record = api.post("/api/library/live-plan", json={"path": str(path)}).json()["library_error"]
    response = api.post("/api/library/picture-error", json={"path": str(path), "revision": record["revision"], "action": "original"})
    assert response.status_code == 200, response.text
    assert response.json()["count"] == 1
    marks = LibraryMarks(root)
    from hdr_finisher.library_grades import LibraryGrades
    LibraryGrades(marks, SessionStore())
    marks.writer.drain()
    saved = json.loads(sidecar.read_text())
    assert saved.get("grade") is None
    assert saved["marks"]["rating"] == 4 and saved["marks"]["tags"] == ["keep"]
    assert marks.album_paths("Keep album") == [str(path)]
    state = json.loads(marks._query("SELECT state FROM photo_grades WHERE path=?", (str(path),))[0][0])
    assert state["previous_grade"] == previous
    assert path.read_bytes() == source
    assert api.post("/api/library/live-plan", json={"path": str(path)}).status_code == 200


def test_changed_settings_expire_error_and_stale_reset_cannot_overwrite_them(broken):
    root, path, sidecar = broken
    api = client(root, Helper())
    record = api.post("/api/library/live-plan", json={"path": str(path)}).json()["library_error"]
    document = json.loads(sidecar.read_text())
    del document["grade"]["global_adjustments"]["hdr"]["film_look"]["removed_control"]
    sidecar.write_text(json.dumps(document), encoding="utf-8")
    assert api.post("/api/library/picture-error", json={"path": str(path), "revision": record["revision"], "action": "original"}).status_code == 409
    assert api.post("/api/library/live-plan", json={"path": str(path)}).status_code == 200
    assert not api.get("/api/library/health").json()["picture_errors"]


@pytest.mark.parametrize("error", [CancelledError(), RuntimeError("helper restarting"), ValueError("Insufficient memory"), ValueError("Import cancelled"), ValueError("Source preparation expired or was invalidated")])
def test_interruptions_and_resource_failures_are_not_remembered(tmp_path, error):
    from types import SimpleNamespace
    import asyncio
    errors = PictureErrors(LibraryMarks(tmp_path))
    @errors.guard
    async def operation(command):
        raise error
    with pytest.raises(Exception):
        asyncio.run(operation(SimpleNamespace(path=str(tmp_path / "photo.png"))))
    assert errors.all() == []


def test_pending_reset_and_source_changes_invalidate_inflight_errors(broken):
    from fastapi import HTTPException
    from hdr_finisher.library_grades import LibraryGrades
    root, path, _ = broken
    marks = LibraryMarks(root)
    grades = LibraryGrades(marks, SessionStore())
    errors = PictureErrors(marks)
    revision = errors.revision(path)
    grades._put(str(path), {"pending": True, "desired": None})
    with pytest.raises(HTTPException) as error:
        errors.remember(path, ValueError("old failed grade"), revision)
    assert error.value.status_code == 409
    errors.remember(path, ValueError("failed source"), errors.revision(path))
    path.write_bytes(path.read_bytes() + b"changed")
    assert errors.get(path) is None


def test_two_real_decoder_failures_release_helper_for_next_photo(tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    from hdr_finisher.library_worker import LibraryWorker
    root = tmp_path / "app"
    bad = [tmp_path / f"bad-{i}.png" for i in range(2)]
    for path in bad:
        path.write_bytes(b"broken image")
    good = tmp_path / "good.png"
    Image.new("RGB", (64, 32), (90, 120, 130)).save(good)
    worker = LibraryWorker(root)
    try:
        api = client(root, worker)
        def load(path):
            return api.post("/api/library/live-scene", json={"path": str(path), "gpu": False})
        with ThreadPoolExecutor(max_workers=3) as pool:
            results = list(pool.map(load, [*bad, good]))
        assert [response.status_code for response in results] == [422, 422, 200]
        assert worker.status()["pending"] == 0
        assert len(api.get("/api/library/health").json()["picture_errors"]) == 2
        assert load(bad[0]).status_code == 422
        assert worker.status()["pending"] == 0
    finally:
        worker.close()
