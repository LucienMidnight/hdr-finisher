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
    # A worktree can still have the older optional binary until setup runs.
    try:
        for function, arrays, dimensions in (
            (native.colour_pair, 10, 3), (native.colour_deltas, 7, 1),
            (native.colour_repair, 12, 1), (native.colour_guides, 11, 1),
        ):
            function.argtypes = [floats] * arrays + [ctypes.c_int] * dimensions
            function.restype = None
        # The first two arguments are aligned views into the padded tap field.
        function = native.colour_pair
        function.argtypes = [np.ctypeslib.ndpointer(dtype=np.float32, flags="ALIGNED")] * 2 + function.argtypes[2:]
        if hasattr(native, "colour_guides_relative"):
            native.colour_guides_relative.argtypes = native.colour_guides.argtypes + [ctypes.c_float]
            native.colour_guides_relative.restype = None
    except AttributeError:
        pass
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
