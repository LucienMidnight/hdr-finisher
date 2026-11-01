"""Refresh thumbnail: forget a photo's stored Library pictures so it develops again.

Steve, November 1, 2026: a right-click action for pictures that look wrong
(for example the teal/black 42 MP thumbnails) and for testing. Removes the
stored scenes at every size, the finished display surfaces and unprotected
screen previews. Photos, grades, marks and protected built previews stay.
Cache file names are hashes, so files are matched by the photo path in their
own small headers; this is a manual action, not a hot path.
"""
import json
import os
import zipfile
from pathlib import Path

import numpy as np

from .library_copies import source
from .library_diagnostics import log


def _norm(path):
    return os.path.normcase(os.path.abspath(str(path)))


def _scene_path(file):
    """Photo path from a stored scene's metadata, without reading its pixels."""
    try:
        with zipfile.ZipFile(file) as archive:
            with archive.open("metadata.npy") as handle:
                text = str(np.lib.format.read_array(handle, allow_pickle=False))
        return json.loads(text).get("path")
    except (OSError, KeyError, ValueError, zipfile.BadZipFile):
        return None


def refresh(live, screen_previews, paths):
    wanted = {_norm(p) for p in paths} | {_norm(source(p)) for p in paths}
    cache = live.cache
    removed = {"scenes": 0, "surfaces": 0, "screen_previews": 0}
    for directory in (cache.root, cache.full_root):
        for file in Path(directory).glob("*.npz"):
            found = _scene_path(file)
            if found is None or _norm(found) not in wanted:
                continue
            with cache.transient_lock:
                cache.transient.pop(file.stem, None)
                cache.pending_stores.pop(file.stem, None)
            file.unlink(missing_ok=True)
            cache.managed.record(file)
            removed["scenes"] += 1
    surfaces = cache.managed.directory("library-thumbnails")
    for file in surfaces.glob("*.surface"):
        try:
            with file.open("rb") as handle:
                found = json.loads(handle.readline()).get("identity", {}).get("path")
        except (OSError, ValueError, AttributeError):
            continue
        if found and _norm(found) in wanted:
            file.unlink(missing_ok=True)
            cache.managed.record(file)
            removed["surfaces"] += 1
    for manifest, picture, info in list(screen_previews.records()):
        found = info.get("identity", {}).get("path")
        if found and _norm(found) in wanted and not info.get("protected"):
            picture.unlink(missing_ok=True)
            manifest.unlink(missing_ok=True)
            removed["screen_previews"] += 1
    log("library_pictures_refreshed", photos=len(paths), **removed)
    return removed


def add_refresh_route(router, live, screen_previews):
    from pydantic import BaseModel
    from starlette.concurrency import run_in_threadpool

    class RefreshRequest(BaseModel):
        paths: list[str]

    @router.post("/refresh-pictures")
    async def refresh_pictures(command: RefreshRequest):
        return await run_in_threadpool(refresh, live, screen_previews, command.paths[:10000])
