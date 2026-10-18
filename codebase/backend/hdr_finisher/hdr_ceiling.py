"""Keep decoded HDR deliveries at or below the brightest finished pixel.

Lossy codecs and gain-map reconstruction can overshoot at bright edges and
in saturated highlights. Steve's rule (October 18, 2026) is that a delivered
HDR file never exceeds the highlight compression target, with no upward
allowance. The renderer caps the finished picture at that target when
highlight compression is on; otherwise only the codec limit applies.
Pictures well under their ceiling are only checked, never changed.

Only the neighbourhood of an overshoot is lowered, by the amount it
overshot plus a small margin, and the change fades out smoothly. The rest
of the picture and the SDR rendition are never touched. Dimming the whole
image to pass would visibly change the grade.
"""
from __future__ import annotations

from pathlib import Path
from typing import Callable, TypeVar

import numpy as np

from .color import acescg_to_linear_bt2020
from .color_context import scene_linear_to_nits

T = TypeVar("T")

BLOCK = 16
# Codecs only partly follow a lowered input, so each round undershoots its aim.
# Squaring the overshoot ratio and small growing margins usually finish in
# one correction while landing close under the ceiling.
STRENGTH = 2.0
MARGINS = (0.003, 0.006, 0.012, 0.025, 0.05, 0.1)
CODEC_LIMIT_NITS = 10000.0
CHECK_HEADROOM = 1.25


class CeilingError(RuntimeError):
    pass


def ceiling_note(peak: float, ceiling: float) -> str:
    return (f"HDR peak is {peak:.0f} nits, {peak - ceiling:.0f} above the {ceiling:.0f}-nit target "
            "after correction; the file was exported anyway.")


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
        from .gainmap_decoders import decode_ultrahdr_jpeg
        image, _, _ = decode_ultrahdr_jpeg(path)
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


def _correction(ratio: np.ndarray, margin: float) -> np.ndarray:
    """A smooth multiplier that brings every over-ceiling pixel under it.

    Block maxima are widened by one block, so bilinear upsampling at any
    overshooting pixel interpolates only values at least as large as its own
    ratio. That guarantees coverage while fading gently to 1 elsewhere.
    """
    height, width = ratio.shape
    blocks_y, blocks_x = -(-height // BLOCK), -(-width // BLOCK)
    padded = np.ones((blocks_y * BLOCK, blocks_x * BLOCK), dtype=np.float32)
    padded[:height, :width] = np.maximum(ratio, 1.0)
    grid = padded.reshape(blocks_y, BLOCK, blocks_x, BLOCK).max(axis=(1, 3))
    widened = np.pad(grid, 1, constant_values=1.0)
    grid = np.max([widened[dy:dy + blocks_y, dx:dx + blocks_x] for dy in range(3) for dx in range(3)], axis=0)

    def axis_weights(size: int, blocks: int):
        position = np.clip((np.arange(size, dtype=np.float32) + 0.5) / BLOCK - 0.5, 0, blocks - 1)
        low = np.floor(position).astype(np.int64)
        return low, np.minimum(low + 1, blocks - 1), (position - low).astype(np.float32)

    y0, y1, wy = axis_weights(height, blocks_y)
    x0, x1, wx = axis_weights(width, blocks_x)
    rows = grid[y0] * (1 - wy)[:, None] + grid[y1] * wy[:, None]
    spread = rows[:, x0] * (1 - wx)[None, :] + rows[:, x1] * wx[None, :]
    return np.where(spread > 1.0, 1.0 / (spread ** STRENGTH * (1.0 + margin)), 1.0).astype(np.float32)


def encode_within_ceiling(
    hdr_image: np.ndarray,
    reference_white_nits: float,
    encode: Callable[[np.ndarray], T],
    decode: Callable[[T], np.ndarray],
    ceiling_nits: float | None = None,
    notes: list[str] | None = None,
) -> T:
    """Encode, check every decoded pixel, and correct only where it overshot.

    ``encode`` turns a finished HDR image into a delivery; ``decode`` returns
    that delivery's per-pixel brightest channel in nits at the same size.
    Without ``ceiling_nits`` only the codec limit is enforced. A delivery that
    still overshoots after every correction is returned anyway, with a note
    in ``notes`` saying how far over it is (Steve: export, then explain).
    """
    ceiling = min(float(ceiling_nits or CODEC_LIMIT_NITS), CODEC_LIMIT_NITS)
    current = hdr_image
    delivery = encode(current)
    if ceiling <= 0.0:
        return delivery
    # The largest codec overshoot measured (October 18, 2026) was 12%, on an
    # AVIF saturated highlight. Pictures this far below the ceiling cannot
    # reach it, so they skip the decode (about 1.5 s Ultra HDR, 5 s AVIF at
    # 2560 px).
    if float(np.max(channel_nits(hdr_image, reference_white_nits))) * CHECK_HEADROOM <= ceiling:
        return delivery
    for margin in MARGINS:
        decoded = decode(delivery)
        if decoded.shape != current.shape[:2]:
            raise CeilingError("The decoded HDR file does not match the exported size.")
        ratio = decoded / np.float32(ceiling)
        if float(np.max(ratio)) <= 1.0:
            return delivery
        current = current.copy()
        current[..., :3] *= _correction(ratio, margin)[..., None]
        delivery = encode(current)
    peak = float(np.max(decode(delivery)))
    if peak > ceiling and notes is not None:
        notes.append(ceiling_note(peak, ceiling))
    return delivery
