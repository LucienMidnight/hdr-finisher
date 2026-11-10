from fastapi import FastAPI
from fastapi.testclient import TestClient
from hdr_finisher.library_api import OverlayRequest, create_library_router
from hdr_finisher.library_overlays import OverlayMaps
from hdr_finisher.media_browser import MediaBrowserStore

class NoBuildWorker:
    def status(self):
        return {"running": True, "paused": False, "pending": 0}

def test_camera_quality_is_distinct_and_defaults_stay_native():
    assert OverlayRequest(path="photo.raw", kind="focus", quality="camera").quality == "camera"
    assert OverlayRequest(path="photo.raw").quality == "half"
    assert OverlayRequest(path="photo.raw", quality="full").quality == "full"

def test_camera_cache_probe_passes_quality_without_build(tmp_path, monkeypatch):
    seen = []
    def cached(self, path, kind, quality):
        seen.append((path, kind, quality))
        return None
    monkeypatch.setattr(OverlayMaps, "cached", cached)
    app = FastAPI()
    app.include_router(create_library_router(NoBuildWorker(), MediaBrowserStore(tmp_path)))
    with TestClient(app) as client:
        response = client.post("/api/library/overlay-map", json=dict(path=str(tmp_path / "photo.raw"), kind="focus", quality="camera", cache_only=True, priority=82))
        assert response.status_code == 200
        assert response.json() == {"cache_miss": True}
    assert len(seen) == 1
    assert seen[0][1:] == ("focus", "camera")

def test_camera_requests_still_refuse_saved_grades(tmp_path, monkeypatch):
    from hdr_finisher.sessions import SessionStore
    from hdr_finisher.library_documents import LibraryDocuments
    monkeypatch.setattr(LibraryDocuments, "request", lambda self, path: {"edited": True})
    app = FastAPI()
    app.include_router(create_library_router(NoBuildWorker(), MediaBrowserStore(tmp_path), SessionStore()))
    with TestClient(app) as client:
        response = client.post("/api/library/overlay-map", json=dict(path="photo.raw", kind="focus", quality="camera"))
        assert response.status_code == 200
        assert response.json()["reason"] == "graded"


def test_foreground_camera_admission_keeps_native_background(tmp_path, monkeypatch):
    from contextlib import asynccontextmanager
    from concurrent.futures import Future
    from hdr_finisher import library_grants
    seen = []
    @asynccontextmanager
    async def grant(path, kind, priority, **kwargs):
        seen.append((kind, priority))
        yield None
    class Worker(NoBuildWorker):
        def submit_library(self, command, **arguments):
            result = Future()
            result.set_result({"unavailable": "fixture without pixels"})
            return "fixture", result
        def cancel(self, job):
            pass
    (tmp_path / "photo.raw").write_bytes(b"fixture")
    monkeypatch.setattr(library_grants, "backend_grant", grant)
    app = FastAPI()
    app.include_router(create_library_router(Worker(), MediaBrowserStore(tmp_path)))
    with TestClient(app) as client:
        for quality, priority in [("camera", 30), ("full", 82)]:
            response = client.post("/api/library/overlay-map", json=dict(path=str(tmp_path / "photo.raw"), kind="focus", quality=quality, priority=priority))
            assert response.status_code == 200, response.text
            assert response.json()["unavailable"] == "fixture without pixels"
        assert client.post("/api/library/overlay-map", json=dict(path="a.raw", kind="exposure", quality="camera")).status_code == 400
        assert client.post("/api/library/overlay-map", json=dict(path="a.raw", kind="focus", quality="full", priority=30)).status_code == 400
    assert seen == [("camera", 30), ("cpu", 82)]
