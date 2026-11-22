"""Where one export's wait goes: exclusive wall time per lane and stage.

An export opens ``export_clock()``. Code marks its work with ``stage(name)``
and a rendition with ``lane(name)``. Stages nest: time spent in an inner
stage counts only there, so the stages add up to the measured work and the
rest is reported as unattributed. Only the thread that opened the clock
records time. Work it hands to the CPU pool is timed by the stage that waits
for it, so parallel helpers are never counted twice.

Without an open clock every call is a cheap no-op, so Grade and Library
rendering through the same functions are unaffected.
"""
from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
import threading
from time import perf_counter

_clock: ContextVar["ExportClock | None"] = ContextVar("export_clock", default=None)


class ExportClock:
    def __init__(self) -> None:
        self.thread = threading.get_ident()
        self.started = perf_counter()
        self.lane = "source"
        self.lanes: dict[str, dict[str, float]] = {}
        self._stack: list[list] = []  # [lane, name, resumed_at]

    def _owned(self) -> bool:
        return threading.get_ident() == self.thread

    def _add(self, lane: str, name: str, seconds: float) -> None:
        stages = self.lanes.setdefault(lane, {})
        stages[name] = stages.get(name, 0.0) + seconds

    def enter(self, name: str) -> None:
        now = perf_counter()
        if self._stack:
            lane, parent, resumed = self._stack[-1]
            self._add(lane, parent, now - resumed)
        self._stack.append([self.lane, name, now])

    def leave(self) -> None:
        now = perf_counter()
        lane, name, resumed = self._stack.pop()
        self._add(lane, name, now - resumed)
        if self._stack:
            self._stack[-1][2] = now

    @property
    def current_stage(self) -> str | None:
        return self._stack[-1][1] if self._stack else None

    def summary(self) -> dict:
        total = (perf_counter() - self.started) * 1000.0
        lanes = {lane: {name: round(seconds * 1000.0, 1) for name, seconds in sorted(stages.items(), key=lambda item: -item[1])}
                 for lane, stages in self.lanes.items()}
        attributed = sum(sum(stages.values()) for stages in lanes.values())
        unattributed = max(0.0, total - attributed)
        return {"total_ms": round(total, 1), "lanes": lanes, "unattributed_ms": round(unattributed, 1),
                "unattributed_percent": round(100.0 * unattributed / total, 2) if total else 0.0}


@contextmanager
def export_clock():
    """Open a clock for this export unless an outer export already owns one."""
    active = _clock.get()
    if active is not None:
        yield active
        return
    clock = ExportClock()
    token = _clock.set(clock)
    try:
        yield clock
    finally:
        _clock.reset(token)


def active_clock() -> ExportClock | None:
    return _clock.get()


@contextmanager
def stage(name: str):
    clock = _clock.get()
    if clock is None or not clock._owned():
        yield
        return
    clock.enter(name)
    try:
        yield
    finally:
        clock.leave()


@contextmanager
def lane(name: str):
    clock = _clock.get()
    if clock is None or not clock._owned():
        yield
        return
    previous, clock.lane = clock.lane, name
    try:
        yield
    finally:
        clock.lane = previous


def timed(name: str):
    """Decorator form of ``stage`` for whole functions."""
    def wrap(function):
        from functools import wraps

        @wraps(function)
        def run(*args, **kwargs):
            if _clock.get() is None:
                return function(*args, **kwargs)
            with stage(name):
                return function(*args, **kwargs)
        return run
    return wrap
