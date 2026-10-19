"""Library backend commands. The interface never decodes a source or writes a photo."""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
import os
import time
from pathlib import Path
from concurrent.futures import CancelledError
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse, Response
from fastapi.routing import APIRoute
from fastapi.exceptions import RequestValidationError
from .library_diagnostics import log, recent
from pydantic import BaseModel, Field, field_validator
from starlette.concurrency import run_in_threadpool

from .library_pictures import LibraryPictureCache
from .library_marks import LibraryMarks, MarkChange, NameTaken
from .library_index import LibraryIndex


class StopwatchEvent(BaseModel):
    stage: str = Field(max_length=64, pattern=r"^[a-z_]+$")
    time: float
    path: str | None = Field(default=None, max_length=4096)
    request: str | None = Field(default=None, max_length=80)
    key: str | None = Field(default=None, max_length=64)
    duration_ms: float | None = None
    queue_ms: float | None = None
    first: bool | None = None
    kept: bool | None = None

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


class SensorRequest(BaseModel):
    path: str
    edge: int = Field(default=320, ge=64, le=2560)
    # An edited photo waits for its saved-grade picture instead of showing
    # the unedited look first.
    saved_grade_only: bool = False


class ThumbnailRequest(BaseModel):
    populate: bool = True
    client: str = Field(default="", max_length=80)
    wanted: list[str] | None = Field(default=None, max_length=256)
    paths: list[str] = Field(max_length=256)
    edge: int = Field(default=360, ge=64, le=1440)
    priority: int = Field(default=10, ge=0, le=100)


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


class PinsRequest(BaseModel):
    paths: list[str] = Field(max_length=100)


class MetadataRequest(BaseModel):
    paths: list[str] = Field(max_length=32)


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


def create_library_router(worker, browser, store=None):
    cache = LibraryPictureCache(browser.root)
    from .library_raw import RawBrowsing, camera_raw
    from .library_raw_thumbnails import RawThumbnails
    raw_browsing = RawBrowsing(browser.root, paused=lambda: worker.status()["paused"])
    raw_thumbnails = RawThumbnails(browser.root)
    marks = LibraryMarks(browser.root)
    if store is not None:
        from .library_grade_api import add_grade_routes
    index = LibraryIndex(marks, browser, worker)

    file_commands = None

    @asynccontextmanager
    async def lifespan(_app):
        await run_in_threadpool(thumbnails.managed.usage)
        await run_in_threadpool(file_commands.start)
        await run_in_threadpool(marks.writer.start, lambda: worker.status()["paused"])
        try:
            yield
        finally:
            await run_in_threadpool(raw_browsing.close)
            file_commands._stop.set()
            index.close()
            if store is not None: kept.close()
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
        from .library_kept import KeptPictures, preferences as picture_preferences
        marks.kept = kept = KeptPictures(browser.root, marks, worker)

        @router.get("/picture-settings")
        def picture_settings(): return kept.usage()

        @router.post("/picture-settings")
        def set_picture_settings(change: dict):
            return command(lambda: (picture_preferences(browser.root, change), kept.cache.managed.trim(), kept.remake_missing(), kept.usage())[-1])

        @router.post("/kept-picture")
        def request_kept(request: FolderRequest):
            # Slice 7 can request the same producer for a photo not open in Grade.
            kept.schedule(request.path)
            return {"queued": True}

        @router.get("/kept-pixels/{key}")
        def kept_pixels(key: str, lane: Literal["hdr", "sdr"] = "sdr"):
            try: body, width, height, stride = kept.pixels(key, lane)
            except (ValueError, OSError, EOFError) as exc:
                raise HTTPException(status_code=404, detail="Saved Library picture is unavailable; request it again.") from exc
            return Response(body, media_type="application/octet-stream", headers={
                "X-Image-Width": str(width), "X-Image-Height": str(height), "X-Bytes-Per-Row": str(stride)})

    from .library_thumbnails import Thumbnails
    thumbnails = Thumbnails(browser.root, worker, marks, kept if store is not None else None)

    @router.post("/thumbnails")
    def thumbnail_batch(request: ThumbnailRequest):
        return thumbnails.batch(request.paths, request.edge, request.priority, request.client, request.wanted, request.populate)

    @router.get("/thumbnail-work")
    def thumbnail_work():
        return {"paused": worker.status()["paused"]}

    @router.post("/thumbnail/{key}")
    async def save_scene_thumbnail(key: str, request: Request, path: str, width: int, height: int):
        from .library_thumbnails import THUMBNAIL_EDGE
        limit = THUMBNAIL_EDGE * THUMBNAIL_EDGE * 12
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > limit:
                raise HTTPException(413, "Thumbnail is too large.")
        try:
            return await run_in_threadpool(thumbnails.store_scene, path, key, width, height, body)
        except (ValueError, OSError, CancelledError) as error:
            raise HTTPException(409, str(error)) from error

    @router.get("/thumbnail/{key}")
    def thumbnail_file(key: str):
        try:
            file = thumbnails.file(key)
            body = file.read_bytes()
            os.utime(file, None)
        except (ValueError, OSError):
            raise HTTPException(404, "Thumbnail was cleared; it will be made again.")
        return Response(body, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=31536000, immutable"})

    @router.get("/cache-settings")
    def cache_settings():
        return thumbnails.managed.usage()

    @router.post("/cache-settings")
    def set_cache_settings(change: dict):
        thumbnails.cancel()
        return command(thumbnails.managed.update, change)

    @router.post("/cache-clear")
    def clear_library_cache(change: dict):
        thumbnails.cancel()
        cache.transient.clear()
        return command(thumbnails.managed.clear, change.get("location"))

    from .library_file_commands import add_file_routes
    file_commands = add_file_routes(router, marks, browser, index, worker, store)

    @router.get("/health")
    def health():
        return {"writer": marks.writer.status(), "helper": {"restarts": 0, **worker.status()},
            "index": index.status(), "file_commands": file_commands.status(), "conflicts": marks.conflicts.status(), "problems": recent()}

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
                picture=kept.current_meta(photo["path"], item.get("grade_identity", ""))
                item["picture_key"] = picture["key"] if picture else ""
                item["pictureCurrent"] = bool(picture)
                item["picture_updating"] = bool(item.get("edited") and not item["pictureCurrent"])
                photo.update(item)
                if item.get("edited") and not item["pictureCurrent"]: kept.ensure(photo["path"])
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

    async def helper_result(request, command, *, retain_picture=False, **arguments):
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
        try:
            while not future.done():
                if worker.status()["paused"]:
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
        except (ValueError, OSError, CancelledError) as exc:
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
                    saved = kept.request(photo["path"])
                    photo.update(edited=saved["edited"], grade_identity=saved["grade_identity"])
                except (ValueError, OSError):
                    photo.update(edited=False)
        if store is not None:
            result["photos"] = marks.copies.expand(result["photos"])
            kept.remake_missing()
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

    @router.post("/scan")
    async def scan(command: FolderRequest, request: Request):
        result = await helper_result(request, "scan", path=command.path, priority=0)
        if isinstance(result, Response):
            return result
        return await run_in_threadpool(listing, result, result["path"])

    def listing(result, root=None):
        with marks._lock:
            accept_helper(result)
            return accepted_listing(result, root)

    def accept_helper(result):
        epoch = result.pop('_file_epoch', None)
        if epoch is not None and epoch != file_commands.epoch:
            raise HTTPException(409, 'Photos changed during this read. Open the folder again.')

    def accepted_listing(result, root=None):
        if root is not None:
            index.remember_scan(root, result["photos"])
        records = marks.read([photo["path"] for photo in result["photos"]])
        by_path = {row["path"]: row for row in records["photos"]}
        for photo in result["photos"]:
            photo.update(by_path[photo["path"]])
            # Edited state and grade identity come from library_grades.describe
            # below, for every photo and copy at once.
        result.update(warnings=records["warnings"], undo_available=records["undo_available"])
        if root is not None:
            index.checks.seed({**result,"photos":[dict(photo) for photo in result["photos"]]})
        if store is not None:
            result["photos"] = marks.copies.expand(result["photos"], getattr(marks, "recent_documents", None))
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
        with marks._lock:
            accept_helper(result)
            index.remember_facts(result['photos'])

    @router.post("/metadata")
    async def metadata(command: MetadataRequest, request: Request):
        result = await helper_result(request, "metadata", paths=list(dict.fromkeys(str(marks.source_path(p)) for p in command.paths)), priority=90)
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
        if store is not None:
            cached = await run_in_threadpool(kept.cached, command.path, command.edge)
            if cached: return cached
            await run_in_threadpool(kept.ensure, command.path)
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
        if store is not None:
            cached = await run_in_threadpool(kept.cached, command.path, command.edge)
            if cached: return cached
            await run_in_threadpool(kept.ensure, command.path)
            if command.saved_grade_only:
                return {"waiting_for_saved_grade": True}
        command.path = str(marks.source_path(command.path))
        if worker.status()["paused"]:
            return JSONResponse({"detail": "library_pending"}, status_code=202)
        try:
            cached = await run_in_threadpool(cache.cached, command.path, command.edge, "grade-thumbnail")
            if cached: return cached
            started = time.perf_counter()
            header, payload = await run_in_threadpool(library_gpu_raw.sensor, Path(command.path))
            log("gpu_raw_sensor", path=command.path, duration_ms=(time.perf_counter() - started) * 1000,
                bytes=sum(len(part) for part in payload), lens=bool(header.get("lens_grid")))
        except library_gpu_raw.NotEligible as reason:
            log("gpu_raw_not_eligible", path=command.path, reason=str(reason))
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
        log("gpu_raw_developed", path=path, key=result.get("key"), store_ms=store_ms, **(header.get("timing_ms") or {}))
        return result

    from .library_overlays import OverlayMaps
    from .raw_import import RAW_EXTENSIONS
    overlay_maps = OverlayMaps(browser.root)
    @router.post("/overlay-switch")
    def overlay_switch(command: OverlaySwitch):
        return command.model_dump() # Viewing state is transient, never a grade or preference.
    @router.post("/overlay-map")
    async def overlay_map(command: OverlayRequest, request: Request):
        if store is not None and kept.request(command.path)["edited"]:
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
            log("cache_pixels_failed", key=key, reason=str(exc), action="picture requested again")
            raise HTTPException(status_code=404, detail="Library cache entry is unavailable; request it again.") from exc

    return router
