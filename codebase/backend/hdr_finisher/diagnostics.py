"""Structured decisions sent through the desktop's existing stderr collector."""
from collections.abc import Mapping
from contextlib import contextmanager
from contextvars import ContextVar
from itertools import count
import json
import os
import re
import sys
from threading import Lock
import time

ACTION_HEADER = "X-HDR-Finisher-Action"
_ACTION = re.compile(r"[a-zA-Z0-9_-]{1,80}")
_NAME = re.compile(r"[a-z][a-z0-9_]{0,79}")
_PRIVATE = re.compile(r"secret|password|authorization|cookie|^token$|request.?body|base64|^(pixels?|pixel_data|data)$", re.I)
_AREAS = {"app", "library", "grade", "denoise", "gpu", "memory", "raw", "export", "proof", "match"}
_action = ContextVar("diagnostic_action", default=None)
_sequence = count(1)
_process = ContextVar("diagnostic_process", default="backend")
_lock = Lock()


def valid_action(value):
    return value if isinstance(value, str) and _ACTION.fullmatch(value) else None


def current_action():
    return _action.get()


@contextmanager
def action_scope(action):
    reset = _action.set(valid_action(action))
    try:
        yield
    finally:
        _action.reset(reset)


@contextmanager
def process_scope(role):
    reset = _process.set(role)
    try:
        yield
    finally:
        _process.reset(reset)


def _safe(value, depth=0):
    if isinstance(value, str):
        return value[:1000]
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if depth >= 3:
        return None
    if isinstance(value, Mapping):
        return {key: _safe(item, depth + 1) for key, item in list(value.items())[:48]
                if isinstance(key, str) and len(key) <= 80 and not _PRIVATE.search(key)}
    if isinstance(value, (tuple, list)):
        return [_safe(item, depth + 1) for item in value[:16]]
    return None


def log(area, event, *, level="info", action=None, photo=None, **fields):
    if area not in _AREAS or not _NAME.fullmatch(event) or level not in {"info", "warn", "error"}:
        return
    stream = sys.stderr
    if stream is None:
        return
    with _lock:
        record = {**_safe(fields), "time": time.time(), "seq": next(_sequence), "proc": _process.get(), "pid": os.getpid(),
                  "area": area, "event": event, "level": level, "action": valid_action(action) or current_action(),
                  "photo": _safe(photo) if isinstance(photo, Mapping) else None}
        try:
            line = json.dumps(record, ensure_ascii=True, allow_nan=False, separators=(",", ":"))
            if len(line) <= 8192:
                stream.write(line + "\n")
                stream.flush()
        except (OSError, ValueError):
            pass


class RequestAction:
    """Keep the header in context for routes, worker threads and streaming bodies."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        header = ACTION_HEADER.lower().encode("ascii")
        action = next((value.decode("latin-1") for key, value in scope.get("headers", []) if key == header), None)
        with action_scope(action):
            await self.app(scope, receive, send)
