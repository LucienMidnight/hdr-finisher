"""Float32 prefix-sum box pass shared by detail, film and local masks.

Callers own tiling, cancellation and radius-zero shortcuts. Preserve the
accumulation order along each line so scheduling cannot change pixels.
"""
import numpy as np


def prefix_box_blur(values: np.ndarray, radius: int, axis: int) -> np.ndarray:
    padding = [(0, 0)] * values.ndim
    padding[axis] = (radius, radius)
    padded = np.pad(values, padding, mode="edge")
    shape = list(padded.shape)
    shape[axis] += 1
    cumulative = np.empty(shape, dtype=np.float32)
    first = [slice(None)] * values.ndim
    first[axis] = 0
    cumulative[tuple(first)] = 0.0
    rest = [slice(None)] * values.ndim
    rest[axis] = slice(1, None)
    np.cumsum(padded, axis=axis, dtype=np.float32, out=cumulative[tuple(rest)])
    width = radius * 2 + 1
    after = [slice(None)] * values.ndim
    before = [slice(None)] * values.ndim
    after[axis] = slice(width, None)
    before[axis] = slice(None, -width)
    result = np.subtract(cumulative[tuple(after)], cumulative[tuple(before)])
    result /= np.float32(width)
    return result
