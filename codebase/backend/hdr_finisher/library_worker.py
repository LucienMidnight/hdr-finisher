"""Low-priority, single-decoder library process; grading never decodes its jobs."""
from __future__ import annotations

from concurrent.futures import CancelledError, Future, TimeoutError
from contextlib import contextmanager
import heapq
import multiprocessing
import os
from pathlib import Path
from threading import Condition, Event, RLock, Thread
import time
from uuid import uuid4


class LibraryWorker:
    def __init__(self, root: Path) -> None:
        self.root = Path(root).resolve()
        self._lock = RLock()
        self._connection = None
        self._process = None
        self._reader = None
        self._ready = Event()
        self._pending: dict[str, Future] = {}
        self._paused: set[str] = set()
        self._closed = False
        self._failure: str | None = None
        self.info: dict = {}

    def start(self) -> None:
        with self._lock:
            if self._closed:
                raise RuntimeError("Library helper is closed.")
            if self._failure:
                raise RuntimeError(self._failure)
            if self._process is None:
                context = multiprocessing.get_context("spawn")
                parent, child = context.Pipe()
                process = context.Process(target=_worker_main,
                    args=(child, str(self.root), os.getpid(), bool(self._paused)),
                    name="hdr-library", daemon=True)
                self._connection = parent
                self._process = process
                try:
                    process.start()
                except Exception:
                    parent.close()
                    child.close()
                    self._process = None
                    self._connection = None
                    raise
                child.close()
                self._reader = Thread(target=self._read_results, name="hdr-library-results", daemon=True)
                self._reader.start()
        if not self._ready.wait(30):
            self.close()
            raise RuntimeError("Library helper did not start in time.")
        if self._failure:
            raise RuntimeError(self._failure)

    def submit_thumbnail(self, value: str, size: int = 256, *, fast_only: bool = False,
                         priority: int = 10) -> tuple[str, Future]:
        self.start()
        job_id = uuid4().hex
        future = Future()
        with self._lock:
            if self._closed or self._failure:
                raise RuntimeError(self._failure or "Library helper is closed.")
            # Bound requests as well as decoder concurrency; no unbounded RAM
            # growth when several clients browse very large folders.
            if len(self._pending) >= 256:
                raise RuntimeError("Library helper queue is full.")
            self._pending[job_id] = future
            try:
                self._connection.send({"command": "thumbnail", "id": job_id,
                    "path": str(value), "size": int(size), "fast_only": bool(fast_only),
                    "priority": int(priority)})
            except (EOFError, OSError) as exc:
                self._pending.pop(job_id, None)
                raise RuntimeError("Library helper is unavailable.") from exc
        return job_id, future

    def thumbnail(self, value: str, size: int = 256, *, fast_only: bool = False,
                  cancel_event: Event | None = None) -> Path:
        job_id, future = self.submit_thumbnail(value, size, fast_only=fast_only,
                                              priority=0 if fast_only else 10)
        try:
            while True:
                if cancel_event is not None and cancel_event.is_set():
                    raise CancelledError("Thumbnail job was cancelled.")
                try:
                    return future.result(timeout=0.1)
                except TimeoutError:
                    continue
        except BaseException:
            self.cancel(job_id)
            raise

    def cancel(self, job_id: str) -> bool:
        with self._lock:
            future = self._pending.pop(job_id, None)
            if future is None:
                return False
            future.cancel()
            self._send({"command": "cancel", "id": job_id})
            return True

    def pause(self, reason: str, paused: bool) -> None:
        with self._lock:
            if paused:
                self._paused.add(reason)
            else:
                self._paused.discard(reason)
            self._send({"command": "pause", "paused": bool(self._paused)})

    @contextmanager
    def busy(self):
        reason = uuid4().hex
        self.pause(reason, True)
        try:
            yield
        finally:
            self.pause(reason, False)

    def _send(self, message: dict) -> None:
        if self._connection is not None and not self._closed and not self._failure:
            try:
                self._connection.send(message)
            except (EOFError, OSError):
                pass  # The reader fails all pending futures when the pipe closes.

    def _read_results(self) -> None:
        try:
            while True:
                message = self._connection.recv()
                if message.get("event") == "ready":
                    self.info = message
                    self._ready.set()
                    continue
                with self._lock:
                    future = self._pending.pop(message["id"], None)
                if future is None or future.done():
                    continue
                if "path" in message:
                    future.set_result(Path(message["path"]))
                else:
                    from .media_browser import MediaBrowserError, MediaBrowserInterpretationRequired
                    error = message.get("error", "Library job failed.")
                    if message.get("reason"):
                        exception = MediaBrowserInterpretationRequired(error,
                            reason=message["reason"], profile_name=message.get("profile_name"))
                    else:
                        exception = MediaBrowserError(error)
                    future.set_exception(exception)
        except (EOFError, OSError, KeyError) as exc:
            with self._lock:
                if not self._closed:
                    self._failure = "Library helper stopped unexpectedly."
                pending = list(self._pending.values())
                self._pending.clear()
            for future in pending:
                if not future.done():
                    future.set_exception(RuntimeError(self._failure or "Library helper closed."))
            self._ready.set()

    def status(self) -> dict:
        with self._lock:
            return {**self.info, "running": bool(self._process and self._process.is_alive()),
                    "pending": len(self._pending), "paused": bool(self._paused),
                    "failure": self._failure}

    def close(self) -> None:
        with self._lock:
            if self._closed:
                return
            self._send({"command": "stop"})
            self._closed = True
            process, connection = self._process, self._connection
            pending = list(self._pending.values())
            self._pending.clear()
        for future in pending:
            future.cancel()
        if process is not None:
            process.join(timeout=3)
            if process.is_alive():
                process.terminate()
                process.join(timeout=3)
        if connection is not None:
            connection.close()


def _lower_priority() -> str:
    if os.name == "nt":
        import ctypes
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.GetCurrentProcess.restype = ctypes.c_void_p
        kernel32.SetPriorityClass.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
        if not kernel32.SetPriorityClass(kernel32.GetCurrentProcess(), 0x00004000):
            raise OSError(ctypes.get_last_error(), "Could not lower library process priority")
        return "below_normal"
    os.nice(10)
    return "nice_10"


def _worker_main(connection, root: str, parent_pid: int, paused: bool) -> None:
    # Set these before importing numpy or any decoder. Native libraries must
    # not create a full-size thread pool in the background process.
    for name in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMEXPR_NUM_THREADS"):
        os.environ[name] = "1"
    priority = _lower_priority()
    from .media_browser import MediaBrowserStore, MediaBrowserInterpretationRequired
    from .launcher import _parent_is_alive
    browser = MediaBrowserStore(Path(root))
    condition = Condition()
    write_lock = RLock()
    queue: list[tuple[int, int, dict]] = []
    jobs: dict[str, Event] = {}
    stopping = Event()
    sequence = 0
    state = {"paused": paused}

    def reply(message):
        with write_lock:
            connection.send(message)

    def decode():
        while not stopping.is_set():
            with condition:
                while not stopping.is_set() and (not queue or state["paused"]):
                    condition.wait(timeout=0.25)
                if stopping.is_set():
                    return
                _priority, _sequence, job = heapq.heappop(queue)
                cancelled = jobs.get(job["id"])
            if cancelled is None or cancelled.is_set():
                continue
            try:
                output = browser.thumbnail(job["path"], job["size"], fast_only=job["fast_only"])
                result = {"id": job["id"], "path": str(output)}
            except MediaBrowserInterpretationRequired as exc:
                result = {"id": job["id"], "error": str(exc), "reason": exc.reason,
                          "profile_name": exc.profile_name}
            except Exception as exc:
                result = {"id": job["id"], "error": str(exc)}
            with condition:
                jobs.pop(job["id"], None)
            if not cancelled.is_set() and not stopping.is_set():
                try:
                    reply(result)
                except (EOFError, OSError):
                    return

    Thread(target=decode, name="hdr-library-decode", daemon=True).start()
    reply({"event": "ready", "pid": os.getpid(), "priority": priority, "decode_workers": 1})
    try:
        while _parent_is_alive(parent_pid):
            if not connection.poll(0.25):
                continue
            message = connection.recv()
            with condition:
                if message["command"] == "stop":
                    break
                if message["command"] == "pause":
                    state["paused"] = message["paused"]
                elif message["command"] == "cancel":
                    event = jobs.pop(message["id"], None)
                    if event is not None:
                        event.set()
                    queue[:] = [item for item in queue if item[2]["id"] != message["id"]]
                    heapq.heapify(queue)
                elif message["command"] == "thumbnail":
                    sequence += 1
                    jobs[message["id"]] = Event()
                    heapq.heappush(queue, (message["priority"], sequence, message))
                condition.notify_all()
    except (EOFError, OSError):
        pass
    finally:
        stopping.set()
        with condition:
            condition.notify_all()
        connection.close()
