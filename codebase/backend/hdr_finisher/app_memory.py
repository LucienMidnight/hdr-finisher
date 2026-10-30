"""Single RAM budget owner. Disk and dedicated GPU memory are separate.

Windows charged RAM is proportional resident memory (QueryWorkingSet).
Shared pages are divided by their OS share count, never added as full copies.
"""
import ctypes
from ctypes import wintypes
import os
import sys
from threading import RLock, Lock
import time
import weakref

WORKING = 600_000_000
STARTING = 1_300_000_000
SHARES = dict(thumbnails=512*1024**2, sharp=512_000_000,
              camera=64_000_000, raw=768_000_000, handoff=256_000_000,
              working=WORKING)
_lock = RLock()
_reservations = {}
_waiting_until = 0
_caches = {}
_sample = (0, None)
_sample_lock = Lock()
_remote_claim = None


def machine_memory():
    if os.name == 'nt':
        class Memory(ctypes.Structure):
            _fields_ = [('length',ctypes.c_uint32),('load',ctypes.c_uint32)] + [
                (key,ctypes.c_uint64) for key in ('total','available','page','free_page','virtual','free_virtual','extended')]
        value=Memory(); value.length=ctypes.sizeof(value)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(value)): return value.total
    if sys.platform=='darwin':
        value=ctypes.c_uint64();size=ctypes.c_size_t(ctypes.sizeof(value))
        libc=ctypes.CDLL('/usr/lib/libSystem.B.dylib')
        if libc.sysctlbyname(b'hw.memsize',ctypes.byref(value),ctypes.byref(size),None,0)==0:return value.value
    try: return os.sysconf('SC_PAGE_SIZE')*os.sysconf('SC_PHYS_PAGES')
    except (ValueError,AttributeError): return 8*1024**3


def budgets(ram=None):
    ceiling=max(2_500_000_000,min(4_000_000_000,int((ram or machine_memory())//4)))
    # Starting memory and working room stay fixed. The fixed thumbnail pool
    # stays fixed too; only the other cache shares shrink on smaller machines.
    scale=max(0,(ceiling-STARTING-WORKING-SHARES['thumbnails']) /
              (4_000_000_000-STARTING-WORKING-SHARES['thumbnails']))
    return ceiling,{key:int(value*(scale if key not in ('thumbnails','working') else 1))
                    for key,value in SHARES.items()}

CEILING, LIMITS = budgets()
TARGET = CEILING-WORKING


def limit(share): return LIMITS[share]


def register(key, share, trim=None):
    with _lock:
        _caches[key] = dict(share=share,bytes=0,trim=(weakref.WeakMethod(trim) if getattr(trim,'__self__',None) is not None else lambda:trim) if trim else None)


def claim(key, share, size):
    """Atomic aggregate share admission; callers evict their oldest first."""
    size=max(0,int(size))
    if _remote_claim is not None:
        granted=_remote_claim(key,share,size)
        if granted: report(key,share,size)
        return granted
    with _lock:
        # Dead cache objects no longer retain bytes. Admission must discard
        # their reports too, even before the next periodic telemetry sample.
        for dead in [k for k,v in _caches.items() if v.get('trim') and v['trim']() is None]:
            forget(dead)
        previous=_caches.get(key,{}).get('bytes',0)
        used=sum(v['bytes'] for v in _caches.values() if v['share']==share)-previous
        # Temporary reservations do not consume retained cache shares.
        if size>previous and used+size>limit(share): return False
        if share != 'handoff' and size>previous and _sample[1]:
            total=sum(r.get('chargedBytes',r['workingSetBytes']) for r in _sample[1])
            if total+size-previous>TARGET: return False
        entry=_caches.setdefault(key,dict(share=share,trim=None))
        entry['bytes']=size
        return True


def report(key,share,size):
    # Telemetry is always actual retained bytes, even when admission was refused.
    with _lock:
        entry=_caches.setdefault(key,dict(share=share,trim=None))
        entry['bytes']=max(0,int(size))


def forget(key):
    with _lock: entry=_caches.get(key)
    if entry and _remote_claim is not None:_remote_claim(key,entry['share'],0)
    with _lock: _caches.pop(key,None)


def cache_snapshot():
    with _lock:
        dead=[key for key,v in _caches.items() if v.get('trim') and v['trim']() is None]
        for key in dead: forget(key)
        return {share:dict(bytes=sum(v['bytes'] for v in _caches.values() if v['share']==share),limitBytes=cap)
                for share,cap in LIMITS.items()}


def reclaim(level='moderate'):
    with _lock:
        callbacks=[(v['trim'](),0 if level=='critical' else v['bytes']//2)
                   for v in _caches.values() if v.get('trim')]
    for callback,target in callbacks:
        if callback: callback(target)


_mac_pressure='none'
_mac_source=None
_mac_callback=None


def _start_mac_pressure():
    global _mac_source,_mac_callback
    if sys.platform!='darwin' or _mac_source is not None:return
    dispatch=ctypes.CDLL('/usr/lib/system/libdispatch.dylib')
    dispatch.dispatch_get_global_queue.restype=ctypes.c_void_p
    dispatch.dispatch_source_create.argtypes=[ctypes.c_void_p,ctypes.c_size_t,ctypes.c_ulong,ctypes.c_void_p]
    dispatch.dispatch_source_create.restype=ctypes.c_void_p
    dispatch.dispatch_source_get_data.argtypes=[ctypes.c_void_p]
    dispatch.dispatch_source_get_data.restype=ctypes.c_ulong
    dispatch.dispatch_source_set_event_handler_f.argtypes=[ctypes.c_void_p,ctypes.c_void_p]
    dispatch.dispatch_resume.argtypes=[ctypes.c_void_p]
    kind=ctypes.addressof(ctypes.c_byte.in_dll(dispatch,'_dispatch_source_type_memorypressure'))
    source=dispatch.dispatch_source_create(kind,0,1|2|4,dispatch.dispatch_get_global_queue(0,0))
    if not source:raise OSError('macOS memory-pressure source unavailable')
    @ctypes.CFUNCTYPE(None,ctypes.c_void_p)
    def changed(context):
        global _mac_pressure
        flags=dispatch.dispatch_source_get_data(source)
        _mac_pressure='critical' if flags&4 else 'moderate' if flags&2 else 'none'
    _mac_callback=changed;_mac_source=source
    dispatch.dispatch_source_set_event_handler_f(source,changed)
    dispatch.dispatch_resume(source)


_pressure_handle=None

def system_pressure():
    global _pressure_handle
    if sys.platform=='darwin':
        _start_mac_pressure()
        return _mac_pressure
    if os.name=='nt':
        kernel=ctypes.WinDLL('kernel32',use_last_error=True)
        kernel.CreateMemoryResourceNotification.restype=wintypes.HANDLE
        kernel.QueryMemoryResourceNotification.argtypes=[wintypes.HANDLE,ctypes.POINTER(wintypes.BOOL)]
        if _pressure_handle is None: _pressure_handle=kernel.CreateMemoryResourceNotification(0)
        low=wintypes.BOOL()
        if _pressure_handle and kernel.QueryMemoryResourceNotification(_pressure_handle,ctypes.byref(low)) and low.value:
            class Memory(ctypes.Structure):
                _fields_=[('length',ctypes.c_uint32),('load',ctypes.c_uint32)]+[(k,ctypes.c_uint64) for k in ('total','available','page','free_page','virtual','free_virtual','extended')]
            value=Memory();value.length=ctypes.sizeof(value);kernel.GlobalMemoryStatusEx(ctypes.byref(value))
            return 'critical' if value.available<max(256_000_000,value.total//50) else 'moderate'
    return 'none'


def proportional_resident(handle, working, psapi):
    import numpy as np
    # QueryWorkingSet may grow during the query; retry with the returned size.
    count=max(4096,int(working//4096*1.25)+1024)
    for attempt in range(4):
        buffer=(ctypes.c_size_t*(count+1))()
        psapi.QueryWorkingSet.argtypes=[wintypes.HANDLE,ctypes.c_void_p,wintypes.DWORD]
        if psapi.QueryWorkingSet(handle,buffer,ctypes.sizeof(buffer)):
            flags=np.ctypeslib.as_array(buffer)[1:int(buffer[0])+1]
            shares=(flags>>5)&7
            divisor=np.where((flags&256)!=0,np.maximum(shares,1),1)
            return int(np.sum(4096/divisor))
        count=max(count*2,int(buffer[0])+1024)
    # Never silently certify an unreadable process with a zero charge.
    raise OSError('QueryWorkingSet failed; memory gate unavailable')


def linux_pss(pid, fallback):
    from pathlib import Path
    try:
        for line in Path(f'/proc/{pid}/smaps_rollup').read_text().splitlines():
            if line.startswith('Pss:'): return int(line.split()[1])*1024
    except OSError: pass
    return fallback

def mac_process_tree(root):
    import subprocess
    class Usage(ctypes.Structure):
        _fields_=[('uuid',ctypes.c_uint8*16)]+[(k,ctypes.c_uint64) for k in
            ('user','system','idle','interrupt','pageins','wired','resident','footprint','start','exit')]
    lib=ctypes.CDLL('/usr/lib/libproc.dylib',use_errno=True)
    lib.proc_pid_rusage.argtypes=[ctypes.c_int,ctypes.c_int,ctypes.c_void_p]
    rows={}
    for line in subprocess.check_output(['/bin/ps','-axo','pid=,ppid=,comm='],text=True).splitlines():
        fields=line.split(None,2)
        if len(fields)==3:rows[int(fields[0])]=(int(fields[1]),fields[2])
    owned={root}
    while True:
        added={pid for pid,(parent,_) in rows.items() if parent in owned}-owned
        if not added:break
        owned.update(added)
    result=[]
    for pid in owned:
        usage=Usage()
        if lib.proc_pid_rusage(pid,0,ctypes.byref(usage)):
            if pid not in rows:continue
            raise OSError(ctypes.get_errno(),'proc_pid_rusage failed; memory gate unavailable')
        result.append(dict(pid=pid,parentPid=rows.get(pid,(0,''))[0],name=rows.get(pid,(0,''))[1],
            workingSetBytes=usage.resident,chargedBytes=usage.footprint))
    return result


def process_tree(root):
    names={}
    if sys.platform=='darwin':
        return mac_process_tree(root)
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
                names[entry.pid]=entry.name
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
            if not handle:
                error = ctypes.get_last_error()
                if error == 87: continue  # PID exited after the tree snapshot.
                raise ctypes.WinError(error)
            try:
                memory = Memory(); memory.size = ctypes.sizeof(memory)
                if not psapi.GetProcessMemoryInfo(handle,ctypes.byref(memory),memory.size):
                    error = ctypes.get_last_error()
                    status = wintypes.DWORD()
                    kernel.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
                    if kernel.GetExitCodeProcess(handle,ctypes.byref(status)) and status.value != 259: continue
                    raise ctypes.WinError(error)
                working = memory.working
                try:charged = proportional_resident(handle, working, psapi)
                except OSError:
                    status=wintypes.DWORD()
                    kernel.GetExitCodeProcess.argtypes=[wintypes.HANDLE,ctypes.POINTER(wintypes.DWORD)]
                    if kernel.GetExitCodeProcess(handle,ctypes.byref(status)) and status.value!=259:continue
                    raise
            finally: kernel.CloseHandle(handle)
        result.append({'pid':pid,'parentPid':rows.get(pid,(0,0))[0],'name':names.get(pid,''),'workingSetBytes':working,
                       'chargedBytes':charged if os.name == 'nt' else linux_pss(pid, working)})
    return result


def snapshot(refresh=False):
    global _sample
    now=time.monotonic()
    with _lock:
        cached=_sample
    if refresh or now-cached[0]>.45 or cached[1] is None:
        with _sample_lock:
            with _lock: cached = _sample
            if refresh or time.monotonic()-cached[0]>.45 or cached[1] is None:
                rows=process_tree(int(os.environ.get('HDR_FINISHER_DESKTOP_PID',os.getppid())))
                with _lock: _sample=(time.monotonic(),rows)
            else: rows=cached[1]
    else: rows=cached[1]
    total=sum(row.get('chargedBytes',row['workingSetBytes']) for row in rows)
    with _lock:
        for key,(_,expires) in list(_reservations.items()):
            if expires<now: _reservations.pop(key,None)
        reserved=sum(row[0] for row in _reservations.values())
        waiting=now<_waiting_until
    pressure=system_pressure()
    return dict(totalBytes=total,workingSetBytes=sum(r['workingSetBytes'] for r in rows),
                measurement='physical-footprint' if sys.platform=='darwin' else 'proportional-resident',processes=rows,ceilingBytes=CEILING,
                targetBytes=TARGET,reservedBytes=reserved,caches=cache_snapshot(),
                pressure=pressure,budgetPressure=total>TARGET or waiting,
                reclaim=total>TARGET or waiting or pressure!='none')


def admit(key,size,release=False):
    global _waiting_until
    if release:
        with _lock: _reservations.pop(key,None)
        return dict(granted=True)
    with _lock:
        if key in _reservations:
            _reservations[key]=(_reservations[key][0],time.monotonic()+30)
            return dict(granted=True)
    value=snapshot()
    size=max(1,int(size))
    with _lock:
        reserved=sum(row[0] for row in _reservations.values())
    # Retained Grade levels need eviction only when total RAM is needed.
    # Ordinary admission and lease renewal must not destroy another owner.
    if value['totalBytes']+reserved+size>CEILING and value['caches']['working']['bytes']:
        with _lock: callbacks=[v['trim']() for v in _caches.values() if v['share']=='working' and v.get('trim')]
        for callback in callbacks:
            if callback: callback(0)
        value=snapshot(refresh=True)
    with _lock:
        # Shares cap retained caches. WORKING is the minimum room caches
        # leave free, not a combined job limit or a per-job maximum.
        reserved=sum(row[0] for row in _reservations.values())
        granted=value['totalBytes']+reserved+size<=CEILING
        if granted: _reservations[key]=(size,time.monotonic()+30)
        else: _waiting_until=time.monotonic()+2
    return dict(value,granted=granted)
