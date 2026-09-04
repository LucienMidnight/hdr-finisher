from __future__ import annotations

import atexit
import json
import os
import secrets
import time
from time import perf_counter
from pathlib import Path
from tempfile import NamedTemporaryFile

import uvicorn
from fastapi import FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from .capabilities import probe_capabilities
from .config import APP_NAME, APP_VERSION, DEFAULT_HOST, DEFAULT_PORT, DOCS_DIR, EXPORTS_DIR, FRONTEND_DIR, SAMPLES_DIR
from .desktop_security import DesktopPathGrants, secret_matches
from .exporters import ExportOverwriteRequired, build_export_backends
from .folder_picker import pick_directory
from .loader import LoaderError
from .media_browser import MediaBrowserError, MediaBrowserInterpretationRequired, MediaBrowserStore
from .import_jobs import ImportJobManager
from .raw_import import list_lens_profiles
from .models import (
    DirectoryPickRequest,
    DirectoryPickResponse,
    DesktopPathGrantRequest,
    DesktopPathGrantResponse,
    DesktopProjectOpenRequest,
    DesktopProjectSaveRequest,
    DesktopSessionOpenRequest,
    BrowserEvidenceRecord,
    BrowserEvidenceResponse,
    EditCommandBatch,
    EditDocument,
    EditStateResponse,
    ExportSettings,
    ExportResponse,
    ExportTargetIdentity,
    FavoritePathRequest,
    GeometryMapRequest,
    GeometryMapResponse,
    PerspectiveSolveRequest,
    PerspectiveSolveResponse,
    ImportJobRequest,
    LocalLuminanceSampleRequest,
    LocalLuminanceSampleResponse,
    LocalMaskPreviewRequest,
    MaskExpression,
    PreviewKind,
    PreviewRequest,
    ProofArtifactRequest,
    ProofArtifactResponse,
    ProofMatrixRequest,
    ProofMatrixResponse,
    ProofReconstructionRequest,
    ProofReconstructionResponse,
    ProjectOpenRequest,
    ProjectResponse,
    ProjectSaveRequest,
    ScopeMode,
    ScopeMaxNits,
    SdrMatchActionRequest,
    SessionSummary,
    SourceInterpretationOverride,
)
from .overlay import encode_processed_overlay_bytes
from .preview import encode_processed_preview_bytes, encode_processed_rgba8
from .render_cache import StaleRender, encode_rgba_proxy
from .finishing import geometry_output_dimensions, perspective_guide_transform, solve_perspective_guides
from .display_probe import probe_displays
from .proofing import EvidenceStore, ProofArtifactStore
from .projects import ProjectError, ProjectSourceRelinkRequired, open_project, save_project
from .resource_preflight import (
    FULL_PREVIEW_BASELINE_DIMENSION,
    detect_memory_resources,
    estimate_preview_resources,
)
from .scopes import build_scope_from_processed
from .sessions import EditCommandError, RevisionConflictError, SessionStore
from .test_pattern import build_delivery_proof_pattern


app = FastAPI(title=APP_NAME, version=APP_VERSION)
desktop_authoring_secret = os.environ.get("HDR_FINISHER_DESKTOP_SECRET")
desktop_control_secret = os.environ.get("HDR_FINISHER_DESKTOP_CONTROL_SECRET")
desktop_path_grants = DesktopPathGrants()
_EXPORT_SUFFIXES = {
    "avif_gain_map": ".avif",
    "jpeg_ultrahdr": ".jpg",
    "jpegxl_hdr": ".jxl",
    "sdr_jpeg": ".jpg",
    "sdr_png": ".png",
    "sdr_jpegxl": ".jxl",
}


def _preview_resource_payload(session, max_dimension: int) -> dict[str, object]:
    estimate = estimate_preview_resources(
        width=int(session.source.width),
        height=int(session.source.height),
        max_dimension=int(max_dimension),
        resources=detect_memory_resources(),
    )
    return {
        "allowed": estimate.allowed,
        "reason": estimate.reason,
        "requested_max_dimension": estimate.requested_max_dimension,
        "width": estimate.width,
        "height": estimate.height,
        "pixel_count": estimate.pixel_count,
        "estimated_peak_bytes": estimate.estimated_peak_bytes,
        "safely_available_bytes": estimate.safely_available_bytes,
    }


def _guard_preview_resources(session, max_dimension: int) -> None:
    if int(max_dimension) <= FULL_PREVIEW_BASELINE_DIMENSION:
        return
    payload = _preview_resource_payload(session, max_dimension)
    if not payload["allowed"]:
        raise HTTPException(status_code=507, detail=payload["reason"])


@app.middleware("http")
async def desktop_request_boundary(request: Request, call_next):
    if desktop_authoring_secret and request.url.path.startswith("/api/"):
        if request.url.path == "/api/desktop/grant":
            allowed = secret_matches(request.headers.get("x-hdr-finisher-control"), desktop_control_secret)
        else:
            allowed = secret_matches(request.headers.get("x-hdr-finisher-token"), desktop_authoring_secret)
        if not allowed:
            return JSONResponse(status_code=401, content={"detail": "Desktop authorization is required."})
    response = await call_next(request)
    if desktop_authoring_secret:
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' blob: data:; connect-src 'self'; worker-src 'self' blob:; "
            "object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
        )
        response.headers["X-Content-Type-Options"] = "nosniff"
    return response


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
store = SessionStore()
atexit.register(store.clear)
capabilities = probe_capabilities()
export_backends = build_export_backends(capabilities)
proof_store = ProofArtifactStore()
evidence_store = EvidenceStore()
media_browser_store = MediaBrowserStore()
import_jobs = ImportJobManager(store, media_browser_store, workers=1)
atexit.register(import_jobs.close)
external_proof_tokens: dict[str, tuple[str, float]] = {}
SAMPLES_DIR.mkdir(parents=True, exist_ok=True)

app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")
if DOCS_DIR.is_dir():
    app.mount("/docs", StaticFiles(directory=str(DOCS_DIR)), name="docs")
app.mount("/samples", StaticFiles(directory=str(SAMPLES_DIR)), name="samples")


def _check_revision(actual_revision: int, expected_revision: int | None) -> None:
    if expected_revision is not None and expected_revision != actual_revision:
        raise RevisionConflictError(expected_revision, actual_revision)


def _matches_approved_export_target(
    path: Path,
    approved: ExportTargetIdentity,
    *,
    platform_name: str | None = None,
) -> bool:
    try:
        stat = path.stat()
    except OSError:
        return False
    current = {
        "device": str(stat.st_dev),
        "inode": str(stat.st_ino),
        "size": str(stat.st_size),
        "modifiedNs": str(stat.st_mtime_ns),
    }
    expected = approved.model_dump()
    # Node and Python expose different st_dev values for the same Windows
    # volume. The file ID, size, and timestamp are stable across both runtimes.
    keys = ("inode", "size", "modifiedNs") if (platform_name or os.name) == "nt" else tuple(current)
    return all(current[key] == expected[key] for key in keys)


def _resolve_edit_request(
    session_id: str,
    adjustments,
    edit_revision: int | None,
    *,
    transient_adjustments: bool = False,
):
    session = store.get(session_id)
    _check_revision(session.edit_revision, edit_revision)
    if adjustments is not None:
        if transient_adjustments:
            return session, adjustments
        # Compatibility bridge while global controls migrate to edit commands.
        # Revision checking still guarantees that locals are never rendered from
        # a stale ordered document.
        if adjustments != session.adjustments:
            session = store.update_adjustments(session_id, adjustments)
            session.render_cache.clear_adjusted()
    return session, session.adjustments


def _revision_conflict(exc: RevisionConflictError) -> HTTPException:
    return HTTPException(
        status_code=409,
        detail={
            "code": "edit_revision_mismatch",
            "message": str(exc),
            "expected_revision": exc.expected,
            "current_revision": exc.actual,
        },
    )


def _mask_expression_at_path(expression: MaskExpression, mask_path: str | None) -> MaskExpression:
    """Return a retained mask-graph node addressed by dot-separated child indexes."""
    if not mask_path:
        return expression
    current = expression
    try:
        indexes = [int(part) for part in mask_path.split(".")]
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Mask path must contain child indexes.") from exc
    for index in indexes:
        if index < 0 or index >= len(current.children):
            raise HTTPException(status_code=422, detail=f"Mask path '{mask_path}' is outside the expression graph.")
        current = current.children[index]
    return current


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": APP_VERSION, "protocol_version": "1"}


@app.post("/api/desktop/grant", response_model=DesktopPathGrantResponse)
def grant_desktop_path(request: DesktopPathGrantRequest) -> DesktopPathGrantResponse:
    try:
        grant, path = desktop_path_grants.issue(request.path, request.intent)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return DesktopPathGrantResponse(grant=grant, path=str(path))


@app.post("/api/desktop/session", response_model=SessionSummary)
def create_desktop_session(request: DesktopSessionOpenRequest) -> SessionSummary:
    try:
        source_path = desktop_path_grants.consume(request.grant, "source-open")
        payload = store.create_session(
            source_path,
            original_filename=source_path.name,
            owns_source_path=False,
            raw_import_settings=request.raw_import_settings,
        )
    except (ValueError, LoaderError, OSError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return SessionSummary(session=payload)


@app.post("/api/import-jobs", status_code=202)
def create_import_job(request: ImportJobRequest) -> dict[str, object]:
    try:
        source_path = desktop_path_grants.consume(request.grant, "source-open")
        if request.replace_session_id is not None:
            current = store.get(request.replace_session_id)
            if current.source_path.resolve() != source_path.resolve():
                raise ValueError("RAW re-development must use the active session source.")
        return import_jobs.start(
            source_path, request.raw_import_settings, replace_session_id=request.replace_session_id
        ).payload()
    except (KeyError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/import-jobs/{job_id}")
def get_import_job(job_id: str) -> dict[str, object]:
    try:
        return import_jobs.get(job_id).payload()
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.delete("/api/import-jobs/{job_id}")
def cancel_import_job(job_id: str) -> dict[str, object]:
    try:
        return import_jobs.cancel(job_id).payload()
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/import-jobs/{job_id}/preview")
def import_job_preview(job_id: str) -> FileResponse:
    try:
        job = import_jobs.get(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    with job.state_lock:
        preview_path = job.preview_path
    if preview_path is None or not preview_path.is_file():
        raise HTTPException(status_code=404, detail="The import preview is not ready.")
    return FileResponse(preview_path, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


@app.post("/api/desktop/project/open", response_model=SessionSummary)
def open_desktop_project(request: DesktopProjectOpenRequest) -> SessionSummary:
    try:
        project_path = desktop_path_grants.resolve(request.project_grant, "project-open")
        source_path = (
            desktop_path_grants.consume(request.source_grant, "source-relink")
            if request.source_grant else None
        )
        session = open_project(store, project_path, source_path)
    except ProjectSourceRelinkRequired as exc:
        raise HTTPException(
            status_code=409,
            detail={"code": "source_relink_required", "message": str(exc)},
        ) from exc
    except (ValueError, ProjectError, LoaderError, OSError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return SessionSummary(session=session.to_payload())


@app.post("/api/desktop/session/{session_id}/project/save", response_model=ProjectResponse)
def save_desktop_project(session_id: str, request: DesktopProjectSaveRequest) -> ProjectResponse:
    try:
        project_path = desktop_path_grants.consume(request.project_grant, "project-save")
        return save_project(store.get(session_id), project_path)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (ValueError, ProjectError, OSError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/capabilities")
def api_capabilities() -> dict[str, object]:
    return {"capabilities": capabilities}


@app.post("/api/session")
async def create_session(file: UploadFile = File(...)) -> SessionSummary:
    suffix = Path(file.filename or "").suffix
    temp_path: Path | None = None
    transferred = False
    try:
        with NamedTemporaryFile(delete=False, suffix=suffix) as temp:
            temp_path = Path(temp.name)
            while chunk := await file.read(1024 * 1024):
                temp.write(chunk)
        payload = store.create_session(
            temp_path,
            original_filename=file.filename,
            owns_source_path=True,
        )
        transferred = True
    except LoaderError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        if temp_path is not None and not transferred:
            temp_path.unlink(missing_ok=True)
    return SessionSummary(session=payload)


@app.get("/api/session/{session_id}")
def get_session(session_id: str) -> SessionSummary:
    try:
        session = store.get(session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return SessionSummary(session=session.to_payload())


@app.delete("/api/session/current")
def clear_session() -> dict[str, str]:
    store.clear()
    return {"status": "cleared"}


@app.post("/api/session/{session_id}/interpretation")
def update_interpretation(session_id: str, override: SourceInterpretationOverride) -> SessionSummary:
    try:
        session = store.update_source_interpretation(session_id, override)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except LoaderError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return SessionSummary(session=session.to_payload())


@app.get("/api/session/{session_id}/edit-state", response_model=EditStateResponse)
def get_edit_state(session_id: str) -> EditStateResponse:
    try:
        return store.edit_state(session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.put("/api/session/{session_id}/edit-state", response_model=EditStateResponse)
def put_edit_state(
    session_id: str,
    document: EditDocument,
    expected_revision: int = Query(ge=0),
) -> EditStateResponse:
    try:
        return store.replace_edit_document(session_id, document, expected_revision)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RevisionConflictError as exc:
        raise _revision_conflict(exc) from exc
    except (EditCommandError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/session/{session_id}/edit-commands", response_model=EditStateResponse)
def post_edit_commands(session_id: str, batch: EditCommandBatch) -> EditStateResponse:
    try:
        return store.apply_edit_commands(session_id, batch.commands)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RevisionConflictError as exc:
        raise _revision_conflict(exc) from exc
    except (EditCommandError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/session/{session_id}/sdr-match", response_model=EditStateResponse)
def post_sdr_match(session_id: str, request: SdrMatchActionRequest) -> EditStateResponse:
    try:
        return store.apply_sdr_match_action(
            session_id,
            expected_revision=request.expected_revision,
            action=request.action,
            authored_sdr_override_consent=request.authored_sdr_override_consent,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RevisionConflictError as exc:
        raise _revision_conflict(exc) from exc
    except (EditCommandError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/session/{session_id}/project/save", response_model=ProjectResponse)
def save_project_file(session_id: str, request: ProjectSaveRequest) -> ProjectResponse:
    try:
        session = store.get(session_id)
        return save_project(
            session,
            Path(request.path),
            Path(request.source_path) if request.source_path else None,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (ProjectError, OSError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/project/open", response_model=SessionSummary)
def open_project_file(request: ProjectOpenRequest) -> SessionSummary:
    try:
        session = open_project(
            store,
            Path(request.path),
            Path(request.source_path) if request.source_path else None,
        )
    except ProjectSourceRelinkRequired as exc:
        raise HTTPException(
            status_code=409,
            detail={"code": "source_relink_required", "message": str(exc)},
        ) from exc
    except (ProjectError, LoaderError, OSError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return SessionSummary(session=session.to_payload())


@app.post("/api/session/{session_id}/preview/{kind}")
def preview(session_id: str, kind: PreviewKind, request: PreviewRequest) -> Response:
    if request.transient_adjustments and request.adjustments is None:
        raise HTTPException(status_code=422, detail="Transient preview adjustments are required.")
    try:
        session, adjustments = _resolve_edit_request(
            session_id,
            request.adjustments,
            request.edit_revision,
            transient_adjustments=request.transient_adjustments,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RevisionConflictError as exc:
        raise _revision_conflict(exc) from exc

    preview_long_edge = request.long_edge or session.preview.long_edge
    _guard_preview_resources(session, preview_long_edge)
    token = store.next_preview_token(session_id, kind)
    try:
        processed = session.render_cache.adjusted_frame(
            adjustments,
            kind,
            preview_long_edge,
            is_current=lambda: session.preview_tokens[kind] == token,
            local_adjustments=(
                request.local_adjustments
                if request.local_adjustments is not None
                else session.local_adjustments
            ) if request.include_locals else [],
            sdr_match=session.sdr_match,
        )
        body, media_type = encode_processed_preview_bytes(
            processed,
            kind,
            hdr_display=request.hdr_display,
            reference_white_nits=session.hdr_reference_white_nits,
        )
    except StaleRender:
        return JSONResponse(status_code=409, content={"detail": "Stale preview request dropped."})
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    if not store.is_preview_current(session_id, kind, token):
        return JSONResponse(status_code=409, content={"detail": "Stale preview request dropped."})
    return Response(content=body, media_type=media_type)


@app.get("/api/session/{session_id}/preview-preflight")
def preview_preflight(
    session_id: str,
    max_dimension: int = Query(ge=256, le=100_000),
) -> dict[str, object]:
    try:
        session = store.get(session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _preview_resource_payload(session, max_dimension)


@app.post("/api/session/{session_id}/preview-raw/{kind}")
def preview_raw(session_id: str, kind: PreviewKind, request: PreviewRequest) -> Response:
    """Render ordinary CPU fallback grading directly into a browser canvas."""
    try:
        session, adjustments = _resolve_edit_request(session_id, request.adjustments, request.edit_revision)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RevisionConflictError as exc:
        raise _revision_conflict(exc) from exc

    preview_long_edge = request.long_edge or (768 if kind == PreviewKind.SDR else 960)
    _guard_preview_resources(session, preview_long_edge)
    token = store.next_preview_token(session_id, kind)
    try:
        processed = session.render_cache.adjusted_frame(
            adjustments,
            kind,
            preview_long_edge,
            is_current=lambda: session.preview_tokens[kind] == token,
            local_adjustments=(
                request.local_adjustments
                if request.local_adjustments is not None
                else session.local_adjustments
            ) if request.include_locals else [],
            sdr_match=session.sdr_match,
        )
        body = encode_processed_rgba8(processed, kind)
    except StaleRender:
        return JSONResponse(status_code=409, content={"detail": "Stale raw preview request dropped."})
    if not store.is_preview_current(session_id, kind, token):
        return JSONResponse(status_code=409, content={"detail": "Stale raw preview request dropped."})
    height, width = processed.shape[:2]
    return Response(
        content=body,
        media_type="application/octet-stream",
        headers={
            "X-Image-Width": str(width),
            "X-Image-Height": str(height),
            "X-Generation": str(request.generation if request.generation is not None else token),
            "X-Preview-Lane": kind.value,
            "X-Display-Interpretation": "srgb-rgba8",
            "X-Cache-Identity": f"{session_id}:{kind.value}:{token}",
        },
    )


@app.post("/api/session/{session_id}/overlay/{kind}")
def overlay(session_id: str, kind: PreviewKind, request: PreviewRequest) -> Response:
    try:
        session, adjustments = _resolve_edit_request(session_id, request.adjustments, request.edit_revision)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RevisionConflictError as exc:
        raise _revision_conflict(exc) from exc

    if adjustments.shared.overlay_mode == "off":
        return Response(status_code=204)

    preview_long_edge = request.long_edge or session.preview.long_edge
    _guard_preview_resources(session, preview_long_edge)
    try:
        processed = session.render_cache.adjusted_frame(
            adjustments,
            kind,
            preview_long_edge,
            local_adjustments=(
                request.local_adjustments
                if request.local_adjustments is not None
                else session.local_adjustments
            ) if request.include_locals else [],
            sdr_match=session.sdr_match,
        )
        body, media_type = encode_processed_overlay_bytes(processed, adjustments, kind, session.color_context)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return Response(content=body, media_type=media_type)


@app.get("/api/session/{session_id}/scopes")
def scopes(
    session_id: str,
    kind: PreviewKind = PreviewKind.HDR,
    mode: ScopeMode = ScopeMode.HISTOGRAM,
    bins: int | None = Query(default=None, ge=32, le=384),
    columns: int = Query(default=512, ge=64, le=1024),
    long_edge: int = Query(default=960, ge=256, le=2000),
    max_nits: ScopeMaxNits = Query(default=ScopeMaxNits.NITS_4000),
    channels: str = Query(default="all", pattern="^(all|rgb|luma)$"),
    edit_revision: int | None = Query(default=None, ge=0),
):
    try:
        session = store.get(session_id)
        _check_revision(session.edit_revision, edit_revision)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RevisionConflictError as exc:
        raise _revision_conflict(exc) from exc
    return session.render_cache.scope_result(
        session.adjustments,
        kind,
        long_edge,
        mode.value,
        bins or 256,
        columns,
        int(max_nits.value),
        local_adjustments=session.local_adjustments,
        channel_names=("R", "G", "B") if channels == "rgb" else (("Y",) if channels == "luma" else None),
        sdr_match=session.sdr_match,
    )


@app.post("/api/session/{session_id}/scopes")
def scopes_for_adjustments(
    session_id: str,
    request: PreviewRequest,
    kind: PreviewKind = PreviewKind.HDR,
    mode: ScopeMode = ScopeMode.HISTOGRAM,
    bins: int | None = Query(default=None, ge=32, le=384),
    columns: int = Query(default=512, ge=64, le=1024),
    long_edge: int = Query(default=960, ge=256, le=2000),
    max_nits: ScopeMaxNits = Query(default=ScopeMaxNits.NITS_4000),
    channels: str = Query(default="all", pattern="^(all|rgb|luma)$"),
):
    try:
        session, adjustments = _resolve_edit_request(session_id, request.adjustments, request.edit_revision)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RevisionConflictError as exc:
        raise _revision_conflict(exc) from exc
    token = store.next_scope_token(session_id, kind)
    try:
        result = session.render_cache.scope_result(
            adjustments,
            kind,
            long_edge,
            mode.value,
            bins or 256,
            columns,
            int(max_nits.value),
            is_current=lambda: session.scope_tokens[kind] == token,
            local_adjustments=(
                request.local_adjustments
                if request.local_adjustments is not None
                else session.local_adjustments
            ) if request.include_locals else [],
            channel_names=("R", "G", "B") if channels == "rgb" else (("Y",) if channels == "luma" else None),
            scope_region=(
                request.scope_region.x,
                request.scope_region.y,
                request.scope_region.width,
                request.scope_region.height,
            ) if request.scope_region is not None else None,
            sdr_match=session.sdr_match,
        )
    except StaleRender:
        return JSONResponse(status_code=409, content={"detail": "Stale scope request dropped."})
    result.tier = request.tier
    result.generation = request.generation
    return result


@app.get("/api/session/{session_id}/proxy/{kind}")
def webgpu_proxy(
    session_id: str,
    kind: PreviewKind,
    long_edge: int = Query(default=1600, ge=256, le=16384),
    format: str = Query(default="rgba16f", pattern="^(rgba16f|rgba32f)$"),
    edit_revision: int | None = Query(default=None, ge=0),
    geometry_signature: str | None = Query(default=None),
) -> Response:
    try:
        session = store.get(session_id)
        _check_revision(session.edit_revision, edit_revision)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RevisionConflictError as exc:
        raise _revision_conflict(exc) from exc
    _guard_preview_resources(session, long_edge)
    proxy, working_space, authoritative_geometry_signature = session.render_cache.geometry_source_proxy(
        kind,
        long_edge,
        session.adjustments,
        session.sdr_match,
    )
    if geometry_signature is not None:
        try:
            requested_geometry = json.loads(geometry_signature)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=400, detail="Invalid geometry signature.") from exc
        authoritative_geometry = session.adjustments.shared.geometry.model_dump(mode="json")
        if requested_geometry != authoritative_geometry:
            raise HTTPException(status_code=409, detail="Stale geometry proxy request dropped.")
        accepted_geometry_signature = geometry_signature
    else:
        accepted_geometry_signature = authoritative_geometry_signature
    body, bytes_per_row, pixel_format = encode_rgba_proxy(proxy, prefer_half=format == "rgba16f")
    height, width = proxy.shape[:2]
    return Response(
        content=body,
        media_type="application/octet-stream",
        headers={
            "X-Image-Width": str(width),
            "X-Image-Height": str(height),
            "X-Bytes-Per-Row": str(bytes_per_row),
            "X-Working-Space": working_space,
            "X-Pixel-Format": pixel_format,
            "X-Geometry-Signature": accepted_geometry_signature,
            "X-Edit-Revision": str(session.edit_revision),
        },
    )


@app.get("/api/session/{session_id}/local-mask/{local_id}")
def local_mask_proxy(
    session_id: str,
    local_id: str,
    long_edge: int = Query(default=1600, ge=256, le=16384),
    edit_revision: int | None = Query(default=None, ge=0),
    geometry_signature: str | None = Query(default=None),
    spatial_only: bool = Query(default=False),
    mask_path: str | None = Query(default=None, pattern=r"^\d+(?:\.\d+)*$"),
) -> Response:
    try:
        session = store.get(session_id)
        _check_revision(session.edit_revision, edit_revision)
        local = next(item for item in session.local_adjustments if item.id == local_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except StopIteration as exc:
        raise HTTPException(status_code=404, detail=f"Local adjustment '{local_id}' was not found.") from exc
    except RevisionConflictError as exc:
        raise _revision_conflict(exc) from exc
    if geometry_signature is not None:
        try:
            requested_geometry = json.loads(geometry_signature)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=400, detail="Invalid geometry signature.") from exc
        authoritative_geometry = session.adjustments.shared.geometry.model_dump(mode="json")
        if requested_geometry != authoritative_geometry:
            raise HTTPException(status_code=409, detail="Stale local mask geometry request dropped.")
    _guard_preview_resources(session, long_edge)
    selected_mask = _mask_expression_at_path(local.mask, mask_path)
    mask_source = local.model_copy(
        update={
            "id": f"{local.id}:{mask_path}" if mask_path else local.id,
            "mask": selected_mask,
        },
        deep=True,
    )
    started = perf_counter()
    mask = session.render_cache.compiled_local_mask(
        session.adjustments,
        mask_source,
        long_edge,
        spatial_only=spatial_only,
    )
    cpu_mask_ms = (perf_counter() - started) * 1000.0
    height, width = mask.shape
    return Response(
        content=mask.tobytes(order="C"),
        media_type="application/octet-stream",
        headers={
            "X-Image-Width": str(width),
            "X-Image-Height": str(height),
            "X-Pixel-Format": "r8unorm",
            "X-Local-Adjustment": local.id,
            "X-Mask-Path": mask_path or "root",
            "X-Geometry-Signature": geometry_signature or session.adjustments.shared.geometry.model_dump_json(),
            "X-CPU-Mask-Ms": f"{cpu_mask_ms:.3f}",
            "X-Mask-Content": "spatial" if spatial_only else "influence",
        },
    )


@app.post("/api/session/{session_id}/local-mask/{local_id}/preview")
def local_mask_preview_proxy(
    session_id: str,
    local_id: str,
    request: LocalMaskPreviewRequest,
) -> Response:
    """Compile a live mask-control draft without changing edit history."""
    try:
        session = store.get(session_id)
        _check_revision(session.edit_revision, request.edit_revision)
        next(item for item in session.local_adjustments if item.id == local_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except StopIteration as exc:
        raise HTTPException(status_code=404, detail=f"Local adjustment '{local_id}' was not found.") from exc
    except RevisionConflictError as exc:
        raise _revision_conflict(exc) from exc
    _guard_preview_resources(session, request.long_edge)
    started = perf_counter()
    mask = session.render_cache.compiled_mask_draft(
        request.adjustments or session.adjustments,
        request.mask,
        request.long_edge,
    )
    cpu_mask_ms = (perf_counter() - started) * 1000.0
    height, width = mask.shape
    return Response(
        content=mask.tobytes(order="C"),
        media_type="application/octet-stream",
        headers={
            "X-Image-Width": str(width),
            "X-Image-Height": str(height),
            "X-Pixel-Format": "r8unorm",
            "X-Local-Adjustment": local_id,
            "X-Mask-Preview": "draft",
            "X-CPU-Mask-Ms": f"{cpu_mask_ms:.3f}",
        },
    )


@app.post(
    "/api/session/{session_id}/geometry-map",
    response_model=GeometryMapResponse,
)
def geometry_map(session_id: str, request: GeometryMapRequest) -> GeometryMapResponse:
    """Return the cached bidirectional map used by source-anchored editor tools."""
    try:
        session = store.get(session_id)
        _check_revision(session.edit_revision, request.edit_revision)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RevisionConflictError as exc:
        raise _revision_conflict(exc) from exc
    _guard_preview_resources(session, request.long_edge)
    adjustments = request.adjustments or session.adjustments
    output_to_source, source_to_output, width, height = session.render_cache.geometry_map(
        adjustments,
        request.long_edge,
    )
    full_width, full_height = geometry_output_dimensions(session.source.width, session.source.height, adjustments.shared.geometry)
    return GeometryMapResponse(
        geometry_signature=adjustments.shared.geometry.model_dump_json(),
        output_to_source=list(output_to_source),
        source_to_output=list(source_to_output),
        output_width=width,
        output_height=height,
        full_output_width=full_width,
        full_output_height=full_height,
    )


@app.post(
    "/api/session/{session_id}/perspective-solve",
    response_model=PerspectiveSolveResponse,
)
def perspective_solve(session_id: str, request: PerspectiveSolveRequest) -> PerspectiveSolveResponse:
    """Solve a manual guided correction without mutating session state."""
    try:
        session = store.get(session_id)
        _check_revision(session.edit_revision, request.edit_revision)
        source, _working_space = session.render_cache.source_proxy(PreviewKind.HDR, 512)
        horizontal, vertical, perspective_rotate, residual = solve_perspective_guides(
            source.shape[1],
            source.shape[0],
            request.adjustments.shared.geometry,
            request.vertical_guides,
            request.horizontal_guides,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RevisionConflictError as exc:
        raise _revision_conflict(exc) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    solved_geometry = request.adjustments.shared.geometry.model_copy(update={
        "perspective_horizontal": horizontal,
        "perspective_vertical": vertical,
        "perspective_rotate": perspective_rotate,
    })
    return PerspectiveSolveResponse(
        perspective_horizontal=horizontal,
        perspective_vertical=vertical,
        perspective_rotate=perspective_rotate,
        residual_degrees=residual,
        guide_transform=list(perspective_guide_transform(
            source.shape[1], source.shape[0], request.adjustments.shared.geometry, solved_geometry,
        )),
    )


@app.post(
    "/api/session/{session_id}/local-luminance-sample",
    response_model=LocalLuminanceSampleResponse,
)
def local_luminance_sample(
    session_id: str,
    request: LocalLuminanceSampleRequest,
) -> LocalLuminanceSampleResponse:
    try:
        session = store.get(session_id)
        _check_revision(session.edit_revision, request.edit_revision)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RevisionConflictError as exc:
        raise _revision_conflict(exc) from exc
    _guard_preview_resources(session, request.long_edge)
    low, high, center, count = session.render_cache.sample_luminance(
        session.adjustments,
        request.points,
        request.long_edge,
    )
    return LocalLuminanceSampleResponse(
        low_ev=low,
        high_ev=high,
        center_ev=center,
        sample_count=count,
    )


@app.get("/api/session/{session_id}/diagnostics")
def session_diagnostics(session_id: str) -> dict[str, object]:
    try:
        session = store.get(session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"render_cache": session.render_cache.diagnostics()}


@app.post("/api/session/{session_id}/export")
def export(session_id: str, settings: ExportSettings):
    try:
        session = store.get(session_id)
        _check_revision(session.edit_revision, settings.edit_revision)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RevisionConflictError as exc:
        raise _revision_conflict(exc) from exc

    backend = export_backends.get(settings.format)
    if backend is None:
        raise HTTPException(status_code=400, detail=f"Unsupported export format: {settings.format}")
    if session.metadata.get("experimental_dng_import"):
        from .resource_preflight import detect_memory_resources, estimate_resources

        height, width = session.image.shape[:2]
        finishing = settings.output_finishing
        if finishing.resize_mode == "long_edge" and finishing.long_edge:
            scale = min(1.0, float(finishing.long_edge) / max(width, height))
            width, height = max(1, round(width * scale)), max(1, round(height * scale))
        elif finishing.resize_mode == "fit" and finishing.width and finishing.height:
            scale = min(1.0, finishing.width / width, finishing.height / height)
            width, height = max(1, round(width * scale)), max(1, round(height * scale))
        estimate = estimate_resources(
            width=width,
            height=height,
            samples=3,
            bytes_per_sample=4,
            resources=detect_memory_resources(),
        )
        error = estimate.export_error(width, height)
        if error is not None:
            return JSONResponse(
                status_code=507,
                content=ExportResponse(
                    accepted=False,
                    backend=getattr(backend, "name", settings.format),
                    message=error,
                    output_path=settings.output_path,
                ).model_dump(),
            )
    if desktop_authoring_secret:
        try:
            if not settings.path_grant:
                raise ValueError("Choose an export filename using the desktop Save dialog.")
            granted_path = desktop_path_grants.resolve(settings.path_grant, "export-file")
            if settings.output_path and Path(settings.output_path).expanduser().resolve(strict=False) != granted_path:
                raise ValueError("The export filename does not match the desktop selection.")
            expected_suffix = _EXPORT_SUFFIXES.get(settings.format)
            if expected_suffix is not None and granted_path.suffix.lower() != expected_suffix:
                raise ValueError(
                    f"The selected filename must end in {expected_suffix} for {settings.format} export."
                )
            settings = settings.model_copy(update={"output_path": str(granted_path)})
            if settings.overwrite and settings.overwrite_target is not None and granted_path.exists():
                if not _matches_approved_export_target(granted_path, settings.overwrite_target):
                    # Native approval applied to a different file. Let the
                    # exporter raise the normal authoritative overwrite prompt.
                    settings = settings.model_copy(update={"overwrite": False, "overwrite_target": None})
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    try:
        export_started = perf_counter()
        result = backend.export(session, settings)
    except ExportOverwriteRequired as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "overwrite_required",
                "message": f"A file named {exc.output_path.name} already exists. Replace it?",
                "output_path": str(exc.output_path),
            },
        ) from exc
    result.timings_ms.setdefault("total", round((perf_counter() - export_started) * 1000.0, 3))
    if not result.accepted:
        return JSONResponse(status_code=501, content=result.model_dump())
    return result


@app.post("/api/session/{session_id}/proof/artifact", response_model=ProofArtifactResponse)
def create_proof_artifact(session_id: str, request: ProofArtifactRequest) -> ProofArtifactResponse:
    try:
        session, adjustments = _resolve_edit_request(session_id, request.adjustments, request.edit_revision)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RevisionConflictError as exc:
        raise _revision_conflict(exc) from exc
    backend = export_backends.get(request.format)
    if backend is None:
        raise HTTPException(status_code=400, detail=f"Unsupported proof format: {request.format}")
    try:
        return proof_store.create(session, request.model_copy(update={"adjustments": adjustments}), backend)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=501, detail=str(exc)) from exc


@app.get("/api/proof/artifact/{artifact_name}")
def proof_artifact(artifact_name: str, mime: str | None = Query(default=None)) -> FileResponse:
    artifact_id = Path(artifact_name).stem
    try:
        artifact = proof_store.artifact(artifact_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    media_type = "application/octet-stream" if mime == "wrong" else artifact.media_type
    return FileResponse(
        artifact.path,
        media_type=media_type,
        headers={
            "Cache-Control": "public, max-age=31536000, immutable",
            "ETag": f'"{artifact.sha256}"',
            "X-Content-SHA256": artifact.sha256,
            "X-HDR-Finisher-Format": artifact.format,
        },
    )


@app.post("/api/proof/external/{artifact_id}")
def create_external_proof_url(artifact_id: str) -> dict[str, str]:
    try:
        proof_store.artifact(artifact_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    token = secrets.token_urlsafe(24)
    external_proof_tokens[token] = (artifact_id, time.monotonic() + 15 * 60)
    return {"url": f"/proof/{token}"}


def _external_proof_artifact(token: str):
    record = external_proof_tokens.get(token)
    if record is None or record[1] <= time.monotonic():
        external_proof_tokens.pop(token, None)
        raise HTTPException(status_code=404, detail="This proof link has expired.")
    try:
        return proof_store.artifact(record[0])
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/proof/{token}")
def external_proof_page(token: str) -> HTMLResponse:
    artifact = _external_proof_artifact(token)
    label = "AVIF gain map" if artifact.format == "avif_gain_map" else "JPEG Ultra HDR"
    html = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>HDR Finisher Delivery Proof</title><style>
html,body{{margin:0;min-height:100%;background:#0d1011;color:#eef2f2;font:14px system-ui,sans-serif}}
main{{display:grid;min-height:100vh;place-items:center;padding:24px;box-sizing:border-box}}
figure{{margin:0;max-width:100%;text-align:center}}img{{display:block;max-width:100%;max-height:calc(100vh - 90px);object-fit:contain}}
figcaption{{padding-top:12px;color:#b9c3c3}}
</style></head><body><main><figure><img src="/proof/{token}/media" alt="HDR Finisher delivery proof">
<figcaption>{label} · read-only browser proof · link expires after 15 minutes</figcaption></figure></main></body></html>"""
    return HTMLResponse(html, headers={"Cache-Control": "no-store"})


@app.get("/proof/{token}/media")
def external_proof_media(token: str) -> FileResponse:
    artifact = _external_proof_artifact(token)
    return FileResponse(artifact.path, media_type=artifact.media_type, filename=artifact.path.name)


@app.post("/api/proof/matrix", response_model=ProofMatrixResponse)
def proof_matrix(request: ProofMatrixRequest) -> ProofMatrixResponse:
    try:
        return proof_store.matrix(request.artifact_id, request.display_headroom)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=501, detail=str(exc)) from exc


@app.post("/api/proof/reconstruction", response_model=ProofReconstructionResponse)
def proof_reconstruction(request: ProofReconstructionRequest) -> ProofReconstructionResponse:
    telemetry = probe_displays()
    displays = telemetry.get("displays")
    try:
        return proof_store.reconstruction(request, displays if isinstance(displays, list) else [])
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=501, detail=str(exc)) from exc


@app.get("/api/proof/tile/{tile_name}")
def proof_tile(tile_name: str) -> FileResponse:
    tile_id = Path(tile_name).stem
    try:
        tile = proof_store.tile(tile_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return FileResponse(
        tile.path,
        media_type=tile.media_type,
        headers={"Cache-Control": "public, max-age=31536000, immutable", "ETag": f'"{tile.tile_id}"'},
    )


@app.get("/api/display")
def display_telemetry() -> dict[str, object]:
    return probe_displays()


@app.get("/api/proof/test-pattern")
def delivery_test_pattern() -> Response:
    try:
        import tifffile
        from io import BytesIO

        buffer = BytesIO()
        tifffile.imwrite(buffer, build_delivery_proof_pattern(), photometric="rgb")
        return Response(
            content=buffer.getvalue(),
            media_type="image/tiff",
            headers={"Content-Disposition": 'inline; filename="hdr_delivery_proof_pattern.tiff"'},
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not generate the delivery test pattern: {exc}") from exc


@app.get("/api/proof/evidence", response_model=BrowserEvidenceResponse)
def list_proof_evidence() -> BrowserEvidenceResponse:
    return evidence_store.list()


@app.post("/api/proof/evidence", response_model=BrowserEvidenceResponse)
def add_proof_evidence(record: BrowserEvidenceRecord) -> BrowserEvidenceResponse:
    try:
        proof_store.artifact(record.artifact_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return evidence_store.add(record)


@app.post("/api/export-directory")
def export_directory(request: DirectoryPickRequest) -> DirectoryPickResponse:
    try:
        directory = pick_directory(request.initial_directory)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return DirectoryPickResponse(directory=directory)


@app.get("/api/export-directory/default", response_model=DirectoryPickResponse)
def default_export_directory() -> DirectoryPickResponse:
    EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
    return DirectoryPickResponse(directory=str(EXPORTS_DIR.resolve()))


@app.get("/api/export-directories")
def list_export_directories(path: str | None = Query(default=None)) -> dict[str, object]:
    requested = Path(path).expanduser() if path else EXPORTS_DIR
    try:
        current = requested.resolve(strict=True)
    except (OSError, RuntimeError) as exc:
        raise HTTPException(status_code=400, detail=f"Folder is not available: {requested}") from exc
    if not current.is_dir():
        raise HTTPException(status_code=400, detail=f"Not a folder: {current}")
    try:
        entries = []
        for child in sorted(current.iterdir(), key=lambda candidate: (not candidate.is_dir(), candidate.name.casefold())):
            if child.is_dir():
                entries.append({"name": child.name, "path": str(child.resolve()), "kind": "directory"})
            elif child.is_file():
                entries.append({"name": child.name, "path": str(child.resolve()), "kind": "file"})
    except OSError as exc:
        raise HTTPException(status_code=400, detail=f"Could not read folder: {current}") from exc
    parent = None if current.parent == current else str(current.parent)
    directories = [entry for entry in entries if entry["kind"] == "directory"]
    return {"current": str(current), "parent": parent, "entries": entries, "directories": directories}


@app.get("/api/media-browser")
def media_browser(path: str | None = Query(default=None), mode: str = Query(default="source")) -> dict[str, object]:
    try:
        return media_browser_store.list_directory(path, mode)
    except MediaBrowserError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/media-browser/thumbnail")
def media_browser_thumbnail(path: str = Query(), size: int = Query(default=256, ge=64, le=512)) -> FileResponse:
    try:
        thumbnail = media_browser_store.thumbnail(path, size)
    except MediaBrowserInterpretationRequired as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "interpretation_required",
                "message": str(exc),
                "reason": exc.reason,
                "profile_name": exc.profile_name,
            },
        ) from exc
    except (MediaBrowserError, OSError, RuntimeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return FileResponse(thumbnail, media_type="image/jpeg", headers={"Cache-Control": "private, no-cache"})


@app.get("/api/media-browser/favorites")
def media_browser_favorites() -> dict[str, object]:
    return {"favorites": media_browser_store.pinned()}


@app.post("/api/media-browser/favorites")
def add_media_browser_favorite(request: FavoritePathRequest) -> dict[str, object]:
    try:
        return {"favorites": media_browser_store.add_pin(request.path)}
    except MediaBrowserError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.delete("/api/media-browser/favorites")
def remove_media_browser_favorite(path: str = Query()) -> dict[str, object]:
    return {"favorites": media_browser_store.remove_pin(path)}


@app.get("/api/media-browser/pinned")
def media_browser_pinned() -> dict[str, object]:
    return {"pinned": media_browser_store.pinned()}


@app.post("/api/media-browser/pinned")
def add_media_browser_pin(request: FavoritePathRequest) -> dict[str, object]:
    try:
        return {"pinned": media_browser_store.add_pin(request.path)}
    except MediaBrowserError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.delete("/api/media-browser/pinned")
def remove_media_browser_pin(path: str = Query()) -> dict[str, object]:
    return {"pinned": media_browser_store.remove_pin(path)}


@app.post("/api/media-browser/recents")
def record_media_browser_import(request: FavoritePathRequest) -> dict[str, object]:
    try:
        return {"recents": media_browser_store.record_import(request.path)}
    except MediaBrowserError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/lens-profiles")
def lens_profiles(q: str | None = Query(default=None), limit: int = Query(default=250, ge=1, le=1000)) -> dict[str, object]:
    profiles = [profile.as_dict() for profile in list_lens_profiles(q, limit)]
    return {"profiles": profiles, "available": capabilities["lens_correction"].status == "available"}


@app.get("/")
def root() -> HTMLResponse:
    html = (FRONTEND_DIR / "index.html").read_text(encoding="utf-8")
    html = html.replace("__HDR_FINISHER_ASSET_VERSION__", APP_VERSION)
    return HTMLResponse(content=html, headers={"Cache-Control": "no-store"})


@app.get("/launcher")
def launcher() -> HTMLResponse:
    html = (FRONTEND_DIR / "launcher.html").read_text(encoding="utf-8")
    return HTMLResponse(content=html.replace("__HDR_FINISHER_VERSION__", APP_VERSION))


def run() -> None:
    uvicorn.run("hdr_finisher.main:app", host=DEFAULT_HOST, port=DEFAULT_PORT, reload=False)


if __name__ == "__main__":
    run()
