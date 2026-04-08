from __future__ import annotations

from pathlib import Path
from tempfile import NamedTemporaryFile

import uvicorn
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from .capabilities import probe_capabilities
from .config import APP_NAME, APP_VERSION, DEFAULT_HOST, DEFAULT_PORT, FRONTEND_DIR, SAMPLES_DIR
from .exporters import build_export_backends
from .loader import LoaderError
from .models import ExportSettings, PreviewKind, PreviewRequest, ScopeMode, SessionSummary, SourceInterpretationOverride
from .overlay import render_overlay_bytes
from .preview import render_preview_bytes
from .scopes import build_scope
from .sessions import SessionStore


app = FastAPI(title=APP_NAME, version=APP_VERSION)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
store = SessionStore()
capabilities = probe_capabilities()
export_backends = build_export_backends(capabilities)
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
    with NamedTemporaryFile(delete=False, suffix=suffix) as temp:
        temp.write(await file.read())
        temp_path = Path(temp.name)

    try:
        payload = store.create_session(temp_path)
    except LoaderError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
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
        body, media_type = render_preview_bytes(
            session.image,
            request.adjustments,
            kind,
            session.preview.long_edge,
            sdr_reference_image=session.sdr_reference_image,
        )
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
        body, media_type = render_overlay_bytes(
            session.image,
            request.adjustments,
            kind,
            session.preview.long_edge,
            sdr_reference_image=session.sdr_reference_image,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return Response(content=body, media_type=media_type)


@app.get("/api/session/{session_id}/scopes")
def scopes(session_id: str, kind: PreviewKind = PreviewKind.HDR, mode: ScopeMode = ScopeMode.HISTOGRAM):
    try:
        session = store.get(session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return build_scope(session.image, session.adjustments, kind, mode, sdr_reference_image=session.sdr_reference_image)


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


@app.get("/")
def root() -> HTMLResponse:
    html = (FRONTEND_DIR / "index.html").read_text(encoding="utf-8")
    html = html.replace('/static/styles.css', f'/static/styles.css?v={APP_VERSION}')
    html = html.replace('/static/app.js', f'/static/app.js?v={APP_VERSION}')
    return HTMLResponse(content=html)


def run() -> None:
    uvicorn.run("hdr_finisher.main:app", host=DEFAULT_HOST, port=DEFAULT_PORT, reload=False)


if __name__ == "__main__":
    run()
