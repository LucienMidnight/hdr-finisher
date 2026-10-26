"""Low-priority Library CPU lanes; Grade never decodes their jobs."""
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
from .library_diagnostics import log, problem


class LibraryWorker:
    def __init__(self, root: Path) -> None:
        self.root = Path(root).resolve()
        self._lock = RLock()
        self._connection = None
        self._process = None
        self._reader = None
        self._ready = Event()
        self._pending: dict[str, Future] = {}
        self._requests = {}
        self._work = {}
        self._stop = Event()
        self._restarts = 0
        self._recovering = False
        self._restart_limit = 3
        self._paused: set[str] = set()
        self._source_foreground = set()
        self._closed = False
        self._failure: str | None = None
        self.info: dict = {}

    def start(self) -> None:
        with self._lock:
            if self._closed:
                raise RuntimeError("Library helper is closed.")
            if self._failure:
                raise RuntimeError(self._failure)
            if self._recovering:
                return  # Queue reads without occupying a backend request thread.
            if self._reader is None:
                self._reader = Thread(target=self._supervise, name="hdr-library-results", daemon=True)
                self._reader.start()
        if not self._ready.wait(32):
            raise RuntimeError("Library helper is restarting; try again in a moment.")
        if self._failure:
            raise RuntimeError(self._failure)

    def _launch(self):
        with self._lock:
            if self._closed:
                return None
            context = multiprocessing.get_context("spawn")
            parent, child = context.Pipe()
            process = context.Process(target=_worker_main,
                    args=(child, str(self.root), os.getpid(), bool(self._paused)),
                    name="hdr-library", daemon=False)
            self._connection = parent
            self._process = process
            try:
                process.start()
            except Exception:
                parent.close()
                self._process = None
                self._connection = None
                raise
            finally:
                child.close()
            log("helper_process_started", pid=process.pid)
            return parent

    def _supervise(self):
        while not self._stop.is_set():
            connection = None
            try:
                connection = self._launch()
                if connection is None:
                    return
                self._read_results(connection)
                return
            except (EOFError, OSError, KeyError, RuntimeError) as error:
                with self._lock:
                    if self._closed:
                        return
                    self._ready.clear()
                    self._recovering = True
                    self._work.clear()
                    process = self._process
                    self._connection = None
                    log("helper_stopped", reason=repr(error), pending=len(self._pending), action="waiting requests retained; Grade unaffected")
                # Dispose the failed generation before launching another. Never
                # hold the control lock during process joins or restart backoff.
                if process is not None:
                    if process.is_alive():
                        process.terminate()
                    process.join(timeout=3)
                if connection is not None:
                    connection.close()
                with self._lock:
                    if self._closed:
                        return
                    if self._restarts >= self._restart_limit:
                        self._failure = "Library helper stopped after repeated problems."
                        self._recovering = False
                        pending = list(self._pending.values())
                        self._pending.clear()
                        self._requests.clear()
                        log("helper_restart_exhausted", reason=repr(error), restarts=self._restarts, action="automatic attempts stopped; restart app; Grade unaffected")
                    else:
                        pending = None
                        self._restarts += 1
                        log("helper_restart", reason=repr(error), restarts=self._restarts, action="restart automatically; replay read-only waiting requests")
                if pending is not None:
                    for future in pending:
                        if not future.done():
                            future.set_exception(RuntimeError(self._failure))
                    self._ready.set()
                    return
                if self._stop.wait(min(2, .5 * self._restarts)):
                    return

    def submit_thumbnail(self, value: str, size: int = 256, *, fast_only: bool = False, embedded_only: bool = False,
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
                self._requests[job_id] = {"command": "thumbnail", "id": job_id,
                    "path": str(value), "size": int(size), "fast_only": bool(fast_only), "embedded_only": bool(embedded_only), "priority": int(priority)}
                if self._connection is not None and not self._recovering:
                    self._connection.send(self._requests[job_id])
            except (EOFError, OSError) as exc:
                problem("helper_send_failed", value, exc, "request retained for automatic helper restart")
        return job_id, future

    def submit_library(self, command: str, *, priority: int = 10, **arguments) -> tuple[str, Future]:
        if command not in {"picture", "native", "scan", "tree", "metadata", "kept-check", "overlay", "live-scene", "live-fallback", "stored-screen-write"}:
            raise ValueError("Unknown library helper command.")
        self.start()
        job_id = uuid4().hex
        future = Future()
        with self._lock:
            if self._closed or self._failure:
                raise RuntimeError(self._failure or "Library helper is closed.")
            if len(self._pending) >= 256:
                raise RuntimeError("Library helper queue is full.")
            self._pending[job_id] = future
            try:
                self._requests[job_id] = {**arguments, "command": command, "id": job_id, "priority": priority}
                if self._connection is not None and not self._recovering:
                    self._connection.send(self._requests[job_id])
            except (EOFError, OSError) as exc:
                problem("helper_send_failed", arguments.get("path", arguments.get("paths", [])), exc, "request retained for automatic helper restart")
        return job_id, future

    def prioritize(self, job_id, priority):
        with self._lock:
            request = self._requests.get(job_id)
            if request and priority < request["priority"]:
                request["priority"] = priority
                self._send({"command": "prioritize", "id": job_id, "priority": priority})

    def submit_browse_picture(self, **arguments) -> tuple[str, Future]:
        """Non-RAW browsing owns its job, independently of HTTP waiters."""
        from .library_pictures import picture_key
        key = picture_key(arguments["path"], arguments["edge"], arguments["quality"])
        self.start()
        with self._lock:
            for job_id, request in self._requests.items():
                if request.get("browse_key") == key:
                    priority = min(request["priority"], arguments.get("priority", 10))
                    request["priority"] = priority
                    self._send({"command": "prioritize", "id": job_id, "priority": priority})
                    return job_id, self._pending[job_id]
            return self.submit_library("picture", browse_key=key, **arguments)

    def thumbnail(self, value: str, size: int = 256, *, fast_only: bool = False, embedded_only: bool = False,
                  cancel_event: Event | None = None) -> Path:
        job_id, future = self.submit_thumbnail(value, size, fast_only=fast_only, embedded_only=embedded_only,
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
            self._requests.pop(job_id, None)
            if job_id in self._work:
                self._work[job_id]["state"] = "stopping"
            if future is None:
                return False
            future.cancel()
            self._send({"command": "cancel", "id": job_id})
            return True

    def pause(self, reason: str, paused: bool) -> None:
        with self._lock:
            was_paused = bool(self._paused)
            if paused:
                self._paused.add(reason)
            else:
                self._paused.discard(reason)
            if bool(self._paused) != was_paused:
                log("helper_pause" if self._paused else "helper_resume", reason="Grade/import/export" if reason != "manual" else "manual", action="background lanes wait" if self._paused else "background lanes resume")
            self._send({"command": "pause", "paused": bool(self._paused)})

    def foreground_source(self, key, active):
        # Source reads/LibRaw run outside this helper; indexing must see them too.
        with self._lock:
            if active:
                self._source_foreground.add(key)
            else:
                self._source_foreground.discard(key)
            self._send({"command": "source-busy", "active": bool(self._source_foreground)})

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
            except (EOFError, OSError) as error:
                log("helper_control_failed", operation=message["command"], reason=str(error), action="reader fails waiting requests when pipe closes")

    def _read_results(self, connection) -> None:
        started = time.monotonic()
        ready = False
        try:
            while not self._stop.is_set():
                if not connection.poll(.25):
                    if not self._process.is_alive():
                        raise RuntimeError(f"helper exited with code {self._process.exitcode}")
                    if not ready and time.monotonic() - started > 30:
                        raise RuntimeError("helper did not report ready within 30 seconds")
                    continue
                message = connection.recv()
                if message.get("event") == "diagnostic":
                    record = message["record"]
                    log(record.pop("event"), **record)
                    continue
                if message.get("event") == "work":
                    with self._lock:
                        if message.get("done"):
                            self._work.pop(message["id"], None)
                        else:
                            previous = self._work.get(message["id"], {})
                            self._work[message["id"]] = dict(path=message.get("path"), stage=message["stage"],
                                state=previous.get("state", "running" if message["id"] in self._pending else "stopping"))
                    continue
                if message.get("event") == "ready":
                    log("helper_ready", pid=message.get("pid"))
                    log("helper_start", pid=message.get("pid"), action="helper ready")
                    with self._lock:
                        self._work.clear()
                        self.info = message
                        ready = True
                        self._recovering = False
                        connection.send({"command": "source-busy", "active": bool(self._source_foreground)})
                        for job in self._requests.values():
                            connection.send(job)
                        self._ready.set()
                    continue
                with self._lock:
                    future = self._pending.pop(message["id"], None)
                    self._requests.pop(message["id"], None)
                if future is None or future.done():
                    continue
                if "result" in message:
                    future.set_result(message["result"])
                elif "path" in message:
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
        finally:
            if self._closed:
                self._ready.set()

    def status(self) -> dict:
        with self._lock:
            return {**self.info, "running": bool(self._process and self._process.is_alive()),
                    "jobs": list(self._work.values()) + [dict(path=r.get("path"),stage="Waiting to develop photo",state="waiting") for k,r in self._requests.items() if k not in self._work and r.get("command") in {"live-scene","live-fallback"}],
                    "pending": len(self._pending), "source_busy": bool(self._source_foreground), "paused": bool(self._paused), "manual_paused": "manual" in self._paused,
                    "failure": self._failure, "restarts": self._restarts, "recovering": self._recovering}

    def close(self) -> None:
        with self._lock:
            if self._closed:
                return
            self._send({"command": "stop"})
            log("helper_stop", pending=len(self._pending), action="app closing; pending requests cancelled")
            self._closed = True
            self._stop.set()
            self._ready.set()
            process, connection = self._process, self._connection
            pending = list(self._pending.values())
            self._pending.clear()
            self._requests.clear()
            self._work.clear()
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
    try:
        _worker_main_impl(connection, root, parent_pid, paused)
    except Exception as error:
        from . import library_diagnostics
        library_diagnostics._sink = None
        log("helper_boot_failed", root=root, reason=repr(error), action="helper exits; parent fails waiting requests; Grade unaffected")
        raise


def _worker_main_impl(connection, root: str, parent_pid: int, paused: bool) -> None:
    # Partition CPU capacity between simultaneous photos and native libraries.
    # OS priority and pause/yield gates, rather than reserved cores, protect Grade.
    from .cpu_budget import native_threads as thread_budget, photo_lanes, logical_cpus
    native_threads = thread_budget()
    lanes = photo_lanes()
    for name in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMEXPR_NUM_THREADS"):
        os.environ[name] = str(native_threads)
    os.environ["HDR_CPU_THREADS"] = str(native_threads)
    priority = _lower_priority()
    from .media_browser import MediaBrowserStore, MediaBrowserInterpretationRequired
    from .launcher import _parent_is_alive
    from .library_pictures import LibraryPictureCache
    from .library_folders import scan_folder, folder_tree
    pictures = LibraryPictureCache(root)
    browser = MediaBrowserStore(Path(root))
    condition = Condition()
    write_lock = RLock()
    queue: list[tuple[int, int, dict]] = []
    jobs: dict[str, Event] = {}
    stopping = Event()
    sequence = 0
    state = {"paused": paused, "foreground": 0, "checking": 0, "source_busy": False, "developing": 0}

    def lane(job):
        if job["command"] == "stored-screen-write":
            return "stored"
        if job["command"] in {"picture", "native", "live-scene", "live-fallback"}:
            return "picture"
        if job["command"] == "overlay":
            return "kept"
        if job.get("checking"):
            return "check"
        return "index" if job.get("background") else "main"

    def reply(message):
        with write_lock:
            connection.send(message)

    from . import library_diagnostics
    library_diagnostics._sink = lambda record: reply({"event": "diagnostic", "record": record})

    def decode(kind="main"):
        while not stopping.is_set():
            with condition:
                while not stopping.is_set():
                    candidates = [(item, index) for index, item in enumerate(queue) if lane(item[2]) == kind]
                    if candidates and not state["paused"] and (kind in {"main", "stored"} or not state["source_busy"]) and (kind != "picture" or state["foreground"] < lanes):
                        _, index = min(candidates)
                        _priority, _sequence, job = queue.pop(index)
                        heapq.heapify(queue)
                        break
                    condition.wait(timeout=0.25)
                if stopping.is_set():
                    return
                started = time.perf_counter()
                log("picture_helper_job_started" if kind == "picture" else "helper_job_started", job=job["id"], request=job.get("trace_id"), operation=job["command"], edge=job.get("edge"), path=job.get("path"), queue_ms=round((time.time()-job["queued_at"])*1000, 2))
                cancelled = jobs.get(job["id"])
                if cancelled is None or cancelled.is_set():
                    continue
                if kind == "check":
                    state["checking"] += 1
                elif kind == "picture":
                    state["foreground"] += 1
                if kind == "picture": state["developing"] += 1

                from .library_metadata import pause_readers
                pause_readers(state["paused"] or state["source_busy"] or bool(state["developing"]))
            waited = [0.]
            def yielding():
                wait_started = time.perf_counter()
                # Background indexing waits for visible work, grading and export.
                while not cancelled.is_set() and not stopping.is_set():
                    with condition:
                        # Maps outrank folder checks. Only checks
                        # wait for that lane, never the reverse (including a
                        # second queued map while the first one is running).
                        allowed = {"index", "check", "stored"} if kind == "check" else {"index", "kept", "stored"}
                        if kind == "kept":
                            allowed.add("check")
                        if (not state["paused"] and (kind == "stored" or not state["source_busy"]) and (
                                not state["foreground"]
                                and (kind in {"check", "kept"} or not state["checking"])
                                and all(lane(item[2]) in allowed for item in queue))):
                            break
                    time.sleep(0.05)
                waited[0] += time.perf_counter()-wait_started
                return cancelled.is_set() or stopping.is_set()

            last_stage = [None, time.perf_counter()]
            def progress(stage, text):
                if stage == last_stage[0]: return
                now = time.perf_counter()
                log("picture_preparation_stage", edge=job.get("edge"), job=job["id"], path=job.get("path"), stage=stage,
                    previous_stage=last_stage[0], duration_ms=(now-last_stage[1])*1000)
                last_stage[:] = [stage, now]
                reply({"event":"work", "id":job["id"], "path":job.get("path"), "stage":text})
            if job["command"] in {"live-scene", "live-fallback"}: progress("reading", "Reading photo")
            check = yielding if kind in {"index", "check", "kept", "stored"} else cancelled.is_set
            try:
                if job["command"] == "stored-screen-write":
                    from .library_screen_previews import StoredScreenPreviews
                    if check(): raise CancelledError()
                    output = StoredScreenPreviews(root).write(job['identity'], Path(job['body_path']).read_bytes(),
                        job['width'], job['height'], job['stride'], check,
                        source_width=job['source_width'], source_height=job['source_height'])
                    result = {"id": job['id'], "result": output}
                elif job["command"] == "overlay":
                    from .library_overlays import OverlayMaps
                    output = OverlayMaps(root).build(job["path"],job["kind"],job["quality"],cancelled=check)
                    result = {"id":job["id"],"result":output}
                elif job["command"] == "live-fallback":
                    from .library_live import fallback_picture
                    output = fallback_picture(root, job["path"], job.get("document"), job["edge"], cancelled.is_set, progress=progress)
                    result = {"id": job["id"], "result": output}
                elif job["command"] == "live-scene":
                    from .library_live import develop_cpu
                    output = develop_cpu(root, job["path"], job.get("document"), job["edge"], cancelled.is_set, progress=progress, draw_first=job.get("draw_first", False))
                    result = {"id": job["id"], "result": output}
                elif job["command"] == "picture":
                    output = pictures.build(job["path"], job["edge"], job["quality"], cancelled.is_set)
                    result = {"id": job["id"], "result": output}
                elif job["command"] == "native":
                    output = pictures.build_native(job["path"], job["center_x"], job["center_y"], job["width"], job["height"], cancelled.is_set)
                    result = {"id": job["id"], "result": output}
                elif job["command"] == "kept-check":
                    from .library_folders import check_kept
                    result = {"id": job["id"], "result": check_kept(job["paths"], check)}
                elif job["command"] == "metadata":
                    from .library_metadata import read_metadata
                    result = {"id": job["id"], "result": read_metadata(job["paths"], check, parallel=True)}
                elif job["command"] in {"scan", "tree"}:
                    output = scan_folder(job["path"], check, fingerprints=True) if job["command"] == "scan" else folder_tree(job["path"], check)
                    result = {"id": job["id"], "result": output}
                else:
                    output = browser.thumbnail(job["path"], job["size"], fast_only=job["fast_only"], embedded_only=job.get("embedded_only", False), cancel_event=cancelled)
                    result = {"id": job["id"], "path": str(output)}
            except MediaBrowserInterpretationRequired as exc:
                log("picture_helper_interpretation_required" if kind == "picture" else "helper_interpretation_required", path=job.get("path"), reason=str(exc), action="interpretation requested; photo untouched")
                result = {"id": job["id"], "error": str(exc), "reason": exc.reason,
                          "profile_name": exc.profile_name}
            except Exception as exc:
                if not isinstance(exc, CancelledError) and not cancelled.is_set():
                    log("picture_helper_job_failed" if kind == "picture" else "helper_job_failed", operation=job["command"], paths=job.get("path", job.get("paths")), reason=repr(exc), action="request failed; saved marks retained")
                result = {"id": job["id"], "error": str(exc)}
            log(("picture_" if kind == "picture" else "") + ("helper_job_cancelled" if cancelled.is_set() or stopping.is_set() else "helper_job_finished"), job=job["id"], request=job.get("trace_id"), operation=job["command"], edge=job.get("edge"), path=job.get("path"), outcome="cancelled" if cancelled.is_set() or stopping.is_set() else "failed" if "error" in result else "completed", last_stage=last_stage[0], stage_ms=round((time.perf_counter()-last_stage[1])*1000,2), work_ms=round((time.perf_counter()-started-waited[0])*1000, 2), yield_ms=round(waited[0]*1000, 2))
            with condition:
                jobs.pop(job["id"], None)
                if kind == "check":
                    state["checking"] -= 1
                elif kind == "picture":
                    state["foreground"] -= 1
                if kind == "picture": state["developing"] -= 1
                pause_readers(state["paused"] or state["source_busy"] or bool(state["developing"]))
                condition.notify_all()
            reply({"event":"work", "id":job["id"], "done":True})
            if not cancelled.is_set() and not stopping.is_set():
                try:
                    reply(result)
                except (EOFError, OSError) as error:
                    library_diagnostics._sink = None
                    log("picture_helper_reply_failed" if kind == "picture" else "helper_reply_failed", operation=job["command"], edge=job.get("edge"), path=job.get("path"), reason=str(error), action="lane exits; parent detects closed helper")
                    return

    for index in range(lanes):
        Thread(target=decode, name=f"hdr-library-decode-{index}", daemon=True).start()
    # Main and picture lanes share the foreground admission count, so their
    # native teams together stay within the machine partition.
    for index in range(lanes):
        Thread(target=decode, args=("picture",), name=f"hdr-library-picture-{index}", daemon=True).start()
    # Unvisited pinned folders are indexed on their own lane, so a long
    # background scan never queues ahead of the folder the user just clicked.
    Thread(target=decode, args=("index",), name="hdr-library-index", daemon=True).start()
    Thread(target=decode, args=("stored",), name="hdr-library-stored-screen", daemon=True).start()
    Thread(target=decode, args=("check",), name="hdr-library-check", daemon=True).start()
    # Map work yields at checkpoints to foreground work and all pause gates.
    for index in range(lanes):
        Thread(target=decode, args=("kept",), name=f"hdr-library-kept-{index}", daemon=True).start()
    reply({"event": "ready", "pid": os.getpid(), "priority": priority, "decode_workers": lanes, "picture_workers": lanes, "index_workers": min(logical_cpus(), 61) if os.name == "nt" else logical_cpus(), "native_threads": native_threads})
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
                    pictures.pause_native(message["paused"])
                elif message["command"] == "source-busy":
                    state["source_busy"] = message["active"]
                elif message["command"] == "prioritize":
                    queue[:] = [(message["priority"] if item[2]["id"] == message["id"] else item[0], item[1], item[2]) for item in queue]
                    heapq.heapify(queue)
                elif message["command"] == "cancel":
                    event = jobs.pop(message["id"], None)
                    if event is not None:
                        event.set()
                    queue[:] = [item for item in queue if item[2]["id"] != message["id"]]
                    heapq.heapify(queue)
                elif message["command"] in {"thumbnail", "picture", "native", "scan", "tree", "metadata", "kept-check", "overlay", "live-scene", "live-fallback", "stored-screen-write"}:
                    message["queued_at"] = time.time()
                    sequence += 1
                    jobs[message["id"]] = Event()
                    heapq.heappush(queue, (message["priority"], sequence, message))
                from .library_metadata import pause_readers
                pause_readers(state["paused"] or state["source_busy"] or bool(state["developing"]))
                condition.notify_all()
    except (EOFError, OSError) as error:
        library_diagnostics._sink = None
        log("helper_pipe_closed", reason=str(error), action="helper exits")
    finally:
        stopping.set()
        from .library_metadata import close_readers
        close_readers()
        with condition:
            condition.notify_all()
        connection.close()
