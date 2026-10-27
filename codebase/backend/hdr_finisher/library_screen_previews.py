"""Disposable finished screen previews, independent of the scene allowances."""
from hashlib import sha256
import json
import os
from pathlib import Path
from threading import RLock
from time import perf_counter
from uuid import uuid4

import numpy as np

from .library_diagnostics import log
from .library_documents import atomic_json
from .library_copies import source
from .library_live import quality
from .library_pictures import picture_key, PICTURE_VERSION

VERSION = 'stored-screen-preview-jxl-v1:' + PICTURE_VERSION
LIMIT_BYTES = 10 * 1024**3
_lock = RLock()


class StoredScreenPreviews:
    def __init__(self, root, document=None):
        from .library_cache import LibraryCache
        self.cache = LibraryCache(root)
        self.document = document or (lambda path: None)

    @property
    def directory(self):
        return Path(self.cache.preferences()['location']) / 'stored-screen-previews'

    def identity(self, path, display_width, display_height, lane):
        physical = source(path)
        document = self.document(path) or {}
        grade = sha256(json.dumps(document, sort_keys=True).encode()).hexdigest()
        stat = Path(physical).stat()
        identity = dict(version=VERSION, path=str(path), lane=lane,
            display_width=display_width, display_height=display_height,
            source_key=picture_key(physical, 2560, quality(document)),
            stamp=[stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns], grade_identity=grade)
        key = sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
        slot = sha256(json.dumps([str(path), lane, display_width, display_height]).encode()).hexdigest()
        # Live Library's HDR route currently uses the fixed 1000-nit target.
        hdr = document.get('global_adjustments', {}).get('hdr', {})
        from .models import AdjustmentState
        enabled = hdr.get('highlight_section_enabled', AdjustmentState().hdr.highlight_section_enabled)
        return dict(identity, key=key, slot=slot, white=document.get('hdr_reference_white_nits', 203),
                    cap_nits=1000 if enabled else None, quality=quality(document), framing=document.get('framing'))

    def read(self, identity):
        started = perf_counter()
        directory = self.directory
        result = 'miss'
        read_ms = codec_ms = pack_ms = 0.0
        try:
            info = json.loads((directory / (identity['slot'] + '.json')).read_text('utf-8'))
            if info['identity'] != identity:
                result = 'stale'
                return None
            import imagecodecs
            filename = info['file']
            if Path(filename).name != filename or not filename.startswith(identity['key'] + '-') or not filename.endswith('.jxl'):
                raise ValueError('Invalid stored screen preview filename')
            encoded = (directory / filename).read_bytes()
            read_ms = (perf_counter()-started)*1000
            decoding = perf_counter()
            decoded = imagecodecs.jpegxl_decode(encoded, numthreads=os.cpu_count() or 1)
            codec_ms = (perf_counter()-decoding)*1000
            packing = perf_counter()
            if decoded.shape != (info['height'], info['width'], 3):
                result = 'stale'
                return None
            # Keep SDR transport at its native eight bits; widening it would
            # double local HTTP/upload work without adding picture information.
            rgba = np.empty((*decoded.shape[:2], 4), dtype='<u2' if identity['lane'] == 'hdr' else 'u1')
            if identity['lane'] == 'hdr':
                if identity['cap_nits'] is not None:
                    from .jpegxl import _pq_oetf
                    # Floor makes rounding incapable of exceeding the target.
                    ceiling = int(np.floor(_pq_oetf(np.array(identity['cap_nits'], dtype=np.float32)) * 65535)) - 1
                    np.minimum(decoded, ceiling, out=decoded)
                rgba[..., :3] = decoded
            else:
                rgba[..., :3] = decoded
            rgba[..., 3] = 65535 if identity['lane'] == 'hdr' else 255
            result = 'hit'
            body = rgba.tobytes()
            pack_ms = (perf_counter()-packing)*1000
            return info, body
        except FileNotFoundError:
            return None
        except (ValueError, KeyError, TypeError, OSError, RuntimeError):
            result = 'stale'
            return None
        finally:
            log('stored_screen_preview_read', path=identity['path'], rendition=identity['lane'],
                result=result, decode_ms=round((perf_counter()-started)*1000, 2),
                read_ms=round(read_ms, 2), codec_ms=round(codec_ms, 2), pack_ms=round(pack_ms, 2), picture_size='screen preview')

    def write(self, identity, body, width, height, stride, cancelled=lambda: False, source_width=None, source_height=None, protected=False):
        import imagecodecs
        from .color import acescg_to_linear_bt2020
        from .jpegxl import _pq_oetf, _srgb_oetf
        started = perf_counter()
        if cancelled() or not self.cache.preferences()['enabled']:
            return False
        rows = np.frombuffer(body, dtype='<f2').reshape(height, stride // 2)
        pixels = rows[:, :width*4].reshape(height, width, 4)[..., :3].astype(np.float32)
        if not np.isfinite(pixels).all():
            raise ValueError('Invalid finished screen preview pixels')
        if identity['lane'] == 'hdr':
            nits = np.clip(acescg_to_linear_bt2020(pixels) * (identity['white'] / .18), 0, 10000)
            if identity['cap_nits'] is not None:
                np.minimum(nits, identity['cap_nits'], out=nits)
            samples = np.round(_pq_oetf(nits) * 65535).astype(np.uint16)
            tags = dict(bitspersample=16, primaries=imagecodecs.JPEGXL.PRIMARIES.BT2100,
                        transfer=imagecodecs.JPEGXL.TRANSFER_FUNCTION.PQ)
        else:
            samples = np.round(_srgb_oetf(np.clip(pixels, 0, 1)) * 255).astype(np.uint8)
            tags = dict(bitspersample=8, primaries=imagecodecs.JPEGXL.PRIMARIES.SRGB,
                        transfer=imagecodecs.JPEGXL.TRANSFER_FUNCTION.SRGB)
        if cancelled(): return False
        encoded = imagecodecs.jpegxl_encode(samples, distance=.4, effort=3, decodingspeed=1,
            lossless=False, usecontainer=True, numthreads=os.cpu_count() or 1, **tags)
        if cancelled(): return False
        stat = Path(source(identity['path'])).stat()
        if identity['stamp'] != [stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns]: return False
        self.cache.prepare()
        directory = self.directory
        if directory.is_symlink() or getattr(directory, 'is_junction', lambda: False)():
            raise ValueError('Stored screen preview directory cannot be a link')
        directory.mkdir(exist_ok=True)
        filename = identity['key'] + '-' + uuid4().hex + '.jxl'
        file = directory / filename
        with _lock:
            info_path=directory / (identity['slot'] + '.json')
            try: previous=json.loads(info_path.read_text('utf-8'))
            except (FileNotFoundError,ValueError): previous={}
            protected=protected or previous.get('protected',False)
            # Protected files alone must never be evicted to admit another file.
            usage=self.usage()
            old_size=(directory / previous['file']).stat().st_size if previous.get('file') and (directory / previous['file']).is_file() else 0
            if usage['protected_bytes'] + len(encoded) - (old_size if previous.get('protected') else 0) > LIMIT_BYTES:
                raise ValueError('Protected screen previews fill the stored-preview limit. Discard some or build fewer photos.')
            file.write_bytes(encoded)
            atomic_json(directory / (identity['slot'] + '.json'), dict(identity=identity,
                file=filename, protected=bool(protected), width=width, height=height,
                source_width=source_width or width, source_height=source_height or height))
            if previous.get('file') and previous['file']!=filename and Path(previous['file']).name==previous['file']:
                (directory / previous['file']).unlink(missing_ok=True)
            self.trim()
        log('stored_screen_preview_write', path=identity['path'], rendition=identity['lane'],
            write_ms=round((perf_counter()-started)*1000, 2), bytes=len(encoded), picture_size='screen preview')
        return True

    def records(self):
        for file in self.directory.glob('*.json'):
            if file.is_symlink(): continue
            try:
                info=json.loads(file.read_text('utf-8'))
                name=info['file']
                if Path(name).name!=name: continue
                picture=self.directory/name
                if picture.is_symlink(): continue
                yield file,picture,info
            except (OSError,ValueError,KeyError,TypeError): continue

    def usage(self):
        total=protected=count=0
        for manifest,picture,info in self.records():
            try: size=manifest.stat().st_size+picture.stat().st_size
            except FileNotFoundError: continue
            total+=size
            if info.get('protected'): protected+=size;count+=1
        return dict(bytes=total,protected_bytes=protected,protected_previews=count,limit_bytes=LIMIT_BYTES)

    def discard(self, paths):
        wanted=set(paths); removed=0
        with _lock:
            for manifest,picture,info in self.records():
                if info['identity']['path'] in wanted and info.get('protected'):
                    picture.unlink(missing_ok=True);manifest.unlink(missing_ok=True);removed+=1
        log('built_previews_discarded',count=removed)
        return dict(discarded=removed,**self.usage())

    def trim(self):
        protected=set()
        for manifest,picture,info in self.records():
            if info.get('protected'): protected.update((manifest,picture))
        entries = []
        for file in self.directory.glob('*'):
            if file.suffix not in ('.jxl', '.json') or file.is_symlink(): continue
            try: entries.append((file.stat().st_mtime_ns, file.stat().st_size, file))
            except FileNotFoundError: pass
        total = sum(size for _, size, _ in entries)
        for _, size, file in sorted(entries):
            if total <= LIMIT_BYTES: break
            if file in protected: continue
            file.unlink(missing_ok=True)
            total -= size


def add_screen_preview_routes(router, live, worker):
    import asyncio
    from fastapi import HTTPException, Request
    from fastapi.responses import Response
    from starlette.concurrency import run_in_threadpool
    cache = StoredScreenPreviews(live.root, live.document)
    from threading import BoundedSemaphore
    slots = BoundedSemaphore(2)  # Bounded uploads; no folder-sized RAM queue.

    def identity(path, display_width, display_height, lane):
        if lane not in ('hdr', 'sdr') or not 1 <= display_width <= 2560 or not 1 <= display_height <= 2560:
            raise HTTPException(400, 'Invalid screen preview display')
        return cache.identity(path, display_width, display_height, lane)

    @router.get('/stored-screen-preview')
    def read(path: str, display_width: int, display_height: int, lane: str):
        current = identity(path, display_width, display_height, lane)
        result = cache.read(current) if cache.cache.preferences()['enabled'] else None
        if not result: return Response(status_code=204)
        info, body = result
        if current != identity(path, display_width, display_height, lane):
            return Response(status_code=204)
        meta = dict(current, width=info['width'], height=info['height'],
            source_width=info['source_width'], source_height=info['source_height'])
        return Response(body, media_type='application/octet-stream', headers={
            'X-Preview-Width': str(info['width']), 'X-Preview-Height': str(info['height']),
            'X-Preview-Meta': json.dumps(meta, ensure_ascii=True), 'Cache-Control': 'no-store'})

    @router.post('/stored-screen-preview')
    async def write(request: Request, path: str, display_width: int, display_height: int,
                    lane: str, width: int, height: int, stride: int, grade_identity: str, source_key: str,
                    source_width: int, source_height: int, protected: bool = False):
        if not slots.acquire(blocking=False): return Response(status_code=202)
        release_here = True
        try:
            if not 1 <= width <= 2560 or not 1 <= height <= 2560 or stride != ((width*8+255)//256)*256:
                raise HTTPException(400, 'Invalid screen preview dimensions')
            current = await run_in_threadpool(identity, path, display_width, display_height, lane)
            if current['grade_identity'] != grade_identity or current['source_key'] != source_key:
                return Response(status_code=409)
            if int(request.headers.get('content-length', '0')) != stride*height:
                raise HTTPException(400, 'Invalid screen preview byte count')
            body = await request.body()
            if len(body) != stride*height: raise HTTPException(400, 'Invalid screen preview byte count')
            # Spool outside the helper control pipe: a large upload must not
            # hold its foreground request/cancellation lock during IPC.
            import tempfile
            def spool():
                with tempfile.NamedTemporaryFile(prefix='hdr-screen-preview-', suffix='.rgba', delete=False) as file:
                    file.write(body)
                    return Path(file.name)
            body_path = await run_in_threadpool(spool)
            # Separate low-priority helper lane; HTTP publication never waits for encoding.
            def finished(_):
                body_path.unlink(missing_ok=True)
                slots.release()
            try:
                job, future = await run_in_threadpool(worker.submit_library, 'stored-screen-write',
                    priority=99, background=True, identity=current, body_path=str(body_path), width=width, height=height, stride=stride,
                    source_width=source_width, source_height=source_height, protected=protected)
            except Exception:
                body_path.unlink(missing_ok=True)
                raise
            future.add_done_callback(finished)
            release_here = False
            if protected:
                try:
                    saved=await asyncio.wrap_future(future)
                except asyncio.CancelledError:
                    worker.cancel(job)
                    raise
                if not saved: raise HTTPException(409,'The photo changed or preview building was cancelled. Try again.')
                return Response(status_code=200)
            return Response(status_code=202)
        finally:
            if release_here: slots.release()
