"""Write a planar Y4M frame from rows of already quantized YUV."""

from pathlib import Path
from typing import Iterable

import numpy as np

from .export_timing import tick


def write_y4m_bands(
    path: Path,
    height: int,
    width: int,
    bands: Iterable[np.ndarray],
    *,
    bit_depth: int,
    chroma_subsampling: str,
) -> None:
    vertical = 2 if chroma_subsampling == "420" else 1
    horizontal = 1 if chroma_subsampling == "444" else 2
    chroma_width = -(-width // horizontal)
    chroma_height = -(-height // vertical)
    chroma_name = (
        {"420": "420jpeg", "422": "422", "444": "444"}[chroma_subsampling]
        if bit_depth == 8
        else f"{chroma_subsampling}p{bit_depth}"
    )
    header = (
        f"YUV4MPEG2 W{width} H{height} F1:1 Ip A1:1 C{chroma_name} "
        f"XYSCSS={chroma_name.upper()}\nFRAME\n"
    ).encode("ascii")

    dtype = np.dtype("u1" if bit_depth == 8 else "<u2")
    sample_bytes = dtype.itemsize
    y_bytes = height * width * sample_bytes
    chroma_bytes = chroma_height * chroma_width * sample_bytes
    with path.open("wb") as handle:
        handle.write(header)
        top = 0
        for band in bands:
            if top % vertical:
                raise ValueError("Only the final Y4M band may end in a partial chroma row.")
            # Y4M stores whole planes. Place each set of rows into its plane.
            # For 4:2:0, the final band alone can end in a partial chroma row.
            handle.seek(len(header) + top * width * sample_bytes)
            handle.write(band[..., 0].astype(dtype, copy=False).tobytes())
            for index in (1, 2):
                plane = band[..., index]
                if chroma_subsampling != "444":
                    plane = _downsample_plane(plane, vertical, horizontal)
                handle.seek(len(header) + y_bytes + (index - 1) * chroma_bytes
                            + (top // vertical) * chroma_width * sample_bytes)
                handle.write(plane.astype(dtype, copy=False).tobytes())
            top += len(band)
            tick(top, height)


def _downsample_plane(plane: np.ndarray, vertical: int, horizontal: int) -> np.ndarray:
    height, width = plane.shape
    padded_height = ((height + vertical - 1) // vertical) * vertical
    padded_width = ((width + horizontal - 1) // horizontal) * horizontal
    padded = np.pad(plane, ((0, padded_height - height), (0, padded_width - width)), mode="edge")
    return np.round(
        padded.reshape(padded_height // vertical, vertical, padded_width // horizontal, horizontal)
        .mean(axis=(1, 3))
    ).astype(plane.dtype)
