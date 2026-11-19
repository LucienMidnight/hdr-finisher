"""Optional loops with the same ordered float32 arithmetic as NumPy."""

import ctypes
from functools import lru_cache
import os
import sys

import numpy as np

from .config import BIN_DIR


@lru_cache(maxsize=1)
def library():
    suffix = ".dll" if os.name == "nt" else ".dylib" if sys.platform == "darwin" else ".so"
    try:
        native = ctypes.CDLL(str(BIN_DIR / ("denoise_filters" + suffix)))
        floats = np.ctypeslib.ndpointer(dtype=np.float32, flags=("C_CONTIGUOUS", "ALIGNED"))
        for function, dimensions in ((native.atrous, 8), (native.box7, 3)):
            function.argtypes = [floats] * 3 + [ctypes.c_int] * dimensions
            function.restype = None
    except (OSError, AttributeError):
        return None
    return native


def supports(values):
    return (values.dtype == np.float32 and values.ndim in (2, 3)
            and values.size > 0 and values.size <= np.iinfo(np.int32).max // 2)


def apply(function, values, *args):
    source = np.require(values, requirements=("C", "A"))
    vertical, output = np.empty_like(source), np.empty_like(source)
    height, width, *channels = source.shape
    function(source, vertical, output, height, width, channels[0] if channels else 1, *args)
    return output
