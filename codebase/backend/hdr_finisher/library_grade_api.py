"""Grade commands share the Library's sole writer and project's opening path."""
from pathlib import Path
import json
from typing import Literal
from fastapi import HTTPException
from pydantic import BaseModel
from .library_grades import LibraryGrades
from .models import EditDocument, EditCommand
from .projects import open_document, validate_saved_document


class GradeRequest(BaseModel):
    action: Literal["attach", "capture", "save", "check", "resolve", "load", "discard"]
    choice: Literal["mine", "file", "both", "cancel"] = "cancel"
    document: dict | None = None
    recovery: bool = False
    reuse_source: bool = False
    preserve_recovery: bool = False
    unsaved: bool = False
    initialize: bool = False
    default_white: Literal[100, 203] = 203
    item_key: str | None = None


def add_grade_routes(router, marks, store):
    grades = LibraryGrades(marks, store)
    from .library_copies import LibraryCopies
    copies = LibraryCopies(marks)

    class OpenSettingsRequest(BaseModel):
        path: str
        item_key: str | None = None

    @router.post("/open-settings")
    def open_settings(request: OpenSettingsRequest):
        try:
            source = marks.source_path(request.item_key or request.path)
            if source.resolve() != Path(request.path).resolve():
                raise ValueError("The copy belongs to another photo.")
            with marks._lock:
                key = str(marks._path(request.item_key or request.path))
                state = grades._get(key)
                return {"recovery": bool(state.get("recovery") and not state.get("pending"))}
        except (ValueError, OSError) as error:
            raise HTTPException(status_code=400, detail=str(error)) from error

    class CopyRequest(BaseModel):
        paths: list[str]
        action: Literal["create", "remove", "rename"] = "create"
        start: Literal["current", "clean"] = "current"
        name: str = ""

    @router.post("/virtual-copies")
    def virtual_copies(request: CopyRequest):
        try:
            if request.action == "create": return copies.create_many(request.paths, request.start, request.name)
            if request.action == "remove": return copies.remove_many(request.paths)
            if len(request.paths) != 1: raise ValueError("Select one virtual copy to rename.")
            return copies.rename(request.paths[0], request.name)
        except (ValueError,OSError) as error:
            raise HTTPException(status_code=400,detail=str(error)) from error

    class RevertRequest(BaseModel):
        paths: list[str]
        target: Literal["original", "saved", "session", "previous"] | None = None

    @router.post("/grade-reverts")
    def grade_reverts(request: RevertRequest):
        try:
            return grades.history.revert(request.paths, request.target) if request.target else grades.history.available(request.paths)
        except (ValueError, OSError) as error:
            raise HTTPException(status_code=400, detail=str(error)) from error

    @router.get("/grade-recovery")
    def recovery():
        with marks._lock:
            return {"photos": [{"path": path} for path, value in marks._query("SELECT path, state FROM photo_grades")
                               if json.loads(value).get("recovery") and not json.loads(value).get("pending")]}

    @router.post("/grade/{session_id}")
    def grade_command(session_id: str, request: GradeRequest):
        try:
            if request.action == "attach":
                if request.initialize:
                    session = store.get(session_id)
                    source_path = session.source_reference().durable_path
                    settings = marks._document(Path(request.item_key or source_path)) if source_path is not None else None
                    if not (settings or {}).get("grade") and session.hdr_reference_white_nits != request.default_white:
                        store.apply_edit_commands(session_id, [EditCommand(expected_revision=session.edit_revision,
                            command_type="set_hdr_reference_white", payload={"hdr_reference_white_nits": request.default_white})])
                        session.dirty = False
                        session.undo_history.clear()
                        session.redo_history.clear()

                attached = grades.attach(session_id, request.item_key)
                if not attached["grade"]:
                    attached["session"] = store.get(session_id).to_payload()
                return attached
            if request.action == "capture":
                if request.unsaved:
                    store.get(session_id).dirty = True
                return grades.capture(session_id)
            if request.action == "save":
                return grades.save(session_id)
            if request.action == "check":
                result = grades.check(session_id, request.unsaved)
                result["external"] = grades.external(session_id)
                return result
            if request.action == "resolve":
                return grades.resolve(session_id, request.choice, request.document)
            if request.action == "discard":
                grades.discard_recovery(session_id)
                return {"discarded": True}
            if request.action == "load":
                path = grades.path(session_id)
                state = grades._get(path)
                document = request.document or state["default"]
                session = open_document(store, validate_saved_document(document), marks.source_path(path), reuse_session_id=session_id if request.reuse_source else None)
                new_id = str(session.session_id)
                grades.sessions[new_id] = path
                grades.starts[new_id] = document
                if not request.recovery and not request.preserve_recovery and not state.get("pending") and not state.get("conflict"):
                    state["baseline"] = request.document
                    grades._put(path, state)
                if request.recovery:
                    session.dirty = True
                elif not request.preserve_recovery:
                    grades.discard_recovery(session_id)
                return {"session": session.to_payload()}
        except KeyError as error:
            raise HTTPException(status_code=404, detail="That photo is no longer open.") from error
        except (ValueError, OSError) as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
