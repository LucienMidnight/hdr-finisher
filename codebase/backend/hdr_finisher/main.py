from __future__ import annotations

import atexit
from time import perf_counter
from pathlib import Path
from tempfile import NamedTemporaryFile

import uvicorn
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from .capabilities import probe_capabilities
from .config import APP_NAME, APP_VERSION, DEFAULT_HOST, DEFAULT_PORT, EXPORTS_DIR, FRONTEND_DIR, SAMPLES_DIR
from .exporters import ExportOverwriteRequired, build_export_backends
from .folder_picker import pick_directory
from .loader import LoaderError
from .models import (
    DirectoryPickRequest,
    DirectoryPickResponse,
    BrowserEvidenceRecord,
    BrowserEvidenceResponse,
    EditCommandBatch,
    EditDocument,
    EditStateResponse,
    ExportSettings,
    LocalLuminanceSampleRequest,
    LocalLuminanceSampleResponse,
    LocalMaskPreviewRequest,
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
    SessionSummary,
    SourceInterpretationOverride,
)
from .overlay import encode_processed_overlay_bytes
from .preview import encode_processed_preview_bytes, encode_processed_rgba8
from .render_cache import StaleRender, encode_rgba_proxy
from .display_probe import probe_displays
from .proofing import EvidenceStore, ProofArtifactStore
from .projects import ProjectError, open_project, save_project
from .scopes import build_scope_from_processed
from .sessions import EditCommandError, RevisionConflictError, SessionStore
from .test_pattern import build_delivery_proof_pattern


app = FastAPI(title=APP_NAME, version=APP_VERSION)
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
SAMPLES_DIR.mkdir(parents=True, exist_ok=True)

app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")
app.mount("/samples", StaticFiles(directory=str(SAMPLES_DIR)), name="samples")


def _check_revision(actual_revision: int, expected_revision: int | None) -> None:
    if expected_revision is not None and expected_revision != actual_revision:
        raise RevisionConflictError(expected_revision, actual_revision)


def _resolve_edit_request(session_id: str, adjustments, edit_revision: int | None):
    session = store.get(session_id)
    _check_revision(session.edit_revision, edit_revision)
    if adjustments is not None:
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


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


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
    except (ProjectError, LoaderError, OSError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return SessionSummary(session=session.to_payload())


@app.post("/api/session/{session_id}/preview/{kind}")
def preview(session_id: str, kind: PreviewKind, request: PreviewRequest) -> Response:
    try:
        session, adjustments = _resolve_edit_request(session_id, request.adjustments, request.edit_revision)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RevisionConflictError as exc:
        raise _revision_conflict(exc) from exc

    token = store.next_preview_token(session_id, kind)
    try:
        processed = session.render_cache.adjusted_frame(
            adjustments,
            kind,
            request.long_edge or session.preview.long_edge,
            is_current=lambda: session.preview_tokens[kind] == token,
            local_adjustments=(
                request.local_adjustments
                if request.local_adjustments is not None
                else session.local_adjustments
            ) if request.include_locals else [],
        )
        body, media_type = encode_processed_preview_bytes(processed, kind, hdr_display=request.hdr_display)
    except StaleRender:
        return JSONResponse(status_code=409, content={"detail": "Stale preview request dropped."})
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    if not store.is_preview_current(session_id, kind, token):
        return JSONResponse(status_code=409, content={"detail": "Stale preview request dropped."})
    return Response(content=body, media_type=media_type)


@app.post("/api/session/{session_id}/preview-raw/{kind}")
def preview_raw(session_id: str, kind: PreviewKind, request: PreviewRequest) -> Response:
    """Render ordinary CPU fallback grading directly into a browser canvas."""
    try:
        session, adjustments = _resolve_edit_request(session_id, request.adjustments, request.edit_revision)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RevisionConflictError as exc:
        raise _revision_conflict(exc) from exc

    token = store.next_preview_token(session_id, kind)
    try:
        processed = session.render_cache.adjusted_frame(
            adjustments,
            kind,
            request.long_edge or (768 if kind == PreviewKind.SDR else 960),
            is_current=lambda: session.preview_tokens[kind] == token,
            local_adjustments=(
                request.local_adjustments
                if request.local_adjustments is not None
                else session.local_adjustments
            ) if request.include_locals else [],
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

    try:
        processed = session.render_cache.adjusted_frame(
            adjustments,
            kind,
            request.long_edge or session.preview.long_edge,
            local_adjustments=(
                request.local_adjustments
                if request.local_adjustments is not None
                else session.local_adjustments
            ) if request.include_locals else [],
        )
        body, media_type = encode_processed_overlay_bytes(processed, adjustments, kind)
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
    long_edge: int = Query(default=1600, ge=256, le=2000),
    format: str = Query(default="rgba16f", pattern="^(rgba16f|rgba32f)$"),
) -> Response:
    try:
        session = store.get(session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    proxy, working_space = session.render_cache.source_proxy(kind, long_edge)
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
        },
    )


@app.get("/api/session/{session_id}/local-mask/{local_id}")
def local_mask_proxy(
    session_id: str,
    local_id: str,
    long_edge: int = Query(default=1600, ge=256, le=2000),
    edit_revision: int | None = Query(default=None, ge=0),
    spatial_only: bool = Query(default=False),
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
    started = perf_counter()
    mask = session.render_cache.compiled_local_mask(
        session.adjustments,
        local,
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
    started = perf_counter()
    mask = session.render_cache.compiled_mask_draft(session.adjustments, request.mask, request.long_edge)
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
    try:
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
