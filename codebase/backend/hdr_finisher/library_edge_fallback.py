"""Measured allowance only for CPU edge colour after rejected GPU pixels."""
from contextlib import contextmanager
from contextvars import ContextVar
from concurrent.futures import CancelledError
from math import ceil
from time import monotonic

# Steve, November 3, 2026: 2x the slower 42/48 MP measurement, capped.
MEASURED_SLOWEST_SECONDS = 32.7
UPPER_CAP_SECONDS = 120
RECONSTRUCTION_TIMEOUT_SECONDS = min(UPPER_CAP_SECONDS, ceil(2 * MEASURED_SLOWEST_SECONDS))
_active = ContextVar("library_rejected_gpu_pixels", default=False)

@contextmanager
def rejected_gpu_pixels(active=True):
    token = _active.set(active)
    try:
        yield
    finally:
        _active.reset(token)

@contextmanager
def reconstruction(progress=None, cancelled=None):
    if not _active.get():
        yield cancelled
        return
    started = monotonic()
    def checkpoint():
        if cancelled and cancelled():
            raise CancelledError("Library CPU edge colour cancelled.")
        if monotonic() - started > RECONSTRUCTION_TIMEOUT_SECONDS:
            raise TimeoutError("Library CPU edge colour reconstruction timed out. Try again.")
        return False
    checkpoint()
    if progress: progress("cpu_edge_fallback", "Rebuilding highlight colour on the CPU")
    try:
        yield checkpoint
        checkpoint()
    finally:
        from .library_diagnostics import log
        log("picture_cpu_edge_reconstruction", duration_ms=(monotonic()-started)*1000,
            allowance_seconds=RECONSTRUCTION_TIMEOUT_SECONDS)
        if progress: progress("color_conversion", "Finishing CPU colour reconstruction")
