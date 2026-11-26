"""Optional exact float32 box filter for the default Ultra HDR gain map."""

import ctypes
from functools import lru_cache
import os
import sys

import numpy as np

from .config import BIN_DIR


@lru_cache(maxsize=1)
def _load_box5():
    suffix = ".dll" if os.name == "nt" else ".dylib" if sys.platform == "darwin" else ".so"
    try:
        box5 = ctypes.CDLL(str(BIN_DIR / ("gainmap_filter" + suffix))).box5
    except (OSError, AttributeError):
        return None
    plane = np.ctypeslib.ndpointer(dtype=np.float32, ndim=2, flags=("C_CONTIGUOUS", "ALIGNED"))
    box5.argtypes = [plane, plane, plane, ctypes.c_int, ctypes.c_int]
    box5.restype = None
    return box5


def box5(values: np.ndarray) -> np.ndarray | None:
    if values.dtype != np.float32 or values.ndim != 2 or not values.size:
        return None
    native = _load_box5()
    if native is None:
        return None
    source = np.require(values, requirements=("C", "A"))
    height, width = source.shape
    prefix = np.empty((height + 5, width), dtype=np.float32)
    result = np.empty_like(source)
    native(source, prefix, result, height, width)
    return result
