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
                      InpaintSettings, RepairInput, NativeRepairInput, _box_sum)


class RepairPoint(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    x: float = Field(ge=0, le=1, allow_inf_nan=False)
    y: float = Field(ge=0, le=1, allow_inf_nan=False)
    pressure: float = Field(default=1, ge=0, le=1, allow_inf_nan=False)


class DonorExclusion(BaseModel):
    """Frozen prior defect footprint; later gestures cannot alter this input."""
    model_config = ConfigDict(extra="forbid", frozen=True)
    points: tuple[RepairPoint, ...] = Field(min_length=1, max_length=512)
    radius_px: float = Field(ge=0.5, le=512, allow_inf_nan=False)
    hardness: float = Field(ge=0, le=1, allow_inf_nan=False)


class InpaintRecipe(BaseModel):
    """Serializable input for one gesture, independent of the project schema.

    Points use the existing normalized uncropped-source convention. Radius is
    in native square pixels; pressure follows the existing brush's disc and
    average-pressure capsule rules. No flow accumulation or erasing is used.
    search_rect is half-open (left, top, right, bottom), in native pixels.
    """
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal[1] = 1
    mode: Literal["inpaint", "heal", "clone"] = "inpaint"
    source_point: RepairPoint | None = None
    strength: float = Field(default=1, ge=0, le=1, allow_inf_nan=False)
    raster_version: Literal["native-capsules-v1"] = "native-capsules-v1"
    source_size: tuple[StrictInt, StrictInt]
    search_rect: tuple[StrictInt, StrictInt, StrictInt, StrictInt]
    points: tuple[RepairPoint, ...] = Field(min_length=1, max_length=512)
    radius_px: float = Field(default=8, ge=0.5, le=512, allow_inf_nan=False)
    hardness: float = Field(default=0.1, ge=0, le=1, allow_inf_nan=False)
    method: Literal["standard", "edge-feather", "original-detail", "donor-detail"] = "standard"
    edge_feather: float = Field(default=.25, ge=0, le=1, allow_inf_nan=False)
    texture_amount: float = Field(default=1, ge=0, le=1, allow_inf_nan=False)
    donor_exclusions: tuple[DonorExclusion, ...] = Field(default=(), max_length=256)
    settings: InpaintSettings = Field(default_factory=InpaintSettings)

    @model_validator(mode="after")
    def validate_region(self):
        if self.mode != "inpaint" and self.source_point is None:
            raise ValueError("Choose a source point for Heal or Clone")
        width, height = self.source_size
        left, top, right, bottom = self.search_rect
        if not (3 <= width and 3 <= height and 0 <= left < right <= width
                and 0 <= top < bottom <= height):
            raise ValueError("Search rectangle must be inside the native source")
        if not (3 <= min(right - left, bottom - top)
                and max(right - left, bottom - top) <= NativeRepairInput.region_edge):
            raise ValueError("Search rectangle must be 3..2048 pixels per axis")
        # Require the full footprint, not merely its intersection with the
        # search area. Clipping is permitted only at an actual image edge.
        for point in self.points:
            x, y = point.x * width, point.y * height
            r = self.radius_px
            if (max(0, x - r) < left or min(width, x + r) > right
                    or max(0, y - r) < top or min(height, y + r) > bottom):
                raise ValueError("Search rectangle would cut off the brush stroke")
        return self


def stroke_mask(recipe: InpaintRecipe, checkpoint=lambda: None, *, footprint=None) -> np.ndarray:
    """Rasterize only the fixed native ROI, checking between capsules."""
    from .local_adjustments import _soft_disc, _soft_segment
    left, top, right, bottom = recipe.search_rect
    width, height = recipe.source_size
    yy, xx = np.mgrid[:bottom - top, :right - left].astype(np.float64)
    xx += 0.5
    yy += 0.5
    brush = footprint or recipe
    points = [(p.x * width - left, p.y * height - top, p.pressure) for p in brush.points]
    hardness = (1 - recipe.edge_feather if footprint is None and (recipe.mode != "inpaint" or recipe.method != "standard")
                else brush.hardness)
    result = np.zeros(xx.shape, dtype=np.float32)
    if len(points) == 1:
        checkpoint()
        x, y, pressure = points[0]
        if pressure > 0:
            result[:] = _soft_disc(xx, yy, x, y, brush.radius_px * pressure, hardness)
    else:
        for first, second in zip(points, points[1:]):
            checkpoint()
            radius = brush.radius_px * max(0.05, (first[2] + second[2]) * 0.5)
            # Only rasterize the capsule's bounds, especially for large brushes.
            x0 = max(0, int(np.floor(min(first[0], second[0]) - radius)))
            x1 = min(result.shape[1], int(np.ceil(max(first[0], second[0]) + radius)))
            y0 = max(0, int(np.floor(min(first[1], second[1]) - radius)))
            y1 = min(result.shape[0], int(np.ceil(max(first[1], second[1]) + radius)))
            if x0 >= x1 or y0 >= y1:
                continue
            region = np.s_[y0:y1, x0:x1]
            segment = _soft_segment(xx[region], yy[region], *first[:2], *second[:2], radius, hardness)
            np.maximum(result[region], segment, out=result[region])
    checkpoint()
    if footprint is None and not 1 <= np.count_nonzero(result) <= NativeRepairInput.defect_pixels:
        raise ValueError("Stroke must cover at least one native pixel")
    return result


def prepare_repair(recipe: InpaintRecipe, read_region, *, read_excluded=None,
                   checkpoint=lambda: None) -> RepairInput:
    """Fetch exactly one bounded native window, never a resized preview.

    Readers take (top, left, bottom, right). read_region supplies interpreted
    float32 working RGB from the immutable interpreted original source.
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
    if recipe.donor_exclusions:
        excluded = np.zeros(mask.shape, dtype=bool) if excluded is None else excluded.copy()
        for footprint in recipe.donor_exclusions:
            excluded |= stroke_mask(recipe, checkpoint, footprint=footprint) > 0
    checkpoint()
    large = (max(mask.shape) > MAX_REGION_EDGE or np.count_nonzero(mask) > MAX_DEFECT_PIXELS
             or np.count_nonzero(_box_sum(mask > 0, recipe.settings.patch_radius)) > MAX_TARGET_PATCHES)
    kind = NativeRepairInput if large else RepairInput
    # Prototypes reconstruct the whole interior first. Edge blending and
    # texture finishing are separate, allowing a fair same-seed comparison.
    solve_mask = mask if recipe.method == "standard" else (mask > 0).astype(np.float32)
    return kind(pixels, solve_mask, (left, top), excluded).owned()


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
