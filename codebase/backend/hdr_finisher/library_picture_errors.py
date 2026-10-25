"""Remember failed pictures by source/settings revision without occupying a worker."""
from functools import wraps
from hashlib import sha256
import inspect
import json
import time

from fastapi import HTTPException
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from .library_diagnostics import log


class PictureErrors:
    def __init__(self, marks):
        self.marks = marks
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
            data = [str(source), stamp(source), stamp(self.marks._sidecar(source)), pending]
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
            paths = self.marks._query("SELECT path FROM picture_errors ORDER BY rowid DESC")
            return [record for (path,) in paths if (record := self.get(path))]

    def save(self, record):
        with self.marks._lock:
            db = self.marks._connect()
            with db:
                db.execute("INSERT OR REPLACE INTO picture_errors VALUES (?, ?, ?)",
                           (record["path"], record["revision"], json.dumps(record)))
            db.close()
        return record

    def remember(self, path, error, revision):
        if revision != self.revision(path):
            raise HTTPException(409, "The photo or settings changed. Request its preview again.")
        details = str(error)
        if "validation error" in details:
            reason = "Saved edits contain settings this version cannot read."
        else:
            reason = details.splitlines()[0] if details else "The photo could not be read."
        record = self.save(dict(path=str(path), revision=revision, reason=reason,
                                details=details[:12000], ignored=False, time=time.time()))
        log("picture_failed", path=str(path), reason=details, action="error remembered; workers continue with other photos")
        return record

    @staticmethod
    def response(record):
        return JSONResponse({"detail": record["reason"], "library_error": record}, status_code=422)

    def guard(self, handler):
        @wraps(handler)
        async def checked(command, *args, **kwargs):
            path = command.path
            cached = await run_in_threadpool(self.get, path)
            if cached:
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
            # Admission failures and interruptions are not broken photos.
            text = str(failure).lower()
            if any(word in text for word in ("cancelled", "memory", "busy", "in progress", "changed during", "changed while", "expired", "invalidated")):
                raise HTTPException(503, str(failure)) from failure
            record = await run_in_threadpool(self.remember, path, failure, revision)
            return self.response(record)
        return checked
