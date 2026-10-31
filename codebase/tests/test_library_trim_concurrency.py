"""A blocked disk spill must not own the shared transport lock."""
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from io import BytesIO
import json
import numpy as np
from PIL import Image
from hdr_finisher import app_memory
from hdr_finisher.library_pictures import LibraryPictureCache, picture_key


def test_pending_spill_allows_store_document_and_memory_reads(tmp_path, monkeypatch):
    cache = LibraryPictureCache(tmp_path / "profile")
    source = tmp_path / "a.jpg"
    other = tmp_path / "b.jpg"
    Image.new("RGB", (8, 8)).save(source)
    Image.new("RGB", (8, 8)).save(other)
    key = picture_key(source, 640, "quick")
    body = BytesIO()
    np.savez(body, pixels=np.zeros((8, 8, 3), np.float16), metadata=np.asarray(json.dumps({})))
    cache.transient[key] = body.getvalue()
    cache.pending_stores[key] = (str(source), 640, "quick", None, None)
    # An already delivered disposable copy must disappear first.
    cache.transient["delivered"] = b"discard me"
    entered, release = Event(), Event()
    prepare = cache.managed.prepare
    def slow_prepare():
        if not entered.is_set():
            entered.set()
            assert release.wait(5)
        return prepare()
    monkeypatch.setattr(cache.managed, "prepare", slow_prepare)
    monkeypatch.setattr(app_memory, "process_tree", lambda _: [dict(workingSetBytes=1, chargedBytes=1)])
    monkeypatch.setattr(app_memory, "system_pressure", lambda: "none")
    try:
        with ThreadPoolExecutor(4) as pool:
            trimming = pool.submit(cache.trim_memory, 0)
            assert entered.wait(2)
            try:
                assert "delivered" not in cache.transient
                assert cache.open(key).read() == body.getvalue()
                reading = pool.submit(cache.default_document, other)
                memory = pool.submit(app_memory.snapshot, True)
                storing = pool.submit(cache.build, other, 64, "quick", None,
                    (np.zeros((8, 8, 3), np.float32), None, {}))
                assert reading.result(timeout=.9) is None
                assert memory.result(timeout=.9)["totalBytes"] == 1
                assert storing.result(timeout=.9)["stored_bytes"] > 0
            finally:
                release.set()
            trimming.result(timeout=3)
        assert cache.file(key).is_file() and key not in cache.transient
    finally:
        app_memory.forget(cache.memory_key)
        app_memory.forget(cache.native_key)
