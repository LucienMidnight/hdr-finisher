# Windows-only RSS diagnostic; set EXPOSURE_MEMORY_PHOTO relative to output/test-photos.
from pathlib import Path
from threading import Thread,Event
import json,ctypes,rawpy,cv2,numpy as np
from hdr_finisher.library_overlays import exposure_source,pool_max,camera_frame
from hdr_finisher.cpu_budget import native_threads,raw_threads
raw_threads(native_threads());cv2.setNumThreads(native_threads())
# Load native libraries before the baseline; no retained photo arrays.
cv2.resize(np.ones((8,8),np.float32),(4,4))
from ctypes import wintypes
class Memory(ctypes.Structure):
 _fields_=[('cb',wintypes.DWORD),('faults',wintypes.DWORD)]+[(n,ctypes.c_size_t)for n in ['peak','working','peak_paged','paged','peak_nonpaged','nonpaged','pagefile','peak_pagefile','private']]
api=ctypes.WinDLL('psapi',use_last_error=True);kernel=ctypes.WinDLL('kernel32',use_last_error=True)
kernel.GetCurrentProcess.restype=wintypes.HANDLE
api.GetProcessMemoryInfo.argtypes=[wintypes.HANDLE,ctypes.POINTER(Memory),wintypes.DWORD]
handle=kernel.GetCurrentProcess()
def resident():
 value=Memory();value.cb=ctypes.sizeof(value)
 if not api.GetProcessMemoryInfo(handle,ctypes.byref(value),value.cb):raise ctypes.WinError(ctypes.get_last_error())
 return value.working
base=resident();peak=[base];stop=Event()
def sample():
 while not stop.wait(.002):peak[0]=max(peak[0],resident())
thread=Thread(target=sample);thread.start()
try:
 import os
 path=Path('output/test-photos')/os.environ['EXPOSURE_MEMORY_PHOTO'];probe={}
 blown,blocked=exposure_source(path,probe=probe);pixels=blown.size
 maps=np.stack([pool_max(blown),pool_max(blocked)],axis=2).astype(np.uint8)*255
 placement=camera_frame(path,probe['luminance'])
 peak[0]=max(peak[0],resident())
 print(json.dumps(dict(photo=str(path.name),pixels=pixels,baseline_bytes=base,peak_bytes=peak[0],increase_bytes=peak[0]-base,increase_bytes_per_pixel=(peak[0]-base)/pixels,with_25_percent_headroom=(peak[0]-base)*1.25/pixels,aligned='camera_frame'in placement)))
finally:stop.set();thread.join()
