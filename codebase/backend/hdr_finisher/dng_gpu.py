"""Shared GPU DNG correction turn for Grade import and source reloads.

Uses the existing delivery renderer, reservation, cancellation and priority
queue. No source files or saved settings are changed by this pixel handoff.
"""
from concurrent.futures import CancelledError
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4
import os
import shutil
import time

import numpy as np

from .delivery_memory import DeliveryMemory

def correct(image, inspection, cancelled=None):
    from .highlight_edge_gpu import _work
    from .library_dng import correction
    from .dng_opcodes import DngImportCancelled
    from .library_gpu_raw import NotEligible
    from . import gpu_delivery as delivery
    from .delivery import preferences
    directory = None
    memory = DeliveryMemory()
    started = time.perf_counter()
    priority, source_cancelled = _work.get()
    cancelled = cancelled or source_cancelled
    try:
        if preferences()["effective_force_cpu"]:
            raise RuntimeError("CPU rendering was selected.")
        root = Path(os.environ[delivery.ROOT_ENV]) if os.environ.get(delivery.ROOT_ENV) else None
        if root is None or not (root / "heartbeat").exists() or time.time() - (root / "heartbeat").stat().st_mtime > 5:
            raise RuntimeError("The GPU delivery renderer is unavailable.")
        if cancelled and cancelled():
            raise CancelledError("DNG correction cancelled.")
        meta, audit = correction(image, inspection, cancelled)
        meta["preserve_signed"] = True
        h, w = meta["height"], meta["width"]
        description, _ = memory.allocate(image.shape, image)
        output, _ = memory.allocate((3, h, w))
        identity = "delivery-" + uuid4().hex
        directory = root / identity
        directory.mkdir()
        delivery._atomic(directory / "request.json", {
            "id": identity, "operation": "dng_correction", "width": w, "height": h,
            "dng": meta, "memory": {"dng_input": description, "dng": output},
            "priority": priority, "created": time.time(),
        })
        prepared_ms = (time.perf_counter() - started) * 1000
        waiting = time.perf_counter()
        frame = SimpleNamespace(delivery_cancelled=cancelled or (lambda: False))
        reply = delivery._wait_for_result(directory, root, frame)
        while reply.get("error") in delivery.PREEMPTED_REASONS:
            for name in ("result.json", "claimed"):
                (directory / name).unlink(missing_ok=True)
            reply = delivery._wait_for_result(directory, root, frame)
        if cancelled and cancelled():
            raise CancelledError("DNG correction cancelled.")
        if reply.get("error"):
            raise RuntimeError(reply["error"])
        if not isinstance(reply.get("dng_diagnostics"), dict):
            raise RuntimeError("GPU DNG correction returned an incomplete result.")
        wait_ms = (time.perf_counter() - waiting) * 1000
        reading = time.perf_counter()
        result = np.ascontiguousarray(memory.attach(output).transpose(1, 2, 0))
        if not np.isfinite(result).all():
            raise ValueError("GPU DNG correction returned invalid pixels.")
        diagnostics = dict(reply["dng_diagnostics"], operations=audit, renderer="gpu", fallback_reason=None,
            priority=priority, prepare_handoff_ms=prepared_ms,
            queue_ms=max(0., wait_ms-float(reply.get("total_ms", wait_ms))),
            result_copy_ms=(time.perf_counter()-reading)*1000,
            total_ms=round((time.perf_counter() - started) * 1000, 1))
        return result, diagnostics
    except DngImportCancelled:
        raise
    except (OSError, ValueError, RuntimeError, NotEligible) as error:
        return None, {"renderer": "cpu", "fallback_reason": str(error)}
    finally:
        if directory is not None:
            try:
                (directory / "cancelled").touch()
            except OSError:
                pass
            shutil.rmtree(directory, ignore_errors=True)
        memory.close()
