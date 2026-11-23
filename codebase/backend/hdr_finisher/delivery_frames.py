"""Job-owned float delivery frames with bounded disk writes and reads."""
from __future__ import annotations

from .export_timing import timed as _timed_stage
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from pathlib import Path
import math
import mmap
import shutil

import numpy as np

SOURCE_SPILL_BYTES = 256 * 1024 * 1024
_batch_source_buffers = ContextVar("batch_source_buffers", default=False)


@contextmanager
def batch_source_buffers():
    token = _batch_source_buffers.set(True)
    try:
        yield
    finally:
        _batch_source_buffers.reset(token)


def mapped_source_array(shape, dtype=np.float32, *, order="C"):
    """Keep giant batch decode buffers out of malloc until the source is spilled."""
    if not _batch_source_buffers.get():
        return None
    size = math.prod(shape) * np.dtype(dtype).itemsize
    if size < SOURCE_SPILL_BYTES:
        return None
    return np.ndarray(shape, dtype=dtype, buffer=mmap.mmap(-1, size), order=order)


def empty_source_array(shape, dtype=np.float32):
    output = mapped_source_array(shape, dtype)
    return np.empty(shape, dtype=dtype) if output is None else output


def source_float32(source, *, copy=True):
    if not copy and source.dtype == np.float32:
        return source
    order = "F" if source.flags.f_contiguous else "C"
    output = mapped_source_array(source.shape, order=order)
    if output is None:
        return source.astype(np.float32, copy=copy)
    np.copyto(output, source, casting="unsafe")
    return output


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
        try:
            with self.path.open("wb") as file:
                for band in bands:
                    file.write(memoryview(np.ascontiguousarray(band, dtype=self.dtype)).cast("B"))
                if file.tell() != math.prod(self.shape) * self.dtype.itemsize:
                    raise OSError("Incomplete delivery frame.")
        except BaseException:
            self.path.unlink(missing_ok=True)
            raise

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
        try:
            pixels = np.memmap(self.path, mode=mode, shape=self.shape, dtype=self.dtype)
            try:
                yield pixels
                if mode != "r":
                    pixels.flush()
            finally:
                pixels._mmap.close()
        except BaseException:
            if mode == "w+":
                self.path.unlink(missing_ok=True)
            raise

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


def transform_lines(source, destination, axis, transform, *, work_bytes=8 * 1024**2, progress=None):
    from .export_timing import tick

    report = tick if progress is None else progress
    height, width = source.shape[:2]
    length, count = (height, width) if axis == 0 else (width, height)
    lines = max(1, work_bytes // (length * source.dtype.itemsize))
    with source.map("r") as pixels, destination.map("w+") as output:
        for start in range(0, count, lines):
            stop = min(start + lines, count)
            region = np.s_[:, start:stop] if axis == 0 else np.s_[start:stop, :]
            output[region] = transform(pixels[region])
            report(stop, count)
    return destination


def transform_bands(source, destination, transform, *, rows=128, halo=0, progress=None):
    from .export_timing import tick

    report = tick if progress is None else progress
    height = source.shape[0]
    with source.map("r") as pixels:
        def bands():
            for top in range(0, height, rows):
                bottom = min(height, top + rows)
                first = max(0, top - halo)
                last = min(height, bottom + halo)
                yield transform(pixels[first:last], first)[top - first:bottom - first]
                report(bottom, height)

        destination.write(bands())
    return destination
