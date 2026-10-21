"""Bounded Library RAW reader and three independent decoder processes."""
from __future__ import annotations

from collections import OrderedDict
from concurrent.futures import Future
from hashlib import sha256
import json
import multiprocessing
from multiprocessing.shared_memory import SharedMemory
import os
from pathlib import Path
from threading import Condition, Thread
import time

from .library_raw_decode import worker_main
from .library_raw_reader import open_raw
from .library_diagnostics import log

VERSION = "library-camera-gpu-v1"
MIB = 1024 ** 2


def machine_memory():
    if os.name == "nt":
        import ctypes
        class Memory(ctypes.Structure):
            _fields_ = [("length", ctypes.c_uint32), ("load", ctypes.c_uint32)] + [
                (name, ctypes.c_uint64) for name in ("total", "available", "page", "free_page", "virtual", "free_virtual", "extended")]
        value = Memory()
        value.length = ctypes.sizeof(value)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(value)):
            return value.total
    try:
        return os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES")
    except (ValueError, AttributeError):
        return 8 * 1024 ** 3


def allowances(ram):
    return {"raw_files": max(4, min(40, int(ram / (1.6 * 1024 ** 3)))),
        "raw_bytes": max(128 * MIB, min(4 * 1024 ** 3, ram // 16)),
        "transport_bytes": max(64 * MIB, min(2 * 1024 ** 3, ram // 32)),
        "ahead": max(2, min(12, int(ram / (4 * 1024 ** 3)))),
        "gpu_pictures": max(2, min(10, int(ram / (4 * 1024 ** 3))))}


def identity(path):
    path = Path(path).resolve(strict=True)
    stat = path.stat()
    return sha256(f"{VERSION}:{path}:{stat.st_size}:{stat.st_mtime_ns}".encode()).hexdigest(), str(path), stat.st_size


def camera_raw(path):
    from .raw_import import RAW_EXTENSIONS
    path = Path(path)
    if path.suffix.lower() not in RAW_EXTENSIONS:
        return False
    if path.suffix.lower() == ".dng":
        from .linear_dng import inspect_dng, DngRoute
        return inspect_dng(path).route == DngRoute.MOSAICED_RAW_DNG
    return True


class RawBrowsing:
    def __init__(self, root, paused=lambda: False, ram=None):
        self.limits = allowances(ram or machine_memory())
        from .library_cache import LibraryCache
        self.managed = LibraryCache(root)
        self.cv = Condition()
        self.paused = paused
        self.raw = OrderedDict()
        self.outputs = OrderedDict()
        self.jobs = {}
        self.partial = None
        self.stopped = False
        self.threads = []
        self.processes = []
        self.selected = None
        self.wanted = []
        self.screen = (2560, 1440)
        self.sequence = 0
        self.failure = None
        self.plan_revisions = OrderedDict()

    @property
    def root(self):
        return self.managed.directory("library-raw-thumbnails")

    def start(self):
        with self.cv:
            if self.threads or self.stopped:
                return
            reader = Thread(target=self._read, name="library-raw-reader", daemon=True)
            self.threads.append(reader)
            reader.start()
            for index in range(3):
                thread = Thread(target=self._lane, args=(index,), name=f"library-raw-process-{index}", daemon=True)
                self.threads.append(thread)
                thread.start()

    def request(self, path, priority=10):
        key, path, size = identity(path)
        with self.cv:
            if self.stopped:
                raise RuntimeError("Library RAW browsing is closed.")
            if self.failure:
                raise RuntimeError(self.failure)
            if key in self.outputs:
                self.outputs.move_to_end(key)
                future = Future()
                future.set_result(self.outputs[key][1])
                return future
            job = self.jobs.get(key)
            if job:
                job["priority"] = min(priority, job["priority"])
                # Promotion changes the process priority of work already decoding.
                if priority == 0 and job.get("process"):
                    self._promote(job["process"])
            else:
                if len(self.jobs) >= 128:
                    raise RuntimeError("Library RAW queue is full.")
                self.sequence += 1
                job = {"key": key, "path": path, "size": size, "priority": priority,
                    "order": self.sequence, "future": Future(), "active": False}
                self.jobs[key] = job
            self.start()
            self.cv.notify_all()
            return job["future"]

    @staticmethod
    def _promote(process, foreground=True):
        if os.name == "nt":
            import ctypes
            kernel = ctypes.WinDLL("kernel32", use_last_error=True)
            kernel.OpenProcess.argtypes = [ctypes.c_uint32, ctypes.c_int, ctypes.c_uint32]
            kernel.OpenProcess.restype = ctypes.c_void_p
            kernel.SetPriorityClass.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
            kernel.CloseHandle.argtypes = [ctypes.c_void_p]
            # Scheduling priority only; never changes Grade's process or thread pools.
            handle = kernel.OpenProcess(0x0200, False, process.pid)
            if handle:
                try:
                    kernel.SetPriorityClass(handle, 0x20 if foreground else 0x4000)
                finally:
                    kernel.CloseHandle(handle)

    def plan(self, paths, width=2560, height=1440, client="", revision=0, retained=()):
        paths = paths[:self.limits["ahead"] + 3]
        with self.cv:
            if client:
                if revision <= self.plan_revisions.get(client, -1):
                    return self.status()
                self.plan_revisions[client] = revision
                self.plan_revisions.move_to_end(client)
                while len(self.plan_revisions) > 32:
                    self.plan_revisions.popitem(last=False)
            self.screen = (max(1280, min(2560, width)), max(720, min(2560, height)))
            self.wanted = [identity(path)[0] for path in paths]
            self.selected = self.wanted[0] if self.wanted else None
            # Drop queued stale read-ahead; completed/in-flight work remains useful.
            for key, job in list(self.jobs.items()):
                if job["priority"] == 0 and key != self.selected and not job["active"]:
                    job["priority"] = 50 + (self.wanted.index(key) if key in self.wanted else len(self.wanted))
                if job["priority"] >= 50 and key not in self.wanted and not job["active"]:
                    job["future"].cancel()
                    del self.jobs[key]
            for i, path in enumerate(paths):
                if self.wanted[i] not in retained:
                    self.request(path, 0 if i == 0 else 50 + i)
            self.cv.notify_all()
        return self.status()

    def metadata(self, meta, edge):
        w, h = meta["raw_width"], meta["raw_height"]
        scale = min(self.screen[0] / w, self.screen[1] / h, 1) if edge >= 1280 else min(512 / max(w, h), 1)
        width, height = max(1, round(w * scale)), max(1, round(h * scale))
        key = sha256(f"{meta['transport_key']}:{width}:{height}".encode()).hexdigest()
        full_scale = min(self.screen[0] / w, self.screen[1] / h, 1)
        bw, bh = max(1, round(w * full_scale)), max(1, round(h * full_scale))
        browse_key = sha256(f"{meta['transport_key']}:{bw}:{bh}".encode()).hexdigest()
        # edge identifies the preview tier; dimensions remain fitted to the screen.
        return meta | {"key": key, "width": width, "height": height, "edge": max(1280, width, height) if edge >= 1280 else max(width, height),
            "browse_width": bw, "browse_height": bh, "browse_key": browse_key,
            "prepare_full": meta["transport_key"] in self.wanted[:max(1,self.limits["gpu_pictures"]-2)],
            "quality": "quick", "stored_bytes": 0, "cache_hit": False}

    def status(self):
        with self.cv:
            return {"limits": self.limits, "ready": [self.metadata(self.outputs[key][1], 2560)
                for key in self.wanted if key in self.outputs], "raw_files": len(self.raw),
                "raw_bytes": sum(item[1] for item in self.raw.values()),
                "transport_bytes": sum(item[0].size for item in self.outputs.values()),
                "pending": len(self.jobs), "paused": self.paused()}

    def pixels(self, key):
        with self.cv:
            memory, meta = self.outputs[key]
            self.outputs.move_to_end(key)
            return bytes(memory.buf[:meta["transport_bytes"]])

    def _dispose(self, memory):
        memory.close()
        memory.unlink()

    def _trim_raw(self, needed=0):
        active = {key for key, job in self.jobs.items() if job["active"]}
        while self.raw and (len(self.raw) >= self.limits["raw_files"] or
                sum(value[1] for value in self.raw.values()) + needed > self.limits["raw_bytes"]):
            key = next((key for key in self.raw if key not in active), None)
            if key is None:
                return False
            memory, _size = self.raw.pop(key)
            self._dispose(memory)
        return sum(value[1] for value in self.raw.values()) + needed <= self.limits["raw_bytes"]

    def _read(self):
        while True:
            with self.cv:
                if self.stopped:
                    return
                candidates = sorted((j for j in self.jobs.values() if j["key"] not in self.raw),
                    key=lambda j: (j["priority"], j["order"]))
                if self.paused() or not candidates:
                    self.cv.wait(.025)
                    continue
                job = candidates[0]
                # One partial mapping only. On reprioritization release it before
                # reading the new file; rapid travel cannot accumulate paused RAWs.
                if self.partial and self.partial[0] != job["key"]:
                    self.partial[1].close()
                    self._dispose(self.partial[2])
                    self.partial = None
                try:
                    if self.partial is None:
                        if job["size"] > self.limits["raw_bytes"]:
                            raise ValueError("This RAW is larger than the Library memory allowance.")
                        if not self._trim_raw(job["size"]):
                            self.cv.wait(.025)
                            continue
                        memory = SharedMemory(create=True, size=max(1, job["size"]))
                        try:
                            handle = open_raw(job["path"])
                        except BaseException:
                            self._dispose(memory)
                            raise
                        self.partial = [job["key"], handle, memory, 0, time.perf_counter()]
                    part = self.partial
                except Exception as error:
                    self._fail(job, error)
                    continue
            try:
                offset = part[3]
                view = part[2].buf[offset:min(job["size"], offset + MIB)]
                try:
                    count = part[1].readinto(view)
                finally:
                    view.release()
                with self.cv:
                    if not count:
                        raise ValueError("Photo ended before its recorded size; open the folder again.")
                    part[3] += count
                    if part[3] == job["size"]:
                        if identity(job["path"])[0] != job["key"]:
                            raise ValueError("Photo changed during reading; open the folder again.")
                        part[1].close()
                        self.raw[job["key"]] = (part[2], job["size"])
                        job["read_ms"] = (time.perf_counter() - part[4]) * 1000
                        self.partial = None
                        self.cv.notify_all()
            except Exception as error:
                with self.cv:
                    part[1].close()
                    self._dispose(part[2])
                    self.partial = None
                    self._fail(job, error)

    def _fail(self, job, error):
        self.jobs.pop(job["key"], None)
        if not job["future"].done():
            job["future"].set_exception(error)
        log("raw_browse_failed", path=job["path"], reason=str(error), action="Library request fails; Grade unaffected")
        self.cv.notify_all()

    def _lane(self, index):
        context = multiprocessing.get_context("spawn")
        connection, child = context.Pipe()
        process = context.Process(target=worker_main, args=(child, index == 0), daemon=True,
            name=f"hdr-library-raw-{index}")
        job = None
        try:
            process.start()
            child.close()
            with self.cv:
                self.processes.append((process, connection))
            if not connection.poll(30):
                raise RuntimeError("Library RAW decoder did not start.")
            connection.recv()
            while True:
                with self.cv:
                    if self.stopped:
                        return
                    candidates = sorted((j for j in self.jobs.values() if not j["active"] and j["key"] in self.raw
                        and (j["priority"] == 0 if index == 0 else j["priority"] > 0)),
                        key=lambda j: (j["priority"], j["order"]))
                    if self.paused() or not candidates:
                        self.cv.wait(.025)
                        continue
                    job = candidates[0]
                    job["active"] = True
                    job["process"] = process
                    raw, size = self.raw[job["key"]]
                    self.raw.move_to_end(job["key"])
                    self._promote(process, job["priority"] == 0)
                    connection.send({"path": job["path"], "raw_name": raw.name, "size": size})
                while not connection.poll(.1):
                    if self.stopped:
                        return
                    if not process.is_alive():
                        raise RuntimeError("Library RAW decoder stopped.")
                result = connection.recv()
                with self.cv:
                    if self.stopped:
                        return
                    if "error" in result:
                        self._fail(job, ValueError(result["error"]))
                    else:
                        memory = SharedMemory(name=result["name"])
                        connection.send({"accepted": True})
                        meta = result["meta"] | {"transport_key": job["key"], "path": job["path"], "read_ms": job.get("read_ms", 0)}
                        if memory.size > self.limits["transport_bytes"]:
                            self._dispose(memory)
                            self._fail(job, ValueError("This picture exceeds the Library memory allowance."))
                        elif identity(job["path"])[0] != job["key"]:
                            self._dispose(memory)
                            self._fail(job, ValueError("Photo changed during decoding; open the folder again."))
                        else:
                            self.outputs[job["key"]] = (memory, meta)
                            self.jobs.pop(job["key"], None)
                            job["future"].set_result(meta)
                            while len(self.outputs) > 40 or sum(item[0].size for item in self.outputs.values()) > self.limits["transport_bytes"]:
                                key = next(iter(self.outputs))
                                old, _ = self.outputs.pop(key)
                                self._dispose(old)
                            log("raw_browse_ready", path=job["path"], decode_ms=meta["decode_ms"], read_ms=meta["read_ms"])
                    job = None
                    self.cv.notify_all()
        except Exception as error:
            with self.cv:
                if job and not self.stopped:
                    self._fail(job, error)
                # Fail all waiters rather than leaving a reserved lane dead.
                if not self.stopped:
                    self.failure = "Library RAW decoder stopped; restart the app."
                    for pending in list(self.jobs.values()):
                        self._fail(pending, RuntimeError(self.failure))
        finally:
            connection.close()
            if process.is_alive():
                process.terminate()
            process.join(timeout=2)

    def close(self):
        with self.cv:
            self.stopped = True
            for job in self.jobs.values():
                job["future"].cancel()
            self.cv.notify_all()
        for thread in self.threads:
            thread.join(timeout=3)
        with self.cv:
            if self.partial:
                self.partial[1].close()
                self._dispose(self.partial[2])
                self.partial = None
            for memory, _ in self.raw.values():
                self._dispose(memory)
            for memory, _ in self.outputs.values():
                self._dispose(memory)
            self.raw.clear()
            self.outputs.clear()
