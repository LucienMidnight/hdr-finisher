"""Exercise the real helper lanes with deterministic decode checkpoints."""
from queue import Queue, Empty
from threading import Event, Thread
import time

from hdr_finisher import library_worker, library_overlays, library_folders


def test_running_map_and_queued_map_do_not_deadlock_folder_check(tmp_path, monkeypatch):
    incoming, outgoing = Queue(), Queue()
    map_started, check_started, release_map = Event(), Event(), Event()

    class Connection:
        def poll(self, timeout):
            return not incoming.empty()
        def recv(self):
            return incoming.get(timeout=2)
        def send(self, value):
            outgoing.put(value)
        def close(self):
            pass

    def build(self, path, kind, quality, cancelled=None):
        if path == "first":
            map_started.set()
            assert release_map.wait(3)
        assert not cancelled()
        return {"path": path}

    def scan(path, cancelled=None, **kwargs):
        check_started.set()
        assert not cancelled()
        return {"path": path}

    monkeypatch.setattr(library_worker, "_lower_priority", lambda: "test")
    monkeypatch.setattr(library_overlays.OverlayMaps, "build", build)
    monkeypatch.setattr(library_folders, "scan_folder", scan)
    thread = Thread(target=library_worker._worker_main_impl,
                    args=(Connection(), str(tmp_path), __import__("os").getpid(), False), daemon=True)
    thread.start()
    try:
        while outgoing.get(timeout=3).get("event") != "ready":
            pass
        incoming.put(dict(command="overlay", id="one", priority=85, path="first", kind="exposure", quality="half"))
        assert map_started.wait(3)
        incoming.put(dict(command="overlay", id="two", priority=85, path="second", kind="exposure", quality="half"))
        incoming.put(dict(command="scan", id="check", priority=90, path="folder", checking=True))
        assert check_started.wait(3)
        release_map.set()
        completed = set()
        deadline = time.monotonic() + 3
        while len(completed) < 3 and time.monotonic() < deadline:
            try:
                result = outgoing.get(timeout=.1)
            except Empty:
                continue
            if "id" in result:
                assert "error" not in result
                completed.add(result["id"])
        assert completed == {"one", "two", "check"}
    finally:
        incoming.put({"command": "stop"})
        release_map.set()
        thread.join(timeout=3)
        # This test runs the helper in-process; restore its diagnostic sink.
        from hdr_finisher import library_diagnostics
        library_diagnostics._sink = None


def test_saved_grade_thumbnail_progresses_while_source_decode_is_busy(tmp_path, monkeypatch):
    from hdr_finisher import library_pictures, library_thumbnails, library_diagnostics
    incoming, outgoing = Queue(), Queue()
    decode_started, release_decode, thumbnail_done = Event(), Event(), Event()

    class Connection:
        def poll(self, timeout):
            time.sleep(.001)
            return not incoming.empty()
        def recv(self): return incoming.get(timeout=3)
        def send(self, value): outgoing.put(value)
        def close(self): pass

    def picture(self, *args):
        decode_started.set()
        assert release_decode.wait(5)
        return {}

    def thumbnail(root, path, edge, key, kept, cancelled):
        assert kept
        assert not cancelled()
        thumbnail_done.set()
        return {}

    monkeypatch.setattr(library_worker, "_lower_priority", lambda: "test")
    monkeypatch.setattr(library_pictures.LibraryPictureCache, "build", picture)
    monkeypatch.setattr(library_thumbnails, "build", thumbnail)
    thread = Thread(target=library_worker._worker_main_impl,
                    args=(Connection(), str(tmp_path), __import__("os").getpid(), False), daemon=True)
    thread.start()
    try:
        while outgoing.get(timeout=3).get("event") != "ready": pass
        incoming.put(dict(command="picture", id="slow", priority=10, path="slow.dng", edge=640, quality="quick"))
        assert decode_started.wait(3)
        incoming.put(dict(command="grid-thumbnail", id="saved", priority=90, path="edited.arw", edge=640, key="saved", kept={"file":"already-saved.jpg"}))
        assert thumbnail_done.wait(3), "A saved-grade thumbnail must not wait for a source decode"
        assert not release_decode.is_set()
    finally:
        release_decode.set()
        incoming.put({"command":"stop"})
        thread.join(timeout=3)
        library_diagnostics._sink = None
