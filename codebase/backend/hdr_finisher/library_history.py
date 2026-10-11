"""One session-start and previous grade per item; one bulk undo command."""
from copy import deepcopy
from pathlib import Path
from uuid import uuid4
from .models import EditDocument
from .library_grades import grade_key
from .library_marks import Marks
from .library_diagnostics import log

TARGETS = ("original", "saved", "session", "previous")

class LibraryHistory:
    def __init__(self, grades):
        self.grades = grades
        self.run = uuid4().hex

    def current(self, path):
        session = self.grades.store._current
        if session and self.grades.sessions.get(str(session.session_id)) == path: return session

    def target(self, state, document, kind):
        default = state.get("default") or document.get("grade_default")
        if kind == "original": return deepcopy(default)
        if kind == "saved": return deepcopy(document.get("grade") or default)
        field = "session_start" if kind == "session" else "previous_grade"
        if field not in state: raise ValueError("That photo has no grade to restore for this choice.")
        return deepcopy(state[field] or default)

    def available(self, values):
        grades = self.grades; marks = grades.marks
        with grades.store._lock, marks._lock:
            paths = list(dict.fromkeys(str(marks._path(p)) for p in values))
            documents = marks._documents(paths)
            marks.read(paths, documents=documents, canonical=True)
            result = {kind: 0 for kind in TARGETS}
            for path, document in zip(paths, documents):
                document = document or {}; state = grades._get(path)
                session = self.current(path)
                current = session.edit_document().model_dump(mode="json") if session else state.get("desired") if state.get("pending") else document.get("grade") or state.get("default")
                for kind in TARGETS:
                    if kind == "saved" and not session: continue
                    try: target = self.target(state, document, kind)
                    except ValueError: continue
                    if target is not None and grade_key(target) != grade_key(current): result[kind] += 1
            return {"counts": result}

    def revert(self, values, kind):
        if kind not in TARGETS: raise ValueError("Choose a grade to restore.")
        return self.rewrite(values, kind=kind)

    def rewrite(self, values, *, kind=None, targets=None, expected=None, undo=True):
        grades = self.grades; marks = grades.marks
        with grades.store._lock, marks._lock:
            paths = list(dict.fromkeys(str(marks._path(p)) for p in values))
            documents = marks._documents(paths)  # Validate every file before changing any item.
            records = marks.read(paths, documents=documents, canonical=True)["photos"]
            plans = []
            for path, document, row in zip(paths, documents, records):
                document = document or {}; state = grades._get(path); session = self.current(path)
                if state.get("conflict"): raise ValueError("Resolve the grade changed elsewhere before reverting.")
                if state.get("pending") or session:
                    if grades._check(path, state, document.get("grade")): raise ValueError("The grade changed elsewhere; nothing was reverted.")
                else: state["baseline"] = deepcopy(document.get("grade"))
                current = session.edit_document().model_dump(mode="json") if session else state.get("desired") if state.get("pending") else document.get("grade") or state.get("default")
                if expected is not None and grade_key(current) != grade_key(expected[path]):
                    raise ValueError("A grade changed since the revert; Undo was left available and nothing was overwritten.")
                if kind == "saved" and not session: continue
                try: target = deepcopy(targets[path]) if targets is not None else self.target(state, document, kind)
                except ValueError: continue
                if target is None or grade_key(target) == grade_key(current): continue
                EditDocument.model_validate(target)
                if current is None: raise ValueError("Open this photo once before reverting to its starting grade.")
                plans.append((path, document or None, row, state, session, current, target))
            before = {p: deepcopy(old) for p, _, _, _, _, old, _ in plans}
            after = {p: deepcopy(target) for p, _, _, _, _, _, target in plans}
            # Keep the losing grade durably before replacing even an open session.
            for path, _, _, state, session, current, target in plans:
                if state.get("session_run") != self.run:
                    state["session_start"] = deepcopy(current)
                    state["session_run"] = self.run
                state["previous_grade"] = deepcopy(current)
                if session: state["recovery"] = deepcopy(current)
                grades._put(path, state)
            rows, docs = [], []; payload = None; pending = {}
            for path, document, row, state, session, current, target in plans:
                if session:
                    model = EditDocument.model_validate(target)
                    if model.source == session.source_reference() and model.interpretation_override == session.interpretation_override:
                        grades.store.replace_edit_document(str(session.session_id), model, session.edit_revision)
                    else:
                        from .projects import open_document
                        session = open_document(grades.store, model, Path(path))
                        grades.sessions[str(session.session_id)] = path
                        grades.starts[str(session.session_id)] = deepcopy(target)
                    session.dirty = kind != "saved"
                    state = grades._get(path)
                    if session.dirty: state["recovery"] = deepcopy(target)
                    else: state.pop("recovery", None)
                    grades._put(path, state)
                    payload = session.to_payload().model_dump(mode="json")
                else:
                    state.update(desired=deepcopy(target), pending=True)
                    pending[path] = deepcopy(state)
                    row["photo_id"] = row["photo_id"] or uuid4().hex; row["storage"] = "database"
                    rows.append(row); docs.append(document)
            if rows:
                def finalize(db):
                    import json
                    for path, state in pending.items():
                        db.execute("INSERT OR REPLACE INTO photo_grades VALUES (?, ?)", (path, json.dumps(state)))
                marks._save(rows, docs, finalize)
            if undo and plans:
                marks._undo.append({"command": lambda: self.rewrite(list(before), targets=before, expected=after, undo=False)})
            for path, _, _, _, session, _, target in plans:
                if not session and getattr(marks, "kept", None): marks.kept.schedule(path, target)
            log("grade_revert", target=kind or "undo", count=len(plans), action="previous grade retained")
            return {"photos": rows, "count": len(plans), "session": payload, "warnings": [], "undo_available": bool(marks._undo)}
