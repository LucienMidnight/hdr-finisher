"""One serial/overlapped open, measuring peak memory without pixel copies."""
from pathlib import Path
import json, os, subprocess, sys, threading
import ctypes
from ctypes import wintypes
class Counters(ctypes.Structure):
    _fields_ = [('cb', wintypes.DWORD), ('PageFaultCount', wintypes.DWORD)] + [
        (name, ctypes.c_size_t) for name in ('PeakWorkingSetSize', 'WorkingSetSize',
        'QuotaPeakPagedPoolUsage', 'QuotaPagedPoolUsage', 'QuotaPeakNonPagedPoolUsage',
        'QuotaNonPagedPoolUsage', 'PagefileUsage', 'PeakPagefileUsage', 'PrivateUsage')]
get_process = ctypes.WinDLL('kernel32').GetCurrentProcess
get_process.restype = wintypes.HANDLE
get_memory = ctypes.WinDLL('psapi').GetProcessMemoryInfo
get_memory.argtypes = [wintypes.HANDLE, ctypes.POINTER(Counters), wintypes.DWORD]
get_memory.restype = wintypes.BOOL
root=Path(__file__).resolve().parents[1]
output=root/'output/library-grade-open'
serial='--serial' in sys.argv
mode='serial' if serial else 'overlap'
os.environ['HDR_FINISHER_USER_DATA_DIR']=str(output/('memory-'+mode+'-profile'))
sys.path.insert(0,str(root/'backend'))
if serial:
    # Preserve the actual starting revision, even after this task is committed.
    reference = '10eeb1e0605b4c0699c180ccbd6cec08dc8515bd'
    package = output / 'serial-reference' / 'hdr_finisher'
    package.mkdir(parents=True, exist_ok=True)
    (package / '__init__.py').write_text('__path__.append(' + repr(str(root / 'backend/hdr_finisher')) + ')\n', encoding='utf-8')
    for name in ('raw_import.py', 'render_cache.py', 'sessions.py'):
        (package / name).write_bytes(subprocess.check_output([
            'git', 'cat-file', 'blob', reference + ':codebase/backend/hdr_finisher/' + name], cwd=root.parent))
    sys.path.insert(0, str(package.parent))
from hdr_finisher.sessions import SessionStore
process=get_process()
peak={'rss':0,'private':0}
finished=threading.Event()
def sample():
    while not finished.is_set():
        memory= Counters()
        memory.cb=ctypes.sizeof(memory)
        if not get_memory(process, ctypes.byref(memory), memory.cb):
            raise ctypes.WinError()
        peak['rss']=max(peak['rss'], memory.PeakWorkingSetSize)
        peak['private']=max(peak['private'], memory.PrivateUsage)
        finished.wait(.01)
watcher=threading.Thread(target=sample)
watcher.start()
try:
    store=SessionStore() if serial else SessionStore(grade_import_parallel=True)
    session=store.prepare_session(output/'identity/identity.ARW')
finally:
    finished.set()
    watcher.join()
record={'mode':mode,'peak_bytes':peak,'image_bytes':session.image.nbytes}
(output/('memory-'+mode+'.json')).write_text(json.dumps(record),encoding='utf-8')
print(json.dumps(record))
store.clear()