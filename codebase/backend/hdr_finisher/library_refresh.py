"""Refresh indexed disposable pictures; originals, grades and built previews stay."""
import json
from pathlib import Path
from .library_copies import source
from .library_diagnostics import log


def refresh(live, screen_previews, paths):
    managed = live.cache.managed
    wanted = set(paths) | {source(path) for path in paths}
    removed = dict(scenes=0, surfaces=0, screen_previews=0)
    # Resolve the selected identities before advancing their publication generation.
    scenes = {file for path in wanted for file in managed.source_files(path, retarget=True)
              if file.suffix in ('.npz', '.surface')}
    indexed = {filename: kind for path in wanted for filename, kind in managed.refresh_files(path)}
    with managed.mutation({source(path) for path in paths}, ''):
        jobs = getattr(live, 'source_jobs', None)
        if jobs is not None:
            jobs.invalidate(paths)
        with live.cache.transient_lock:
            for key, pending in list(live.cache.pending_stores.items()):
                if pending[0] in wanted:
                    live.cache.pending_stores.pop(key, None)
                    live.cache.transient.pop(key, None)
            for file in scenes:
                live.cache.transient.pop(file.stem, None)
                live.cache.pending_stores.pop(file.stem, None)
        for file in scenes:
            managed.remove_disposable(file)
            removed['surfaces' if file.suffix == '.surface' else 'scenes'] += 1
        for filename, kind in indexed.items():
            manifest = Path(filename)
            try:
                info = json.loads(manifest.read_text('utf-8'))
                if info.get('protected'): continue
                name = info['file']
                if Path(name).name != name: continue
                managed.remove_disposable(manifest.parent / name)
                managed.remove_disposable(manifest)
                removed[kind] += 1
            except FileNotFoundError:
                pass
    log('library_pictures_refreshed', photos=len(paths), **removed)
    return removed


def add_refresh_route(router, live, screen_previews):
    from fastapi import HTTPException
    from pydantic import BaseModel
    from starlette.concurrency import run_in_threadpool
    class RefreshRequest(BaseModel):
        paths: list[str]
    @router.post('/refresh-pictures')
    async def refresh_pictures(command: RefreshRequest):
        try:
            return await run_in_threadpool(refresh, live, screen_previews, command.paths[:10000])
        except (OSError, ValueError) as error:
            raise HTTPException(409, f'Could not refresh pictures: {error}') from error
