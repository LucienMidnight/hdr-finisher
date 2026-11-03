"""One-off Windows diagnostic; trims only the explicitly selected Python PID.

Run while idle in Library after leaving Grade:
  .venv/Scripts/python.exe tools/trim-backend-working-set.py --pid BACKEND_PID
This is never imported or called by the app's memory controller.
"""
import argparse
import ctypes
from ctypes import wintypes
import json
import os
import time


def trim_backend(pid):
    if os.name != 'nt':
        raise RuntimeError('This diagnostic needs Windows')
    class Memory(ctypes.Structure):
        _fields_ = [('size', wintypes.DWORD), ('faults', wintypes.DWORD)] + [
            (name, ctypes.c_size_t) for name in ('peak', 'working', 'paged_peak',
            'paged', 'nonpaged_peak', 'nonpaged', 'pagefile', 'pagefile_peak', 'private')]
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    psapi = ctypes.WinDLL('psapi', use_last_error=True)
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
    psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(Memory), wintypes.DWORD]
    psapi.EmptyWorkingSet.argtypes = [wintypes.HANDLE]
    handle = kernel.OpenProcess(0x510, False, pid)  # query, VM read, set quota
    if not handle: raise ctypes.WinError(ctypes.get_last_error())
    try:
        name = ctypes.create_unicode_buffer(32768); length = wintypes.DWORD(len(name))
        if not kernel.QueryFullProcessImageNameW(handle, 0, name, ctypes.byref(length)):
            raise ctypes.WinError(ctypes.get_last_error())
        if os.path.basename(name.value).lower() not in ('python.exe', 'pythonw.exe'):
            raise ValueError('Refusing to trim a non-Python process: '+name.value)
        def sample():
            value = Memory(); value.size = ctypes.sizeof(value)
            if not psapi.GetProcessMemoryInfo(handle, ctypes.byref(value), value.size):
                raise ctypes.WinError(ctypes.get_last_error())
            return dict(workingSetBytes=value.working, privateBytes=value.private)
        before = sample()
        if not psapi.EmptyWorkingSet(handle): raise ctypes.WinError(ctypes.get_last_error())
        immediate = sample()
        time.sleep(.5)
        return dict(pid=pid, image=name.value, before=before, immediate=immediate, after=sample())
    finally:
        kernel.CloseHandle(handle)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pid', type=int, required=True)
    print(json.dumps(trim_backend(parser.parse_args().pid)))
