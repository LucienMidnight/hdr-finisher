"""Exact parallel helpers for export stages that ran on one core.

Both helpers split work where the arithmetic of every output sample is
unchanged: a one-axis blur treats each line along that axis on its own, so
blocks across the other axis give the same numbers; and a per-pixel band
conversion gives the same rows whichever worker converts them. They act only while
an export is timed (``export_timing.export_clock``), so Grade and Library keep
their current behaviour. Each use was checked byte for byte on the exported
files.
"""
from __future__ import annotations

from typing import Callable

import numpy as np

# Below this a frame is not worth dispatching.
MINIMUM_BLOCK_PIXELS = 2_000_000
MINIMUM_BLOCK_LINES = 64
MINIMUM_PART_ROWS = 16


def _exporting() -> bool:
    from .cpu_budget import _inside
    from .export_timing import active_clock
    return active_clock() is not None and not getattr(_inside, "active", False)


def blur_axis_in_blocks(blur: Callable[[np.ndarray, int, int], np.ndarray], values: np.ndarray,
                        radius: int, axis: int) -> np.ndarray:
    """Blur float32 blocks across the other axis, preserving other dtypes via the caller's blur."""
    if (radius <= 0 or values.dtype != np.float32 or values.ndim < 2 or axis not in (0, 1)
            or values.size < MINIMUM_BLOCK_PIXELS or not _exporting()):
        return blur(values, radius, axis)
    from .cpu_budget import CpuExecutor, logical_cpus
    across = 1 - axis
    lines = values.shape[across]
    blocks = max(1, min(logical_cpus(), lines // MINIMUM_BLOCK_LINES))
    if blocks < 2:
        return blur(values, radius, axis)
    edges = np.linspace(0, lines, blocks + 1).astype(int)
    result = np.empty(values.shape, dtype=np.float32)

    def run(index: int) -> None:
        window = [slice(None)] * values.ndim
        window[across] = slice(edges[index], edges[index + 1])
        result[tuple(window)] = blur(values[tuple(window)], radius, axis)

    with CpuExecutor() as pool:
        list(pool.map(run, range(blocks)))
    return result


def rows_in_parts(convert: Callable[[np.ndarray, int], np.ndarray], band: np.ndarray, top: int) -> np.ndarray:
    """``convert(band, top)`` with the band's rows split over the CPU pool.

    For a per-pixel conversion that takes its first row's frame position
    (dithering uses it). One band is in flight at a time, as before, so the
    memory held stays that of the serial conversion.
    """
    rows = band.shape[0]
    if not _exporting() or rows < 2 * MINIMUM_PART_ROWS:
        return convert(band, top)
    from .cpu_budget import CpuExecutor, logical_cpus
    parts = max(1, min(logical_cpus(), rows // MINIMUM_PART_ROWS))
    edges = np.linspace(0, rows, parts + 1).astype(int)
    with CpuExecutor() as pool:
        pieces = list(pool.map(lambda index: convert(band[edges[index]:edges[index + 1]], top + int(edges[index])),
                               range(parts)))
    return np.concatenate(pieces, axis=0)
