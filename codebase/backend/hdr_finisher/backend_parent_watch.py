"""Watch the desktop before native imports, including a stalled startup."""
import os
import signal
import sys
import threading
import time

_job = None


def _own_windows_job():
    """Kernel-owned cleanup survives hard termination and closed log pipes."""
    global _job
    import ctypes
    from ctypes import wintypes as w
    class Basic(ctypes.Structure):
        _fields_ = [("process_time", ctypes.c_int64), ("job_time", ctypes.c_int64),
                    ("flags", w.DWORD), ("minimum", ctypes.c_size_t), ("maximum", ctypes.c_size_t),
                    ("active", w.DWORD), ("affinity", ctypes.c_size_t), ("priority", w.DWORD), ("scheduling", w.DWORD)]
    class Limits(ctypes.Structure):
        _fields_ = [("basic", Basic), ("io", ctypes.c_uint64 * 6),
                    ("process_memory", ctypes.c_size_t), ("job_memory", ctypes.c_size_t),
                    ("peak_process", ctypes.c_size_t), ("peak_job", ctypes.c_size_t)]
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, w.LPCWSTR]
    kernel.CreateJobObjectW.restype = w.HANDLE
    kernel.SetInformationJobObject.argtypes = [w.HANDLE, ctypes.c_int, ctypes.c_void_p, w.DWORD]
    kernel.AssignProcessToJobObject.argtypes = [w.HANDLE, w.HANDLE]
    kernel.GetCurrentProcess.restype = w.HANDLE
    _job = kernel.CreateJobObjectW(None, None)
    limits = Limits()
    limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    if (not _job or not kernel.SetInformationJobObject(_job, 9, ctypes.byref(limits), ctypes.sizeof(limits))
            or not kernel.AssignProcessToJobObject(_job, kernel.GetCurrentProcess())):
        raise ctypes.WinError(ctypes.get_last_error())


def watch_desktop(parent_pid):
    if sys.platform == "win32":
        _own_windows_job()
    def alive():
        if sys.platform == "win32":
            import ctypes
            from ctypes import wintypes
            kernel = ctypes.WinDLL("kernel32", use_last_error=True)
            kernel.OpenProcess.restype = wintypes.HANDLE
            kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
            kernel.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
            kernel.CloseHandle.argtypes = [wintypes.HANDLE]
            handle = kernel.OpenProcess(0x1000, False, parent_pid)
            if not handle:
                return False
            try:
                code = wintypes.DWORD()
                return bool(kernel.GetExitCodeProcess(handle, ctypes.byref(code))) and code.value == 259
            finally:
                kernel.CloseHandle(handle)
        try:
            os.kill(parent_pid, 0)
            return True
        except ProcessLookupError:
            return False

    def monitor():
        while alive():
            time.sleep(0.5)
        # The desktop owned our pipes: logging here can itself raise BrokenPipe
        # and prevent cleanup after an abrupt desktop exit.
        try:
            if sys.platform != "win32" and os.getpgrp() == os.getpid():
                os.killpg(os.getpgrp(), signal.SIGKILL)
        finally:
            os._exit(1)

    threading.Thread(target=monitor, name="desktop-parent-watch", daemon=True).start()
