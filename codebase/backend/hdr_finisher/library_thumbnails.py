"""Batched compressed grid/filmstrip thumbnails; cached work never joins the decode queue."""
import base64
from concurrent.futures import CancelledError, Future
from hashlib import sha256
from time import monotonic
import json
import os
from pathlib import Path
from tempfile import NamedTemporaryFile
from threading import RLock, Thread
from types import SimpleNamespace
import numpy as np
from .library_cache import LibraryCache
from .library_thumbnail_codec import VERSION, encode
from .library_pictures import LibraryPictureCache, PICTURE_VERSION, decode_picture, default_look, reduce_picture
from .models import AdjustmentState, ExportSettings, PreviewKind


# One stored size per photo; the grid scales it to any cell size. Keying on
# the cell's exact width missed the cache whenever the window changed.
THUMBNAIL_EDGE = 640


def thumbnail_key(path, edge, grade_identity='', kept_key=''):
    source = Path(path).resolve(strict=True)
    stat = source.stat()
    return sha256(f'{VERSION}:{PICTURE_VERSION}:{source}:{stat.st_size}:{stat.st_mtime_ns}:{edge}:{grade_identity}:{kept_key}'.encode()).hexdigest()


def build(root, path, edge, key, kept=None, cancelled=None):
    from .library_pictures import check_cancelled
    managed = LibraryCache(root)
    preferences = managed.preferences()
    enabled = preferences['enabled']
    source_stat = Path(path).stat()
    check_cancelled(cancelled)
    if kept:
        # The kept picture already contains the saved grade. Never render it twice.
        from .library_kept import jpeg_renditions
        from .gainmap_decoders import decode_avif
        if kept['extension'] == 'jpg':
            hdr = jpeg_renditions(kept['file'], True)
            sdr = jpeg_renditions(kept['file'], False)
        else:
            hdr, sdr, _ = decode_avif(Path(kept['file']))
        hdr, sdr = reduce_picture(hdr, edge), reduce_picture(sdr, edge)
    else:
        if enabled:
            cache = LibraryPictureCache(root)
            meta = cache.build(path, edge, 'quick', getattr(cancelled, 'cancelled', cancelled))
            check_cancelled(cancelled)
            with np.load(cache.file(meta['key']), allow_pickle=False) as stored:
                pixels = stored['pixels'].astype(np.float32)
                reference = stored['reference'].astype(np.float32) if 'reference' in stored else None
            adjustments = AdjustmentState.model_validate(meta['adjustments'])
        else:
            pixels, reference, meta = decode_picture(Path(path), edge, 'quick')
            starting = meta.pop('starting_look', None)
            adjustments = AdjustmentState.model_validate(starting) if starting else default_look(pixels, reference, meta.pop('raw_input', False), Path(path).suffix.lower())
        adjustments.hdr.highlight_compression_target_nits = 1000
        # Use the established numerical renderer as a read-only consumer. The
        # GPU scene path for Single/Compare/100% and all export code are unchanged.
        from .adjustments import apply_adjustments, apply_hdr_output_highlight_compression, apply_sdr_output_highlight_compression
        from .color_context import RenderColorContext
        context = RenderColorContext(203)
        def render(kind):
            check_cancelled(cancelled)
            image = apply_adjustments(pixels, adjustments, kind, sdr_reference_image=reference,
                include_grain=True, include_output_highlight_compression=False, color_context=context)
            check_cancelled(cancelled)
            return apply_hdr_output_highlight_compression(image, adjustments, color_context=context) if kind == PreviewKind.HDR else apply_sdr_output_highlight_compression(image, adjustments)
        hdr, sdr = render(PreviewKind.HDR), render(PreviewKind.SDR)
    check_cancelled(cancelled)
    # Match Library's unchanged GPU composite: its 10000-nit transport ceiling
    # applies even when the creative highlight-compression section is disabled.
    from .color import acescg_to_linear_bt2020, linear_bt2020_to_acescg
    hdr = linear_bt2020_to_acescg(np.clip(acescg_to_linear_bt2020(hdr), 0, 10000 * .18 / 203))
    check_cancelled(cancelled)
    body = encode(hdr, sdr)
    check_cancelled(cancelled)
    current = Path(path).stat()
    if (source_stat.st_size, source_stat.st_mtime_ns) != (current.st_size, current.st_mtime_ns):
        raise ValueError('Photo changed while its thumbnail was being made.')
    if managed.preferences() != preferences:
        raise CancelledError('Cache settings changed.')
    if not enabled:
        return {'key': key, 'data': base64.b64encode(body).decode(), 'kept': bool(kept), 'edge': edge}
    managed.prepare()
    directory = managed.directory('library-thumbnails')
    directory.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile(dir=directory, suffix='.tmp', delete=False) as f:
        temp = Path(f.name)
        f.write(body)
    try:
        check_cancelled(cancelled)
        os.replace(temp, directory / (key + '.jpg'))
    finally:
        temp.unlink(missing_ok=True)
    managed.trim()
    return {'key': key, 'kept': bool(kept), 'edge': edge}


class Thumbnails:
    def __init__(self, root, worker, marks, kept=None):
        self.managed = LibraryCache(root)
        self.worker, self.marks, self.kept = worker, marks, kept
        self.jobs = {}
        self.lock = RLock()
        self.touched = {}
        self.clients = {}
        self.job_paths = {}

    def cancel(self):
        with self.lock:
            for job_id, _ in self.jobs.values():
                if job_id is not None:
                    self.worker.cancel(job_id)
            self.jobs.clear()
            self.touched.clear()
            self.job_paths.clear()
            self.clients.clear()

    def dispatch(self, requests):
        for key, job, arguments in requests:
            with self.lock:
                if self.jobs.get(key) is not job:
                    continue
            try:
                job_id, actual = self.worker.submit_library('grid-thumbnail', **arguments)
                with self.lock:
                    if self.jobs.get(key) is not job:
                        self.worker.cancel(job_id)
                        continue
                    job[0] = job_id
                def transfer(future, destination=job[1]):
                    if destination.done():
                        return
                    try:
                        destination.set_result(future.result())
                    except Exception as error:
                        if not destination.done(): destination.set_exception(error)
                actual.add_done_callback(transfer)
            except Exception as error:
                if not job[1].done(): job[1].set_exception(error)

    def file(self, key):
        if len(key) != 64 or any(c not in '0123456789abcdef' for c in key):
            raise ValueError('Invalid thumbnail key.')
        return self.managed.directory('library-thumbnails') / (key + '.jpg')

    def batch(self, paths, edge, priority=10, client="", wanted=None, populate=True):
        ready, pending, errors, requests = [], [], [], []
        edge = THUMBNAIL_EDGE
        with self.lock:
            if client and wanted is not None:
                self.clients[client] = (monotonic(), {(p,edge) for p in wanted})
                self.clients = {c:v for c,v in self.clients.items() if monotonic()-v[0]<30}
                wanted_paths = set().union(*(v[1] for v in self.clients.values()))
                for key, job in list(self.jobs.items()):
                    if self.job_paths.get(key) not in wanted_paths and not job[1].done():
                        if job[0] is not None: self.worker.cancel(job[0])
                        self.jobs.pop(key,None)
                        self.touched.pop(key,None)
                        self.job_paths.pop(key,None)
            # Results that were scrolled past must not keep growing the helper queue.
            for key, (job_id, future) in list(self.jobs.items()):
                if (future.done() and self.file(key).exists()) or monotonic() - self.touched.get(key, 0) > 15:
                    if job_id is not None: self.worker.cancel(job_id)
                    self.jobs.pop(key, None)
                    self.touched.pop(key, None)
                    self.job_paths.pop(key, None)
            for path in dict.fromkeys(paths):
                try:
                    source = str(self.marks.source_path(path))
                    saved = self.kept.cached(path,edge) if self.kept else None
                    request = self.kept.request(path) if self.kept else {}
                    key = thumbnail_key(source, edge, request.get('grade_identity', ''), saved['key'] if saved else '')
                    info = {'path': path, 'key': key, 'kept': bool(saved), 'edge': edge}
                    file = self.file(key)
                    if file.is_file():
                        os.utime(file, None)
                        ready.append(info | {'url': '/api/library/thumbnail/' + key, 'cache_hit': True})
                        continue
                    self.touched[key] = monotonic()
                    job = self.jobs.get(key)
                    if job and job[1].done():
                        self.jobs.pop(key)
                        self.job_paths.pop(key,None)
                        result = job[1].result()
                        if result.get('data'):
                            ready.append(info | {'url': 'data:image/jpeg;base64,' + result['data'], 'cache_hit': False})
                        elif file.is_file():
                            ready.append(info | {'url': '/api/library/thumbnail/' + key, 'cache_hit': False})
                        else:
                            pending.append(path)
                        continue
                    if populate and not job and len(self.jobs) < 64:
                        kept = saved | {'file': str(self.kept.cache.root / (saved['key'] + '.' + saved['extension']))} if saved else None
                        job = [None, Future()]
                        self.jobs[key] = job
                        self.job_paths[key] = (path,edge)
                        requests.append((key, job, dict(path=source, edge=edge, key=key, kept=kept, priority=90)))
                    pending.append(path)
                except (ValueError, OSError, RuntimeError, CancelledError) as exc:
                    errors.append({'path': path, 'message': str(exc)})
        if requests:
            Thread(target=self.dispatch, args=(requests,), name='library-thumbnail-requests', daemon=True).start()
        return {'ready': ready, 'pending': pending, 'errors': errors}
