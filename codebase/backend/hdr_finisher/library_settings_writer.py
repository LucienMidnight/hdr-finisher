"""Backend-only settings writer. The database pending flag is its durable queue."""
from __future__ import annotations

from collections import Counter, deque
import errno
import hashlib
import json
from pathlib import Path
import re
from .library_diagnostics import log, problem, audited
from threading import Event, Lock, Thread
import time
from uuid import uuid4


REASONS = {
    "locked": "the settings file is still in use by another program",
    "disk_full": "the drive is full",
    "unwritable": "the folder cannot be written",
    "offline": "the folder is not connected",
    "unreadable": "the settings file cannot be read and was left untouched",
    "io": "the system could not write the settings file",
}


class LibrarySettingsWriter:
    def __init__(self, marks):
        self.marks = marks
        self._wake, self._stop = Event(), Event()
        self._lane = Lock()
        self._thread = None
        self._paused = False
        self._busy = lambda: False
        self._events = deque(maxlen=100)
        self._serial = 0
        self._completed = 0
        self._progress_total = 0
        self._busy_state = False
        self._recovered = set()
        self._recovery_done = 0
        self._group_delays = {}
        self._cleaned_folders = set()

    @staticmethod
    def fingerprint(document):
        return hashlib.sha256(json.dumps(document, sort_keys=True, ensure_ascii=False).encode()).hexdigest()

    @staticmethod
    def owner(photo_id):
        return hashlib.sha256(photo_id.encode()).hexdigest()[:16]

    log = staticmethod(log)

    def notify(self, message):
        self._serial += 1
        self._events.append({"id": self._serial, "message": message})

    def enqueue(self, db, row, document):
        offline = not Path(row["path"]).parent.exists()
        db.execute("INSERT INTO settings_writes VALUES (?, ?, ?, ?, '', 0, 0) ON CONFLICT(path) DO UPDATE SET revision=excluded.revision, reason=excluded.reason, detail='', next_try=0, attempts=0",
            (row["path"], str(uuid4()), "unknown" if offline else self.fingerprint(document), "offline" if offline else ""))

    def wake(self):
        self._wake.set()

    def start(self, busy=None):
        with self.marks._lock:
            if self._thread is not None:
                return
            if busy is not None:
                self._busy = busy
            # Keep existing pending marks. No table is replaced or migrated.
            if self.marks.database.exists():
                db = self.marks._connect()
                try:
                    with db:
                        db.execute("UPDATE settings_writes SET next_try=0")
                        self._recovered = {row[0] for row in db.execute("SELECT path FROM photos WHERE pending=1")}
                finally:
                    db.close()
            removed = self.cleanup()
            self.log("writer_start", waiting=len(self._recovered), temporary_removed=removed)
            self._stop.clear()
            self._thread = Thread(target=self._run, name="hdr-library-settings", daemon=True)
            self._thread.start()

    def close(self):
        # Do not drain on close. SQLite owns anything still waiting.
        self._stop.set()
        self.wake()
        if self._thread is not None:
            self._thread.join(timeout=1)
            if not self._thread.is_alive():
                self._thread = None

    def pause(self, paused):
        with self.marks._lock:
            self._paused = bool(paused)
            self.log("writer_pause" if paused else "writer_resume", reason="user")
        self.wake()

    def is_current(self, path, revision):
        if getattr(self.marks, "file_commands", None) and self.marks.file_commands.blocked(path): return False
        return bool(self.marks._query("SELECT 1 FROM photos JOIN settings_writes USING(path) WHERE path=? AND pending=1 AND revision=?", (path, revision))) and not self._stop.is_set()

    @audited("writer_cleanup")
    def cleanup(self, only_folder=None):
        """Only known-photo temps with our exact name, document and photo ID."""
        removed = 0
        folders = {}
        for path, photo_id in self.marks._query("SELECT path, photo_id FROM photos"):
            source = Path(path)
            folders.setdefault(source.parent, {})[source.name] = photo_id
        for folder, known in folders.items():
            if only_folder is not None and folder != only_folder:
                continue
            try:
                if not folder.is_dir():
                    continue
                candidates = list(folder.glob(".*.hdrf.*.tmp"))
                for temporary in candidates:
                    if temporary.is_symlink():
                        continue
                    # New names identify app-owned temps even if power failed
                    # halfway through JSON. Older names need a complete document.
                    own_match = re.fullmatch(r"\.hdrf-settings\.(.+)\.hdrf\.([^.]+)\.[a-z0-9_]{8}\.tmp", temporary.name)
                    owned = own_match and own_match[1] in known and self.owner(known[own_match[1]]) == own_match[2]
                    if owned:
                        temporary.unlink()
                        removed += 1
                        continue
                    match = re.fullmatch(r"\.(.+)\.hdrf\.[a-z0-9_]{8}\.tmp", temporary.name)
                    if temporary.is_symlink() or not match or match[1] not in known:
                        continue
                    try:
                        document = json.loads(temporary.read_text(encoding="utf-8"))
                    except (OSError, ValueError) as error:
                        problem("writer_cleanup_unproven", temporary, error, "ownership cannot be proved; file left untouched")
                        continue  # Cannot prove this file belongs to us.
                    if (isinstance(document, dict) and document.get("format") == "HDR Finisher Photo"
                            and document.get("schema_version") == 1
                            and document.get("photo_id") == known[match[1]]
                            and isinstance(document.get("source"), dict)
                            and document["source"].get("filename") == match[1]
                            and document.get("contains_source_pixels") is False):
                        temporary.unlink()
                        removed += 1
                self._cleaned_folders.add(folder)
            except OSError as error:
                self.log("writer_cleanup_failed", folder=folder, reason=str(error), action="left untouched; retry on reconnect")
        return removed

    def status(self, paths=()):
        with self.marks._lock:
            waiting = self.marks._query("SELECT COUNT(*) FROM photos WHERE pending=1")
            problems = self.marks._query("SELECT reason, COUNT(*) FROM settings_writes JOIN photos USING(path) WHERE pending=1 AND reason!='' GROUP BY reason")
            count = waiting[0][0] if waiting else 0
            if not count:
                self._completed = self._progress_total = 0
            self._progress_total = max(self._progress_total, self._completed + count)
            groups = {}
            for path, reason in self.marks._query("SELECT path, reason FROM settings_writes JOIN photos USING(path) WHERE pending=1 AND reason!=''"):
                key = (str(Path(path).parent), reason)
                item = groups.setdefault(key, {"folder": key[0], "reason": reason, "count": 0, "photos": [], "explanation": REASONS[reason]})
                item["count"] += 1
                if len(item["photos"]) < 3:
                    item["photos"].append(path)
            return {"waiting": count, "done": self._completed, "total": self._progress_total,
                "attention": list(groups.values()) + (self.marks.grades.attention() if getattr(self.marks, "grades", None) else []), "busy": bool(self._busy()), "paused": self._paused,
                "reasons": dict(problems), "events": list(self._events),
                "photos": list(self.marks._rows(list(paths)).values()) if paths else []}

    def retry(self, folder, reason):
        """Retry only the selected live folder/reason group; retain its failure until success."""
        with self.marks._lock:
            paths = [path for path, why in self.marks._query("SELECT path, reason FROM settings_writes")
                if str(Path(path).parent) == folder and why == reason]
            if paths:
                db = self.marks._connect()
                try:
                    with db:
                        db.executemany("UPDATE settings_writes SET next_try=0, attempts=0 WHERE path=?", [(path,) for path in paths])
                finally:
                    db.close()
                for path in paths:
                    self._group_delays.pop(("disk_full", self.drive(Path(path))), None)
            self.log("writer_retry", folder=folder, reason=reason, count=len(paths), action="retry requested; pending marks retained")
        self.wake()

    @staticmethod
    def drive(source):
        return source.anchor

    @staticmethod
    def classify(error):
        if isinstance(error, ValueError):
            if isinstance(error.__cause__, OSError):
                return LibrarySettingsWriter.classify(error.__cause__)
            return "unreadable"
        if getattr(error, "winerror", None) in (32, 33):
            return "locked"
        if error.errno == errno.ENOSPC or getattr(error, "winerror", None) in (39, 112):
            return "disk_full"
        if error.errno in (errno.EBUSY, errno.EAGAIN, errno.ETXTBSY):
            return "locked"
        if error.errno in (errno.EACCES, errno.EPERM) or isinstance(error, PermissionError):
            return "unwritable"
        return "io"

    def _pending(self):
        with self.marks._lock:
            return [row[0] for row in self.marks._query("SELECT photos.path FROM photos LEFT JOIN settings_writes USING(path) WHERE pending=1 AND COALESCE(next_try,0)<=?", (time.time(),))]

    def _snapshot(self, path):
        with self.marks._lock:
            row = self.marks._rows([path]).get(path)
            if not row or row["storage"] != "database":
                return None
            state = self.marks._query("SELECT revision, fingerprint, reason, attempts FROM settings_writes WHERE path=?", (path,))
            if not state:
                # Pending marks already contain the lasting state. A missing
                # write descriptor has an unknown baseline; report that.
                db = self.marks._connect()
                try:
                    with db:
                        db.execute("INSERT INTO settings_writes VALUES (?, ?, 'unknown', '', '', 0, 0)", (path, str(uuid4())))
                finally:
                    db.close()
                state = self.marks._query("SELECT revision, fingerprint, reason, attempts FROM settings_writes WHERE path=?", (path,))
            return row, state[0]

    def _attempt(self, path):
        snapshot = self._snapshot(path)
        if snapshot is None:
            return None
        row, (revision, fingerprint, previous, attempts) = snapshot
        source = Path(path)
        try:
            source.stat()
        except FileNotFoundError as error:
            if source.parent.is_dir():
                with self.marks._lock:
                    if self.is_current(path, revision):
                        db = self.marks._connect()
                        try:
                            with db:
                                for table in ("photos", "photo_tags", "album_photos", "settings_writes", "files"):
                                    db.execute(f"DELETE FROM {table} WHERE path=?", (path,))
                        finally:
                            db.close()
                        self._recovered.discard(path)
                return ("deleted", source.parent, path, str(error), True)
            return self._failure(path, revision, "offline", error, attempts, previous)
        except OSError as error:
            return self._failure(path, revision, self.classify(error), error, attempts, previous)
        if source.parent not in self._cleaned_folders:
            self.cleanup(source.parent)
        drive = self.drive(source)
        for group in (("disk_full", drive),):
            if self._group_delays.get(group, 0) > time.time():
                return self._failure(path, revision, group[0], OSError(REASONS[group[0]]), attempts, previous, report=False)
        try:
            document = self.marks._document(source)
            current_fingerprint = self.fingerprint(document)
            external = fingerprint != "unknown" and fingerprint != current_fingerprint
            unknown_baseline = fingerprint == "unknown"
            document = document or self.marks._new_document(row)
            document["marks"] = row["marks"]
            if row["albums"] or "albums" in document:
                document["albums"] = row["albums"]
            if getattr(self.marks, "grades", None):
                document = self.marks.grades.merge(path, document)
            if not self.marks._write_sidecar(source, document, revision=revision, fingerprint=current_fingerprint, owner_id=row["photo_id"]):
                return None  # Superseded while preparing the temporary file.
            if unknown_baseline:
                return ("baseline_unknown", source.parent, path, "no previous settings fingerprint", True)
            if external:
                return ("external_change", source.parent, path, "settings changed since command preflight", True)
            if previous:
                return ("recovered", source.parent, path, previous, True)
            return None
        except (OSError, ValueError) as error:
            return self._failure(path, revision, self.classify(error), error, attempts, previous)

    def acknowledge(self, path):
        # Called under the marks lock immediately after atomic replacement.
        # A newer command cannot slip between the file and its pending flag.
        db = self.marks._connect()
        try:
            with db:
                db.execute("UPDATE photos SET pending=0 WHERE path=?", (path,))
                db.execute("DELETE FROM settings_writes WHERE path=?", (path,))
        finally:
            db.close()
        self._completed += 1
        if path in self._recovered:
            self._recovered.remove(path)
            self._recovery_done += 1

    def _failure(self, path, revision, reason, error, attempts, previous, report=True):
        detail = str(error.__cause__ or error)
        attempts += 1
        delay = (0.15, 0.5, 1)[attempts - 1] if reason == "locked" and attempts <= 3 else 15
        folder = Path(path).parent
        group = self.drive(Path(path)) if reason == "disk_full" else str(folder)
        if reason == "disk_full":
            self._group_delays[(reason, group)] = time.time() + delay
        with self.marks._lock:
            if not self.is_current(path, revision):
                return None
            db = self.marks._connect()
            try:
                with db:
                    db.execute("UPDATE settings_writes SET reason=?, detail=?, next_try=?, attempts=? WHERE path=? AND revision=?",
                        (reason, detail, time.time() + delay, attempts, path, revision))
            finally:
                db.close()
        # Brief file locks remain quiet. Persistent or different problems report once.
        visible = report and previous != reason and (reason != "locked" or attempts > 3)
        if reason == "locked" and attempts == 4:
            visible = True
        return (reason, group, path, detail, visible)

    def drain(self):
        """One pass; also used by deterministic checks, never a mark command."""
        self.status()  # Capture the queue size before this pass completes files.
        busy = bool(self._busy())
        if busy != self._busy_state:
            self.log("writer_pause" if busy else "writer_resume", reason="Grade/import/export")
            self._busy_state = busy
        counts, examples, visible = Counter(), {}, set()
        with self._lane:
            for path in self._pending():
                if getattr(self.marks, "file_commands", None) and self.marks.file_commands.blocked(path): continue
                if self._stop.is_set() or self._paused or self._busy():
                    break
                event = self._attempt(path)
                if event:
                    reason, group, photo, detail, report = event
                    key = (reason, str(group))
                    counts[key] += 1
                    samples = examples.setdefault(key, [])
                    if len(samples) < 3:
                        samples.append({"photo": photo, "reason": detail})
                    if report:
                        visible.add(key)
            with self.marks._lock:
                for (reason, group), count in counts.items():
                    self.log("writer_" + reason, folder=group, count=count, examples=examples[(reason, group)],
                        action="removed from library" if reason == "deleted" else "current marks written; other fields kept" if reason in ("external_change", "baseline_unknown") else "settings written" if reason == "recovered" else "kept pending; automatic retry")
                    if (reason, group) not in visible:
                        continue
                    if reason == "deleted":
                        message = f"{count} photos could no longer be found in {group}; their library entries were removed."
                    elif reason == "recovered":
                        message = f"Finished writing settings for {count} photos in {group}."
                    elif reason == "baseline_unknown":
                        message = f"Restored pending settings for {count} photos in {group}. Earlier file changes could not be checked; the library's marks were written and every other setting was kept."
                    elif reason == "external_change":
                        names = ", ".join(Path(item["photo"]).name for item in examples[(reason, group)])
                        message = f"Settings changed elsewhere for {count} photos in {group} ({names}). The library's marks were written; every other setting was kept."
                    elif reason == "unreadable":
                        names = ", ".join(Path(item["photo"]).name for item in examples[(reason, group)])
                        message = f"Settings for {names} cannot be read and were left untouched. Marks are safe in the library."
                    else:
                        message = f"Settings are waiting in {group}: {REASONS[reason]}. Marks are safe in the library; writing will retry automatically."
                    self.notify(message)
                if self._recovery_done and not self._recovered:
                    self.notify(f"Finished writing settings for {self._recovery_done} photos from the last session.")
                    self.log("writer_recovery_finished", count=self._recovery_done)
                    self._recovery_done = 0
        return self.status()

    def _run(self):
        while not self._stop.is_set():
            self._wake.clear()
            try:
                self.drain()
            except Exception as error:
                # A database or unexpected writer failure must never kill recovery.
                self.log("writer_failed", reason=repr(error), action="marks retained; retry in one second")
            self._wake.wait(1)
