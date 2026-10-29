"""Process-tree host working set and shared Library source admission.

The desktop's parent PID anchors the tree; dedicated GPU VRAM is excluded.
No optional monitoring package and no subprocess per sample are required.
"""
import ctypes
from ctypes import wintypes
import os
from threading import Lock
import time

CEILING = 4_000_000_000
TARGET = 2_400_000_000
ADMISSION = 3_200_000_000
_lock = Lock()
_reservations = {}
_waiting_until = 0


def process_tree(root):
    if os.name != 'nt':
        rows = {}
        from pathlib import Path
        for item in Path('/proc').glob('[0-9]*'):
            try:
                fields = (item/'stat').read_text().rsplit(')', 1)[1].split()
                rows[int(item.name)] = (int(fields[1]), int(fields[21])*os.sysconf('SC_PAGE_SIZE'))
            except (OSError, ValueError, IndexError): pass
    else:
        class Entry(ctypes.Structure):
            _fields_ = [('size',wintypes.DWORD),('usage',wintypes.DWORD),('pid',wintypes.DWORD),('heap',ctypes.c_size_t),('module',wintypes.DWORD),('threads',wintypes.DWORD),('parent',wintypes.DWORD),('priority',wintypes.LONG),('flags',wintypes.DWORD),('name',wintypes.WCHAR*260)]
        class Memory(ctypes.Structure):
            _fields_ = [('size',wintypes.DWORD),('faults',wintypes.DWORD),('peak',ctypes.c_size_t),('working',ctypes.c_size_t),('paged_peak',ctypes.c_size_t),('paged',ctypes.c_size_t),('nonpaged_peak',ctypes.c_size_t),('nonpaged',ctypes.c_size_t),('pagefile',ctypes.c_size_t),('pagefile_peak',ctypes.c_size_t)]
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        psapi = ctypes.WinDLL('psapi', use_last_error=True)
        kernel.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        kernel.Process32FirstW.argtypes = [wintypes.HANDLE,ctypes.POINTER(Entry)]
        kernel.Process32NextW.argtypes = [wintypes.HANDLE,ctypes.POINTER(Entry)]
        psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE,ctypes.POINTER(Memory),wintypes.DWORD]
        snapshot = kernel.CreateToolhelp32Snapshot(2,0)
        if snapshot == ctypes.c_void_p(-1).value: raise ctypes.WinError(ctypes.get_last_error())
        rows = {}
        try:
            entry = Entry(); entry.size = ctypes.sizeof(entry)
            more = kernel.Process32FirstW(snapshot,ctypes.byref(entry))
            while more:
                rows[entry.pid] = (entry.parent,0)
                more = kernel.Process32NextW(snapshot,ctypes.byref(entry))
        finally: kernel.CloseHandle(snapshot)
    owned = {root}
    while True:
        added = {pid for pid,(parent,_) in rows.items() if parent in owned} - owned
        if not added: break
        owned.update(added)
    result = []
    for pid in owned:
        working = rows.get(pid,(0,0))[1]
        if os.name == 'nt':
            handle = kernel.OpenProcess(0x410,False,pid)
            if not handle: continue
            try:
                memory = Memory(); memory.size = ctypes.sizeof(memory)
                if not psapi.GetProcessMemoryInfo(handle,ctypes.byref(memory),memory.size): continue
                working = memory.working
            finally: kernel.CloseHandle(handle)
        result.append({'pid':pid,'workingSetBytes':working})
    return result


def snapshot():
    rows = process_tree(int(os.environ.get("HDR_FINISHER_DESKTOP_PID", os.getppid())))
    total = sum(row['workingSetBytes'] for row in rows)
    with _lock:
        now = time.monotonic()
        for key,(_,expires) in list(_reservations.items()):
            if expires < now: _reservations.pop(key)
        reserved = sum(row[0] for row in _reservations.values())
        waiting = now < _waiting_until
    return {'totalBytes':total,'processes':rows,'ceilingBytes':CEILING,'targetBytes':TARGET,
            'reservedBytes':reserved,'reclaim':total>TARGET or waiting}


def admit(key, size, release=False):
    global _waiting_until
    if release:
        with _lock: _reservations.pop(key,None)
        return {'granted':True}
    value = snapshot()
    with _lock:
        if key in _reservations:
            _reservations[key] = (_reservations[key][0],time.monotonic()+30)
            return {'granted':True}
        size = max(700_000_000,min(1_200_000_000,int(size)))
        # Preserve parallel-work headroom, but allow one bounded visible job
        # to progress after reclaim when the retained display already exceeds it.
        limit = ADMISSION if _reservations else CEILING-200_000_000
        granted = value['totalBytes']+sum(row[0] for row in _reservations.values())+size <= limit
        if granted: _reservations[key] = (size,time.monotonic()+30)
        else: _waiting_until = time.monotonic()+2
    return {'granted':granted,**value}
