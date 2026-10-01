"""Read-only fixture tracing and isolated old/new feather A/B; no RAW decode."""
import argparse
import cProfile
import hashlib
import json
from pathlib import Path
import pstats
import sys
import time
import zipfile

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "backend"), str(ROOT / "tests")]
from hdr_finisher import local_adjustments as masks
from hdr_finisher.models import MaskExpression, GeometryAdjustments
import ctypes


def peak_working_set():
    class Counters(ctypes.Structure):
        _fields_ = [('cb', ctypes.c_ulong), ('faults', ctypes.c_ulong)] + [
            (name, ctypes.c_size_t) for name in ['peak', 'working', 'quota_peak_paged', 'quota_paged',
                                               'quota_peak_nonpaged', 'quota_nonpaged', 'pagefile', 'peak_pagefile']]
    counters = Counters()
    counters.cb = ctypes.sizeof(counters)
    kernel = ctypes.WinDLL('kernel32')
    kernel.GetCurrentProcess.restype = ctypes.c_void_p
    psapi = ctypes.WinDLL('psapi')
    psapi.GetProcessMemoryInfo.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_ulong]
    if not psapi.GetProcessMemoryInfo(kernel.GetCurrentProcess(), ctypes.byref(counters), counters.cb):
        raise ctypes.WinError()
    return counters.peak


def prior_blur(mask, sigma, passes=6):
    sx, sy = (sigma, sigma) if isinstance(sigma, (int, float)) else sigma
    if max(sx, sy) < .25:
        return mask.astype(np.float32, copy=False)
    result = mask.astype(np.float32, copy=True)
    for axis, s in [(1, sx), (0, sy)]:
        for width in masks._gaussian_box_widths(float(s), passes):
            if width > 1:
                result = masks._box_blur_axis(result, (width - 1) // 2, axis)
    return np.clip(result, 0, 1).astype(np.float32, copy=False)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--project')
    parser.add_argument('--mode', choices=['prior', 'current'], default='current')
    parser.add_argument('--edge', type=int, default=7362)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    report = {'mode': args.mode, 'edge': args.edge, 'source': 'synthetic float32, fixture spatial brush only'}
    if args.mode == 'prior':
        masks._gaussian_blur_float = prior_blur
    values = np.random.default_rng(42).random((round(args.edge * 2 / 3), args.edge), dtype=np.float32)
    started = time.perf_counter()
    result = masks._gaussian_blur_float(values, 400)
    report['blur'] = {'ms': (time.perf_counter()-started)*1000,
                      'sha256': hashlib.sha256(memoryview(result)).hexdigest()}
    del result, values
    if args.project:
        with zipfile.ZipFile(args.project) as archive:
            document = json.loads(archive.read('edit-state.json'))
        report['document_keys'] = list(document)
        locals_ = document.get('local_adjustments', document.get('edit_document', {}).get('local_adjustments', []))
        brush = next(x for x in locals_ if x.get('mask', {}).get('leaf', {}).get('type') == 'brush')
        expression = MaskExpression.model_validate(brush['mask'])
        source = np.zeros((round(args.edge*2/3), args.edge, 3), dtype=np.float32)
        profile = cProfile.Profile()
        started = time.perf_counter()
        result = profile.runcall(masks.compile_geometry_fixed_mask, source, expression, GeometryAdjustments(), spatial_only=True)
        report['fixture_brush'] = {'ms': (time.perf_counter()-started)*1000, 'strokes': len(expression.leaf.strokes),
                                   'sha256': hashlib.sha256(memoryview(result)).hexdigest()}
        stats = pstats.Stats(profile)
        report['stages'] = sorted([{'function': key[2], 'file': Path(key[0]).name,
                                   'calls': value[1], 'self_ms': value[2]*1000, 'cumulative_ms': value[3]*1000}
                                  for key, value in stats.stats.items()], key=lambda row: -row['cumulative_ms'])[:35]
    report['peak_working_set_bytes'] = peak_working_set()
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output).write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report), flush=True)


if __name__ == '__main__':
    main()
