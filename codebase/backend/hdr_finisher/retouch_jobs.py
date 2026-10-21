"""Prototype worker, stale-work guard and byte-bounded completed-repair cache.

The app must publish a completion under its session lock after checking the
same token. This service never mutates sessions, history or the last image.
"""
from collections import OrderedDict
from concurrent.futures import CancelledError, ThreadPoolExecutor
from dataclasses import asdict, dataclass
import hashlib
import json
from threading import BoundedSemaphore, Event, RLock

from .retouch import CpuInpaint, InpaintSettings, RepairInput, RepairPatch


@dataclass(frozen=True)
class RepairRevision:
    document: str
    source: str  # source fingerprint + interpretation/upstream recipe identity
    revision: int


@dataclass(frozen=True)
class RepairCompletion:
    token: RepairRevision
    key: str
    patch: RepairPatch
    cached: bool
    cancellation: Event


def repair_key(request, settings, source):
    digest = hashlib.sha256()
    digest.update(json.dumps([source, request.origin, request.pixels.shape, asdict(settings)],
                             sort_keys=True, separators=(",", ":")).encode())
    for array in (request.pixels, request.mask, request.excluded):
        digest.update(array.tobytes(order="C"))
    return digest.hexdigest()


class RepairWorker:
    """One active solve + one waiting ROI; reject extra work instead of queuing.

    Thread worker keeps work outside Electron/UI; heavy gathers/reductions run
    in NumPy. Service is intentionally separate from the Library decoder so a
    repair does not block thumbnail/import work. No native application deps.
    """
    def __init__(self, engine=None, cache_bytes=8 * 1024 * 1024):
        if not 0 <= cache_bytes <= 64 * 1024 * 1024:
            raise ValueError("Prototype repair cache must be 0..64 MiB")
        self.engine = engine or CpuInpaint()
        self.cache_bytes = cache_bytes
        self._pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="retouch")
        self._slots = BoundedSemaphore(2)
        self._lock = RLock()
        self._current = None
        self._cache = OrderedDict()
        self._bytes = 0
        self._closed = False
        self._events = set()

    def set_current(self, token):
        with self._lock:
            self._current = token

    def submit(self, request: RepairInput, settings=InpaintSettings(), *, token):
        if not self._slots.acquire(blocking=False):
            raise RuntimeError("Repair worker is full; cancel or wait before submitting")
        cancel = Event()
        try:
            # Own bounded snapshots before the caller can edit/release buffers.
            owned = request.owned()
            key = repair_key(owned, settings, token.source)
            with self._lock:
                if self._closed:
                    raise RuntimeError("Repair worker is closed")
                self._events.add(cancel)

                def check():
                    with self._lock:
                        if cancel.is_set() or token != self._current or self._closed:
                            raise CancelledError("Cancelled or superseded repair")

                def run():
                    check()
                    with self._lock:
                        cached = self._cache.get(key)
                        if cached is not None:
                            self._cache.move_to_end(key)
                    if cached is not None:
                        check()
                        return RepairCompletion(token, key, cached, True, cancel)
                    patch = self.engine.solve(owned, settings, check)
                    # Check and cache atomically with revision changes. Failed or
                    # stale jobs never replace the last valid cached patch.
                    with self._lock:
                        check()
                        if patch.nbytes <= self.cache_bytes:
                            self._cache[key] = patch
                            self._bytes += patch.nbytes
                            while self._bytes > self.cache_bytes:
                                _, old = self._cache.popitem(last=False)
                                self._bytes -= old.nbytes
                    return RepairCompletion(token, key, patch, False, cancel)

                future = self._pool.submit(run)
        except BaseException:
            with self._lock:
                self._events.discard(cancel)
            self._slots.release()
            raise

        def release(_):
            with self._lock:
                self._events.discard(cancel)
            self._slots.release()
        future.add_done_callback(release)
        return future, cancel

    def accept(self, completion):
        """Recheck at consumption, even if the job was current when it ended."""
        with self._lock:
            if completion.token != self._current or self._closed or completion.cancellation.is_set():
                raise CancelledError("Repair completion no longer belongs to this edit")
            return completion.patch

    def close(self):
        with self._lock:
            self._closed = True
            for event in self._events:
                event.set()
        self._pool.shutdown(wait=True, cancel_futures=True)
        with self._lock:
            self._cache.clear()
            self._bytes = 0

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()
