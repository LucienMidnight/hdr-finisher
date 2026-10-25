"""Batch commands use Library identities and saved documents, never the live grade."""
from pathlib import Path
from typing import Literal
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from .config import APP_DATA_DIR
from .raw_import import RAW_EXTENSIONS
from .models import SourceInterpretationOverride
from .batch_export import BatchExports
from .export_presets import ExportPreset, ExportPresets

class RunRequest(BaseModel):
    paths: list[str] = Field(min_length=1,max_length=10000)
    preset: ExportPreset
    directory: str
    path_grant: str | None = None
class ControlRequest(BaseModel):
    action: Literal["pause","resume","cancel"]
class PhotosRequest(BaseModel):
    paths: list[str] = Field(max_length=10000)

def create_batch_router(store, grants=None, desktop=False):
    router = APIRouter(prefix="/api")
    def snapshot(path):
        grades = store.library_grades
        marks = grades.marks
        # Match grade saving/status: session first, then Library marks.
        with store._lock, marks._lock:
            key = str(marks._path(path))
            source = marks.source_path(key)
            document = marks._document(Path(key)) or {}
            state = grades._get(key)
            grade = state.get("desired") if state.get("pending") else document.get("grade")
            rows = marks._query("SELECT facts FROM files WHERE path=?", (str(source),))
            import json
            facts = json.loads(rows[0][0]) if rows and rows[0][0] else {}
            current = store.current()
            unsaved = bool(current and grades.sessions.get(str(current.session_id)) == key and current.dirty)
            compatibility = "known" if grade or source.suffix.lower() in RAW_EXTENSIONS else "unknown"
            sdr_only = False
            if not grade and current and current.interpretation_override == SourceInterpretationOverride() and Path(current.source_path).resolve() == source.resolve():
                sdr_only = current.analysis.classification.value == "SDR_ONLY"
                compatibility = "known"
            return {"path":key,"source_path":str(source),"name":document.get("name") or source.name,"copy_name":document.get("name", "") if "|copy|" in key else "",
                    "grade":grade,"rating":document.get("marks",{}).get("rating",0),"capture_time":facts.get("capture_time"),"unsaved":unsaved,
                    "sdr_only":sdr_only,"hdr_compatibility":compatibility}
    queue = BatchExports(snapshot)
    store.batch_exports = queue
    store.batch_export = queue
    def library(directory):
        return ExportPresets((Path(directory).expanduser() if directory else APP_DATA_DIR / "HDR Finisher Presets") / "Export")
    @router.get("/export-presets")
    def presets(directory: str | None = None):
        return {"presets":[p.model_dump(mode="json") for p in library(directory).list()],"directory":str(library(directory).root)}
    @router.post("/export-presets")
    def save(preset: ExportPreset, directory: str | None = None):
        try: return library(directory).save(preset)
        except ValueError as error: raise HTTPException(400,str(error)) from error
    @router.delete("/export-presets/{identity}")
    def delete(identity: str, directory: str | None = None):
        try: library(directory).delete(identity); return {"deleted":True}
        except ValueError as error: raise HTTPException(400,str(error)) from error
    @router.post("/batch-export/photos")
    def photos(request: PhotosRequest):
        try:
            return {"photos":[{k:v for k,v in snapshot(path).items() if k != "grade"} for path in request.paths]}
        except (ValueError,OSError) as error: raise HTTPException(400,str(error)) from error
    @router.post("/batch-export")
    def start(request: RunRequest):
        try:
            if desktop:
                selected = grants.consume(request.path_grant or "", "export-directory")
                if selected != Path(request.directory).resolve(): raise ValueError("The export folder does not match the desktop selection.")
            # Revalidate settings and names before launching any work.
            for version in request.preset.versions:
                from .export_presets import SUFFIXES, render_pattern
                if version.settings.format not in SUFFIXES: raise ValueError("Unsupported export format.")
                render_pattern(version.pattern, {"source_path":"example.raw"}, 1, version.name, request.preset.name)
            return queue.start(request.paths,request.preset,request.directory)
        except (ValueError,OSError) as error: raise HTTPException(400,str(error)) from error
    @router.post("/batch-export/shutdown")
    def shutdown():
        queue.close()
        return {}

    @router.get("/batch-export")
    def jobs():
        with queue.condition: return {"jobs":[queue.status(identity) for identity in queue.jobs]}
    @router.get("/batch-export/{identity}")
    def status(identity: str):
        try: return queue.status(identity)
        except KeyError as error: raise HTTPException(404,"Export job not found.") from error
    @router.post("/batch-export/{identity}")
    def control(identity: str, request: ControlRequest):
        try: return queue.control(identity,request.action)
        except KeyError as error: raise HTTPException(404,"Export job not found.") from error
    return router
