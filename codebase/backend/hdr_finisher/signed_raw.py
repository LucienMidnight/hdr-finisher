from __future__ import annotations

import ctypes
from functools import lru_cache
import os
import sys

import numpy as np

from .config import BIN_DIR


@lru_cache(maxsize=1)
def _library():
    suffix = ".dll" if os.name == "nt" else ".dylib" if sys.platform == "darwin" else ".so"
    path = BIN_DIR / ("signed_ahd" + suffix)
    library = ctypes.CDLL(str(path))
    floats = np.ctypeslib.ndpointer(dtype=np.float32, flags="C_CONTIGUOUS")
    integers = np.ctypeslib.ndpointer(dtype=np.int32, flags="C_CONTIGUOUS")
    library.signed_ahd.argtypes = [floats, ctypes.c_int, ctypes.c_int, integers, floats, floats]
    library.signed_ahd.restype = ctypes.c_int
    return library


def demosaic(sensor, pattern, black, matrix, *, rows=256, half_size=False, cancelled=None):
    source = np.asarray(sensor)
    cfa = np.ascontiguousarray(pattern, dtype=np.int32)
    levels = np.asarray(black, dtype=np.float32)
    transform = np.ascontiguousarray(matrix, dtype=np.float32)
    if source.ndim != 2 or min(source.shape) < 2 or source.dtype != np.uint16:
        raise ValueError("Signed RAW development needs an unpacked uint16 Bayer mosaic")
    if cfa.shape != (2, 2) or sorted(cfa.ravel()) != [0, 1, 1, 2]:
        raise ValueError("Signed AHD requires an RGB Bayer pattern")
    if levels.shape != (2, 2) or not np.isfinite(levels).all() or np.any(levels < 0) or np.any(levels > 65535):
        raise ValueError("Invalid per-phase RAW black levels")
    if transform.shape != (3, 3) or not np.isfinite(transform).all():
        raise ValueError("Invalid camera-to-Lab matrix")
    if rows < 16 or rows % 2:
        raise ValueError("Signed AHD strip height must be even and at least 16")
    height, width = source.shape
    step = 2 if half_size else 1
    result = np.empty(((height + step - 1) // step, (width + step - 1) // step, 3), dtype=np.float32)
    library = _library()
    for top in range(0, height, rows):
        if cancelled is not None and cancelled():
            raise InterruptedError("RAW development cancelled")
        bottom = min(height, top + rows)
        first, last = max(0, top - 8), min(height, bottom + 8)
        strip = source[first:last].astype(np.float32)
        for phase_row in range(2):
            for phase_column in range(2):
                strip[phase_row::2, phase_column::2] -= levels[phase_row, phase_column]
        output = np.empty((*strip.shape, 3), dtype=np.float32)
        status = library.signed_ahd(strip, strip.shape[0], width, cfa, transform, output)
        if status:
            raise MemoryError(f"Signed AHD strip failed ({status})")
        result[top // step:(bottom + step - 1) // step] = output[top - first:bottom - first:step, ::step]
    return result


def orient(image, flip):
    if flip == 3:
        image = image[::-1, ::-1]
    elif flip == 5:
        image = np.rot90(image, 1)
    elif flip == 6:
        image = np.rot90(image, -1)
    return np.ascontiguousarray(image)
