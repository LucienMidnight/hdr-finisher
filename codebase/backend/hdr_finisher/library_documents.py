"""Shared document identity, atomic writes and latest saved/pending grades."""
from copy import deepcopy
from hashlib import sha256
import json
import os
from pathlib import Path
from tempfile import NamedTemporaryFile
from .library_grades import grade_key
from .library_diagnostics import log
import sqlite3
from time import perf_counter


def identity(grade):
    return sha256(json.dumps(grade_key(grade),sort_keys=True,separators=(",",":")).encode()).hexdigest()


def atomic_json(path, value):
    path=Path(path); path.parent.mkdir(parents=True,exist_ok=True)
    with NamedTemporaryFile(dir=path.parent,suffix=".tmp",delete=False) as f:
        temp=Path(f.name);f.write(json.dumps(value,ensure_ascii=False).encode());f.flush();os.fsync(f.fileno())
    try: os.replace(temp,path)
    finally: temp.unlink(missing_ok=True)


class LibraryDocuments:
    def __init__(self, marks):
        self.marks = marks

    def request(self, path, *, recovery=False):
        """Read committed grade state before the atomically replaced sidecar.

        Pending desired grades win, including the interval between replacement
        and acknowledgement. This reader takes neither the session nor Library
        lock, so it cannot reverse their session-before-Library order.
        """
        from .library_copies import source, is_copy, LibraryCopies
        started = perf_counter()
        physical = self.marks._path(source(path))
        path = str(physical) + ("|copy|" + str(path).split("|copy|", 1)[1] if is_copy(path) else "")
        state, copies = {}, {}
        # Never initialise schema or journal mode from a foreground reader.
        if self.marks.database.exists():
            db = sqlite3.connect(self.marks.database.as_uri() + "?mode=ro", uri=True)
            try:
                db.execute("BEGIN")
                row = db.execute("SELECT state FROM photo_grades WHERE path=?", (path,)).fetchone()
                state = json.loads(row[0]) if row else {}
                if is_copy(path):
                    row = db.execute("SELECT state FROM library_copies WHERE source=?", (str(physical),)).fetchone()
                    copies = json.loads(row[0]) if row else {}
            finally:
                db.close()
        doc = self.marks._document(physical) or {}
        if is_copy(path):
            items = (copies.get("desired", []) if copies.get("pending") else
                LibraryCopies.validate(doc) if physical.parent.exists() else copies.get("baseline", []))
            item = next((item for item in items if item["photo_id"] == path.split("|copy|", 1)[1]), None)
            if item is None:
                raise ValueError("That virtual copy is no longer available. Nothing was changed.")
            doc = {**item, "grade_default": item.get("grade_default") or doc.get("grade_default")}
        grade = state.get("desired") if state.get("pending") else doc.get("grade")
        if recovery and not state.get("pending"):
            grade = state.get("recovery") or grade
        default = doc.get("grade_default") or state.get("default")
        result = {"path":path,"grade":deepcopy(grade),"grade_identity":identity(grade),
            "edited":grade is not None and grade_key(grade)!=grade_key(default)}
        log("document_lookup_timing", duration_ms=round((perf_counter()-started)*1000, 3))
        return result
