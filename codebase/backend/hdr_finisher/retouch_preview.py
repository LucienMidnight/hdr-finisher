"""Exact reuse of a warm reduced source after a bounded native repair."""
from math import ceil, floor
import numpy as np

from .preview import _block_reduce, _neighbour_reduce
from .retouch_source import REPAIR_PUBLICATION_SCRATCH_BYTES


def refresh_repair_level(
    image: np.ndarray,
    previous: np.ndarray,
    dirty_rects: tuple[tuple[int, int, int, int], ...],
) -> np.ndarray | None:
    """Return a new immutable mip, or None to leave a usual cold-cache miss."""
    from PIL import Image

    if not dirty_rects:
        return previous

    height, width = image.shape[:2]
    target_h, target_w = previous.shape[:2]
    sx, sy = width / target_w, height / target_h
    block = max(1, ceil(max(sx, sy)))
    # Both Lanczos taps and the local min/max clamp can see beyond the edit.
    # A conservative margin includes the complete three-lobe support and the
    # edited block plus both neighbouring blocks, even at a partial edge.
    rectangles = {
        (max(0, floor((l - max(3 * sx, 2 * block)) / sx)),
         max(0, floor((t - max(3 * sy, 2 * block)) / sy)),
         min(target_w, ceil((r + max(3 * sx, 2 * block)) / sx)),
         min(target_h, ceil((b + max(3 * sy, 2 * block)) / sy)))
        for l, t, r, b in dirty_rects if r > l and b > t
    }
    if not rectangles:
        return previous
    # Fall back to one cold resize when edits touch too much of the photo.
    if sum((r - l) / target_w + (b - t) / target_h for l, t, r, b in rectangles) >= 0.5:
        return None
    def band(t, b):
        return (max(0, floor((t + .5) * sy - 3 * sy)),
                min(height, ceil((b - .5) * sy + 3 * sy) + 1))

    # Reuse the 64 MiB publication scratch allowance, after native compositing
    # is done. Account conservatively for a new level, both Pillow passes
    # with their conversion copies, and the range work for one rectangle.
    for l, t, r, b in rectangles:
        y0, y1 = band(t, b)
        span, rows = r - l, y1 - y0
        scratch = 8 * (rows * (width + target_w) + span * (height + target_h))
        scratch += 32 * (b - t + 3) * (span + 3)
        if previous.nbytes + scratch > REPAIR_PUBLICATION_SCRATCH_BYTES:
            return None

    updated = previous.copy()
    for l, t, r, b in rectangles:
        rows = np.minimum(((np.arange(t, b) + .5) * height / target_h).astype(np.intp) // block,
                          -(-height // block) - 1)
        cols = np.minimum(((np.arange(l, r) + .5) * width / target_w).astype(np.intp) // block,
                          -(-width // block) - 1)
        ry, rx = max(0, rows[0] - 1), max(0, cols[0] - 1)
        clamp_y = slice(ry * block, (rows[-1] + 2) * block)
        clamp_x = slice(rx * block, (cols[-1] + 2) * block)
        y0, y1 = band(t, b)
        for c in range(image.shape[2]):
            channel = image[..., c]
            # Keep the full axis lengths for both Pillow passes; rounding and
            # filter normalization are then identical to the ordinary resize.
            horizontal = np.asarray(Image.fromarray(channel[y0:y1]).resize(
                (target_w, y1 - y0), Image.Resampling.LANCZOS))
            strip = np.zeros((height, r - l), dtype=np.float32)
            strip[y0:y1] = horizontal[:, l:r]
            resized = np.asarray(Image.fromarray(strip).resize(
                (r - l, target_h), Image.Resampling.LANCZOS))[t:b]
            crop = channel[clamp_y, clamp_x]
            bounds = []
            for reduce in (np.minimum, np.maximum):
                coarse = _block_reduce(reduce, _block_reduce(reduce, crop, block, 0), block, 1)
                coarse = _neighbour_reduce(reduce, _neighbour_reduce(reduce, coarse, 0), 1)
                bounds.append(coarse[np.ix_(rows - ry, cols - rx)])
            updated[t:b, l:r, c] = np.clip(resized, *bounds)
    updated.setflags(write=False)
    return updated
