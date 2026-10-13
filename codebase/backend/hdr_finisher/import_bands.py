"""Bounded, Grade-import-only bands; other consumers retain serial execution."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from contextvars import ContextVar
import os
from threading import Semaphore
from typing import Callable, TypeVar

_T = TypeVar("_T")
_pool: ContextVar[ThreadPoolExecutor | None] = ContextVar("grade_import_pool", default=None)
_open_slot = Semaphore(1)


@contextmanager
def grade_import_bands(*, enabled: bool = True):
    # Leave at least half the logical CPUs free; one multicore open at a time.
    workers = min(2, max(1, (os.cpu_count() or 2) // 2))
    if not enabled or workers == 1 or not _open_slot.acquire(blocking=False):
        yield
        return
    pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="grade-import-band")
    token = _pool.set(pool)
    try:
        yield
    finally:
        _pool.reset(token)
        # No queued band may outlive a cancelled/failed import or its arrays.
        pool.shutdown(wait=True, cancel_futures=True)
        _open_slot.release()


def parallel_import_enabled():
    return _pool.get() is not None


def run_bands(function: Callable[[int], _T], starts: range):
    pool = _pool.get()
    if pool is None or len(starts) < 2:
        yield from map(function, starts)
    else:
        # Results are only scalars/small integer vectors or None, never images.
        # map yields original band order, irrespective of completion order.
        yield from pool.map(function, starts)


def map_import_negative(image, transform, *, cancelled=None):
    from .color import transform_float32_bounded
    if _pool.get() is None:
        return transform_float32_bounded(image, transform, cancelled=cancelled)
    result = image.astype("float32", copy=False)
    if not result.flags.writeable:
        result = result.copy()
    # Bound even an all-negative band's float64 working arrays. Two 100k
    # pixel bands stay below 100 MB using a conservative 320 bytes/pixel.
    rows = min(128, max(1, 100_000 // max(1, result.shape[1])))
    def band(start):
        if cancelled is not None and cancelled():
            raise RuntimeError("Import cancelled")
        result[start:start + rows] = transform(result[start:start + rows])
    for _ in run_bands(band, range(0, result.shape[0], rows)):
        pass
    return result
