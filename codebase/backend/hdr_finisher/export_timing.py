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
import os
import threading
import time
from time import perf_counter

_clock: ContextVar["ExportClock | None"] = ContextVar("export_clock", default=None)


class ExportClock:
    def __init__(self) -> None:
        self.thread = threading.get_ident()
        self.started = perf_counter()
        self._started_epoch = time.time()
        self._trace = [] if os.environ.get("HDR_FINISHER_EXPORT_STAGE_TRACE") == "1" else None
        self._develop_s = 0.0
        self._lock = threading.Lock()
        self.lane = "source"
        self.lanes: dict[str, dict[str, float]] = {}
        self._stack: list[list] = []  # [lane, name, resumed_at]
        self.finished_lanes: set[str] = set()
        self.progress = None  # export_progress.ExportProgress, when someone watches

    def _owned(self) -> bool:
        return threading.get_ident() == self.thread

    def _add_slice(self, lane: str, name: str, resumed: float, now: float) -> None:
        stages = self.lanes.setdefault(lane, {})
        stages[name] = stages.get(name, 0.0) + (now - resumed)
        if self._trace is not None:
            self._trace.append([lane, name,
                                round(self._started_epoch + (resumed - self.started), 3),
                                round(self._started_epoch + (now - self.started), 3)])

    def enter(self, name: str) -> None:
        with self._lock:
            now = perf_counter()
            if self._stack:
                self._add_slice(*self._stack[-1], now)
            self._stack.append([self.lane, name, now])

    def leave(self) -> None:
        with self._lock:
            now = perf_counter()
            self._add_slice(*self._stack.pop(), now)
            if self._stack:
                self._stack[-1][2] = now

    def current(self) -> tuple[str, str | None]:
        with self._lock:
            if self._stack:
                lane, name, _ = self._stack[-1]
                return lane, name
            return self.lane, None

    @property
    def current_stage(self) -> str | None:
        return self.current()[1]

    @property
    def current_lane(self) -> str:
        return self.current()[0]

    def lane_finished(self, name: str) -> bool:
        with self._lock:
            return name in self.finished_lanes

    def elapsed(self, lane: str, name: str) -> float:
        """Seconds spent so far in one stage, including a running one. Any thread."""
        with self._lock:
            seconds = self.lanes.get(lane, {}).get(name, 0.0)
            top = self._stack[-1] if self._stack else None
            if top and top[0] == lane and top[1] == name:
                seconds += max(0.0, perf_counter() - top[2])
            return seconds

    def record_development(self, seconds: float) -> None:
        """Include batch RAW development that ran before this clock opened."""
        with self._lock:
            self._develop_s = seconds
            self.lanes.setdefault("source", {})["develop_raw"] = seconds
            if self._trace is not None:
                self._trace.insert(0, ["source", "develop_raw", round(self._started_epoch - seconds, 3),
                                       round(self._started_epoch, 3)])

    def summary(self) -> dict:
        with self._lock:
            total = (perf_counter() - self.started + self._develop_s) * 1000.0
            lanes = {lane: {name: round(seconds * 1000.0, 1) for name, seconds in sorted(stages.items(), key=lambda item: -item[1])}
                     for lane, stages in self.lanes.items()}
            trace = list(self._trace) if self._trace is not None else None
        attributed = sum(sum(stages.values()) for stages in lanes.values())
        unattributed = max(0.0, total - attributed)
        summary = {"total_ms": round(total, 1), "lanes": lanes, "unattributed_ms": round(unattributed, 1),
                   "unattributed_percent": round(100.0 * unattributed / total, 2) if total else 0.0}
        if trace is not None:
            summary["stage_trace"] = trace
        return summary


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
    with clock._lock:
        previous, clock.lane = clock.lane, name
    try:
        yield
    finally:
        with clock._lock:
            clock.lane = previous
            clock.finished_lanes.add(name)


def tick(done: int, total: int) -> None:
    """Report progress through the loop of the running stage. Any thread."""
    clock = _clock.get()
    if clock is not None and clock.progress is not None and total > 0:
        clock.progress.tick(done, total)


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
