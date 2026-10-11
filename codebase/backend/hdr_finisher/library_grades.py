"""Sidecar grade commands and durable recovery; rendering stays in projects/sessions."""
from copy import deepcopy
import json
from pathlib import Path

from .models import EditDocument
from .library_marks import Marks
from .library_diagnostics import log


def grade_key(value):
    if value is None:
        return None
    grade = deepcopy(value)
    source = grade.get("source", {})
    for field in ("durable_path", "filename", "fingerprint_sha256", "byte_size"):
        source.pop(field, None)
    return grade


class LibraryGrades:
    def __init__(self, marks, store):
        self.marks, self.store = marks, store
        self.sessions = {}
        store.grade_recovery_observer = self.capture_edit
        marks.grades = self
        with marks._lock:
            db = marks._connect()
            with db:
                db.execute("CREATE TABLE IF NOT EXISTS photo_grades (path TEXT PRIMARY KEY, state TEXT NOT NULL)")
            db.close()

    def capture_edit(self, session):
        if str(session.session_id) in self.sessions:
            self.capture(str(session.session_id))

    def _get(self, path):
        rows = self.marks._query("SELECT state FROM photo_grades WHERE path=?", (str(path),))
        return json.loads(rows[0][0]) if rows else {}

    def _put(self, path, state):
        db = self.marks._connect()
        try:
            with db:
                db.execute("INSERT OR REPLACE INTO photo_grades VALUES (?, ?)", (str(path), json.dumps(state)))
        finally:
            db.close()

    def attach(self, session_id):
        with self.store._lock, self.marks._lock:
            session = self.store.get(session_id)
            path = session.source_reference().durable_path
            if path is None:
                raise ValueError("This photo has no original path for a settings file.")
            path = str(Path(path))
            document = self.marks._document(Path(path))
            grade = (document or {}).get("grade")
            if grade is not None:
                EditDocument.model_validate(grade)
            state = self._get(path)
            recovery = state.get("recovery")
            self.sessions[session_id] = path
            # A pending grade belongs to the durable queue, not a new session.
            if not state.get("pending") and not state.get("conflict") and not recovery:
                state["baseline"] = grade
            state.setdefault("default", session.edit_document().model_dump(mode="json"))
            self._put(path, state)
            return {"grade": state.get("desired") if state.get("pending") else grade,
                    "recovery": recovery if not state.get("pending") else None, "conflict": bool(state.get("conflict")), "path": path}

    def path(self, session_id):
        if session_id not in self.sessions:
            raise ValueError("The photo is not attached to Library saving.")
        return self.sessions[session_id]

    def capture(self, session_id):
        with self.store._lock, self.marks._lock:
            path = self.path(session_id)
            session = self.store.get(session_id)
            state = self._get(path)
            if session.dirty:
                state["recovery"] = session.edit_document().model_dump(mode="json")
                self._put(path, state)
            return self.status(session_id)

    def _check(self, path, state, grade):
        baseline = state.get("baseline")
        if grade_key(grade) != grade_key(baseline):
            # An interrupted acknowledgement may find our own whole-file save.
            if state.get("pending") and grade_key(grade) == grade_key(state.get("desired")):
                return False
            state["conflict"] = True
            state["external"] = deepcopy(grade)
            state["pending"] = False
            self._put(path, state)
            log("grade_conflict", photo=path, action="saving paused; both grades retained")
            return True
        return bool(state.get("conflict"))

    def save(self, session_id):
        with self.store._lock, self.marks._lock:
            path = self.path(session_id)
            session = self.store.get(session_id)
            state = self._get(path)
            desired = session.edit_document().model_dump(mode="json")
            revision = session.edit_revision
            state["recovery"] = desired
            self._put(path, state)  # Safe before any filesystem preflight.
        # Folder/network reads never hold the lock that Grade's edits need.
        try:
            document = self.marks._document(Path(path))
        except (ValueError, OSError):
            document = None
            unreadable = True
        else:
            unreadable = False
        if not Path(path).parent.is_dir():
            unreadable = True  # An unplugged drive has no external grade to compare.
        with self.store._lock, self.marks._lock:
            state = self._get(path)
            if not unreadable and self._check(path, state, (document or {}).get("grade")):
                return self.status(session_id)
            state.update(desired=desired, pending=True)
            row = self.marks._rows([path]).get(path)
            if row is None or (document is not None and row["storage"] != "database"):
                row = {"path": path, "photo_id": (document or {}).get("photo_id") or __import__("uuid").uuid4().hex,
                       "marks": Marks.model_validate((document or {}).get("marks", {})).model_dump(),
                       "albums": (document or {}).get("albums", []), "storage": "database"}
            else:
                row["storage"] = "database"
            self.marks._save([row], [document], finalize=lambda db: db.execute(
                "INSERT OR REPLACE INTO photo_grades VALUES (?, ?)", (path, json.dumps(state))))
            if session.edit_revision == revision:
                session.dirty = False
            log("grade_save_queued", photo=path, action="grade retained; settings writer notified")
            return self.status(session_id)

    def merge(self, path, document):
        with self.marks._lock:
            state = self._get(path)
            if not state.get("pending"):
                return document
            if self._check(path, state, document.get("grade")):
                return document  # Marks still save, with the external grade intact.
            document["grade"] = state["desired"]
            return document

    def acknowledge(self, path, document):
        state = self._get(path)
        if state.get("pending") and grade_key(document.get("grade")) == grade_key(state.get("desired")):
            state.update(baseline=state["desired"], pending=False)
            if grade_key(state.get("recovery")) == grade_key(state["desired"]):
                state.pop("recovery", None)
            self._put(path, state)
            log("grade_saved", photo=path, action="whole settings file replaced")

    def status(self, session_id):
        with self.store._lock, self.marks._lock:
            path = self.path(session_id)
            state = self._get(path)
            session = self.store.get(session_id)
            rows = self.marks._rows([path])
            reason = rows.get(path, {}).get("write_reason", "")
            return {"conflict": bool(state.get("conflict")), "pending": bool(state.get("pending")),
                    "dirty": bool(session.dirty), "reason": reason,
                    "revision": session.edit_revision}

    def check(self, session_id, unsaved=False):
        path = self.path(session_id)
        if not Path(path).parent.is_dir():
            return self.status(session_id)
        try:
            grade = (self.marks._document(Path(path)) or {}).get("grade")
        except (ValueError, OSError):
            return self.status(session_id)
        with self.store._lock, self.marks._lock:
            state = self._get(path)
            session = self.store.get(session_id)
            if grade_key(grade) != grade_key(state.get("baseline")):
                if unsaved or session.dirty or state.get("pending") or state.get("conflict"):
                    self._check(path, state, grade)
                else:
                    result = self.status(session_id)
                    result.update(reload=True, grade=grade)
                    return result
            return self.status(session_id)

    def resolve(self, session_id, choice, expected_external):
        path = self.path(session_id)
        grade = (self.marks._document(Path(path)) or {}).get("grade")
        with self.store._lock, self.marks._lock:
            state = self._get(path)
            if grade_key(grade) != grade_key(expected_external):
                self._check(path, state, grade)
                return {**self.status(session_id), "changed_again": True}
            if choice == "cancel":
                return self.status(session_id)
            if choice not in ("mine", "file"):
                raise ValueError("Choose Keep my grade, Use the file's grade, or Cancel.")
            session = self.store.get(session_id)
            local = session.edit_document().model_dump(mode="json")
            state["previous_grade"] = deepcopy(grade if choice == "mine" else local)
            state.update(baseline=grade, conflict=False, pending=False)
            state.pop("external", None)
            self._put(path, state)  # Losing grade survives even if the next save fails.
            log("grade_conflict_resolved", photo=path, choice=choice, action="unchosen grade retained for Stage C")
            if choice == "file":
                return {**self.status(session_id), "reload": True, "grade": grade}
        return self.save(session_id)

    def external(self, session_id):
        return self._get(self.path(session_id)).get("external")

    def attention(self):
        groups = {}
        for path, value in self.marks._query("SELECT path, state FROM photo_grades"):
            if json.loads(value).get("conflict"):
                folder = str(Path(path).parent)
                group = groups.setdefault(folder, {"folder": folder, "reason": "grade_conflict", "count": 0,
                    "photos": [], "explanation": "grade changed elsewhere; saving paused; resolve in Grade"})
                group["count"] += 1
                group["photos"].append(path)
        return list(groups.values())

    def discard_recovery(self, session_id):
        with self.store._lock, self.marks._lock:
            path = self.path(session_id)
            state = self._get(path)
            state.pop("recovery", None)
            self._put(path, state)
