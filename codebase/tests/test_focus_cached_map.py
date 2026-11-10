import numpy as np
from PIL import Image
from fastapi import FastAPI
from fastapi.testclient import TestClient
from hdr_finisher.library_api import create_library_router, OverlayRequest
from hdr_finisher.library_overlays import OverlayMaps
from hdr_finisher.media_browser import MediaBrowserStore


class NoBuildWorker:
    def status(self):
        return {"running": True, "paused": False, "pending": 0}


def test_cached_full_and_changed_source_miss_never_build(tmp_path):
    source = tmp_path / "photo.png"
    Image.fromarray(np.zeros((32, 48, 3), dtype=np.uint8)).save(source)
    root = tmp_path / "app"
    maps = OverlayMaps(root)
    full = maps.build(str(source), "focus", "full")
    assert maps.cached(str(source), "focus", "half") is None
    app = FastAPI()
    app.include_router(create_library_router(NoBuildWorker(), MediaBrowserStore(root)))
    command = dict(path=str(source), kind="focus", quality="full", cache_only=True, priority=82)
    with TestClient(app) as client:
        hit = client.post("/api/library/overlay-map", json=command)
        assert hit.status_code == 200
        assert hit.json()["key"] == full["key"]
        Image.fromarray(np.ones((33, 48, 3), dtype=np.uint8)).save(source)
        miss = client.post("/api/library/overlay-map", json=command)
        assert miss.status_code == 200
        assert miss.json() == {"cache_miss": True}
        assert maps.cached(str(source), "focus", "half") is None
        assert maps.cached(str(source), "focus", "full") is None


def test_probe_excludes_saved_grades(tmp_path, monkeypatch):
    from hdr_finisher.sessions import SessionStore
    from hdr_finisher.library_documents import LibraryDocuments
    monkeypatch.setattr(LibraryDocuments, "request", lambda self, path: {"edited": True})
    app = FastAPI()
    app.include_router(create_library_router(NoBuildWorker(), MediaBrowserStore(tmp_path), SessionStore()))
    with TestClient(app) as client:
        response = client.post("/api/library/overlay-map", json=dict(path="edited.raw", kind="focus", quality="full", cache_only=True))
        assert response.status_code == 200
        assert response.json()["reason"] == "graded"


def test_normal_requests_build_by_default():
    assert OverlayRequest(path="photo.png").cache_only is False
