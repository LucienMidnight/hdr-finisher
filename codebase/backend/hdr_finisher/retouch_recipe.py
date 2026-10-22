"""Source-space authoring adapter shared by session repairs and prototype fixtures.

The recipe stores native dimensions and a fixed search rectangle, never a
viewport or proxy size. A caller must run preparation on a backend worker and
check the source/edit revision while publishing the resulting repair.
"""
from __future__ import annotations

from typing import Literal

import numpy as np
from pydantic import BaseModel, ConfigDict, Field, StrictInt, model_validator

from .retouch import (MAX_DEFECT_PIXELS, MAX_REGION_EDGE, MAX_TARGET_PATCHES,
                      InpaintSettings, RepairInput, _box_sum)


class RepairPoint(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    x: float = Field(ge=0, le=1, allow_inf_nan=False)
    y: float = Field(ge=0, le=1, allow_inf_nan=False)
    pressure: float = Field(default=1, ge=0, le=1, allow_inf_nan=False)


class InpaintRecipe(BaseModel):
    """Serializable input for one gesture, independent of the project schema.

    Points use the existing normalized uncropped-source convention. Radius is
    in native square pixels; pressure follows the existing brush's disc and
    average-pressure capsule rules. No flow accumulation or erasing is used.
    search_rect is half-open (left, top, right, bottom), in native pixels.
    """
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal[1] = 1
    mode: Literal["inpaint"] = "inpaint"
    raster_version: Literal["native-capsules-v1"] = "native-capsules-v1"
    source_size: tuple[StrictInt, StrictInt]
    search_rect: tuple[StrictInt, StrictInt, StrictInt, StrictInt]
    points: tuple[RepairPoint, ...] = Field(min_length=1, max_length=512)
    radius_px: float = Field(default=8, ge=0.5, le=32, allow_inf_nan=False)
    hardness: float = Field(default=0.75, ge=0, le=1, allow_inf_nan=False)
    settings: InpaintSettings = Field(default_factory=InpaintSettings)

    @model_validator(mode="after")
    def validate_region(self):
        width, height = self.source_size
        left, top, right, bottom = self.search_rect
        if not (3 <= width and 3 <= height and 0 <= left < right <= width
                and 0 <= top < bottom <= height):
            raise ValueError("Search rectangle must be inside the native source")
        if not (3 <= min(right - left, bottom - top)
                and max(right - left, bottom - top) <= MAX_REGION_EDGE):
            raise ValueError("Search rectangle must be 3..256 pixels per axis")
        # Require the full footprint, not merely its intersection with the
        # search area. Clipping is permitted only at an actual image edge.
        for point in self.points:
            x, y = point.x * width, point.y * height
            r = self.radius_px
            if (max(0, x - r) < left or min(width, x + r) > right
                    or max(0, y - r) < top or min(height, y + r) > bottom):
                raise ValueError("Search rectangle would cut off the brush stroke")
        return self


def stroke_mask(recipe: InpaintRecipe, checkpoint=lambda: None) -> np.ndarray:
    """Rasterize only the fixed native ROI, checking between capsules."""
    from .local_adjustments import _soft_disc, _soft_segment
    left, top, right, bottom = recipe.search_rect
    width, height = recipe.source_size
    yy, xx = np.mgrid[:bottom - top, :right - left].astype(np.float64)
    xx += 0.5
    yy += 0.5
    points = [(p.x * width - left, p.y * height - top, p.pressure) for p in recipe.points]
    result = np.zeros(xx.shape, dtype=np.float32)
    if len(points) == 1:
        checkpoint()
        x, y, pressure = points[0]
        if pressure > 0:
            result[:] = _soft_disc(xx, yy, x, y, recipe.radius_px * pressure, recipe.hardness)
    else:
        for first, second in zip(points, points[1:]):
            checkpoint()
            radius = recipe.radius_px * max(0.05, (first[2] + second[2]) * 0.5)
            segment = _soft_segment(xx, yy, *first[:2], *second[:2], radius, recipe.hardness)
            np.maximum(result, segment, out=result)
    checkpoint()
    if not 1 <= np.count_nonzero(result) <= MAX_DEFECT_PIXELS:
        raise ValueError("Stroke must cover 1..4096 native pixels; use a smaller stroke")
    if np.count_nonzero(_box_sum(result > 0, recipe.settings.patch_radius)) > MAX_TARGET_PATCHES:
        raise ValueError("Stroke affects too many patches; use a smaller stroke")
    return result


def prepare_repair(recipe: InpaintRecipe, read_region, *, read_excluded=None,
                   checkpoint=lambda: None) -> RepairInput:
    """Fetch exactly one bounded native window, never a resized preview.

    Readers take (top, left, bottom, right). read_region supplies interpreted
    float32 working RGB, with preceding completed repairs already composed.
    Optional read_excluded supplies other known defects as a boolean window.
    The caller owns the source epoch check; this adapter owns its snapshots.
    """
    # Revalidate nested points, including recipes made with copy/
    # construct APIs, before any source read or allocation based on the record.
    recipe = InpaintRecipe.model_validate_json(recipe.model_dump_json())
    checkpoint()
    mask = stroke_mask(recipe, checkpoint)
    left, top, right, bottom = recipe.search_rect
    pixels = read_region(top, left, bottom, right)
    checkpoint()
    if pixels.shape != (*mask.shape, 3):
        raise ValueError("Source reader returned the wrong native window shape")
    excluded = read_excluded(top, left, bottom, right) if read_excluded else None
    checkpoint()
    return RepairInput(pixels, mask, (left, top), excluded).owned()


def compose_repairs(pixels: np.ndarray, origin: tuple[int, int], patches) -> np.ndarray:
    """Copy intersections of completed native patches, without another solve.

    Patches are already feathered. They must come from the same source and
    dependency revision, in document order, each solved over preceding repairs.
    This function cannot establish that identity; the session must check it.
    Only the caller's requested window is copied; source and cache stay intact.
    """
    x, y = origin
    height, width = pixels.shape[:2]
    result = pixels.copy()
    for patch in patches:
        px, py = patch.origin
        ph, pw = patch.pixels.shape[:2]
        left, top = max(x, px), max(y, py)
        right, bottom = min(x + width, px + pw), min(y + height, py + ph)
        if left < right and top < bottom:
            result[top - y:bottom - y, left - x:right - x] = patch.pixels[
                top - py:bottom - py, left - px:right - px]
    return result
