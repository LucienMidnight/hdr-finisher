"""File facts for the Library, and background indexing of pinned folders.

The grading backend is the only database writer. Folder walks and EXIF reads
run as low-priority helper jobs on the helper's own indexing lane.
"""
from __future__ import annotations

from concurrent.futures import CancelledError, TimeoutError
import json
import os
from pathlib import Path
from threading import Event, RLock, Thread
import time

from .library_metadata import FACT_FIELDS

LABELS = ("red", "orange", "green", "blue")


class _Restart(Exception):
    """Pins or settings changed; begin the pass again."""


class LibraryIndex:
    def __init__(self, marks, browser, worker):
        self.marks, self.browser, self.worker = marks, browser, worker
        self.preferences_path = Path(browser.root) / "library-preferences.json"
        self._state = RLock()
        self._wake = Event()
        self._thread = None
        self._generation = 0
        self._paused = False
        self._progress = {"state": "idle", "folder": "", "done": 0, "total": 0, "passes": 0}

    # Personal settings stay outside the database, which can be rebuilt.

    def preferences(self):
        try:
            saved = json.loads(self.preferences_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            saved = {}
        saved = saved if isinstance(saved, dict) else {}
        names = saved.get("label_names") if isinstance(saved.get("label_names"), dict) else {}
        return {"background_indexing": saved.get("background_indexing") is not False,
            "label_names": {label: " ".join(str(names.get(label) or "").split())[:60] for label in LABELS}}

    def set_preferences(self, *, background_indexing=None, label_names=None):
        with self._state:
            current = self.preferences()
            if background_indexing is not None:
                current["background_indexing"] = bool(background_indexing)
            if label_names is not None:
                current["label_names"] = {**current["label_names"], **{label: name for label, name in label_names.items() if label in LABELS}}
            self.preferences_path.parent.mkdir(parents=True, exist_ok=True)
            temporary = self.preferences_path.with_suffix(".tmp")
            temporary.write_text(json.dumps(current, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            os.replace(temporary, self.preferences_path)
        if background_indexing is not None:
            self.kick()
        return self.preferences()

    # File facts.

    @staticmethod
    def _prefix(root):
        root = str(root)
        return root if root.endswith(("\\", "/")) else root + os.sep

    def remember_scan(self, root, photos):
        """Record a folder listing and attach facts already known for unchanged files."""
        prefix = self._prefix(root)
        with self.marks._lock:
            db = self.marks._connect()
            try:
                known = {path: (size, modified, facts) for path, size, modified, facts in
                    db.execute("SELECT path, bytes, mtime_ns, facts FROM files WHERE substr(path, 1, ?) = ?", (len(prefix), prefix))}
                changed = []
                for photo in photos:
                    old = known.pop(photo["path"], None)
                    same = old is not None and old[:2] == (photo["bytes"], photo["mtime_ns"])
                    if same and old[2]:
                        photo.update(json.loads(old[2]), indexed=True)
                    elif not same:
                        changed.append((photo["path"], photo["bytes"], photo["mtime_ns"]))
                if changed or known:
                    with db:
                        db.executemany("INSERT OR REPLACE INTO files VALUES (?, ?, ?, NULL)", changed)
                        db.executemany("DELETE FROM files WHERE path = ?", [(path,) for path in known])
            finally:
                db.close()

    def remember_facts(self, records):
        rows = [(record["path"], record["bytes"], record["mtime_ns"], json.dumps({name: record.get(name) for name in FACT_FIELDS}))
            for record in records if record.get("mtime_ns") is not None]
        for record in records:
            record["indexed"] = record.get("mtime_ns") is not None
        if not rows:
            return
        with self.marks._lock:
            db = self.marks._connect()
            try:
                with db:
                    db.executemany("INSERT OR REPLACE INTO files VALUES (?, ?, ?, ?)", rows)
            finally:
                db.close()

    def photos(self, paths):
        """Listing rows for an album or tag; photos that are not connected are counted."""
        photos, missing = [], 0
        for value in paths:
            path = Path(value)
            try:
                stat = path.stat()
            except OSError:
                missing += 1
                continue
            photos.append({"path": value, "name": path.name, "type": path.suffix[1:].upper(), "bytes": stat.st_size, "mtime_ns": stat.st_mtime_ns})
        by_path = {photo["path"]: photo for photo in photos}
        with self.marks._lock:
            if self.marks.database.exists():
                db = self.marks._connect()
                try:
                    keys = list(by_path)
                    for start in range(0, len(keys), 800):
                        chunk = keys[start:start + 800]
                        for path, size, modified, facts in db.execute("SELECT path, bytes, mtime_ns, facts FROM files WHERE path IN (" + ",".join("?" for _ in chunk) + ")", chunk):
                            photo = by_path[path]
                            if facts and (size, modified) == (photo["bytes"], photo["mtime_ns"]):
                                photo.update(json.loads(facts), indexed=True)
                finally:
                    db.close()
        photos.sort(key=lambda item: (item["name"].casefold(), item["path"].casefold()))
        return photos, missing

    # Background indexing of pinned folders, including ones never visited.

    def kick(self):
        """Start, or restart, a pass over the pinned folders."""
        if self.worker is None:
            return
        with self._state:
            self._generation += 1
            if self._thread is None:
                self._thread = Thread(target=self._run, name="hdr-library-indexer", daemon=True)
                self._thread.start()
        self._wake.set()

    def pause(self, paused):
        with self._state:
            self._paused = bool(paused)
        self._wake.set()

    def status(self):
        with self._state:
            enabled = self.preferences()["background_indexing"]
            progress = dict(self._progress)
            if not enabled:
                progress["state"] = "off"
            elif self._paused and progress["state"] != "idle":
                progress["state"] = "paused"
            helper = self.worker.status()["paused"] if self.worker is not None else False
            return {**progress, "enabled": enabled, "paused": self._paused, "waiting": bool(helper and progress["state"] == "indexing")}

    def _set(self, **progress):
        with self._state:
            self._progress.update(progress)

    def _check(self, generation):
        """Wait out a user pause; leave the pass when it is no longer wanted."""
        while True:
            with self._state:
                if generation != self._generation:
                    raise _Restart()
                paused = self._paused
            if not paused:
                return
            time.sleep(0.25)

    def _job(self, generation, command, **arguments):
        while True:
            self._check(generation)
            job_id, future = self.worker.submit_library(command, priority=95, background=True, **arguments)
            try:
                while True:
                    with self._state:
                        if generation != self._generation:
                            raise _Restart()
                        if self._paused:
                            break  # Give the lane back; ask again after Resume.
                    try:
                        return future.result(timeout=0.25)
                    except TimeoutError:
                        continue
            finally:
                self.worker.cancel(job_id)

    def _pass(self, generation):
        if not self.preferences()["background_indexing"]:
            self._set(state="idle", folder="", done=0, total=0)
            return
        for pin in self.browser.pinned():
            if not pin.get("available"):
                continue
            self._set(state="indexing", folder=pin["name"], done=0, total=0)
            try:
                photos = self._job(generation, "scan", path=pin["path"])["photos"]
            except (ValueError, OSError):
                continue  # Unreadable or just unplugged; the next pass tries again.
            self.remember_scan(pin["path"], photos)
            # Settings files rebuild marks, tags and albums for unvisited folders.
            prefix = self._prefix(pin["path"])
            with self.marks._lock:
                recorded = [row[0] for row in self.marks._query("SELECT path FROM photos WHERE substr(path, 1, ?) = ?", (len(prefix), prefix))]
            settings = list(dict.fromkeys([*[photo["path"] for photo in photos if photo.get("sidecar")], *recorded]))
            for start in range(0, len(settings), 200):
                self._check(generation)
                self.marks.read(settings[start:start + 200])
            waiting = [photo["path"] for photo in photos if not photo.get("indexed")]
            done = len(photos) - len(waiting)
            self._set(done=done, total=len(photos))
            for start in range(0, len(waiting), 32):
                try:
                    records = self._job(generation, "metadata", paths=waiting[start:start + 32])["photos"]
                except (ValueError, OSError):
                    records = []
                self.remember_facts(records)
                done += len(waiting[start:start + 32])
                self._set(done=done)
        self._set(state="idle", folder="", done=0, total=0, passes=self._progress["passes"] + 1)

    def _run(self):
        failures = 0
        while failures < 5:
            self._wake.wait()
            self._wake.clear()
            with self._state:
                generation = self._generation
            try:
                self._pass(generation)
                failures = 0
            except _Restart:
                self._wake.set()
            except CancelledError:
                break  # The helper closed with the app.
            except RuntimeError:
                failures += 1  # Helper queue full or unavailable; try again shortly.
                time.sleep(2)
                self._wake.set()
        self._set(state="idle", folder="", done=0, total=0)
