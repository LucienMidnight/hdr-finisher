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
from .cpu_budget import logical_cpus
from .library_diagnostics import audited, log, problem, timed_lock

LABELS = ("red", "orange", "green", "blue")


class _Restart(Exception):
    """Pins or settings changed; begin the pass again."""
    _library_control = True


class _Retry(RuntimeError):
    """An incomplete pass should be tried again automatically."""
    _library_control = True


class LibraryIndex:
    def __init__(self, marks, browser, worker):
        self.marks, self.browser, self.worker = marks, browser, worker
        self.preferences_path = Path(browser.root) / "library-preferences.json"
        self._state = RLock()
        self._wake = Event()
        self._stop = Event()
        self._retry_seconds = 15
        self._thread = None
        self._upkeep_thread = None
        from .library_folder_checks import FolderChecks
        self.checks = FolderChecks(self)
        self._generation = 0
        self._paused = False
        self._preferences_failure = None
        self._progress = {"state": "idle", "folder": "", "done": 0, "total": 0, "passes": 0}
        from .library_membership import LibraryMembership
        self.membership = LibraryMembership(self)

    def wait_for_upkeep(self):
        """Yield between photo families, without owning a database lock."""
        while self.worker is not None:
            if self._stop.is_set():
                raise CancelledError()
            status = self.worker.status()
            if not self._paused and not status.get("paused") and not status.get("source_busy") and not status.get("pending"):
                return
            self._stop.wait(.05)

    def _startup_upkeep(self):
        # Let the last folder and its grid get their first requests in first.
        if self._stop.wait(3):
            return
        started = time.monotonic()
        log("startup_upkeep_started", action="background Library recovery reconciliation")
        try:
            from .cpu_budget import lower_thread_priority
            lower_thread_priority()
            self.wait_for_upkeep()
            if getattr(self, "cache_upkeep", None):
                self.cache_upkeep(self.wait_for_upkeep)
            self.marks.writer.startup_cleanup(self.wait_for_upkeep)
            self.wait_for_upkeep()
            self.membership.reconcile()
            log("startup_upkeep_finished", duration_ms=round((time.monotonic()-started)*1000, 2))
        except CancelledError:
            log("startup_upkeep_cancelled", duration_ms=round((time.monotonic()-started)*1000, 2))
        except Exception as error:
            problem("startup_upkeep_failed", self.browser.root, error, "durable recovery retained; retry on next launch")

    # Personal settings stay outside the database, which can be rebuilt.

    def preferences(self):
        try:
            saved = json.loads(self.preferences_path.read_text(encoding="utf-8"))
            self._preferences_failure = None
        except FileNotFoundError:
            self._preferences_failure = None
            saved = {}  # First use has no preferences.
        except (OSError, ValueError) as error:
            if self._preferences_failure != str(error):
                problem("preferences_read_failed", self.preferences_path, error, "defaults used; file left untouched")
            self._preferences_failure = str(error)
            saved = {}
        saved = saved if isinstance(saved, dict) else {}
        names = saved.get("label_names") if isinstance(saved.get("label_names"), dict) else {}
        return {"background_indexing": saved.get("background_indexing") is not False,
            "label_names": {label: " ".join(str(names.get(label) or "").split())[:60] for label in LABELS}}

    @audited("index_set_preferences")
    def set_preferences(self, *, background_indexing=None, label_names=None):
        with self._state:
            current = self.preferences()
            if background_indexing is not None:
                current["background_indexing"] = bool(background_indexing)
            if label_names is not None:
                current["label_names"] = {**current["label_names"], **{label: name for label, name in label_names.items() if label in LABELS}}
            self.preferences_path.parent.mkdir(parents=True, exist_ok=True)
            temporary = self.preferences_path.with_suffix(".tmp")
            try: saved = json.loads(self.preferences_path.read_text(encoding="utf-8"))
            except FileNotFoundError: saved = {}
            if not isinstance(saved, dict): raise ValueError("Library settings could not be read; nothing was changed.")
            saved.update(current)
            temporary.write_text(json.dumps(saved, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            os.replace(temporary, self.preferences_path)
        if background_indexing is not None:
            self.kick()
        return self.preferences()

    # File facts.

    @staticmethod
    def _prefix(root):
        root = str(root)
        return root if root.endswith(("\\", "/")) else root + os.sep

    def accept_read(self, epoch=None, generation=None):
        files = getattr(self.marks, 'file_commands', None)
        if epoch is not None and files and epoch != files.epoch:
            raise ValueError('Photos changed during this read. Open the folder again.')
        if generation is not None:
            with self._state:
                if generation != self._generation: raise _Restart()

    @audited("index_remember_scan")
    def remember_scan(self, root, photos, *, epoch=None, generation=None, reconcile=True, removed=None):
        """Record a folder listing and attach facts already known for unchanged files."""
        prefix = self._prefix(root)
        present = {p["path"] for p in photos}
        commands = getattr(self.marks, "file_commands", None)
        # Work one short page at a time, including a whole-library pin scan.
        for start in range(0, len(photos), 32):
            batch = photos[start:start+32]
            if generation is not None: self._check(generation)
            with timed_lock(self.marks._lock, "index_scan"):
                self.accept_read(epoch, generation)
                db = self.marks._connect()
                try:
                    keys = [p["path"] for p in batch]
                    known = {r[0]:r[1:] for r in db.execute(
                        "SELECT path,bytes,mtime_ns,facts FROM files WHERE path IN (" + ",".join("?" for _ in keys) + ")", keys)}
                    changed = []
                    for photo in batch:
                        if commands and (commands.blocked(photo["path"]) or photo["path"] in commands.retired and not Path(photo["path"]).exists()):
                            present.discard(photo["path"])
                            continue
                        old = known.get(photo["path"])
                        same = old is not None and old[:2] == (photo["bytes"], photo["mtime_ns"])
                        if same and old[2]:
                            photo.update(json.loads(old[2]), indexed=True)
                        elif not same:
                            changed.append((photo["path"], photo["bytes"], photo["mtime_ns"]))
                    with db:
                        db.executemany("INSERT OR REPLACE INTO files VALUES (?,?,?,NULL)", changed)
                finally:
                    db.close()
            if reconcile: self.membership.maintain([r[0] for r in changed])
            if generation is not None or epoch is not None: time.sleep(.001)
        photos[:] = [p for p in photos if p["path"] in present]
        if removed is not None:
            for start in range(0, len(removed), 32):
                batch = removed[start:start+32]
                with timed_lock(self.marks._lock, "index_scan"):
                    self.accept_read(epoch, generation)
                    db = self.marks._connect()
                    try:
                        with db:
                            db.executemany("DELETE FROM files WHERE path=?", [(p,) for p in batch if not (commands and commands.blocked(p))])
                    finally:
                        db.close()
                if reconcile: self.membership.maintain(batch)
                if generation is not None or epoch is not None: time.sleep(.001)
            return
        after = prefix
        inclusive = True
        while True:
            with timed_lock(self.marks._lock, "index_scan"):
                self.accept_read(epoch, generation)
                db = self.marks._connect()
                try:
                    keys = [r[0] for r in db.execute(
                        "SELECT path FROM files WHERE path" + (">=" if inclusive else ">") + "? AND path<? ORDER BY path LIMIT 200",
                        (after, prefix[:-1] + chr(ord(prefix[-1])+1)))]
                    removed = [p for p in keys if p not in present and not (commands and commands.blocked(p))]
                    with db:
                        db.executemany("DELETE FROM files WHERE path=?", [(p,) for p in removed])
                finally:
                    db.close()
            if reconcile: self.membership.maintain(removed)
            if not keys: break
            after, inclusive = keys[-1], False
            if generation is not None or epoch is not None: time.sleep(.001)

    @audited("index_remember_facts")
    def remember_facts(self, records, *, epoch=None, generation=None, foreground=False):
        for record in records:
            record["indexed"] = record.get("mtime_ns") is not None
        with timed_lock(self.marks._lock, "index_batch"):
            self.accept_read(epoch, generation)
            commands = getattr(self.marks, "file_commands", None)
            rows = [(r["path"], r["bytes"], r["mtime_ns"], json.dumps({name: r.get(name) for name in FACT_FIELDS}))
                for r in records if r.get("mtime_ns") is not None and not (commands and (commands.blocked(r["path"]) or r["path"] in commands.retired and not Path(r["path"]).exists()))]
            if not rows: return
            db = self.marks._connect()
            try:
                with db:
                    db.executemany("INSERT OR REPLACE INTO files VALUES (?, ?, ?, ?)", rows)
            finally:
                db.close()
        paths = [r[0] for r in rows]
        if foreground:
            self.membership.reconcile(paths)
        else:
            self.membership.maintain(paths)

    @audited("index_photos")
    def photos(self, paths):
        """Listing rows for an album or tag; photos that are not connected are counted."""
        photos, missing = [], 0
        for value in paths:
            path = Path(value)
            try:
                stat = path.stat()
            except OSError as error:
                problem("collection_photo_missing", value, error, "photo omitted from view; library entry kept")
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

    def wait_for_grade(self):
        while self.worker.status()["paused"]:
            if self._stop.wait(.05):
                raise CancelledError()

    # Background indexing of pinned folders, including ones never visited.

    def kick(self):
        """Start, or restart, a pass over the pinned folders."""
        if self.worker is None:
            return
        with self._state:
            self._generation += 1
            if self._upkeep_thread is None:
                self._upkeep_thread = Thread(target=self._startup_upkeep, name="hdr-library-upkeep", daemon=True)
                self._upkeep_thread.start()
            if self._thread is None or not self._thread.is_alive():
                self._thread = Thread(target=self._run, name="hdr-library-indexer", daemon=True)
                self._thread.start()
        self._wake.set()
        self.checks.start()

    def close(self):
        self._stop.set()
        self.checks.wake.set()
        with self.checks.lock:
            for signal in self.checks.signals.values(): signal.close()
            self.checks.signals.clear()
        self._wake.set()

    def pause(self, paused):
        with self._state:
            self._paused = bool(paused)
            log("index_pause" if paused else "index_resume", action="user control")
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
            return {**progress, "enabled": enabled, "paused": self._paused, "waiting": bool(helper and progress["state"] == "indexing"), "checks": self.checks.status(), "checkWaiting": bool(helper)}

    def _set(self, **progress):
        with self._state:
            self._progress.update(progress)

    def _check(self, generation):
        """Wait out a user pause; leave the pass when it is no longer wanted."""
        while True:
            if self._stop.is_set():
                raise CancelledError()
            with self._state:
                if generation != self._generation:
                    raise _Restart()
                paused = self._paused
            busy = self.worker is not None and self.worker.status().get("source_busy", False)
            if not paused and not busy and self.checks.running is None:
                return
            time.sleep(0.25)

    def _job(self, generation, command, **arguments):
        while True:
            self._check(generation)
            job_id, future = self.worker.submit_library(command, priority=95, background=True, **arguments)
            try:
                while True:
                    if self._stop.is_set():
                        raise CancelledError()
                    with self._state:
                        if generation != self._generation:
                            raise _Restart()
                        if self._paused:
                            break  # Give the lane back; ask again after Resume.
                    try:
                        result = future.result(timeout=0.25)
                        self._check(generation)
                        return result
                    except TimeoutError:
                        continue
            finally:
                self.worker.cancel(job_id)

    @audited("index_pass")
    def _pass(self, generation):
        if not self.preferences()["background_indexing"]:
            self._set(state="idle", folder="", done=0, total=0)
            return
        incomplete = False
        for pin in self.browser.pinned():
            with self.checks.lock:
                active=list(self.checks.streaming)
            if any(self.membership.under(root,pin["path"]) or self.membership.under(pin["path"],root) or os.path.normcase(root)==os.path.normcase(pin["path"]) for root in active):
                continue  # The open view owns bounded discovery; no second tree.
            if not pin.get("available"):
                incomplete = True
                log("index_offline", folder=pin["path"], reason="pinned folder not connected", action="entries kept; retry automatically")
                continue
            self._set(state="indexing", folder=pin["name"], done=0, total=0)
            try:
                revision = self.checks.revision
                result = self._job(generation, "scan", path=pin["path"])
                if revision != self.checks.revision:
                    result = self._job(generation, "scan", path=pin["path"])  # Names may have changed while this walk yielded.
                photos = result["photos"]
            except (ValueError, OSError) as error:
                incomplete = True
                problem("index_scan_failed", pin["path"], error, "entries kept; retry automatically")
                continue  # Unreadable or just unplugged; the next pass tries again.
            self.remember_scan(pin["path"], photos, generation=generation)
            log("index_facts_reused", folder=pin["path"], total=len(photos),
                reused=sum(bool(photo.get("indexed")) for photo in photos),
                pending=sum(not photo.get("indexed") for photo in photos))
            self.marks.conflicts.scan([photo["path"] for photo in photos])
            # Settings files rebuild marks, tags and albums for unvisited folders.
            prefix = self._prefix(pin["path"])
            with self.marks._lock:
                recorded = [row[0] for row in self.marks._query("SELECT path FROM photos WHERE path>=? AND path<?", (prefix, prefix[:-1] + chr(ord(prefix[-1])+1)))]
            settings = list(dict.fromkeys([*[photo["path"] for photo in photos if photo.get("sidecar")], *recorded]))
            for path in settings:
                self._check(generation)
                self.marks.read([path])
                time.sleep(.001)
            self.checks.seed(result)
            waiting = [photo["path"] for photo in photos if not photo.get("indexed")]
            done = len(photos) - len(waiting)
            self._set(done=done, total=len(photos))
            batch_size = max(32, logical_cpus() * 4)
            for start in range(0, len(waiting), batch_size):
                try:
                    records = self._job(generation, "metadata", paths=waiting[start:start + batch_size])["photos"]
                except (ValueError, OSError) as error:
                    log("index_metadata_failed", folder=pin["path"], paths=waiting[start:start + batch_size], reason=str(error), action="facts unavailable; next pass retries")
                    records = []
                    incomplete = True
                # I/O-bound SQLite writes retain short 32-row lock holds;
                # parallel readers never acquire the shared database lock.
                for offset in range(0, len(records), 32):
                    self.remember_facts(records[offset:offset+32], generation=generation)
                done += len(waiting[start:start + batch_size])
                self._set(done=done)
        if incomplete:
            raise _Retry("some pinned folders or photo details could not be read")
        self._set(state="idle", folder="", done=0, total=0, passes=self._progress["passes"] + 1)

    def _run(self):
        failures = 0
        while not self._stop.is_set():
            self._wake.wait()
            self._wake.clear()
            if self._stop.is_set():
                break
            with self._state:
                generation = self._generation
            try:
                log("index_start", generation=generation, action="scan pinned folders")
                started = time.monotonic()
                self._pass(generation)
                log("index_recovered" if failures else "index_end", passes=self._progress["passes"], duration=round(time.monotonic()-started, 3))
                failures = 0
            except _Restart:
                self._wake.set()
            except CancelledError:
                log("index_stop", action="helper closed; indexing stopped")
                break  # The helper closed with the app.
            except Exception as error:
                failures += 1
                if failures == 1 or failures % 5 == 0:
                    log("index_failed", folder=self._progress["folder"], reason=repr(error), failures=failures, action="entries retained; retry automatically; Re-scan wakes retry")
                self._set(state="retrying")
                self._wake.wait(self._retry_seconds)
                self._wake.set()
        self._set(state="idle", folder="", done=0, total=0)
