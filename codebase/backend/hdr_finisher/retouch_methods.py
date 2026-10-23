"""Bounded native finishing for the explicitly experimental repair methods.

No display-tier processing or clean-reference pixels enter a repair. Original
texture is appropriate for broad tone changes; donor texture replaces fine
structure using the same clean PatchMatch correspondences as the tone solve.
"""
from dataclasses import replace
import numpy as np


def _detail_at(image, yy, xx):
    """Five-pixel high-pass residual at requested coordinates; bounded gathers."""
    height, width = image.shape[:2]
    mean = np.zeros(np.broadcast_shapes(yy.shape, xx.shape) + (3,), dtype=np.float64)
    for dy in range(-2, 3):
        for dx in range(-2, 3):
            mean += image[np.clip(yy+dy, 0, height-1), np.clip(xx+dx, 0, width-1)]
    return image[yy, xx].astype(np.float64) - mean / 25


def _donor_field(request, patch):
    sources, targets = patch.source_centres, patch.target_centres
    if len(targets) == 0 or sources.shape != targets.shape:
        raise ValueError("No clean texture correspondences for this repair")
    # Native solves report the coarse field in native coordinates. Recover
    # its grid spacing, preserving the within-cell pixel phase when sampling.
    steps = [np.diff(np.unique(targets[:, axis])) for axis in (0, 1)]
    steps = [v[v > 0] for v in steps if len(v)]
    scale = int(min(v.min() for v in steps)) if steps else 1
    height, width = request.mask.shape
    field = np.full(((height+scale-1)//scale, (width+scale-1)//scale, 2), -1, dtype=np.int32)
    field[targets[:, 0]//scale, targets[:, 1]//scale] = sources
    return field, scale


def finish_repair(recipe, request, patch, alpha, checkpoint=lambda: None):
    """Return a finished immutable patch without mutating the worker's cache."""
    if recipe.method == "standard":
        return patch
    x = patch.origin[0] - request.origin[0]
    y = patch.origin[1] - request.origin[1]
    height, width = patch.pixels.shape[:2]
    a = alpha[y:y+height, x:x+width]
    original = request.pixels[y:y+height, x:x+width]
    result = np.empty_like(patch.pixels)
    amount = recipe.texture_amount if recipe.method in ("original-detail", "donor-detail") else 0
    field, scale = _donor_field(request, patch) if amount and recipe.method == "donor-detail" else (None, None)
    xx = np.arange(width)[None, :]
    for top in range(0, height, 64):
        checkpoint()
        bottom = min(height, top+64)
        yy = np.arange(top, bottom)[:, None]
        filled = patch.pixels[top:bottom].astype(np.float64)
        if amount:
            filled_detail = _detail_at(patch.pixels, yy, xx)
            if recipe.method == "original-detail":
                detail = _detail_at(request.pixels, yy+y, xx+x)
            else:
                ry, rx = yy+y, xx+x
                donors = field[ry//scale, rx//scale]
                sy = donors[..., 0] + ry % scale
                sx = donors[..., 1] + rx % scale
                active = a[top:bottom] > 0
                valid = ((donors[..., 0] >= 0) & (donors[..., 1] >= 0) &
                         (sy < request.mask.shape[0]) & (sx < request.mask.shape[1]))
                if not valid[active].all():
                    raise ValueError("Incomplete clean texture correspondences")
                # Only inactive corners may lack a correspondence.
                sy, sx = np.where(valid, sy, 0), np.where(valid, sx, 0)
                detail = _detail_at(request.pixels, sy, sx)
            filled += amount * (detail - filled_detail)
        blend = a[top:bottom, :, None]
        result[top:bottom] = original[top:bottom] * (1-blend) + filled * blend
    checkpoint()
    if not np.isfinite(result).all():
        raise ValueError("Repair texture finishing produced non-finite pixels")
    result.setflags(write=False)
    return replace(patch, pixels=result)
