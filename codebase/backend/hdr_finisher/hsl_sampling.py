"""Request-scoped taps of the real grade pipeline for HSL picking.

The CPU picker uses a bounded proxy. Capturing stops the render at the exact
stage input, before downstream curves, film, output mapping or encoding.
"""
from contextvars import ContextVar
import math
from time import perf_counter
from pydantic import BaseModel, ConfigDict, Field

from .models import AdjustmentState, LocalAdjustment, MaskPoint, PreviewKind
from .hsl import HSLRecipe, sample_neighborhood, selection

_target = ContextVar("hsl_sample_target", default=None)


class HSLSelectionRect(BaseModel):
    model_config = ConfigDict(extra="forbid")
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)


class HSLSampleRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lane: PreviewKind
    local_id: str | None = Field(default=None, max_length=128)
    points: list[MaskPoint] = Field(min_length=1, max_length=512)
    adjustments: AdjustmentState
    local_adjustments: list[LocalAdjustment] = Field(default_factory=list, max_length=256)
    edit_revision: int = Field(ge=0)
    long_edge: int = Field(default=1000, ge=256, le=1600)
    selection_recipe: HSLRecipe | None = None
    selection_rect: HSLSelectionRect | None = None


def selection_crop(shape, rect, recipe, scale):
    from .hsl_selection import MIN_SCALE, geometry
    height, width = shape[:2]
    if rect is None:
        return (0, 0, width, height), (0, 0, width, height)
    left = max(0, min(width - 1, math.floor(rect.x * width) - 1))
    top = max(0, min(height - 1, math.floor(rect.y * height) - 1))
    right = min(width, max(left + 1, math.ceil((rect.x + rect.width) * width) + 1))
    bottom = min(height, max(top + 1, math.ceil((rect.y + rect.height) * height) + 1))
    geo = geometry(scale)
    processing_scale = min(1, max(MIN_SCALE, scale))
    halo = geo.reach + math.ceil(abs(recipe.edge) * processing_scale) + math.ceil(2 * recipe.edge_feather * processing_scale)
    start_x = max(0, ((left - halo) // geo.cell) * geo.cell)
    start_y = max(0, ((top - halo) // geo.cell) * geo.cell)
    end_x = min(width, math.ceil((right + halo) / geo.cell) * geo.cell)
    end_y = min(height, math.ceil((bottom + halo) / geo.cell) * geo.cell)
    return (left, top, right, bottom), (start_x, start_y, end_x, end_y)


class _Captured(Exception):
    def __init__(self, pixels, kind):
        self.pixels = pixels
        self.kind = kind


def capturing(local_id=None):
    return _target.get() == ("stage", local_id)


def tap(pixels, kind, local_id=None):
    if capturing(local_id):
        raise _Captured(pixels, kind)


def capture_stage_input(source, adjustments, kind, *, reference=None, color_context=None, source_pixel_scale=1.0):
    """The Global HSL stage input of ``source`` (geometry applied), in the lane's space."""
    from .adjustments import apply_adjustments
    token = _target.set(("stage", None))
    try:
        apply_adjustments(source, adjustments, kind, sdr_reference_image=reference,
                          color_context=color_context, source_pixel_scale=source_pixel_scale)
    except _Captured as captured:
        return captured.pixels
    finally:
        _target.reset(token)
    raise ValueError("The HSL stage could not be captured")


def stage_input_signature(adjustments, lane):
    branch = getattr(adjustments, lane.value).model_dump(mode="json")
    downstream = {"hsl", "hsl_section_enabled", "curves_section_enabled", "luma_curve", "red_curve",
                  "green_curve", "blue_curve", "detail", "detail_section_enabled", "film_look",
                  "film_look_section_enabled", "vignette", "vignette_section_enabled",
                  "color_grading", "color_grading_section_enabled"}
    if lane == PreviewKind.HDR:
        downstream.add("highlight_section_enabled")
        downstream.update(key for key in branch if key.startswith("highlight_compression_"))
    return {key: value for key, value in branch.items() if key not in downstream}


def sample_stage(cache, request):
    started = perf_counter()
    timings = {}
    from .adjustments import apply_adjustments
    from .color import acescg_to_linear_srgb
    locals_ = [local.model_copy(deep=True) for local in request.local_adjustments]
    if request.local_id is not None:
        target = next((item for item in locals_ if item.id == request.local_id), None)
        if target is None:
            raise ValueError("The selected local grade no longer exists")
        # A disabled/masked-out selection still has an editable stage input.
        target.enabled = True
        target.opacity = 1
        getattr(target, f"{request.lane.value}_grade").enabled = True
    scale = min(1, request.long_edge / max(cache.image.shape[:2]))
    token = _target.set(("stage", request.local_id))
    try:
        try:
            if request.local_id is None:
                raise _Captured(cache.hsl_stage_input(request.adjustments, request.long_edge, request.lane), request.lane)
            source, reference = cache._proxies(request.long_edge)
            apply_adjustments(source, request.adjustments, request.lane,
                              sdr_reference_image=reference, local_adjustments=locals_,
                              color_context=cache.color_context,
                              source_pixel_scale=scale)
        except _Captured as captured:
            pixels = captured.pixels
            height, width = pixels.shape[:2]
            region = None
            origin = (0, 0)
            if request.selection_recipe is not None and request.local_id is None and request.selection_rect is not None:
                output_rect, work_rect = selection_crop(pixels.shape, request.selection_rect, request.selection_recipe, scale)
                left, top, right, bottom = output_rect
                start_x, start_y, end_x, end_y = work_rect
                pixels = pixels[start_y:end_y, start_x:end_x]
                origin = (start_x, start_y)
                region = {"x": left / width, "y": top / height,
                          "width": (right-left) / width, "height": (bottom-top) / height}
            if captured.kind == PreviewKind.HDR:
                pixels = acescg_to_linear_srgb(pixels)
            timings['stage'] = (perf_counter() - started) * 1000
            if request.selection_recipe is not None:
                import base64
                from io import BytesIO
                import numpy as np
                from PIL import Image
                if request.local_id is None:
                    # Global HSL: the same shared selection the render applies.
                    from .hsl_selection import prepare, select
                    selection_started = perf_counter()
                    prepared = prepare(pixels, scale, origin)
                    timings['prepare'] = (perf_counter() - selection_started) * 1000
                    selection_started = perf_counter()
                    weight = select(prepared, request.selection_recipe.ranges,
                                    edge=request.selection_recipe.edge, edge_feather=request.selection_recipe.edge_feather,
                                    edge_detail=request.selection_recipe.edge_detail)
                    timings['select'] = (perf_counter() - selection_started) * 1000
                    if region is not None:
                        weight = weight[top-start_y:bottom-start_y, left-start_x:right-start_x]
                else:
                    weight = selection(pixels, request.selection_recipe.ranges)[0]
                if request.local_id is not None:
                    mask = cache.compiled_local_mask(request.adjustments, target, request.long_edge,
                                                     lane=request.lane)
                    if mask.shape != weight.shape:
                        mask = np.asarray(Image.fromarray(mask).resize(weight.shape[::-1], Image.Resampling.BILINEAR))
                    weight *= mask.astype(float) / 255
                overlay = np.zeros((*weight.shape, 4), dtype=np.uint8)
                overlay[..., :3] = [31, 184, 219]
                overlay[..., 3] = np.rint(weight * 115).astype(np.uint8)
                encoded = BytesIO()
                encoding_started = perf_counter()
                Image.fromarray(overlay).save(encoded, format="PNG", compress_level=1)
                timings['encode'] = (perf_counter() - encoding_started) * 1000
                timings['total'] = (perf_counter() - started) * 1000
                return {"selection_overlay": "data:image/png;base64," + base64.b64encode(encoded.getvalue()).decode(),
                        "selection_region": region, "timings_ms": timings}
            samples = [sample_neighborhood(pixels, min(width - 1, int(p.x * width)),
                                          min(height - 1, int(p.y * height))).tolist()
                       for p in request.points]
            return {"samples": samples, "width": width, "height": height,
                    "working_space": "linear-srgb", "edit_revision": request.edit_revision,
                    "timings_ms": {"total": (perf_counter() - started) * 1000}}
        raise ValueError("The requested HSL stage could not be sampled")
    finally:
        _target.reset(token)
