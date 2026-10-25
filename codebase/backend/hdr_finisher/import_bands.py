"""Bounded, Grade-import-only bands; other consumers retain serial execution."""
from .cpu_budget import CpuExecutor
from contextlib import contextmanager
from contextvars import ContextVar
import os
from threading import Semaphore
from typing import Callable, TypeVar

_T = TypeVar("_T")
_pool: ContextVar[CpuExecutor | None] = ContextVar("grade_import_pool", default=None)
_open_slot = Semaphore(1)


@contextmanager
def grade_import_bands(*, enabled: bool = True):
    # One multicore open at a time; divide scratch across all logical CPUs.
    workers = max(1, os.cpu_count() or 1)
    if not enabled or workers == 1 or not _open_slot.acquire(blocking=False):
        yield
        return
    pool = CpuExecutor()
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
    # Keep the original 200k-pixel concurrent scratch allowance as CPUs grow.
    # A row is the smallest band; arrays keep their original operation order.
    workers = max(1, os.cpu_count() or 1)
    rows = min(128, max(1, 200_000 // workers // max(1, result.shape[1])))
    def band(start):
        if cancelled is not None and cancelled():
            raise RuntimeError("Import cancelled")
        result[start:start + rows] = transform(result[start:start + rows])
    # Memory bound: at most the original 200k concurrent scratch pixels;
    # a machine with more CPUs than rows can afford waits for the next wave.
    concurrent = min(workers, max(1, 200_000 // max(1, rows * result.shape[1])))
    starts = range(0, result.shape[0], rows)
    for offset in range(0, len(starts), concurrent):
        for _ in run_bands(band, starts[offset:offset + concurrent]):
            pass
    return result
