"""Request-scoped taps of the real grade pipeline for HSL picking.

The CPU picker uses a bounded proxy. Capturing stops the render at the exact
stage input, before downstream curves, film, output mapping or encoding.
"""
from contextvars import ContextVar
from pydantic import BaseModel, ConfigDict, Field

from .models import AdjustmentState, LocalAdjustment, MaskPoint, PreviewKind
from .hsl import HSLRecipe, sample_neighborhood, selection

_target = ContextVar("hsl_sample_target", default=None)


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


class _Captured(Exception):
    def __init__(self, pixels, kind):
        self.pixels = pixels
        self.kind = kind


def capturing(local_id=None):
    return _target.get() == ("stage", local_id)


def tap(pixels, kind, local_id=None):
    if capturing(local_id):
        raise _Captured(pixels, kind)


def sample_stage(cache, request):
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
    source, reference = cache._proxies(request.long_edge)
    token = _target.set(("stage", request.local_id))
    try:
        try:
            apply_adjustments(source, request.adjustments, request.lane,
                              sdr_reference_image=reference, local_adjustments=locals_,
                              color_context=cache.color_context,
                              source_pixel_scale=min(1, request.long_edge / max(cache.image.shape[:2])))
        except _Captured as captured:
            pixels = captured.pixels
            if captured.kind == PreviewKind.HDR:
                pixels = acescg_to_linear_srgb(pixels)
            height, width = pixels.shape[:2]
            samples = [sample_neighborhood(pixels, min(width - 1, int(p.x * width)),
                                          min(height - 1, int(p.y * height))).tolist()
                       for p in request.points]
            if request.selection_recipe is not None:
                import base64
                from io import BytesIO
                import numpy as np
                from PIL import Image
                weight = selection(pixels, request.selection_recipe.ranges)[0]
                if request.local_id is not None:
                    from .local_adjustments import compile_geometry_fixed_mask
                    mask = compile_geometry_fixed_mask(source, target.mask, request.adjustments.shared.geometry)
                    weight *= mask.astype(float) / 255
                overlay = np.zeros((*weight.shape, 4), dtype=np.uint8)
                overlay[..., 3] = np.rint((1 - weight) * 190).astype(np.uint8)
                encoded = BytesIO()
                Image.fromarray(overlay).save(encoded, format="PNG")
                return {"selection_overlay": "data:image/png;base64," + base64.b64encode(encoded.getvalue()).decode()}
            return {"samples": samples, "width": width, "height": height,
                    "working_space": "linear-srgb", "edit_revision": request.edit_revision}
        raise ValueError("The requested HSL stage could not be sampled")
    finally:
        _target.reset(token)
