"""Remember failed pictures by source/settings revision without occupying a worker."""
import errno
from pathlib import Path
from functools import wraps
from hashlib import sha256
import inspect
import json
import time

from fastapi import HTTPException
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from .library_diagnostics import log


def source_offline(error, path):
    if not isinstance(error, OSError):
        return False
    if getattr(error, "winerror", None) in {21, 53, 55, 64, 67, 121, 1117, 1167}:
        return True
    if error.errno in {errno.ENODEV, errno.ENXIO, errno.ENETDOWN, errno.ENETUNREACH, errno.EHOSTUNREACH, errno.ETIMEDOUT}:
        return True
    # A deleted individual file is distinct from a disconnected parent folder.
    return error.errno == errno.ENOENT and not Path(path).parent.is_dir()


def _reader_identity():
    """Changes whenever the grade settings this version can read change, so a
    remembered failure (often an old grade an earlier version wrote) is retried
    after an update instead of staying stuck until the photo changes."""
    from .models import EditDocument
    # A newly supported source route must retry failures saved by the old app.
    identity = {"grade_schema": EditDocument.model_json_schema(), "library_source_routes": "jxl-colour-metadata-v5"}
    return sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()


_READER = _reader_identity()


def _listed(path):
    from .file_gate import path_listed
    return path_listed(path)


def temporary_development_failure(details):
    text = str(details).lower()
    # A safety refusal is a result, not a stalled allocation. Remember it
    # until refresh/retry or a source/settings change, including across helpers
    # where only the error text survives transport.
    if any(word in text for word in ("large-file safety cannot be confirmed",
            "is safely available", "dng resource preflight failed", "validation error")):
        return False
    return any(word in text for word in ("timeout", "timed out", "took too long", "cancelled", "canceled",
        "aborted", "out of memory", "insufficient memory", "memoryerror", "memory pressure", "waiting for memory", "busy", "in progress", "changed during", "changed while", "expired",
        "invalidated", "helper stopped", "time limit exceeded", "stall", "yielding", "waiting for", "fetch failed", "failed to fetch", "network"))


def plain_development_reason(details):
    """The development route's reasons are diagnostics; the photo shows plain
    words and the original text stays under Error details."""
    first = details.splitlines()[0] if details else ""
    if first.startswith("Not supported:"):
        return first
    if temporary_development_failure(details):
        return "Couldn't finish preparing this photo. Try again."
    if "no supported GPU development route" in first or first.startswith("RGB transfer "):
        return "The Library can't show this photo. Open it in Grade to work on it."
    return first or "Photo development failed. Try again."


class PictureErrors:
    def __init__(self, marks):
        self.marks = marks
        marks.picture_errors = self
        with marks._lock:
            db = marks._connect()
            with db:
                db.execute("CREATE TABLE IF NOT EXISTS picture_errors (path TEXT PRIMARY KEY, revision TEXT NOT NULL, record TEXT NOT NULL)")
            db.close()

    def revision(self, path):
        source = self.marks.source_path(path).resolve()
        def stamp(file):
            try:
                stat = file.stat()
                return [stat.st_size, stat.st_mtime_ns]
            except OSError as error:
                return [error.errno]
        with self.marks._lock:
            grades = getattr(self.marks, "grades", None)
            state = grades._get(str(path)) if grades else {}
            pending = {"grade": state.get("desired")} if state.get("pending") else None
            data = [str(source), stamp(source), stamp(self.marks._sidecar(source)), pending, _READER]
            return sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()

    def get(self, path):
        with self.marks._lock:
            rows = self.marks._query("SELECT revision, record FROM picture_errors WHERE path=?", (str(path),))
            if not rows:
                return None
            revision, record = rows[0]
            if revision != self.revision(path):
                self.clear(path)
                return None
            return json.loads(record)

    def clear(self, path):
        with self.marks._lock:
            db = self.marks._connect()
            with db:
                db.execute("DELETE FROM picture_errors WHERE path=?", (str(path),))
            db.close()

    def all(self):
        with self.marks._lock:
            paths = self.marks._query("SELECT path FROM picture_errors WHERE path NOT LIKE '@grade:%' ORDER BY rowid DESC")
            records = []
            for (path,) in paths:
                # Files the Library no longer lists (macOS "._" companions,
                # metadata folders) must not stay under Needs attention.
                if not _listed(self.marks.source_path(path)):
                    self.clear(path)
                elif record := self.get(path):
                    records.append(record)
            return records

    def save(self, record):
        with self.marks._lock:
            db = self.marks._connect()
            with db:
                db.execute("INSERT OR REPLACE INTO picture_errors VALUES (?, ?, ?)",
                           (record["path"], record["revision"], json.dumps(record)))
            db.close()
        return record

    def _grade_receipt(self, path, original):
        return "@grade:" + sha256(json.dumps([str(path), original, _READER], sort_keys=True).encode()).hexdigest()

    def grade_dismissed(self, path, original):
        return bool(self.marks._query("SELECT path FROM picture_errors WHERE path=?", (self._grade_receipt(path, original),)))

    def dismiss_grade(self, path, original):
        self.save(dict(path=self._grade_receipt(path, original), revision=_READER, ignored=True))

    def remember(self, path, error, revision, plain=None):
        if revision != self.revision(path):
            raise HTTPException(409, "The photo or settings changed. Request its preview again.")
        details = str(error)
        if temporary_development_failure(details):
            raise HTTPException(503, plain_development_reason(details)) from error
        if plain:
            reason = plain
        elif "validation error" in details:
            reason = "Saved edits contain settings this version cannot read."
        else:
            reason = details.splitlines()[0] if details else "The photo could not be read."
        record = self.save(dict(path=str(path), revision=revision, reason=reason,
                                details=details[:12000], ignored=False, time=time.time()))
        log("picture_failed", path=str(path), reason=details, action="error remembered; workers continue with other photos")
        return record

    def observe_grade(self, path, report):
        revision = self.revision(path)
        old = self.get(path)
        if report is None:
            if old and old.get("grade_warning") and not any("repair_id" in i for i in old.get("notice", {}).get("issues", [])): self.clear(path)
            return None
        if old and old.get("grade_warning") and old.get("notice") == report:
            return old
        from .saved_grades import summary_lines
        return self.save(dict(path=str(path), revision=revision, reason=report["reason"],
                              details="\n".join(summary_lines(report["issues"])),
                              grade_warning=True, notice=report, ignored=False, time=time.time()))

    @staticmethod
    def response(record):
        return JSONResponse({"detail": record["reason"], "library_error": record}, status_code=422)

    def guard_cached(self, handler):
        # Cache discovery is read-only: a later failed development cannot hide
        # a valid scene of this same source and grade from Single or Compare.
        return self.guard(handler, cache_probe=True)

    def guard(self, handler, cache_probe=False):
        @wraps(handler)
        async def checked(command, *args, **kwargs):
            path = command.path
            cached = await run_in_threadpool(self.get, path)
            if cached and not cached.get("grade_warning"):
                if cache_probe:
                    result = await run_in_threadpool(handler, command, *args, **kwargs)
                    if isinstance(result, dict) and (result.get("cached") or result.get("unedited_raw") or result.get("original_file")):
                        return result
                return self.response(cached)
            revision = await run_in_threadpool(self.revision, path)
            try:
                if inspect.iscoroutinefunction(handler):
                    return await handler(command, *args, **kwargs)
                return await run_in_threadpool(handler, command, *args, **kwargs)
            except HTTPException as error:
                if error.status_code != 400 or not isinstance(error.__cause__, (ValueError, OSError)):
                    raise
                failure = error.__cause__
            except (ValueError, OSError) as error:
                failure = error
            if source_offline(failure, path):
                log("picture_offline", path=str(path), action="no broken-photo receipt; retry after reconnect")
                return JSONResponse({"detail": "This folder is offline. Reconnect the drive, then open the folder again.",
                                     "offline": True, "path": str(path)}, status_code=503)
            # Admission failures and interruptions are not broken photos.
            if temporary_development_failure(failure):
                raise HTTPException(503, str(failure)) from failure
            record = await run_in_threadpool(self.remember, path, failure, revision)
            return self.response(record)
        return checked
