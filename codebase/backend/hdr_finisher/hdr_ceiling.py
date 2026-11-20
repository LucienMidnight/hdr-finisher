"""Decoded HDR target enforcement and local correction.

Lossy codecs and gain-map reconstruction can overshoot at bright edges and
in saturated highlights. Enabled Highlight Compression always enforces its
target after encoding, with a 1% encoding allowance. With Highlights off the
optional preset check uses the codec limit. Uncorrectable files are rejected.

Only the neighbourhood of an overshoot is lowered, by the amount it
overshot plus a small margin, and the change fades out smoothly. The rest
of the picture and the SDR rendition are never touched. Dimming the whole
image to pass would visibly change the grade.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Callable, TypeVar

import numpy as np

from .color import acescg_to_linear_bt2020
from .color_context import scene_linear_to_nits

T = TypeVar("T")

BLOCK = 16
BAND_ROWS = 128
# Codecs only partly follow a lowered input, so each round undershoots its aim.
# Squaring the overshoot ratio and small growing margins usually finish in
# one correction while landing close under the ceiling.
STRENGTH = 2.0
MARGINS = (0.003, 0.006, 0.012, 0.025, 0.05, 0.1)
CODEC_LIMIT_NITS = 10000.0
# Steve, 2026-11-14: accept initial encodes within this allowance unchanged.
ENCODING_ALLOWANCE = 0.01


class CeilingError(ValueError):
    pass


def delivery_ceiling_nits(adjustments) -> float:
    """The promised HDR peak: the highlight compression target when it is on."""
    hdr = adjustments.hdr
    if hdr.highlight_section_enabled:
        return min(float(hdr.highlight_compression_target_nits), CODEC_LIMIT_NITS)
    return CODEC_LIMIT_NITS


def channel_nits(image: np.ndarray, reference_white_nits: float = 203) -> np.ndarray:
    """Per-pixel brightest BT.2020 channel, in nits, in bounded row bands."""
    result = np.empty(image.shape[:2], dtype=np.float32)
    for first in range(0, image.shape[0], 256):
        rgb = acescg_to_linear_bt2020(image[first:first + 256, :, :3])
        result[first:first + 256] = scene_linear_to_nits(np.max(rgb, axis=-1), reference_white_nits)
    return result


def decoded_channel_nits(path: Path, format_name: str) -> np.ndarray:
    """Decode a delivery the way the import decoders do (0.18 == 203 nits)."""
    if format_name == "jpeg_ultrahdr":
        return _ultrahdr_channel_nits(path)
    elif format_name == "avif_gain_map":
        from .gainmap_decoders import decode_avif
        image, _, _ = decode_avif(path)
    elif format_name == "jpegxl_hdr":
        from .jpegxl import decode_jpegxl
        image, _ = decode_jpegxl(path)
    else:
        raise ValueError(f"Unsupported HDR ceiling format: {format_name}")
    if image.size == 0 or not np.all(np.isfinite(image)):
        raise CeilingError("The HDR file decoded to empty or non-finite pixels.")
    return channel_nits(image, 203)


@dataclass(frozen=True)
class _DecodedCeiling:
    shape: tuple[int, int]
    peak: float
    block_maxima: np.ndarray


def decoded_ultrahdr_ceiling(path: Path, ceiling_nits: float) -> _DecodedCeiling | np.ndarray:
    """Keep only the full decoded peak and the data used by local correction."""
    return _ultrahdr_channel_nits(path, min(float(ceiling_nits), CODEC_LIMIT_NITS))


def _fill_block_maxima(grid: np.ndarray, top: int, nits: np.ndarray, ceiling: float) -> None:
    height, width = nits.shape
    blocks_y, blocks_x = -(-height // BLOCK), grid.shape[1]
    padded = np.ones((blocks_y * BLOCK, blocks_x * BLOCK), dtype=np.float32)
    padded[:height, :width] = np.maximum(nits / np.float32(ceiling), 1.0)
    grid[top // BLOCK:top // BLOCK + blocks_y] = padded.reshape(
        blocks_y, BLOCK, blocks_x, BLOCK).max(axis=(1, 3))


def _ultrahdr_channel_nits(path: Path, ceiling: float | None = None) -> _DecodedCeiling | np.ndarray:
    """Check the same decoded HDR samples without materializing either RGB rendition."""
    from PIL import Image
    from .color import linear_bt2020_to_acescg, linear_srgb_to_acescg
    from .gainmap_decoders import _apply_exif_orientation, inspect_jpeg_gain_map, reconstructed_ultrahdr_rgba

    gain = inspect_jpeg_gain_map(path)
    transform = linear_srgb_to_acescg if gain.use_base_color_space else linear_bt2020_to_acescg
    with Image.open(path) as primary:
        width, height = primary.size
        orientation = int(primary.getexif().get(274, 1))
    # The block coordinates need to follow EXIF orientation. Retain the
    # per-pixel route for orientations other than the delivery default.
    compact = ceiling is not None and orientation == 1
    if compact:
        grid = np.ones((-(-height // BLOCK), -(-width // BLOCK)), dtype=np.float32)
        peak = -np.inf
    else:
        nits = np.empty((height, width), dtype=np.float32)
    with reconstructed_ultrahdr_rgba(path, width, height) as raw:
        for top in range(0, height, BAND_ROWS):
            rows = min(BAND_ROWS, height - top)
            rgba = np.fromfile(raw, dtype="<f2", count=rows * width * 4).reshape(rows, width, 4)
            hdr = rgba[..., :3].astype(np.float32)
            hdr *= np.float32(0.18)
            hdr = np.maximum(transform(hdr), np.float32(0))
            if not np.isfinite(hdr).all():
                raise CeilingError("The HDR file decoded to non-finite pixels.")
            if not compact:
                nits[top:top + rows] = channel_nits(hdr, 203)
                continue
            rgb = acescg_to_linear_bt2020(hdr)
            brightest = np.maximum(rgb[..., 0], rgb[..., 1])
            np.maximum(brightest, rgb[..., 2], out=brightest)
            band_nits = scene_linear_to_nits(brightest, 203)
            if not np.isfinite(band_nits).all():
                raise CeilingError("The HDR file decoded to empty or non-finite pixels.")
            band_peak = float(np.max(band_nits))
            peak = max(peak, band_peak)
            if band_peak > ceiling:
                _fill_block_maxima(grid, top, band_nits, ceiling)
    if compact:
        return _DecodedCeiling((height, width), peak, grid)
    return _apply_exif_orientation(nits[..., None], orientation)[..., 0]


def _correct_bands(
    current: np.ndarray, decoded: _DecodedCeiling | np.ndarray, ceiling: float, margin: float,
) -> None:
    """Apply the same widened block grid using global interpolation coordinates."""
    height, width = decoded.shape
    blocks_y, blocks_x = -(-height // BLOCK), -(-width // BLOCK)
    if isinstance(decoded, _DecodedCeiling):
        grid = decoded.block_maxima
    else:
        grid = np.empty((blocks_y, blocks_x), dtype=np.float32)
        for top in range(0, height, BAND_ROWS):
            _fill_block_maxima(grid, top, decoded[top:top + BAND_ROWS], ceiling)
    widened = np.pad(grid, 1, constant_values=1.0)
    grid = np.max([widened[dy:dy + blocks_y, dx:dx + blocks_x] for dy in range(3) for dx in range(3)], axis=0)

    def axis_weights(size: int, blocks: int):
        position = np.clip((np.arange(size, dtype=np.float32) + 0.5) / BLOCK - 0.5, 0, blocks - 1)
        low = np.floor(position).astype(np.int64)
        return low, np.minimum(low + 1, blocks - 1), (position - low).astype(np.float32)

    y0, y1, wy = axis_weights(height, blocks_y)
    x0, x1, wx = axis_weights(width, blocks_x)
    for top in range(0, height, BAND_ROWS):
        band = slice(top, top + BAND_ROWS)
        if np.all(grid[y0[band]] == 1.0) and np.all(grid[y1[band]] == 1.0):
            continue
        rows = grid[y0[band]] * (1 - wy[band, None]) + grid[y1[band]] * wy[band, None]
        spread = rows[:, x0] * (1 - wx)[None, :] + rows[:, x1] * wx[None, :]
        correction = np.where(spread > 1.0, 1.0 / (spread ** STRENGTH * (1.0 + margin)), 1.0).astype(np.float32)
        rgb = current[band, :, :3]
        np.multiply(rgb, correction[..., None], out=rgb, where=correction[..., None] != 1.0)


def encode_within_ceiling(
    hdr_image: np.ndarray,
    reference_white_nits: float,
    encode: Callable[[np.ndarray], T],
    decode: Callable[[T], _DecodedCeiling | np.ndarray],
    ceiling_nits: float | None = None,
    notes: list[str] | None = None,
    *,
    encoding_allowance: float = 0.0,
    correct_in_place: bool = False,
) -> T:
    """Encode, check every decoded pixel, and correct only where it overshot.

    ``encode`` turns a finished HDR image into a delivery; ``decode`` returns
    the brightest decoded channel in nits at the same size, either a per-pixel
    plane or a validated peak and correction grid.
    Without ``ceiling_nits`` the delivery is encoded once and not checked.
    Initial encodes within ``encoding_allowance`` are unchanged. Corrections
    aim at the target itself; only the final round may use the allowance.
    An over-allowance or invalid delivery is never returned as successful.
    Only a caller that owns a private writable render may opt into correction
    in place, and its encoder must return a separate delivery.
    """
    current = hdr_image
    delivery = encode(current)
    if ceiling_nits is None:
        return delivery
    ceiling = min(float(ceiling_nits), CODEC_LIMIT_NITS)
    if ceiling <= 0.0:
        return delivery
    for attempt in range(len(MARGINS) + 1):
        decoded = decode(delivery)
        if decoded.shape != current.shape[:2]:
            raise CeilingError("The decoded HDR file does not match the exported size.")
        if isinstance(decoded, _DecodedCeiling):
            peak = decoded.peak
        else:
            if not decoded.size or not np.all(np.isfinite(decoded)):
                raise CeilingError("The HDR file decoded to empty or non-finite pixels.")
            peak = float(np.max(decoded))
        allowed = ceiling * (1.0 + encoding_allowance)
        if peak <= ceiling or (attempt in (0, len(MARGINS)) and peak <= allowed):
            return delivery
        if attempt == len(MARGINS):
            raise CeilingError(
                f"HDR peak remains {peak:.3f} nits, above the {ceiling:g}-nit target after local correction; "
                "no file was delivered."
            )
        if not correct_in_place:
            current = current.copy()
        _correct_bands(current, decoded, ceiling, MARGINS[attempt])
        del decoded
        delivery = encode(current)
