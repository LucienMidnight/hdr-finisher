"""Shared GPU edge-colour turn for Grade import and source reloads.

Uses the existing delivery renderer, reservation, cancellation and priority
queue. No source files or saved settings are changed by this pixel handoff.
"""
from concurrent.futures import CancelledError
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4
import os
import shutil
import time

import numpy as np

from .color import _ACESCG_TO_LINEAR_BT2020, _LINEAR_BT2020_TO_ACESCG
from .delivery_memory import DeliveryMemory

_work = ContextVar("edge_colour_source_work", default=(0, None))


@contextmanager
def source_work(*, priority, cancelled=None):
    token = _work.set((priority, cancelled))
    try:
        yield
    finally:
        _work.reset(token)


def reconstruct(image, ratio, expand, cancelled=None):
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
            raise CancelledError("RAW reconstruction cancelled.")
        h, w = ratio.shape
        description, packed = memory.allocate((4, h, w))
        packed[:3] = image.transpose(2, 0, 1)
        packed[3] = ratio
        output, _ = memory.allocate((3, h, w))
        identity = "delivery-" + uuid4().hex
        directory = root / identity
        directory.mkdir()
        delivery._atomic(directory / "request.json", {
            "id": identity, "operation": "edge_colour", "width": w, "height": h,
            "expand": float(expand), "toBT": _ACESCG_TO_LINEAR_BT2020.T.tolist(),
            "fromBT": _LINEAR_BT2020_TO_ACESCG.T.tolist(),
            "memory": {"edge_input": description, "edge": output},
            "priority": priority, "created": time.time(),
        })
        frame = SimpleNamespace(delivery_cancelled=cancelled or (lambda: False))
        reply = delivery._wait_for_result(directory, root, frame)
        while reply.get("error") in delivery.PREEMPTED_REASONS:
            for name in ("result.json", "claimed"):
                (directory / name).unlink(missing_ok=True)
            reply = delivery._wait_for_result(directory, root, frame)
        if reply.get("error"):
            raise RuntimeError(reply["error"])
        if not isinstance(reply.get("edge_diagnostics"), dict):
            raise RuntimeError("GPU edge colour returned an incomplete result.")
        result = np.ascontiguousarray(memory.attach(output).transpose(1, 2, 0))
        if not np.isfinite(result).all():
            raise ValueError("GPU edge colour returned invalid pixels.")
        diagnostics = dict(reply["edge_diagnostics"], renderer="gpu", fallback_reason=None,
            total_ms=round((time.perf_counter() - started) * 1000, 1))
        return result, diagnostics
    except (OSError, ValueError, RuntimeError) as error:
        return None, {"renderer": "cpu", "fallback_reason": str(error)}
    finally:
        if directory is not None:
            try:
                (directory / "cancelled").touch()
            except OSError:
                pass
            shutil.rmtree(directory, ignore_errors=True)
        memory.close()
