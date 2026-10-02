"""Let the page's GPU render SDR Match candidates for a waiting Match request.

Match explores editable SDR recipes by rendering each one and measuring it
against the settled HDR target.  The fitting logic and its dependencies between
trials stay in :mod:`sdr_match`; only the rendering of a candidate moves.  The
Match request thread offers a candidate here and waits; the page collects it,
renders it with the preview renderer, and returns display-linear sRGB pixels.

Nothing here is trusted to be exact.  The CPU renders the recipe Match finally
chooses and measures that, so the reported quality and status describe what
export will produce.  Any refusal, timeout or malformed answer abandons the
bridge and the caller reruns the whole fit on the CPU.
"""

from __future__ import annotations

import threading
from collections import deque
from time import monotonic, perf_counter
from typing import Any

import numpy as np


class RemoteCandidateUnavailable(RuntimeError):
    """The page could not supply a candidate; the fit must restart on the CPU."""


class RemoteCandidateBridge:
    FIRST_TIMEOUT_S = 6.0
    TIMEOUT_S = 3.0

    def __init__(self) -> None:
        self._condition = threading.Condition()
        self._pending: deque[dict[str, Any]] = deque()
        self._results: dict[int, np.ndarray | None] = {}
        self._next_id = 1
        self._closed = False
        self.failure: str | None = None
        self.rendered = 0
        self.wait_ms = 0.0
        # Which list of locals the page already holds (see sdr_match).
        self.locals_identity: int | None = None
        # The shoulder anchor the page measured for its latest candidate (diagnostic).
        self.last_anchor: float | None = None

    def render(self, payload: dict[str, Any], width: int, height: int) -> np.ndarray:
        """Offer one candidate and wait for the page's pixels."""
        started = perf_counter()
        with self._condition:
            if self._closed:
                raise RemoteCandidateUnavailable(self.failure or "closed")
            job_id = self._next_id
            self._next_id += 1
            self._pending.append({"job_id": job_id, "width": int(width), "height": int(height), **payload})
            self._condition.notify_all()
            deadline = monotonic() + (self.FIRST_TIMEOUT_S if self.rendered == 0 else self.TIMEOUT_S)
            while job_id not in self._results and not self._closed:
                remaining = deadline - monotonic()
                if remaining <= 0:
                    self._fail("the page did not return a candidate in time")
                    break
                self._condition.wait(remaining)
            result = self._results.pop(job_id, None)
            if result is None:
                self._fail(self.failure or "the page declined a candidate")
                raise RemoteCandidateUnavailable(self.failure)
            self.rendered += 1
            self.wait_ms += (perf_counter() - started) * 1000.0
            return result

    def next_job(self, wait_s: float) -> dict[str, Any] | None:
        """The next candidate for the page, or ``None`` when none arrives in time."""
        deadline = monotonic() + max(0.0, wait_s)
        with self._condition:
            while not self._pending and not self._closed:
                remaining = deadline - monotonic()
                if remaining <= 0:
                    return None
                self._condition.wait(remaining)
            return self._pending.popleft() if self._pending and not self._closed else None

    def submit(
        self, job_id: int, pixels: bytes | None, width: int, height: int, anchor: float | None = None
    ) -> bool:
        """Accept the page's answer; an empty or wrong-sized one ends the bridge."""
        with self._condition:
            if self._closed:
                return False
            self.last_anchor = anchor
            array = None
            # Half-float RGB: the precision the renderer holds this picture in.
            if pixels is not None and len(pixels) == width * height * 6 and width > 0 and height > 0:
                array = np.frombuffer(pixels, dtype="<f2").reshape(height, width, 3).astype(np.float32)
                if not np.isfinite(array).all():
                    array = None
            if array is None:
                self._fail("the page returned no usable candidate")
            self._results[job_id] = array
            self._condition.notify_all()
            return array is not None

    def close(self) -> None:
        with self._condition:
            self._closed = True
            self._pending.clear()
            self._condition.notify_all()

    @property
    def closed(self) -> bool:
        return self._closed

    def _fail(self, reason: str) -> None:
        # Caller holds the condition.
        self.failure = self.failure or reason
        self._closed = True
        self._pending.clear()
        self._condition.notify_all()


_BRIDGES: dict[str, RemoteCandidateBridge] = {}
_BRIDGES_LOCK = threading.Lock()


def open_bridge(session_id: str) -> RemoteCandidateBridge:
    bridge = RemoteCandidateBridge()
    with _BRIDGES_LOCK:
        previous = _BRIDGES.get(session_id)
        _BRIDGES[session_id] = bridge
    if previous is not None:
        previous.close()
    return bridge


def close_bridge(session_id: str, bridge: RemoteCandidateBridge) -> None:
    bridge.close()
    with _BRIDGES_LOCK:
        if _BRIDGES.get(session_id) is bridge:
            del _BRIDGES[session_id]


def bridge_for(session_id: str) -> RemoteCandidateBridge | None:
    with _BRIDGES_LOCK:
        return _BRIDGES.get(session_id)
