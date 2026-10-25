"""Machine-derived CPU partitions. Outer lanes times native threads never exceed CPUs."""
import os
from math import isqrt
from concurrent.futures import ThreadPoolExecutor, Future
from threading import local, RLock
from weakref import WeakSet


def logical_cpus():
    return max(1, os.cpu_count() or 1)


def photo_lanes():
    return max(1, isqrt(logical_cpus()))


def native_threads():
    return max(1, logical_cpus() // photo_lanes())


def lower_thread_priority():
    """Reader threads stay below normal without lowering the Grade process."""
    if os.name == "nt":
        import ctypes
        api = ctypes.WinDLL("kernel32", use_last_error=True)
        api.GetCurrentThread.restype = ctypes.c_void_p
        api.SetThreadPriority.argtypes = [ctypes.c_void_p, ctypes.c_int]
        if not api.SetThreadPriority(api.GetCurrentThread(), -1):
            raise OSError(ctypes.get_last_error(), "Could not lower Library reader priority")
    elif hasattr(os, "setpriority"):
        from threading import get_native_id
        # Linux nice is per thread; other Unix platforms use the helper priority.
        import sys
        if sys.platform.startswith("linux"):
            os.setpriority(os.PRIO_PROCESS, get_native_id(), 10)


def raw_threads(count):
    """Set LibRaw's OpenMP team on its calling thread, before unpack/postprocess."""
    import ctypes
    import ctypes.util
    from pathlib import Path
    import rawpy
    if os.name == "nt":
        runtime = ctypes.CDLL(str(Path(rawpy.__file__).parent / "vcomp140.dll"))
    else:
        library = ctypes.util.find_library("gomp") or ctypes.util.find_library("omp")
        if library is None:
            # A serial LibRaw build cannot create an OpenMP team.
            return
        runtime = ctypes.CDLL(library)
    runtime.omp_set_num_threads.argtypes = [ctypes.c_int]
    runtime.omp_set_num_threads(max(1, int(count)))


_cpu_pool = ThreadPoolExecutor(max_workers=logical_cpus(), thread_name_prefix="hdr-cpu")
_inside = local()


class CpuExecutor:
    """Shared process CPU pool; nested bands run inline to avoid pool deadlock.

    Each caller retains ownership of its futures and joins them at shutdown.
    Native decoders use separate process partitions, not this Python pool.
    """
    def __init__(self):
        self.futures = WeakSet()
        self.lock = RLock()
        self.closed = False

    def submit(self, function, *args, **kwargs):
        def run():
            previous = getattr(_inside, "active", False)
            _inside.active = True
            try:
                return function(*args, **kwargs)
            finally:
                _inside.active = previous
        # Submission and shutdown share ownership: no band can escape its join.
        with self.lock:
            if self.closed:
                raise RuntimeError("CPU executor is closed")
            if getattr(_inside, "active", False):
                future = Future()
                try:
                    future.set_result(run())
                except BaseException as error:
                    future.set_exception(error)
            else:
                future = _cpu_pool.submit(run)
            self.futures.add(future)
            return future

    def map(self, function, values):
        futures = [self.submit(function, value) for value in values]
        return (future.result() for future in futures)

    def shutdown(self, wait=True, *, cancel_futures=False):
        with self.lock:
            self.closed = True
            futures = list(self.futures)
        if cancel_futures:
            for future in futures:
                future.cancel()
        if wait and futures:
            from concurrent.futures import wait as join
            join(futures)
        with self.lock:
            self.futures.clear()

    def __enter__(self):
        return self

    def __exit__(self, *error):
        self.shutdown(cancel_futures=bool(error[0]))
