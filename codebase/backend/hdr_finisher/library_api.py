"""Library backend commands. The interface never decodes a source or writes a photo."""
from __future__ import annotations

import asyncio
import json
from hashlib import sha256
from contextlib import asynccontextmanager
import os
import time
from pathlib import Path
from concurrent.futures import CancelledError
from typing import Literal
from .cpu_budget import logical_cpus

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from fastapi.routing import APIRoute
from fastapi.exceptions import RequestValidationError
from .library_diagnostics import log, recent, timed_lock
from pydantic import BaseModel, Field, field_validator
from starlette.concurrency import run_in_threadpool

from .library_pictures import LibraryPictureCache
from .library_marks import LibraryMarks, MarkChange, NameTaken
from .library_index import LibraryIndex


class StopwatchEvent(BaseModel):
    range_start: int | None = Field(default=None, ge=0)
    range_end: int | None = Field(default=None, ge=0)
    total: int | None = Field(default=None, ge=0)
    count: int | None = Field(default=None, ge=0)
    picture_requests: int | None = Field(default=None, ge=0)
    scroll_top: float | None = Field(default=None, ge=0)
    active: bool | None = None
    demand: Literal["selected", "visible", "background"] | None = None
    display_epoch: int | None = Field(default=None, ge=0)
    visible_thumbnails: int | None = Field(default=None, ge=0)
    stage: str = Field(max_length=64, pattern=r"^[a-z_]+$")
    time: float
    path: str | None = Field(default=None, max_length=4096)
    request: str | None = Field(default=None, max_length=80)
    picture_key: str | None = Field(default=None, max_length=96)
    scene_key: str | None = Field(default=None, max_length=96)
    picture_size: str | None = Field(default=None, max_length=128)
    step: str | None = Field(default=None, max_length=32)
    work_stage: str | None = Field(default=None, max_length=128)
    scope: str | None = Field(default=None, max_length=32)
    view: str | None = Field(default=None, max_length=64)
    route: str | None = Field(default=None, max_length=64)
    rendition: Literal['hdr', 'sdr'] | None = None
    cache_hit: bool | None = None
    duration_ms: float | None = None
    queue_ms: float | None = None
    gpu_ms: float | None = None
    sensor_ms: float | None = None
    quantiles_ms: float | None = None
    handoff_ms: float | None = None
    source_ms: dict[str, float | None] | None = Field(default=None, max_length=32)
    gpu_stages_ms: dict[str, float] | None = Field(default=None, max_length=32)
    reason: str | None = Field(default=None, max_length=2048)
    first: bool | None = None
    kept: bool | None = None
    quick_draw: bool | None = None
    sharp_draw: bool | None = None
    blank: bool | None = None

class OverlayRequest(BaseModel):
    path: str
    kind: Literal["exposure", "focus"] = "exposure"
    quality: Literal["half", "full"] = "half"
    priority: int = Field(default=85,ge=82,le=85)
class OverlaySwitch(BaseModel):
    kind: Literal["exposure", "focus"]
    enabled: bool


class LibraryRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()
        async def checked(request):
            request.state.library_arrived = time.perf_counter()
            async def context():
                if request.method != "POST" or "application/json" not in request.headers.get("content-type", ""):
                    return dict(request.query_params)
                try:
                    body = await request.json()
                except ValueError:
                    return {"body": "unreadable JSON"}
                if not isinstance(body, dict):
                    return {"body": "not an object"}
                return {key: {"count": len(value), "examples": value[:3]} if isinstance(value, list) else value
                    for key, value in body.items() if key in {"path", "paths", "name", "tag", "tags", "folder", "action", "kind"}}
            try:
                return await handler(request)
            except HTTPException as error:
                if error.status_code != 499:
                    log("request_failed", operation=request.url.path, context=await context(), reason=str(error.__cause__ or error.detail),
                        action="request stopped; saved marks retained")
                raise
            except RequestValidationError as error:
                log("request_invalid", operation=request.url.path, context=await context(), reason=str(error), action="request rejected; nothing changed")
                return JSONResponse({"detail": "That Library request could not be understood. Nothing was changed."}, status_code=400)
            except Exception as error:
                log("request_failed", operation=request.url.path, context=await context(), reason=repr(error), action="request stopped; saved marks retained")
                return JSONResponse({"detail": "The Library could not finish that request. Saved marks are safe; try again."}, status_code=500)
        return checked


def helper_error(error):
    if "queue is full" in str(error):
        return "The Library helper is busy. Saved marks are safe; try again in a moment."
    if "repeated problems" in str(error):
        return "The Library helper stopped after repeated problems. Saved marks are safe; restart the app to browse again."
    return "The Library helper is restarting. Saved marks are safe; try again in a moment."


def user_error(error, subject="The Library"):
    if isinstance(error, OSError):
        name = error.filename or subject
        return f"{name} could not be reached or changed. Saved marks are safe; check the folder and try again."
    from pydantic import ValidationError
    if isinstance(error, ValidationError):
        return "Those marks could not be read. Nothing was changed; saved marks are safe."
    return str(error)


class PictureRequest(BaseModel):
    path: str
    edge: int = Field(default=320, ge=64, le=2560)
    quality: Literal["fast", "quick"] = "quick"
    purpose: Literal["browse", "thumbnail"] = "browse"
    priority: int = Field(default=10, ge=0, le=100)


class LiveSceneRequest(BaseModel):
    path: str
    source_job: str | None = Field(default=None, pattern=r"^[a-f0-9]{32}$")
    edge: Literal[640, 2560, 100000] = 640
    gpu: bool = True
    max_storage_bytes: int | None = Field(default=None, gt=0)
    priority: int = Field(default=30, ge=0, le=100)


class PictureErrorCommand(BaseModel):
    path: str
    revision: str
    action: Literal["ignore", "retry", "original"]


class SensorRequest(BaseModel):
    path: str
    edge: int = Field(default=320, ge=64, le=2560)
    native_mode: bool = False
    # An edited photo waits for its saved-grade picture instead of showing
    # the unedited look first.
    saved_grade_only: bool = False


class NativeRequest(BaseModel):
    path: str
    center_x: float = Field(default=.5, ge=0, le=1)
    center_y: float = Field(default=.5, ge=0, le=1)
    width: int = Field(ge=64, le=4096)
    height: int = Field(ge=64, le=4096)


class RawPlanRequest(BaseModel):
    paths: list[str] = Field(default_factory=list, max_length=16)
    client: str = Field(default="", max_length=64)
    revision: int = Field(default=0, ge=0)
    retained: list[str] = Field(default_factory=list, max_length=16)
    width: int = Field(default=2560, ge=1, le=16384)
    height: int = Field(default=1440, ge=1, le=16384)


class FolderRequest(BaseModel):
    path: str


class CameraPreviewRequest(FolderRequest):
    quick_draw: bool = False
    bytes: int | None = None
    mtime_ns: int | None = None


class PinsRequest(BaseModel):
    paths: list[str] = Field(max_length=100)


class MetadataRequest(BaseModel):
    paths: list[str] = Field(max_length=32)
    demand: Literal["selected", "visible", "background"] = "visible"


class CameraDetailsRequest(MetadataRequest):
    paths: list[str] = Field(max_length=max(32, logical_cpus() * 4))


class PathsRequest(BaseModel):
    paths: list[str]


class MarksRequest(PathsRequest):
    change: MarkChange


class NameRequest(BaseModel):
    name: str


class TagRenameRequest(BaseModel):
    tag: str
    name: str
    merge: bool = False


class TagsRequest(BaseModel):
    tags: list[str] = Field(min_length=1, max_length=500)
    into: str | None = None


class AlbumRequest(BaseModel):
    name: str
    paths: list[str] = Field(default_factory=list)
    new_name: str | None = None


class CollectionRequest(BaseModel):
    cached: bool = False
    kind: Literal["album", "tag"]
    name: str


class IndexRequest(BaseModel):
    action: Literal["pause", "resume", "rescan", "enable", "disable"]


class ChecksRequest(BaseModel):
    paths: list[str] = Field(default_factory=list, max_length=100)
    client: str = Field(default="", max_length=80)
    visible: str = ""


class WriterRequest(BaseModel):
    action: Literal["pause", "resume", "retry"]
    folder: str = ""
    reason: str = ""


class PreferencesRequest(BaseModel):
    label_names: dict[Literal["red", "orange", "green", "blue"], str]

    @field_validator("label_names")
    @classmethod
    def clean_label_names(cls, values):
        return {label: " ".join(name.split())[:60] for label, name in values.items()}


class TestPatternsRequest(BaseModel):
    enabled: bool


def create_library_router(worker, browser, store=None):
    cache = LibraryPictureCache(browser.root)
    from .library_raw import RawBrowsing, camera_raw
    from .library_raw_thumbnails import RawThumbnails
    raw_browsing = RawBrowsing(browser.root, paused=lambda: worker.status()["paused"], foreground_changed=getattr(worker, "foreground_source", lambda key, active: None))
    raw_thumbnails = RawThumbnails(browser.root)
    marks = LibraryMarks(browser.root)
    if store is not None:
        from .library_grade_api import add_grade_routes
    index = LibraryIndex(marks, browser, worker)
    index.cache_upkeep = cache.managed.reconcile_background

    file_commands = None

    @asynccontextmanager
    async def lifespan(_app):
        from .library_diagnostics import startup_phase
        with startup_phase("file_recovery"):
            await run_in_threadpool(file_commands.start)
        with startup_phase("settings_writer"):
            await run_in_threadpool(marks.writer.start, lambda: worker.status()["paused"])
        try:
            yield
        finally:
            await run_in_threadpool(raw_browsing.close)
            file_commands._stop.set()
            index.close()
            await run_in_threadpool(marks.writer.close)

    router = APIRouter(prefix="/api/library", lifespan=lifespan, route_class=LibraryRoute)
    from .library_review import add_review_routes
    add_review_routes(router, index, marks)
    from .library_folder_commands import add_folder_command_routes
    folder_commands = add_folder_command_routes(router, marks, browser, index)
    from .library_smart_albums import add_smart_album_routes
    add_smart_album_routes(router, marks, index)
    if store is not None:
        add_grade_routes(router, marks, store)
        from .library_documents import LibraryDocuments
        documents = LibraryDocuments(marks)

    from .library_live import LivePictures, quality as live_quality, recipe as live_recipe
    live = LivePictures(browser.root, marks, documents if store is not None else None)
    from .library_screen_previews import add_screen_preview_routes
    add_screen_preview_routes(router, live, worker)
    from .library_picture_errors import PictureErrors
    picture_errors = PictureErrors(marks)

    def picture_document(path):
        document = live.document(path)
        if document:
            from .models import EditDocument
            EditDocument.model_validate(document)
        return document

    @router.post("/picture-error")
    def picture_error(command: PictureErrorCommand):
        record = picture_errors.get(command.path)
        if not record or record["revision"] != command.revision:
            raise HTTPException(409, "The photo or settings changed. Refresh its picture before making this choice.")
        if command.action == "ignore":
            return {"error": picture_errors.save({**record, "ignored": True})}
        result = {}
        if command.action == "original":
            if not getattr(marks, "grades", None):
                raise HTTPException(409, "Reverting is unavailable in this Library session.")
            try:
                result = marks.grades.history.rewrite([command.path], kind="original", save_open=True)
            except (ValueError, OSError) as error:
                raise HTTPException(400, user_error(error)) from error
        picture_errors.clear(command.path)
        log("picture_error_resolved", path=command.path, action=command.action)
        return result

    @router.post("/fallback-picture")
    @picture_errors.guard
    async def fallback_picture(command: LiveSceneRequest, request: Request):
        document = await run_in_threadpool(picture_document, command.path)
        path = str(marks.source_path(command.path))
        return await helper_result(request, "live-fallback", path=path, document=document,
            edge=command.edge, priority=command.priority)

    @router.post("/preview")
    async def live_preview(command: CameraPreviewRequest, request: Request):
        from .library_pictures import camera_preview, original_preview
        if await request.is_disconnected(): return Response(status_code=499)
        path = str(marks.source_path(command.path))
        original = Path(path).suffix.lower() in {".jpg", ".jpeg", ".png"}
        if not original and not await run_in_threadpool(camera_raw, path):
            return Response(status_code=204)
        try:
            identity = Path(path).stat()
            def eligible():
                stat = Path(path).stat()
                return ((stat.st_size, stat.st_mtime_ns) == (identity.st_size, identity.st_mtime_ns)
                    and (command.bytes is None or stat.st_size == command.bytes)
                    # Folder JSON timestamps pass through JavaScript numbers;
                    # the before/after file identity above remains exact.
                    and (command.mtime_ns is None or float(stat.st_mtime_ns) == float(command.mtime_ns))
                    and picture_document(command.path) is None
                    and live.cache.cached(path, 640, live_quality(None)) is None)
            if not await run_in_threadpool(eligible):
                return Response(status_code=204)
            if await request.is_disconnected(): return Response(status_code=499)
            preview = await run_in_threadpool(original_preview if original else camera_preview, path, 640)
            if await request.is_disconnected(): return Response(status_code=499)
            if not await run_in_threadpool(eligible):
                return Response(status_code=204)
            return preview
        except (ValueError, OSError):
            return Response(status_code=204)

    @router.get("/live-pixels/{key}")
    def live_pixels(request: Request, key: str, lane: Literal["hdr", "sdr"] = "hdr"):
        started = time.perf_counter()
        try:
            body, width, height, stride, space = live.pixels(key, lane)
        except (KeyError, ValueError, OSError, EOFError) as error:
            raise HTTPException(404, "Preview data unavailable; request it again.") from error
        return Response(body, media_type="application/octet-stream", headers={
            "X-Image-Width": str(width), "X-Image-Height": str(height),
            "X-Bytes-Per-Row": str(stride), "X-Working-Space": space,
            "Cache-Control": "private, no-store", "X-Library-Pixels-Ms": str((time.perf_counter()-started)*1000),
            "X-Library-Pixels-Queue-Ms": str((started-request.state.library_arrived)*1000)})

    from .library_pictures import picture_key
    from .library_source_jobs import SourceJobs
    source_foreground = getattr(worker, "foreground_source", lambda token, active: None)
    source_jobs = SourceJobs(released=lambda token: source_foreground(token, False))

    @router.post("/live-source/{token}")
    def touch_live_source(token: str):
        try:
            return source_jobs.check(token, file_commands.epoch)
        except ValueError as error:
            raise HTTPException(409, str(error)) from error

    @router.delete("/live-source/{token}")
    def release_live_source(token: str):
        source_jobs.release(token)
        return {"released": True}

    @router.post("/live-plan")
    @picture_errors.guard
    def live_plan(command: LiveSceneRequest):
        # Cache discovery and stat only: never decode or claim a source slot.
        document = picture_document(command.path)
        path = marks.source_path(command.path)
        stat = path.stat()
        cached = live.cache.cached(str(path), command.edge, live_quality(document))
        if cached:
            live.cache.accept_transient(cached)
        return {"cached": live.describe(command.path, cached) if cached else None,
                "bytes": stat.st_size, "revision": f"{stat.st_mtime_ns}:{stat.st_size}",
                "source_identity": picture_key(path, 0, live_quality(document)),
                "render_identity": picture_key(path, 0, live_quality(document)) + ":" + sha256(json.dumps(document or {}, sort_keys=True).encode()).hexdigest(),
                "warm_allowed": live.cache.managed.can_warm()}

    @router.post("/live-scene")
    @picture_errors.guard
    async def live_scene(command: LiveSceneRequest, request: Request):
        requested_at = time.perf_counter()
        document = await run_in_threadpool(picture_document, command.path)
        path = str(marks.source_path(command.path))
        source_quality = live_quality(document)
        cached = await run_in_threadpool(live.cache.cached, path, command.edge, source_quality)
        if cached:
            live.cache.accept_transient(cached)
            return await run_in_threadpool(live.describe, command.path, cached)
        if worker.status()["paused"]:
            return JSONResponse({"detail": "library_pending"}, status_code=202)
        token = source_jobs.claim(path, source_quality, command.edge, command.priority, file_commands.epoch, command.source_job)
        if token is None:
            return JSONResponse({"detail": "library_pending"}, status_code=202)
        claimed_at = time.perf_counter()
        log("picture_source_claim", path=path, checks_claim_ms=(claimed_at-requested_at)*1000, gpu=command.gpu)
        transfer = False
        try:
            if command.gpu:
                source_foreground(token, True)
                from . import library_gpu_raw, library_rgb
                from .models import RawImportSettings, SourceInterpretationOverride
                inputs = live_recipe(document)
                try:
                    if inputs.get("repairs"):
                        raise library_gpu_raw.NotEligible("CPU Inpaint repairs require the native repaired source")
                    if Path(path).suffix.lower() in {".jpg", ".jpeg", ".png", ".exr", ".hdr", ".pfm", ".tif", ".tiff", ".jxl", ".avif", ".heic", ".heif"}:
                        header, parts = await run_in_threadpool(source_jobs.preparing, token, path, library_rgb.decoded, Path(path), inputs)
                    elif Path(path).suffix.lower() == ".dng":
                        from . import library_dng
                        if SourceInterpretationOverride.model_validate(inputs["interpretation_override"]) != SourceInterpretationOverride():
                            raise library_gpu_raw.NotEligible("DNG interpretation overrides retain the CPU route")
                        def dng_source():
                            return library_dng.decoded(Path(path), inputs,
                                progress=lambda stage,text: source_jobs.stage(token,stage,text),
                                cancelled=lambda: source_jobs.cancelled(token), edge=command.edge, max_storage_bytes=command.max_storage_bytes)
                        header, parts = await run_in_threadpool(source_jobs.preparing, token, path, dng_source)
                    else:
                        if SourceInterpretationOverride.model_validate(inputs["interpretation_override"]) != SourceInterpretationOverride():
                            raise library_gpu_raw.NotEligible("source interpretation uses Grade's CPU development")
                        header, parts = await run_in_threadpool(source_jobs.preparing, token, path, library_gpu_raw.sensor, Path(path),
                            RawImportSettings.model_validate(inputs["raw_import_settings"]))
                except library_gpu_raw.NotEligible as error:
                    log("picture_source_cpu_fallback", path=path, reason=str(error), discarded_decode_ms=(time.perf_counter()-claimed_at)*1000)
                    return Response(status_code=204, headers={"X-Library-Fallback": str(error)})
                source_jobs.check(token, file_commands.epoch)
                if await request.is_disconnected():
                    raise HTTPException(499, "Library request cancelled.")
                header.setdefault("source_timings_ms", {}).update(checks_claim=(claimed_at-requested_at)*1000, decode_prepare=(time.perf_counter()-claimed_at)*1000)
                header.update(edge=command.edge, source_quality=source_quality, item_path=command.path, source_job=token)
                transfer = True
                return Response(library_gpu_raw.frame(header, *parts), media_type="application/octet-stream")
            result = await helper_result(request, "live-scene", path=path, document=document,
                edge=command.edge, priority=command.priority, source_token=token, draw_first=command.edge != 100000)
            if isinstance(result, Response): return result
            source_jobs.check(token, file_commands.epoch)
            publication_epoch = file_commands.epoch
            def validate_cpu_store():
                if publication_epoch != file_commands.epoch or source_quality != live_quality(live.document(command.path)):
                    raise ValueError("Source settings changed before saving preview data.")
            for scene in result.pop("_pending_scenes", []):
                default = scene.pop("_default_document", None)
                live.cache.accept_transient(scene)
                with live.cache.transient_lock:
                    if scene["key"] in live.cache.transient:
                        live.cache.pending_stores[scene["key"]] = (path, scene["edge"], source_quality, default, validate_cpu_store)
            live.cache.accept_transient(result)
            return await run_in_threadpool(live.describe, command.path, result)
        finally:
            if not transfer:
                source_jobs.release(token)

    @router.post("/live-developed")
    async def live_developed(request: Request):
        from . import library_gpu_raw
        try:
            header, body = library_gpu_raw.unframe(await request.body())
            if header.get("source_job"):
                source_jobs.check(header["source_job"], file_commands.epoch)
            item = header["item_path"]
            document = await run_in_threadpool(live.document, item)
            if header["source_quality"] != live_quality(document):
                raise ValueError("Source settings changed during development.")
            path = str(marks.source_path(item))
            if header.get("source_job"):
                owner = source_jobs.check(header["source_job"], file_commands.epoch)
                if owner["path"] != path or owner["quality"] != header["source_quality"] or (owner["edge"] == 100000) != (header["edge"] == 100000):
                    raise ValueError("Developed source does not match its preparation owner.")
            publication_epoch = file_commands.epoch
            class SceneCache:
                def build(self, source, edge, _quality, decoded):
                    pixels, reference, metadata = decoded
                    default = metadata.get("default_document") or {}
                    fingerprint = default.get("source", {}).get("fingerprint_sha256")
                    if document:
                        expected = document.get("source", {}).get("fingerprint_sha256")
                        if expected and expected != fingerprint:
                            raise ValueError("The source photo changed; its saved grade cannot be shown.")
                        metadata.pop("default_document", None)
                    metadata["source_fingerprint_sha256"] = fingerprint
                    if header.get("source_job"):
                        source_jobs.check(header["source_job"], file_commands.epoch)
                    if header["source_quality"] != live_quality(live.document(item)):
                        raise ValueError("Source settings changed during development.")
                    def validate_owner():
                        # Cache.build checks again after encoding, before rename.
                        # A changed file must not acquire a newer key for old pixels.
                        if header.get("source_job"):
                            source_jobs.check(header["source_job"], file_commands.epoch)
                        if header["source_quality"] != live_quality(live.document(item)):
                            raise ValueError("Source settings changed during development.")
                        return False
                    def validate_store():
                        if publication_epoch != file_commands.epoch or header["source_quality"] != live_quality(live.document(item)):
                            raise ValueError("Source settings changed before saving preview data.")
                    if header.get("describe_only"):
                        # Same defaults/grade/identity as normal acceptance, without
                        # receiving, packing or persisting any scene pixels.
                        validate_owner()
                        look = metadata.pop("starting_look")
                        metadata.pop("default_document", None)
                        result = dict(metadata, key=picture_key(source, edge, header["source_quality"]),
                            path=str(source), edge=edge, quality=header["source_quality"],
                            width=header["width"], height=header["height"], adjustments=look,
                            white=203, has_reference=bool(header["colour"].get("authored_sdr", True) or header.get("has_sdr_reference")),
                            cache_hit=False, stored_bytes=0)
                        return result
                    result = live.cache.build(source, edge, header["source_quality"],
                        cancelled=validate_owner, decoded=(pixels, reference, metadata), defer_store=bool(header.get("draw_first")), store_validate=validate_store)
                    live.cache.accept_transient(result)
                    return result
            from . import library_rgb
            adapter = library_rgb if header.get("rgb") else library_gpu_raw
            if header.get("describe_only") and (not header.get("rgb") or header["edge"] == 100000 or body):
                raise ValueError("Only reduced RGB scene metadata can be described without pixels.")
            result = await run_in_threadpool(adapter.developed, SceneCache(), path, header, None if header.get("describe_only") else body)
            log("picture_live_developed", path=str(path), edge=header["edge"], **(header.get("timing_ms") or {}))
            described = await run_in_threadpool(live.describe, item, result)
            if header.get("describe_only"):
                from .models import GeometryAdjustments, AdjustmentState
                adjustments = AdjustmentState.model_validate(described["adjustments"])
                described["direct_supported"] = (adjustments.shared.geometry == GeometryAdjustments()
                    and not described["locals"]
                    and not any(v.get("enabled") for v in described["denoise"].values() if isinstance(v, dict)))
            return described
        except (ValueError, OSError, KeyError) as error:
            raise HTTPException(409, str(error)) from error

    @router.post("/live-store/{key}")
    def store_live_scene(key: str):
        from .library_live import metadata as scene_metadata
        meta = scene_metadata(key)
        if not meta:
            raise HTTPException(404, "Preview data unavailable; request it again.")
        item = meta["path"]
        epoch = file_commands.epoch
        def validate(quality):
            if epoch != file_commands.epoch or quality != live_quality(live.document(item)):
                raise ValueError("Source settings changed before saving preview data.")
        try:
            live.cache.persist_pending(str(marks.source_path(item)), validate)
            return {"saved": True}
        except (ValueError, OSError) as error:
            raise HTTPException(409, str(error)) from error

    @router.get("/warmup-idle")
    def warmup_idle():
        status = worker.status()
        return {"idle": not status["paused"] and not status["pending"]}

    @router.post('/denoise-warmup')
    def denoise_warmup():
        from .denoise_adaptive import _tail_reference, _quantile_calibration
        _tail_reference()
        _quantile_calibration(0.1)
        return {'ready': True}

    @router.get("/cache-settings")
    def cache_settings():
        return cache.managed.usage()

    @router.post("/cache-settings")
    def set_cache_settings(change: dict):
        return command(cache.managed.update, change)

    @router.post("/cache-clear")
    def clear_library_cache(change: dict):
        source_jobs.invalidate()
        cache.transient.clear()
        live.cache.transient.clear()
        return command(cache.managed.clear, change.get("location"))

    from .library_file_commands import add_file_routes
    file_commands = add_file_routes(router, marks, browser, index, worker, store)

    @router.get("/health")
    def health():
        import time
        with marks._lock:
            errors, checked_at = picture_errors.all(), time.time()
        return {"picture_errors": errors, "picture_errors_checked_at": checked_at, "preparation": source_jobs.snapshot(), "writer": marks.writer.status(), "helper": {"restarts": 0, **worker.status()},
            "index": index.status(), "file_commands": file_commands.status(), "conflicts": marks.conflicts.status(), "problems": recent()}

    @router.post("/scene-work")
    def scene_work(request: dict):
        if request.get("action") not in {"pause", "resume"}:
            raise HTTPException(400, "Choose pause or resume.")
        worker.pause("manual", request["action"] == "pause")
        return worker.status()

    @router.post("/writer")
    def writer_command(request: WriterRequest):
        if request.action == "retry":
            marks.writer.retry(request.folder, request.reason)
        else:
            marks.writer.pause(request.action == "pause")
        return health()

    @router.post("/settings-status")
    def settings_status(request: PathsRequest):
        result = marks.writer.status(request.paths)
        if store is not None:
            states = marks.grades.describe(request.paths)
            for photo in result["photos"]:
                item = states.get(photo["path"], {})
                photo.update(item)
        return result

    @router.get("/settings-status")
    def settings_summary():
        return marks.writer.status()

    def command(operation, *arguments):
        try:
            return operation(*arguments)
        except NameTaken as error:
            raise HTTPException(status_code=409, detail=user_error(error)) from error
        except (ValueError, OSError) as error:
            raise HTTPException(status_code=400, detail=user_error(error)) from error

    async def helper_result(request, command, *, retain_picture=False, source_token=None, **arguments):
        arguments["trace_id"] = request.headers.get("X-Library-Request")
        epoch = file_commands.epoch
        try:
            if retain_picture:
                job_id, future = await run_in_threadpool(worker.submit_browse_picture, **arguments)
            else:
                job_id, future = await run_in_threadpool(worker.submit_library, command, **arguments)
        except (RuntimeError, ValueError, OSError) as error:
            log("helper_request_failed", operation=command, paths=arguments, reason=str(error), action="request stopped; saved marks retained")
            raise HTTPException(status_code=503, detail=helper_error(error)) from error
        if source_token:
            source_jobs.bind(source_token, lambda: worker.cancel(job_id), lambda priority: worker.prioritize(job_id, priority))
        try:
            while not future.done():
                if source_token:
                    source_jobs.check(source_token, file_commands.epoch)
                # Source jobs keep their owner and wait behind the helper pause
                # gate. Returning 202 here cancels them in finally and restarts
                # the entire import on every brief Grade pause.
                if worker.status()["paused"] and command not in {"live-scene", "live-fallback"}:
                    return JSONResponse({"detail": "library_pending"}, status_code=202,
                        headers={"Retry-After": "0.1", "Cache-Control": "no-store"})
                if await request.is_disconnected():
                    raise HTTPException(status_code=499, detail="Library request cancelled.")
                await asyncio.sleep(.05)
            if epoch != file_commands.epoch:
                raise HTTPException(409, "Photos changed during this read. Open the folder again.")
            result = future.result()
            if command in {'picture', 'native'}: cache.accept_transient(result)
            elif command == 'overlay': overlay_maps.cache.accept_transient(result)
            result['_file_epoch'] = epoch
            return result
        except RuntimeError as exc:
            log("helper_request_failed", operation=command, paths=arguments, reason=str(exc), action="request stopped; restart app")
            raise HTTPException(status_code=503, detail=helper_error(exc)) from exc
        except CancelledError as exc:
            raise HTTPException(status_code=499, detail="Library request cancelled.") from exc
        except (ValueError, OSError) as exc:
            log("helper_request_failed", operation=command, paths=arguments, reason=str(exc), action="request stopped; saved marks retained")
            raise HTTPException(status_code=400, detail=f"The Library could not read {arguments.get('path', 'the selected photos')}. Saved marks are safe; check the photo or folder and try again.") from exc
        finally:
            if not retain_picture:
                worker.cancel(job_id)

    @router.post("/stopwatch")
    def stopwatch(events: list[StopwatchEvent]):
        if len(events)>64: raise HTTPException(400,"Too many timing events.")
        for event in events:
            log("page_" + event.stage, **event.model_dump(exclude_none=True, exclude={"stage"}))
        return {"ok": True}

    @router.get("/options")
    def options():
        raw_browsing.start()
        return {"timing": os.environ.get("HDR_FINISHER_DEV_LIBRARY_TIMING") == "1", "browsing": raw_browsing.limits}

    @router.post("/raw-plan")
    def raw_plan(command: RawPlanRequest):
        paths = [str(marks.source_path(path)) for path in command.paths]
        paths = [path for path in paths if camera_raw(path)]
        return raw_browsing.plan(paths, command.width, command.height, command.client, command.revision, command.retained)

    @router.get("/raw-ready")
    def raw_ready():
        return raw_browsing.status()

    @router.get("/raw-transport/{key}")
    def raw_transport(key: str):
        try:
            return Response(raw_browsing.pixels(key), media_type="application/octet-stream",
                headers={"Cache-Control": "private, no-store"})
        except KeyError:
            raise HTTPException(404, "RAW picture was released; select the photo again.")

    @router.get("/raw-thumbnail/{key}")
    def raw_thumbnail(key: str):
        try:
            body, width, height, stride = raw_thumbnails.pixels(key)
            return Response(body, media_type="application/octet-stream", headers={
                "X-Image-Width": str(width), "X-Image-Height": str(height),
                "X-Bytes-Per-Row": str(stride), "X-Working-Space": "acescg", "Cache-Control": "private, no-store"})
        except (ValueError, OSError, EOFError):
            raise HTTPException(404, "RAW thumbnail was released; select the photo again.")

    @router.post("/raw-thumbnail/{key}")
    async def save_raw_thumbnail(key: str, request: Request):
        # Metadata comes from our completed decode, not arbitrary client input.
        if int(request.headers.get("content-length", "0")) > 512 * 512 * 8:
            raise HTTPException(413, "RAW thumbnail is too large.")
        with raw_browsing.cv:
            entry = raw_browsing.outputs.get(key)
            if entry is None:
                raise HTTPException(409, "RAW picture was released before thumbnail save.")
            meta = raw_browsing.metadata(entry[1], 512)
        body = await request.body()
        try:
            await run_in_threadpool(raw_thumbnails.store, meta, body)
        except (ValueError, OSError) as error:
            raise HTTPException(409, str(error)) from error
        return {"ok": True}

    @router.get("/pins")
    def pins():
        if index._thread is None:
            index.kick()  # The first Library page starts background indexing.
        return {"pinned": folder_commands.pins()}

    @router.get("/index")
    def index_status():
        return index.status()

    @router.post("/index")
    def index_command(request: IndexRequest):
        if request.action in {"pause", "resume"}:
            index.pause(request.action == "pause")
        elif request.action == "rescan":
            index.pause(False)
            index.kick()
        else:
            command(lambda: index.set_preferences(background_indexing=request.action == "enable"))
        return index.status()

    @router.post("/checks")
    def checks_command(request: ChecksRequest):
        if request.client:
            index.checks.visible(request.client, request.visible)
        if request.paths:
            index.checks.request(request.paths)
        return index.checks.status()

    @router.post("/view")
    def checked_view(request: FolderRequest):
        result = index.checks.view(request.path)
        if result is None:
            return {"photos": None}
        return cached_listing(result)

    def cached_listing(result):
        result = {**result, "photos": [dict(photo) for photo in result["photos"]]}
        import json
        from .library_marks import Marks
        photos = result["photos"]
        paths = [p["path"] for p in photos]
        with marks._lock:
            rows = marks._rows(paths)
            if marks.database.exists():
                db = marks._connect()
                try:
                    for start in range(0, len(paths), 800):
                        chunk = paths[start:start + 800]
                        facts = {path: (size, modified, data) for path, size, modified, data in db.execute(
                            "SELECT path, bytes, mtime_ns, facts FROM files WHERE path IN (" + ",".join("?" for _ in chunk) + ")", chunk)}
                        for photo in photos[start:start + 800]:
                            row = facts.get(photo["path"])
                            if row and row[:2] == (photo["bytes"], photo["mtime_ns"]) and row[2]:
                                photo.update(json.loads(row[2]), indexed=True)
                finally:
                    db.close()
        for photo in photos:
            photo.update(rows.get(photo["path"], {"marks": Marks().model_dump(), "albums": [], "storage": "none"}))
            if store is not None:
                try:
                    saved = documents.request(photo["path"])
                    photo.update(edited=saved["edited"], grade_identity=saved["grade_identity"])
                except (ValueError, OSError):
                    photo.update(edited=False)
        if store is not None:
            result["photos"] = marks.copies.expand(result["photos"])
        if store is not None:
            saved_states = store.library_grades.describe([photo["path"] for photo in result["photos"]])
            for photo in result["photos"]:
                photo.update(saved_states.get(photo["path"], {}))
        index.membership.describe(result["photos"])
        return result

    @router.get("/preferences")
    def preferences():
        return index.preferences()

    @router.post("/preferences")
    def set_preferences(request: PreferencesRequest):
        return command(lambda: index.set_preferences(label_names=request.label_names))

    @router.post("/test-patterns")
    def set_test_patterns(request: TestPatternsRequest):
        from .library_test_patterns import set_test_patterns_enabled
        try:
            result = set_test_patterns_enabled(browser, request.enabled)
            if result.pop("changed"):
                index.membership.reconcile()
                index.kick()
            return result
        except (OSError, ValueError, ImportError) as exc:
            raise HTTPException(status_code=500, detail="The Library test-pattern folder could not be prepared. Your files are safe.") from exc

    @router.post("/pins")
    def add_pins(command: PinsRequest):
        # Validate the whole selection before changing preferences.
        from .library_folders import checked_folder
        try:
            paths = list(dict.fromkeys(str(checked_folder(path)) for path in command.paths))
            previous = {item["path"] for item in browser.pinned()}
            for path in paths:
                browser.add_pin(path)
            index.membership.reconcile()
            index.kick()
            return {"pinned": folder_commands.pins(), "skipped": sum(path in previous for path in paths)}
        except (OSError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=user_error(exc)) from exc

    @router.post("/pins/impact")
    def pin_impact(request: FolderRequest):
        return command(index.membership.impact, request.path)

    @router.post("/albums/impact")
    def album_impact(request: AlbumRequest):
        return command(lambda: index.membership.impact(album=request.name, paths=request.paths or None))

    @router.post("/pins/remove")
    def remove_pin(command: FolderRequest):
        # Missing/offline folders must still be removable from preferences.
        try:
            with marks._lock:
                impact = index.membership.impact(folder=command.path)
                pinned = browser.remove_pin(command.path)
            index.membership.reconcile()
            index.kick()
            return {"pinned": pinned, **impact}
        except (OSError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=user_error(exc)) from exc

    @router.post("/folder-stream")
    async def folder_stream(command: FolderRequest, request: Request):
        from .library_folder_stream import stream_folder
        # Normalise lexically; even an offline indexed folder may open.
        root = os.path.abspath(os.path.expanduser(command.path))
        return StreamingResponse(stream_folder(index, store, request, root, listing),
            media_type="application/x-ndjson", headers={"Cache-Control":"no-store"})

    @router.post("/folder-details")
    def folder_details(command: MetadataRequest):
        photos=[]
        for value in dict.fromkeys(command.paths):
            path=Path(str(marks.source_path(value)))
            try:
                stat=path.stat()
            except OSError: continue
            photos.append(dict(path=str(path),name=path.name,type=path.suffix[1:].upper(),bytes=stat.st_size,mtime_ns=stat.st_mtime_ns))
        return listing(dict(path="",photos=photos,unreadable_folders=[]))

    @router.post("/scan")
    async def scan(command: FolderRequest, request: Request):
        result = await helper_result(request, "scan", path=command.path, priority=0)
        if isinstance(result, Response):
            return result
        return await run_in_threadpool(listing, result, result["path"])

    def listing(result, root=None):
        accept_helper(result)
        # Indexing and marks readers own short transactions themselves.
        return accepted_listing(result, root)

    def accept_helper(result):
        epoch = result.pop('_file_epoch', None)
        if epoch is not None and epoch != file_commands.epoch:
            raise HTTPException(409, 'Photos changed during this read. Open the folder again.')

    def accepted_listing(result, root=None):
        if root is not None:
            index.remember_scan(root, result["photos"], reconcile=False)
        records = {"photos":[],"warnings":[],"undo_available":bool(marks._undo)}
        documents = {}
        for start in range(0,len(result["photos"]),16):
            with marks._lock:
                page=marks.read([photo["path"] for photo in result["photos"][start:start+16]])
                documents.update(marks.recent_documents)
            records["photos"].extend(page["photos"])
            records["warnings"].extend(page["warnings"])
            records["undo_available"]=page["undo_available"]
        by_path = {row["path"]: row for row in records["photos"]}
        for photo in result["photos"]:
            photo.update(by_path[photo["path"]])
            # Edited state and grade identity come from library_grades.describe
            # below, for every photo and copy at once.
        result.update(warnings=records["warnings"], undo_available=records["undo_available"])
        if root is not None:
            index.checks.seed({**result,"photos":[dict(photo) for photo in result["photos"]]})
        if store is not None:
            result["photos"] = marks.copies.expand(result["photos"], documents)
            marks.recent_documents = {}
        if store is not None:
            saved_states = store.library_grades.describe([photo["path"] for photo in result["photos"]])
            for photo in result["photos"]:
                photo.update(saved_states.get(photo["path"], {}))
        index.membership.describe(result["photos"])
        return result

    @router.post("/collection")
    def collection(request: CollectionRequest):
        """The photos of an album or tag, wherever they are in the library."""
        paths = marks.album_paths(request.name) if request.kind == "album" else marks.tag_paths(request.name)
        physical = list(dict.fromkeys(str(marks.source_path(p)) for p in paths))
        photos, missing = index.photos(physical)
        result = {"path": "", "photos": photos, "unreadable_folders": [], "missing": missing}
        result = cached_listing(result) if request.cached else listing(result)
        result["photos"] = [p for p in result["photos"] if p["path"] in paths]
        return result

    def accept_facts(result):
        accept_helper(result)
        index.remember_facts(result['photos'], foreground=True)

    @router.post("/metadata")
    async def metadata(command: CameraDetailsRequest, request: Request):
        started = time.perf_counter()
        background = command.demand == "background"
        result = await helper_result(request, "metadata", paths=list(dict.fromkeys(str(marks.source_path(p)) for p in command.paths)),
            priority=95 if background else 0 if command.demand == "selected" else 5, background=background)
        log("camera_details_read", demand=command.demand, count=len(command.paths),
            duration_ms=(time.perf_counter()-started)*1000, outcome="pending" if isinstance(result, Response) else "completed")
        if not isinstance(result, Response):
            await run_in_threadpool(accept_facts, result)
            facts={p["path"]:p for p in result["photos"]}
            result["photos"]=[{**facts[str(marks.source_path(p))],"path":p} for p in command.paths if str(marks.source_path(p)) in facts]
        return result

    @router.post("/marks")
    def change_marks(command: MarksRequest):
        try:
            return marks.change(command.paths, command.change)
        except (ValueError, OSError) as error:
            raise HTTPException(status_code=400, detail=user_error(error)) from error

    @router.post("/undo")
    def undo_marks():
        try:
            return marks.undo()
        except (ValueError, OSError) as error:
            raise HTTPException(status_code=400, detail=user_error(error)) from error

    @router.get("/tags")
    def tag_suggestions(q: str = "", all: bool = False):
        return {"tags": marks.tags(q, None if all else 20)}

    @router.post("/tags/create")
    def tag_create(request: NameRequest):
        return command(marks.tag_create, request.name)

    @router.post("/tags/rename")
    def tag_rename(request: TagRenameRequest):
        return command(marks.tag_rename, request.tag, request.name, request.merge)

    @router.post("/tags/merge")
    def tag_merge(request: TagsRequest):
        return command(marks.tag_merge, request.tags, request.into or "")

    @router.post("/tags/remove")
    def tag_remove(request: TagsRequest):
        return command(marks.tag_remove, request.tags)

    @router.get("/albums")
    def albums():
        return {"albums": marks.albums()}

    @router.post("/albums/create")
    def album_create(request: AlbumRequest):
        return command(marks.album_create, request.name, request.paths)

    @router.post("/albums/duplicate")
    def album_duplicate(request: AlbumRequest):
        def duplicate():
            with marks._lock:
                if not marks._exists("album", request.name):
                    raise ValueError("That album is no longer in the library.")
                return marks.album_create(request.new_name or "", marks.album_paths(request.name))
        return command(duplicate)

    @router.post("/albums/add")
    def album_add(request: AlbumRequest):
        return command(marks.album_change, request.name, request.paths, True)

    @router.post("/albums/remove")
    def album_remove(request: AlbumRequest):
        def remove():
            with marks._lock:
                impact = index.membership.impact(album=request.name, paths=request.paths)
                return {**marks.album_change(request.name, request.paths, False), "left_library": impact["leaving"]}
        return command(remove)

    @router.post("/albums/rename")
    def album_rename(request: AlbumRequest):
        return command(marks.album_rename, request.name, request.new_name or "")

    @router.post("/albums/delete")
    def album_delete(request: AlbumRequest):
        return command(marks.album_delete, request.name)

    @router.post("/tree")
    async def tree(command: FolderRequest, request: Request):
        return await helper_result(request, "tree", path=command.path, priority=0)

    @router.post("/picture")
    async def picture(command: PictureRequest, request: Request):
        command.path = str(marks.source_path(command.path))
        if await run_in_threadpool(camera_raw, command.path):
            if command.purpose == "thumbnail":
                if command.quality == "fast":
                    from .library_pictures import camera_preview
                    try:
                        return await run_in_threadpool(camera_preview, command.path, command.edge)
                    except Exception as error:
                        log("camera_preview_unavailable", path=command.path, reason=str(error))
                return await helper_result(request, "picture", path=command.path,
                    edge=command.edge, quality="grade-thumbnail", priority=command.priority)
            if command.edge < 1280:
                cached = await run_in_threadpool(raw_thumbnails.cached, command.path)
                if cached:
                    return cached
            if command.quality == "fast" and command.edge < 1280:
                from .library_pictures import camera_preview
                try:
                    return await run_in_threadpool(camera_preview, command.path, command.edge)
                except Exception as error:
                    log("camera_preview_unavailable", path=command.path, reason=str(error))
            future = raw_browsing.request(command.path, command.priority)
            while not future.done():
                if raw_browsing.paused():
                    return JSONResponse({"detail": "library_pending"}, status_code=202)
                if await request.is_disconnected():
                    # Decoding finishes and is kept even if the selection moved.
                    raise HTTPException(499, "Library request cancelled.")
                await asyncio.sleep(.01)
            if future.cancelled():
                raise HTTPException(499, "Library request superseded.")
            try:
                return raw_browsing.metadata(future.result(), command.edge)
            except (ValueError, OSError) as error:
                raise HTTPException(400, str(error)) from error
        try:
            cached = await run_in_threadpool(cache.cached, command.path, command.edge, command.quality)
        except (ValueError, OSError) as exc:
            raise HTTPException(status_code=400, detail=user_error(exc)) from exc
        if cached:
            return cached
        return await helper_result(request, "picture", retain_picture=True, **command.model_dump())

    # Camera RAW grid thumbnails developed on the GPU by the Library window.
    # Anything the GPU route does not cover answers 204 and keeps the CPU route.
    from . import library_gpu_raw
    @router.post("/raw-sensor")
    async def raw_sensor(command: SensorRequest):
        command.path = str(marks.source_path(command.path))
        if worker.status()["paused"]:
            return JSONResponse({"detail": "library_pending"}, status_code=202)
        try:
            if command.native_mode and cache.gpu_native_ready(command.path):
                return {"native_ready": True}
            cached = None if command.native_mode else await run_in_threadpool(cache.cached, command.path, command.edge, "grade-thumbnail")
            if cached: return cached
            started = time.perf_counter()
            header, payload = await run_in_threadpool(library_gpu_raw.sensor, Path(command.path))
            log("picture_raw_sensor_read", path=command.path, duration_ms=(time.perf_counter() - started) * 1000,
                bytes=sum(len(part) for part in payload), lens=bool(header.get("lens_grid")))
        except library_gpu_raw.NotEligible as reason:
            log("picture_raw_not_eligible", path=command.path, reason=str(reason))
            return Response(status_code=204)
        except (ValueError, OSError) as error:
            raise HTTPException(status_code=400, detail=user_error(error)) from error
        header["edge"] = command.edge
        return Response(library_gpu_raw.frame(header, *payload), media_type="application/octet-stream")

    @router.post("/raw-developed")
    async def raw_developed(request: Request):
        try:
            header, payload = library_gpu_raw.unframe(await request.body())
            path = str(marks.source_path(header["path"]))
            started = time.perf_counter()
            result = await run_in_threadpool(library_gpu_raw.developed, cache, path, header, payload)
            store_ms = (time.perf_counter() - started) * 1000
        except (ValueError, OSError, KeyError) as error:
            raise HTTPException(status_code=409, detail=user_error(error)) from error
        log("picture_raw_developed", path=path, key=result.get("key"), store_ms=store_ms, **(header.get("timing_ms") or {}))
        return result

    from .library_overlays import OverlayMaps
    from .raw_import import RAW_EXTENSIONS
    overlay_maps = OverlayMaps(browser.root)
    @router.post("/overlay-switch")
    def overlay_switch(command: OverlaySwitch):
        return command.model_dump() # Viewing state is transient, never a grade or preference.
    @router.post("/overlay-map")
    async def overlay_map(command: OverlayRequest, request: Request):
        if store is not None and documents.request(command.path)["edited"]:
            return {"unavailable":"Overlay is measured from the original; this photo is shown with its saved grade."}
        path = str(marks.source_path(command.path))
        # A format with no source clipping limit must not imply a clean exposure map.
        if command.kind=="exposure" and Path(path).suffix.lower() not in {".png",".jpg",".jpeg",".tif",".tiff"} | RAW_EXTENSIONS:
            return {"unavailable":"Exposure warnings unavailable: this file has no recorded clipping limit."}
        cached = await run_in_threadpool(overlay_maps.cached,path,command.kind,command.quality)
        if cached:return cached
        result = await helper_result(request,"overlay",path=path,kind=command.kind,quality=command.quality,priority=command.priority)
        if isinstance(result,Response):return result
        if result.get("unavailable"):return result
        # Check source version again after the helper finishes, before allowing display.
        current = await run_in_threadpool(overlay_maps.cached,path,command.kind,command.quality)
        return current or JSONResponse({"detail":"library_pending"},status_code=202)
    @router.get("/overlay-pixels/{key}")
    def overlay_pixels(key: str):
        try:return Response(overlay_maps.png(key),media_type="image/png",headers={"Cache-Control":"private, no-store"})
        except (ValueError,OSError):raise HTTPException(404,"Overlay map unavailable; it will be made again.")

    @router.post("/native")
    async def native(command: NativeRequest, request: Request):
        command.path = str(marks.source_path(command.path))
        if cache.gpu_native_ready(command.path):
            return await run_in_threadpool(cache.build_native, command.path, command.center_x,
                command.center_y, command.width, command.height)
        return await helper_result(request, "native", priority=0, **command.model_dump())

    @router.get("/pixels/{key}")
    def pixels(key: str, lane: Literal["hdr", "sdr"] = Query(default="hdr")):
        try:
            body, width, height, stride, space = cache.pixels(key, lane)
            return Response(body, media_type="application/octet-stream", headers={
                "X-Image-Width": str(width), "X-Image-Height": str(height),
                "X-Bytes-Per-Row": str(stride), "X-Working-Space": space,
                "Cache-Control": "private, no-store"})
        except (ValueError, OSError, EOFError) as exc:
            log("picture_cache_pixels_failed", key=key, reason=str(exc), action="picture requested again")
            raise HTTPException(status_code=404, detail="Library cache entry is unavailable; request it again.") from exc

    return router
