"""Job-owned float delivery frames. Readers stream bands without mapping."""
from __future__ import annotations

from .export_timing import timed as _timed_stage
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
import math
import shutil

import numpy as np


@dataclass(frozen=True)
class DeliveryFrame:
    path: Path
    shape: tuple[int, ...]
    dtype: np.dtype = np.dtype(np.float32)

    def check_space(self) -> None:
        size = math.prod(self.shape) * self.dtype.itemsize
        try:
            reusable = self.path.stat().st_size
        except FileNotFoundError:
            reusable = 0
        if shutil.disk_usage(self.path.parent).free + reusable < size:
            raise OSError(f"Delivery needs {size:,} bytes of free scratch disk space.")

    def write(self, bands) -> None:
        self.check_space()
        with self.path.open("wb") as file:
            for band in bands:
                file.write(memoryview(np.ascontiguousarray(band, dtype=self.dtype)).cast("B"))

    @classmethod
    @_timed_stage("frame_spill")
    def spill(cls, path: Path, pixels: np.ndarray) -> DeliveryFrame:
        frame = cls(path, pixels.shape, pixels.dtype)
        frame.write(row_bands(pixels, 128))
        return frame

    @contextmanager
    def map(self, mode: str):
        if mode == "w+":
            self.check_space()
        pixels = np.memmap(self.path, mode=mode, shape=self.shape, dtype=self.dtype)
        try:
            yield pixels
            if mode != "r":
                pixels.flush()
        finally:
            pixels._mmap.close()

    def bands(self, rows: int):
        height, *row_shape = self.shape
        buffer = np.empty((min(height, rows), *row_shape), dtype=self.dtype)
        with self.path.open("rb") as file:
            for top in range(0, height, rows):
                band = buffer[:min(rows, height - top)]
                if file.readinto(memoryview(band).cast("B")) != band.nbytes:
                    raise OSError("Incomplete delivery frame.")
                yield band


def row_bands(image: np.ndarray | DeliveryFrame, rows: int):
    if isinstance(image, DeliveryFrame):
        yield from image.bands(rows)
    else:
        for top in range(0, image.shape[0], rows):
            yield image[top:top + rows]
