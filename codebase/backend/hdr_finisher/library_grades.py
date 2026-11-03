"""Sidecar grade commands and durable recovery; rendering stays in projects/sessions."""
from copy import deepcopy
import json
from pathlib import Path
from time import perf_counter

from .projects import validate_saved_document
from .library_marks import Marks
from .library_diagnostics import log


def grade_key(value):
    if value is None:
        return None
    grade = deepcopy(value)
    if not isinstance(grade, dict): return grade
    grade.pop("app_version", None)
    grade.pop("section_versions", None)
    # Malformed saved structures still need a stable identity for warnings.
    if not isinstance(grade.get("source", {}), dict) or not isinstance(grade.get("global_adjustments", {}), dict):
        return grade
    source = grade.get("source", {})
    for field in ("durable_path", "filename", "fingerprint_sha256", "byte_size"):
        source.pop(field, None)
    # Viewer choices stay in the saved document, but do not change its grade.
    adjustments = grade.get("global_adjustments", {})
    if any(not isinstance(adjustments.get(key, {}), dict) for key in ("hdr", "sdr", "shared")):
        return grade
    shared = adjustments.get("shared", {})
    for field in ("overlay_mode", "overlay_opacity", "overlay_threshold",
                  "false_color_band_anchor", "false_color_ceiling_nits"):
        shared.pop(field, None)
    # Recomputed source measurements are not authored adjustments. Keep manual
    # peaks and measurement modes: changing either remains a real edit.
    adjustments = grade.get("global_adjustments", {})
    adjustments.get("hdr", {}).pop("highlight_compression_source_peak_nits", None)
    adjustments.get("sdr", {}).pop("highlight_compression_source_peak_percent", None)
    return grade


class LibraryGrades:
    def __init__(self, marks, store):
        self.marks, self.store = marks, store
        self.sessions = {}
        self.starts = {}
        from .library_history import LibraryHistory
        self.history = LibraryHistory(self)
        store.grade_recovery_observer = self.capture_edit
        store.library_grades = self
        marks.grades = self
        with marks._lock:
            db = marks._connect()
            with db:
                db.execute("CREATE TABLE IF NOT EXISTS photo_grades (path TEXT PRIMARY KEY, state TEXT NOT NULL)")
            db.close()

    def open_settings(self, source_path, item_key=None, recovery=False):
        """Read the same saved/pending grade attach will use, before decoding."""
        from .library_documents import LibraryDocuments
        result = LibraryDocuments(self.marks).request(item_key or str(source_path), recovery=recovery)
        if self.marks.source_path(result["path"]).resolve() != Path(source_path).resolve():
            raise ValueError("The copy belongs to another photo.")
        grade = result["grade"]
        return validate_saved_document(grade) if grade else None

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

    def attach(self, session_id, item_key=None):
        with self.store._lock, self.marks._lock:
            session = self.store.get(session_id)
            path = session.source_reference().durable_path
            if path is None:
                raise ValueError("This photo has no original path for a settings file.")
            path = str(Path(path))
            if item_key:
                key = str(self.marks._path(item_key))
                if self.marks.source_path(key) != Path(path): raise ValueError("The copy belongs to another photo.")
                path = key
            document = self.marks._document(Path(path))
            grade = (document or {}).get("grade")
            if grade is not None:
                from .saved_grades import notice
                from .library_picture_errors import PictureErrors
                errors = getattr(self.marks, "picture_errors", None) or PictureErrors(self.marks)
                errors.observe_grade(path, notice(validate_saved_document(grade)))
            state = self._get(path)
            recovery = state.get("recovery")
            self.sessions[session_id] = path
            # A pending grade belongs to the durable queue, not a new session.
            if not state.get("pending") and not state.get("conflict") and not recovery:
                state["baseline"] = grade
            if grade is None and not state.get("pending") and not recovery:
                state["default"] = session.edit_document().model_dump(mode="json")
            else:
                state.setdefault("default", session.edit_document().model_dump(mode="json"))
            for field in ("session_start", "previous_grade"):
                if field in (document or {}).get("grade_history", {}) and field not in state:
                    state[field] = deepcopy(document["grade_history"][field])
            self.starts[session_id] = deepcopy(state.get("desired") if state.get("pending") else grade or state["default"])
            self._put(path, state)
            return {"grade": state.get("desired") if state.get("pending") else grade,
                    "recovery": recovery if not state.get("pending") else None, "conflict": bool(state.get("conflict")), "path": path, "name": (document or {}).get("name")}

    def observe_documents(self, paths, documents):
        if len(paths)>1:
            for path,document in zip(paths,documents):self.observe_documents([path],[document])
            return
        connected={str(path):self.marks.source_path(path).parent.is_dir() for path in paths}
        with self.marks._lock:
            db = self.marks._connect()
            try:
                with db:
                    for path, document in zip(paths, documents):
                        if document is None and not connected[str(path)]: continue
                        # Read through this connection: once its write grows past the
                        # page cache it holds the file exclusively, and a second
                        # connection would wait on it until "database is locked".
                        row = db.execute("SELECT state FROM photo_grades WHERE path=?", (str(path),)).fetchone()
                        state = json.loads(row[0]) if row else {}; document = document or {}
                        if "grade" not in document and not state: continue
                        before = deepcopy(state)
                        state["indexed_grade"] = document.get("grade")
                        for field in ("session_start", "previous_grade"):
                            if field in document.get("grade_history", {}) and field not in state:
                                state[field] = deepcopy(document["grade_history"][field])
                        if document.get("grade_default"): state["default"] = document["grade_default"]
                        if state != before:
                            db.execute("INSERT OR REPLACE INTO photo_grades VALUES (?, ?)", (str(path), json.dumps(state)))
            finally: db.close()

    def describe(self, paths):
        states = {}
        for start in range(0, len(paths), 800):
            chunk = [str(p) for p in paths[start:start+800]]
            for path, value in self.marks._query("SELECT path, state FROM photo_grades WHERE path IN (" + ",".join("?" for _ in chunk) + ")", chunk):
                states[path] = json.loads(value)
        from .library_documents import identity
        result = {}
        exports = getattr(self.store, "batch_export", None)
        export_records = exports.read_records() if exports else None
        empty = {"edited":False,"grade_identity":identity(None)}
        if exports: empty.update(exported=False,edited_since_export=False,last_export=None)
        for path in paths:
            if str(path) not in states and (not exports or str(path) not in export_records):
                result[str(path)] = empty.copy()
                continue
            state = states.get(str(path), {})
            grade = state.get("desired") if state.get("pending") else state.get("indexed_grade", state.get("baseline"))
            result[str(path)] = {"edited": grade is not None and grade_key(grade) != grade_key(state.get("default")), "grade_identity": identity(grade)}
            if exports: result[str(path)].update(exports.export_state(str(path), grade, export_records))
        return result

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
                if state.get("session_run") != self.history.run:
                    state["session_start"] = deepcopy(self.starts.get(session_id, state.get("baseline") or state["default"]))
                    state["session_run"] = self.history.run
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
        if state.get("conflict"):
            # The file holds our last saved grade again, so nothing conflicts any
            # more. Keep the grade that was briefly there as the previous grade.
            state["previous_grade"] = state.pop("external", None) or state.get("previous_grade")
            state["conflict"] = False
            self._put(path, state)
            log("grade_conflict_cleared", photo=path, action="file matches the saved grade; other grade kept as previous")
        return False

    def save(self, session_id):
        started = perf_counter()
        with self.store._lock, self.marks._lock:
            locked = perf_counter()
            path = self.path(session_id)
            session = self.store.get(session_id)
            state = self._get(path)
            desired = session.edit_document().model_dump(mode="json")
            revision = session.edit_revision
            state["recovery"] = desired
            self._put(path, state)  # Safe before any filesystem preflight.
        prepared = perf_counter()
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
        preflight = perf_counter()
        with self.store._lock, self.marks._lock:
            relocked = perf_counter()
            state = self._get(path)
            from .saved_grades import notice
            raw_grade = (document or {}).get("grade")
            report = notice(validate_saved_document(raw_grade)) if raw_grade is not None else None
            from .library_documents import identity
            consented = state.get("grade_read_consent") == identity(raw_grade)
            if (report or session.grade_notice) and not consented:
                session.grade_notice = report or session.grade_notice
                return {**self.status(session_id), "grade_notice": session.grade_notice}
            if not unreadable and self._check(path, state, raw_grade):
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
            registered = perf_counter()
            from time import time
            available_at = time()*1000
            log("grade_save_queued", photo=path, action="grade retained; settings writer notified")
            scheduled = perf_counter()
            result = self.status(session_id)
            # Pixels may only follow the grade already selected by the Library.
            # Recovery (autosave off) never receives a publication ticket.
            result["picture"] = dict(path=path, revision=revision,
                grade_identity=identity(desired), available_at=available_at)
            ended = perf_counter()
            log("grade_save_timing", photo=path, duration_ms=(ended-started)*1000,
                lock_wait_ms=((locked-started)+(relocked-preflight))*1000,
                recovery_ms=(prepared-locked)*1000, preflight_ms=(preflight-prepared)*1000,
                register_ms=(registered-relocked)*1000, schedule_ms=(scheduled-registered)*1000,
                status_ms=(ended-scheduled)*1000)
            return result

    def merge(self, path, document):
        if getattr(self.marks,"copies",None): self.marks.copies.merge(path,document)
        return self.merge_item(path,document)

    def merge_item(self, path, document, include_history=True):
        with self.marks._lock:
            state = self._get(path)
            history = deepcopy(document.get("grade_history", {}))
            for field in ("session_start", "previous_grade"):
                if field in state and (include_history or state.get("pending")): history[field] = deepcopy(state[field])
            if state.get("grade_backups"):
                history["grade_backups"] = deepcopy(state["grade_backups"])
            if history: document["grade_history"] = history
            if not state.get("pending"):
                return document
            from .saved_grades import notice
            from .library_documents import identity
            raw_grade = document.get("grade")
            if raw_grade is not None and notice(validate_saved_document(raw_grade)) and state.get("grade_read_consent") != identity(raw_grade):
                state["pending"] = False
                self._put(path, state)
                return document
            if self._check(path, state, document.get("grade")):
                return document  # Marks still save, with the external grade intact.
            document["grade"] = state["desired"]
            document["grade_default"] = state.get("default")
            return document

    def acknowledge(self, path, document):
        if getattr(self.marks,"copies",None): self.marks.copies.acknowledge(path,document)
        self.acknowledge_item(path,document)

    def acknowledge_item(self, path, document):
        state = self._get(path)
        if state.get("pending") and grade_key(document.get("grade")) == grade_key(state.get("desired")):
            state.update(baseline=state["desired"], indexed_grade=state["desired"], pending=False)
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
            name = {}
            if "|copy|" in path:
                try: name["name"] = (self.marks._document(Path(path)) or {}).get("name")
                except (ValueError, OSError): pass  # Saving/status must still work while settings are unreadable.
            return {"conflict": bool(state.get("conflict")), "pending": bool(state.get("pending")),
                    "dirty": bool(session.dirty), "reason": reason,
                    "revision": session.edit_revision, "grade_notice": session.grade_notice, **name}

    def check(self, session_id, unsaved=False):
        path = self.path(session_id)
        current = self.store._current
        if current and str(current.session_id) != session_id and self.sessions.get(str(current.session_id)) == path:
            return {"session": current.to_payload().model_dump(mode="json"), "dirty": current.dirty}
        if not Path(path).parent.is_dir():
            return self.status(session_id)
        with self.marks._lock:
            before_read = deepcopy(self._get(path).get("baseline"))
        try:
            grade = (self.marks._document(Path(path)) or {}).get("grade")
        except (ValueError, OSError):
            return self.status(session_id)
        with self.store._lock, self.marks._lock:
            state = self._get(path)
            if grade_key(state.get("baseline")) != grade_key(before_read):
                return self.status(session_id)  # Writer acknowledged while this read was in flight.
            session = self.store.get(session_id)
            if grade_key(grade) != grade_key(state.get("baseline")):
                if unsaved or session.dirty or state.get("pending") or state.get("conflict"):
                    self._check(path, state, grade)
                else:
                    result = self.status(session_id)
                    result.update(reload=True, grade=grade)
                    return result
            elif state.get("conflict"):
                self._check(path, state, grade)
            return self.status(session_id)

    def resolve(self, session_id, choice, expected_external):
        path = self.path(session_id)
        grade = (self.marks._document(Path(path)) or {}).get("grade")
        with self.store._lock, self.marks._lock:
            state = self._get(path)
            if grade_key(grade) != grade_key(expected_external):
                if self._check(path, state, grade):
                    return {**self.status(session_id), "changed_again": True}
                return self.status(session_id)  # The conflict went away; nothing to choose.
            if choice == "cancel":
                return self.status(session_id)
            if choice == "both":
                self.marks.copies.create(path, grade=grade or state.get("default"))
                choice = "mine"
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

    def recover_grades(self, choices, action):
        from .library_documents import LibraryDocuments
        from .saved_grades import notice
        from .library_picture_errors import PictureErrors
        if action not in ("continue", "original", "leave", "dismiss"):
            raise ValueError("Choose Continue without them, Revert to original or Leave as is.")
        errors = getattr(self.marks, "picture_errors", None) or PictureErrors(self.marks)
        with self.store._lock, self.marks._lock:
            targets, originals = {}, {}
            for choice in choices:
                path = str(self.marks._path(choice["path"]))
                if choice["revision"] != errors.revision(path):
                    raise ValueError("The photo or settings changed. Review it again before choosing.")
                raw = LibraryDocuments(self.marks).request(path)["grade"]
                if raw is None: continue
                saved = validate_saved_document(raw)
                report = notice(saved) or (errors.get(path) or {}).get("notice")
                if not report: continue
                skipped = {i["repair_id"] for i in report["issues"] if "repair_id" in i}
                if skipped: saved.repairs = [r for r in saved.repairs if r.id not in skipped]
                if action in ("leave", "dismiss"):
                    if action == "dismiss":
                        if any(item["kind"] != "look" for item in report["issues"]):
                            raise ValueError("Unreadable or newer grades need a choice before their warning can be dismissed.")
                        record = errors.observe_grade(path, report)
                        errors.save({**record, "ignored": True})
                    continue
                originals[path] = deepcopy(raw)
                targets[path] = (saved.model_dump(mode="json") if action == "continue" else
                                 self.store.prepare_session(self.marks.source_path(path), owns_source_path=False).edit_document().model_dump(mode="json") if self.history.current(path) else None)
            # Durable backup precedes both live-session replacement and writer work.
            for path, raw in originals.items():
                state = self._get(path)
                doc = self.marks._document(Path(path)) or {}
                backups = state.setdefault("grade_backups", deepcopy(doc.get("grade_history", {}).get("grade_backups", [])))
                if raw not in backups: backups.append(raw)
                state["previous_grade"] = deepcopy(raw)
                from .library_documents import identity
                state["grade_read_consent"] = identity(raw)
                self._put(path, state)
            for path in targets:
                session = self.history.current(path)
                if session: session.grade_notice = None; session.grade_original = None
            result = self.history.rewrite(list(targets), targets=targets, save_open=True, allow_protected=True)
            for path in targets:
                session = self.history.current(path)
                if session: session.grade_notice = None; session.grade_original = None
                errors.clear(path)
            return result

    def discard_recovery(self, session_id):
        with self.store._lock, self.marks._lock:
            path = self.path(session_id)
            state = self._get(path)
            state.pop("recovery", None)
            self._put(path, state)
