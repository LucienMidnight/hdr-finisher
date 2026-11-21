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
        photo = None
        stage = None
        parts = scope.get("path", "").split("/")
        if valid_action(action) and scope.get("method") == "POST" and len(parts) == 6 and parts[1:3] == ["api", "session"]:
            if parts[4] == "denoise-grain":
                stage = "prepared_grain"
            elif (b"x-hdr-finisher-grain-fallback", b"micro") in scope.get("headers", []):
                stage = {"preview": "cpu_preview", "preview-raw": "cpu_preview_raw"}.get(parts[4])
            photo = {"id": parts[3]}
        if not stage:
            with action_scope(action):
                await self.app(scope, receive, send)
            return
        started = time.perf_counter()
        status = None

        async def observed(message):
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
            await send(message)

        with action_scope(action):
            try:
                await self.app(scope, receive, observed)
            finally:
                if status != 401:
                    reason = ("cpu_preparation_complete" if status and status < 400 else "superseded" if status == 409
                              else "cpu_scratch_refused" if status == 507 and stage == "prepared_grain" else "cpu_preparation_failed")
                    event = "grain_cpu_prepare_finished" if reason == "cpu_preparation_complete" else "grain_cpu_prepare_failed"
                    log("denoise", event, photo=photo, route="cpu" if event.endswith("finished") else "refused",
                        reason=reason, level="info" if status and (status < 400 or status == 409) else "error",
                        stage=stage, status=status, duration_ms=round((time.perf_counter() - started) * 1000, 2))
