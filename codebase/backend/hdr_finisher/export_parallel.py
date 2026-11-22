"""Exact parallel helpers for export stages that ran on one core.

Both helpers split work where the arithmetic of every output sample is
unchanged: a one-axis blur treats each line along that axis on its own, so
blocks across the other axis give the same numbers; and a per-pixel band
conversion gives the same band whichever worker runs it. They act only while
an export is timed (``export_timing.export_clock``), so Grade and Library keep
their current behaviour. Each use was checked byte for byte on the exported
files.
"""
from __future__ import annotations

from collections import deque
from typing import Callable, Iterable, Iterator, TypeVar

import numpy as np

T = TypeVar("T")
R = TypeVar("R")

# Below this a frame is not worth dispatching.
MINIMUM_BLOCK_PIXELS = 2_000_000
MINIMUM_BLOCK_LINES = 64


def _exporting() -> bool:
    from .cpu_budget import _inside
    from .export_timing import active_clock
    return active_clock() is not None and not getattr(_inside, "active", False)


def blur_axis_in_blocks(blur: Callable[[np.ndarray, int, int], np.ndarray], values: np.ndarray,
                        radius: int, axis: int) -> np.ndarray:
    """``blur(values, radius, axis)`` on blocks across the other image axis."""
    if radius <= 0 or values.ndim < 2 or axis not in (0, 1) or values.size < MINIMUM_BLOCK_PIXELS or not _exporting():
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


def ordered_map(function: Callable[[T], R], items: Iterable[T], *, ahead: int | None = None) -> Iterator[R]:
    """``map(function, items)`` on the CPU pool, in order, a few items ahead.

    At most ``ahead`` results are held at once, so a band conversion keeps
    its bounded memory.
    """
    if not _exporting():
        yield from map(function, items)
        return
    from .cpu_budget import CpuExecutor, logical_cpus
    ahead = ahead or logical_cpus()
    pending: deque = deque()
    with CpuExecutor() as pool:
        for item in items:
            pending.append(pool.submit(function, item))
            if len(pending) >= ahead:
                yield pending.popleft().result()
        while pending:
            yield pending.popleft().result()
