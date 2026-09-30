"""Isolated whole-frame/strip feather comparison; no source photos needed."""
import argparse
import ctypes
import hashlib
import json
from pathlib import Path
import sys
import time

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "backend"), str(ROOT / "tests")]
from hdr_finisher.local_adjustments import _gaussian_blur_float, _gaussian_box_widths
from test_mask_blur_strips import whole_frame_box


def peak_working_set():
    if sys.platform != "win32":
        return None
    class Counters(ctypes.Structure):
        _fields_ = [("cb", ctypes.c_ulong), ("faults", ctypes.c_ulong)] + [
            (name, ctypes.c_size_t) for name in ["peak", "working", "quota_peak_paged", "quota_paged",
                                               "quota_peak_nonpaged", "quota_nonpaged", "pagefile", "peak_pagefile"]
        ]
    counters = Counters()
    counters.cb = ctypes.sizeof(counters)
    kernel = ctypes.WinDLL("kernel32")
    kernel.GetCurrentProcess.restype = ctypes.c_void_p
    psapi = ctypes.WinDLL("psapi")
    psapi.GetProcessMemoryInfo.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_ulong]
    if not psapi.GetProcessMemoryInfo(kernel.GetCurrentProcess(), ctypes.byref(counters), counters.cb):
        raise ctypes.WinError()
    return counters.peak


parser = argparse.ArgumentParser()
parser.add_argument("mode", choices=["whole", "strips"])
parser.add_argument("--edge", type=int, default=7362)
parser.add_argument("--sigma", type=float, default=400)
args = parser.parse_args()
values = np.random.default_rng(42).random((round(args.edge * 2 / 3), args.edge), dtype=np.float32)
start = time.perf_counter()
if args.mode == "strips":
    result = _gaussian_blur_float(values, args.sigma)
else:
    result = values.copy()
    for axis in [1, 0]:
        for width in _gaussian_box_widths(args.sigma, 6):
            radius = (width - 1) // 2
            if radius:
                result = whole_frame_box(result, radius, axis)
    result = np.clip(result, 0.0, 1.0)
elapsed = (time.perf_counter() - start) * 1000
peak = peak_working_set()
print(json.dumps({"mode": args.mode, "shape": values.shape, "sigma": args.sigma,
                  "ms": elapsed, "peak_working_set_bytes": peak,
                  "float_sha256": hashlib.sha256(memoryview(result)).hexdigest()}), flush=True)
