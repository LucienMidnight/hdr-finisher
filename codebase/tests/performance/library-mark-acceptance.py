"""Measure Stage A HTTP acceptance on disposable local photo copies; no decode."""
import json
from pathlib import Path
import sys
import tempfile
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))
from fastapi import FastAPI
from fastapi.testclient import TestClient
from hdr_finisher.library_api import create_library_router
from hdr_finisher.media_browser import MediaBrowserStore
from hdr_finisher.library_marks import LibraryMarks

class Worker:
    def status(self):
        return {"paused": False}

root = Path(__file__).resolve().parents[2]
output = root / "output"
output.mkdir(exist_ok=True)
image = (root / "tests" / "fixtures" / "sdr_gradient.png").read_bytes()
for count in (1, 1000, 10000):
    with tempfile.TemporaryDirectory(prefix="mark-acceptance-", dir=output) as name:
        folder = Path(name) / "photos"
        folder.mkdir()
        paths = []
        for index in range(count):
            photo = folder / f"{index:05}.png"
            photo.write_bytes(image)
            paths.append(str(photo))
        # Visiting a folder already initializes the database in the real app.
        db = LibraryMarks(Path(name) / "app")._connect()
        db.close()
        app = FastAPI()
        app.include_router(create_library_router(Worker(), MediaBrowserStore(Path(name) / "app")))
        with TestClient(app) as client:
            began = time.perf_counter()
            response = client.post("/api/library/marks", json={"paths": paths, "change": {"rating": 4}})
            seconds = time.perf_counter() - began
            response.raise_for_status()
            result = response.json()
            assert len(result["photos"]) == count and result["undo_available"]
            waiting = client.get("/api/library/settings-status").json()["waiting"]
            print(json.dumps({"photos": count, "http_accept_seconds": round(seconds, 4), "waiting_at_return": waiting, "drive": folder.anchor}), flush=True)
