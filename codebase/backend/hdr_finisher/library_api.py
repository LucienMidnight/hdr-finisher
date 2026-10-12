"""Library backend commands. The interface never decodes a source or writes a photo."""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
import os
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
                if request.method != "POST":
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
    priority: int = Field(default=10, ge=0, le=100)


class NativeRequest(BaseModel):
    path: str
    center_x: float = Field(default=.5, ge=0, le=1)
    center_y: float = Field(default=.5, ge=0, le=1)
    width: int = Field(ge=64, le=4096)
    height: int = Field(ge=64, le=4096)


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
    marks = LibraryMarks(browser.root)
    if store is not None:
        from .library_grade_api import add_grade_routes
    index = LibraryIndex(marks, browser, worker)

    @asynccontextmanager
    async def lifespan(_app):
        await run_in_threadpool(marks.writer.start, lambda: worker.status()["paused"])
        try:
            yield
        finally:
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
        from .library_kept import KeptPictures, preferences as picture_preferences
        marks.kept = kept = KeptPictures(browser.root, marks, worker)

        @router.get("/picture-settings")
        def picture_settings(): return kept.usage()

        @router.post("/picture-settings")
        def set_picture_settings(change: dict):
            return command(lambda: (picture_preferences(browser.root, change), kept.cache.trim(), kept.usage())[-1])

        @router.post("/kept-picture")
        def request_kept(request: FolderRequest):
            # Slice 7 can request the same producer for a photo not open in Grade.
            kept.schedule(request.path)
            return {"queued": True}

        @router.get("/kept-pixels/{key}")
        def kept_pixels(key: str, lane: Literal["hdr", "sdr"] = "sdr"):
            body, width, height, stride = kept.pixels(key, lane)
            return Response(body, media_type="application/octet-stream", headers={
                "X-Image-Width": str(width), "X-Image-Height": str(height), "X-Bytes-Per-Row": str(stride)})

    @router.get("/health")
    def health():
        return {"writer": marks.writer.status(), "helper": {"restarts": 0, **worker.status()},
            "index": index.status(), "conflicts": marks.conflicts.status(), "problems": recent()}

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
                key = kept.key(photo["path"], item.get("grade_identity", ""))
                item["pictureCurrent"] = bool(kept.current_meta(photo["path"], item.get("grade_identity", "")))
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

    async def helper_result(request, command, **arguments):
        try:
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
            return future.result()
        except RuntimeError as exc:
            log("helper_request_failed", operation=command, paths=arguments, reason=str(exc), action="request stopped; restart app")
            raise HTTPException(status_code=503, detail=helper_error(exc)) from exc
        except (ValueError, OSError, CancelledError) as exc:
            log("helper_request_failed", operation=command, paths=arguments, reason=str(exc), action="request stopped; saved marks retained")
            raise HTTPException(status_code=400, detail=f"The Library could not read {arguments.get('path', 'the selected photos')}. Saved marks are safe; check the photo or folder and try again.") from exc
        finally:
            worker.cancel(job_id)

    @router.get("/options")
    def options():
        return {"timing": os.environ.get("HDR_FINISHER_DEV_LIBRARY_TIMING") == "1"}

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
        if store is not None: result["photos"] = marks.copies.expand(result["photos"])
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
            index.kick()
            return {"pinned": folder_commands.pins(), "skipped": sum(path in previous for path in paths)}
        except (OSError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=user_error(exc)) from exc

    @router.post("/pins/remove")
    def remove_pin(command: FolderRequest):
        # Missing/offline folders must still be removable from preferences.
        try:
            return {"pinned": browser.remove_pin(command.path)}
        except (OSError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=user_error(exc)) from exc

    @router.post("/scan")
    async def scan(command: FolderRequest, request: Request):
        result = await helper_result(request, "scan", path=command.path, priority=0)
        if isinstance(result, Response):
            return result
        return await run_in_threadpool(listing, result, result["path"])

    def listing(result, root=None):
        if root is not None:
            index.remember_scan(root, result["photos"])
        records = marks.read([photo["path"] for photo in result["photos"]])
        by_path = {row["path"]: row for row in records["photos"]}
        for photo in result["photos"]:
            photo.update(by_path[photo["path"]])
            if store is not None:
                try:
                    saved = kept.request(photo["path"])
                    photo.update(edited=saved["edited"], grade_identity=saved["grade_identity"])
                except (ValueError, OSError):
                    photo.update(edited=False)
        result.update(warnings=records["warnings"], undo_available=records["undo_available"])
        if root is not None:
            index.checks.seed({**result,"photos":[dict(photo) for photo in result["photos"]]})
        if store is not None: result["photos"] = marks.copies.expand(result["photos"])
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

    @router.post("/metadata")
    async def metadata(command: MetadataRequest, request: Request):
        result = await helper_result(request, "metadata", paths=list(dict.fromkeys(str(marks.source_path(p)) for p in command.paths)), priority=90)
        if not isinstance(result, Response):
            await run_in_threadpool(index.remember_facts, result["photos"])
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

    @router.post("/albums/add")
    def album_add(request: AlbumRequest):
        return command(marks.album_change, request.name, request.paths, True)

    @router.post("/albums/remove")
    def album_remove(request: AlbumRequest):
        return command(marks.album_change, request.name, request.paths, False)

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
            cached = await run_in_threadpool(kept.cached, command.path)
            if cached: return cached
        command.path = str(marks.source_path(command.path))
        try:
            cached = await run_in_threadpool(cache.cached, command.path, command.edge, command.quality)
        except (ValueError, OSError) as exc:
            raise HTTPException(status_code=400, detail=user_error(exc)) from exc
        if cached:
            return cached
        return await helper_result(request, "picture", **command.model_dump())

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
