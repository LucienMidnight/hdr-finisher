"""Searchable library events, bounded recent problems and grouped batch failures."""
from collections import deque
from contextlib import contextmanager
from contextvars import ContextVar
from functools import wraps
import json
from pathlib import Path
import sys
from threading import RLock
import time

_lock = RLock()
_recent = deque(maxlen=50)
_batch = ContextVar("library_diagnostics_batch", default=None)
_sink = None


def log(event, **fields):
    record = {"event": event, "time": time.time(), **fields}
    with _lock:
        if "reason" in fields and event not in {"writer_pause", "writer_resume", "helper_pause", "helper_resume", "kept_picture_replaced", "kept_picture_cancelled"}:
            _recent.append(record)
    if _sink is not None:
        _sink(record)
    else:
        print("[library] " + event + " " + json.dumps({"time": record["time"], **fields}, ensure_ascii=False, default=str), file=sys.stderr, flush=True)


def recent():
    with _lock:
        return list(_recent)


def problem(event, path, error, action):
    group = _batch.get()
    if group is None:
        log(event, path=str(path), reason=str(error.__cause__ or error), action=action)
        return
    key = (event, str(Path(path).parent), action)
    item = group.setdefault(key, {"count": 0, "examples": []})
    item["count"] += 1
    if len(item["examples"]) < 3:
        item["examples"].append({"path": str(path), "reason": str(error.__cause__ or error)})


@contextmanager
def batch():
    if _batch.get() is not None:
        yield
        return
    groups = {}
    token = _batch.set(groups)
    try:
        yield
    finally:
        _batch.reset(token)
        for (event, folder, action), fields in groups.items():
            log(event, folder=folder, reason=fields["examples"][0]["reason"], action=action, **fields)


def audited(operation, *, milestone=False):
    def decorate(function):
        @wraps(function)
        def call(*args, **kwargs):
            started = time.monotonic()
            values = args[1:] if args and any(hasattr(args[0], key) for key in ("database", "root", "marks")) else args
            context = [([str(item) for item in value[:3]] if isinstance(value, (list, tuple)) else str(value)[:500]) for value in values]
            if milestone:
                log("command_start", operation=operation, context=context, count=len(values[0]) if values and isinstance(values[0], (list, tuple)) else 0)
            with batch():
                try:
                    result = function(*args, **kwargs)
                except Exception as error:
                    from concurrent.futures import CancelledError
                    if not isinstance(error, CancelledError) and not getattr(error, "_library_control", False):
                        log(operation + "_failed", context=context, path=getattr(error, "filename", None), reason=str(error.__cause__ or error), action="request stopped; saved marks retained")
                    raise
            if milestone:
                log("command_end", operation=operation, changed=len(result.get("photos", [])) if isinstance(result, dict) else len(result[0]),
                    skipped=result.get("offline", result.get("skipped", 0)) if isinstance(result, dict) else 0, duration=round(time.monotonic() - started, 3))
            return result
        return call
    return decorate
