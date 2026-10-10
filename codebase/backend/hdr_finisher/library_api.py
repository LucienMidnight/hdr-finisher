"""Library backend commands. The interface never decodes a source or writes a photo."""
from __future__ import annotations

import asyncio
import os
from concurrent.futures import CancelledError
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from .library_pictures import LibraryPictureCache


class PictureRequest(BaseModel):
    path: str
    edge: int = Field(default=320, ge=64, le=2560)
    quality: Literal["fast", "quick"] = "quick"
    priority: int = Field(default=10, ge=0, le=100)


class FolderRequest(BaseModel):
    path: str


class PinsRequest(BaseModel):
    paths: list[str] = Field(max_length=100)


def create_library_router(worker, browser):
    router = APIRouter(prefix="/api/library")
    cache = LibraryPictureCache(browser.root)

    async def helper_result(request, command, **arguments):
        job_id, future = worker.submit_library(command, **arguments)
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
        return {"pinned": browser.pinned()}

    @router.post("/pins")
    def add_pins(command: PinsRequest):
        # Validate the whole selection before changing preferences.
        from .library_folders import checked_folder
        try:
            paths = list(dict.fromkeys(str(checked_folder(path)) for path in command.paths))
            previous = {item["path"] for item in browser.pinned()}
            for path in paths:
                browser.add_pin(path)
            return {"pinned": browser.pinned(), "skipped": sum(path in previous for path in paths)}
        except (OSError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.post("/scan")
    async def scan(command: FolderRequest, request: Request):
        return await helper_result(request, "scan", path=command.path, priority=0)

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
