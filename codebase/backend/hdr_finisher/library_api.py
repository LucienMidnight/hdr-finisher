"""Library backend commands. The interface never decodes a source or writes a photo."""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
import os
from concurrent.futures import CancelledError
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field, field_validator
from starlette.concurrency import run_in_threadpool

from .library_pictures import LibraryPictureCache
from .library_marks import LibraryMarks, MarkChange, NameTaken
from .library_index import LibraryIndex


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
    kind: Literal["album", "tag"]
    name: str


class IndexRequest(BaseModel):
    action: Literal["pause", "resume", "rescan", "enable", "disable"]


class PreferencesRequest(BaseModel):
    label_names: dict[Literal["red", "orange", "green", "blue"], str]

    @field_validator("label_names")
    @classmethod
    def clean_label_names(cls, values):
        return {label: " ".join(name.split())[:60] for label, name in values.items()}


def create_library_router(worker, browser):
    cache = LibraryPictureCache(browser.root)
    marks = LibraryMarks(browser.root)
    index = LibraryIndex(marks, browser, worker)

    @asynccontextmanager
    async def lifespan(_app):
        await run_in_threadpool(marks.writer.start, lambda: worker.status()["paused"])
        try:
            yield
        finally:
            await run_in_threadpool(marks.writer.close)

    router = APIRouter(prefix="/api/library", lifespan=lifespan)

    @router.post("/settings-status")
    def settings_status(request: PathsRequest):
        return marks.writer.status(request.paths)

    @router.get("/settings-status")
    def settings_summary():
        return marks.writer.status()

    def command(operation, *arguments):
        try:
            return operation(*arguments)
        except NameTaken as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
        except (ValueError, OSError) as error:
            raise HTTPException(status_code=400, detail=str(error)) from error

    async def helper_result(request, command, **arguments):
        job_id, future = await run_in_threadpool(worker.submit_library, command, **arguments)
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
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except (ValueError, OSError, CancelledError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        finally:
            worker.cancel(job_id)

    @router.get("/options")
    def options():
        return {"timing": os.environ.get("HDR_FINISHER_DEV_LIBRARY_TIMING") == "1"}

    @router.get("/pins")
    def pins():
        if index._thread is None:
            index.kick()  # The first Library page starts background indexing.
        return {"pinned": browser.pinned()}

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
            return {"pinned": browser.pinned(), "skipped": sum(path in previous for path in paths)}
        except (OSError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.post("/pins/remove")
    def remove_pin(command: FolderRequest):
        # Missing/offline folders must still be removable from preferences.
        try:
            return {"pinned": browser.remove_pin(command.path)}
        except (OSError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

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
        result.update(warnings=records["warnings"], undo_available=records["undo_available"])
        return result

    @router.post("/collection")
    def collection(request: CollectionRequest):
        """The photos of an album or tag, wherever they are in the library."""
        paths = marks.album_paths(request.name) if request.kind == "album" else marks.tag_paths(request.name)
        photos, missing = index.photos(paths)
        return listing({"path": "", "photos": photos, "unreadable_folders": [], "missing": missing})

    @router.post("/metadata")
    async def metadata(command: MetadataRequest, request: Request):
        result = await helper_result(request, "metadata", paths=command.paths, priority=90)
        if not isinstance(result, Response):
            await run_in_threadpool(index.remember_facts, result["photos"])
        return result

    @router.post("/marks")
    def change_marks(command: MarksRequest):
        try:
            return marks.change(command.paths, command.change)
        except (ValueError, OSError) as error:
            raise HTTPException(status_code=400, detail=str(error)) from error

    @router.post("/undo")
    def undo_marks():
        try:
            return marks.undo()
        except (ValueError, OSError) as error:
            raise HTTPException(status_code=400, detail=str(error)) from error

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
        try:
            cached = await run_in_threadpool(cache.cached, command.path, command.edge, command.quality)
        except (ValueError, OSError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        if cached:
            return cached
        return await helper_result(request, "picture", **command.model_dump())

    @router.post("/native")
    async def native(command: NativeRequest, request: Request):
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
            raise HTTPException(status_code=404, detail="Library cache entry is unavailable; request it again.") from exc

    return router
