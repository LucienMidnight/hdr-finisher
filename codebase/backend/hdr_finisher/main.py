from __future__ import annotations

import atexit
from pathlib import Path
from tempfile import NamedTemporaryFile

import uvicorn
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from .capabilities import probe_capabilities
from .config import APP_NAME, APP_VERSION, DEFAULT_HOST, DEFAULT_PORT, FRONTEND_DIR, SAMPLES_DIR
from .exporters import build_export_backends
from .folder_picker import pick_directory
from .loader import LoaderError
from .models import (
    DirectoryPickRequest,
    DirectoryPickResponse,
    BrowserEvidenceRecord,
    BrowserEvidenceResponse,
    ExportSettings,
    PreviewKind,
    PreviewRequest,
    ProofArtifactRequest,
    ProofArtifactResponse,
    ProofMatrixRequest,
    ProofMatrixResponse,
    ScopeMode,
    SessionSummary,
    SourceInterpretationOverride,
)
from .overlay import encode_processed_overlay_bytes
from .preview import encode_processed_preview_bytes
from .render_cache import StaleRender, encode_rgba32f_proxy
from .display_probe import probe_displays
from .proofing import EvidenceStore, ProofArtifactStore
from .scopes import build_scope_from_processed
from .sessions import SessionStore
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


@app.post("/api/session/{session_id}/preview/{kind}")
def preview(session_id: str, kind: PreviewKind, request: PreviewRequest) -> Response:
    try:
        session = store.update_adjustments(session_id, request.adjustments)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    token = store.next_preview_token(session_id, kind)
    try:
        processed = session.render_cache.adjusted_frame(
            request.adjustments,
            kind,
            request.long_edge or session.preview.long_edge,
            is_current=lambda: session.preview_tokens[kind] == token,
        )
        body, media_type = encode_processed_preview_bytes(processed, kind, hdr_display=request.hdr_display)
    except StaleRender:
        return JSONResponse(status_code=409, content={"detail": "Stale preview request dropped."})
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    if not store.is_preview_current(session_id, kind, token):
        return JSONResponse(status_code=409, content={"detail": "Stale preview request dropped."})
    return Response(content=body, media_type=media_type)


@app.post("/api/session/{session_id}/overlay/{kind}")
def overlay(session_id: str, kind: PreviewKind, request: PreviewRequest) -> Response:
    try:
        session = store.update_adjustments(session_id, request.adjustments)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    if request.adjustments.shared.overlay_mode == "off":
        return Response(status_code=204)

    try:
        processed = session.render_cache.adjusted_frame(
            request.adjustments,
            kind,
            request.long_edge or session.preview.long_edge,
        )
        body, media_type = encode_processed_overlay_bytes(processed, request.adjustments, kind)
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
):
    try:
        session = store.get(session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    processed = session.render_cache.adjusted_frame(
        session.adjustments,
        kind,
        long_edge,
    )
    return build_scope_from_processed(
        processed,
        kind,
        mode=mode,
        bins=bins,
        waveform_columns=columns,
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
):
    try:
        session = store.update_adjustments(session_id, request.adjustments)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    processed = session.render_cache.adjusted_frame(request.adjustments, kind, long_edge)
    return build_scope_from_processed(
        processed,
        kind,
        mode=mode,
        bins=bins,
        waveform_columns=columns,
    )


@app.get("/api/session/{session_id}/proxy/{kind}")
def webgpu_proxy(
    session_id: str,
    kind: PreviewKind,
    long_edge: int = Query(default=1600, ge=256, le=2000),
) -> Response:
    try:
        session = store.get(session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    proxy, working_space = session.render_cache.source_proxy(kind, long_edge)
    body, bytes_per_row = encode_rgba32f_proxy(proxy)
    height, width = proxy.shape[:2]
    return Response(
        content=body,
        media_type="application/octet-stream",
        headers={
            "X-Image-Width": str(width),
            "X-Image-Height": str(height),
            "X-Bytes-Per-Row": str(bytes_per_row),
            "X-Working-Space": working_space,
        },
    )


@app.post("/api/session/{session_id}/export")
def export(session_id: str, settings: ExportSettings):
    try:
        session = store.get(session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    backend = export_backends.get(settings.format)
    if backend is None:
        raise HTTPException(status_code=400, detail=f"Unsupported export format: {settings.format}")
    result = backend.export(session, settings)
    if not result.accepted:
        return JSONResponse(status_code=501, content=result.model_dump())
    return result


@app.post("/api/session/{session_id}/proof/artifact", response_model=ProofArtifactResponse)
def create_proof_artifact(session_id: str, request: ProofArtifactRequest) -> ProofArtifactResponse:
    try:
        session = store.update_adjustments(session_id, request.adjustments)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    backend = export_backends.get(request.format)
    if backend is None:
        raise HTTPException(status_code=400, detail=f"Unsupported proof format: {request.format}")
    try:
        return proof_store.create(session, request, backend)
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


@app.get("/")
def root() -> HTMLResponse:
    html = (FRONTEND_DIR / "index.html").read_text(encoding="utf-8")
    html = html.replace('/static/styles.css', f'/static/styles.css?v={APP_VERSION}')
    html = html.replace('/static/webgpu-preview.js', f'/static/webgpu-preview.js?v={APP_VERSION}')
    html = html.replace('/static/app.js', f'/static/app.js?v={APP_VERSION}')
    html = html.replace('/static/proofing-ui.js', f'/static/proofing-ui.js?v={APP_VERSION}')
    return HTMLResponse(content=html)


def run() -> None:
    uvicorn.run("hdr_finisher.main:app", host=DEFAULT_HOST, port=DEFAULT_PORT, reload=False)


if __name__ == "__main__":
    run()
