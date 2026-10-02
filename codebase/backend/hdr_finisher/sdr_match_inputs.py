"""Inputs that stay fixed while one SDR Match explores editable candidates."""
from __future__ import annotations

from contextvars import ContextVar
from functools import wraps

import numpy as np

from .adjustments import apply_adjustments, apply_fixed_source_adjustments
from .finishing import apply_geometry
from .local_adjustments import compile_geometry_fixed_mask, spatial_mask_signature
from .models import PreviewKind


class _MatchInputs:
    def __init__(self, source):
        self.source = source
        self.fixed_sources = {}
        self.masks = {}

    def mask(self, expression, geometry):
        key = (geometry.model_dump_json(), spatial_mask_signature(expression))
        if key not in self.masks:
            value = compile_geometry_fixed_mask(self.source, expression, geometry, spatial_only=True)
            value.setflags(write=False)
            self.masks[key] = value
        return self.masks[key]

    def render(self, adjustments, locals, source_pixel_scale, *, kind=PreviewKind.SDR, color_context=None):
        geometry = adjustments.shared.geometry
        key = geometry.model_dump_json()
        if key not in self.fixed_sources:
            self.fixed_sources[key] = apply_geometry(self.source, geometry)
        masks = {local.id: self.mask(local.mask, geometry)
                 for local in locals if local.enabled and local.opacity > 0.0}
        return apply_fixed_source_adjustments(
            self.fixed_sources[key], adjustments, kind,
            include_grain=False, local_adjustments=locals,
            compiled_local_masks=masks, source_pixel_scale=source_pixel_scale,
            color_context=color_context,
        )


_INPUTS = ContextVar("sdr_match_inputs", default=None)


def reuse_match_render_inputs(function):
    @wraps(function)
    def scoped(source, *args, **kwargs):
        source = np.asarray(source, dtype=np.float32)
        token = _INPUTS.set(_MatchInputs(source))
        try:
            return function(source, *args, **kwargs)
        finally:
            _INPUTS.reset(token)
    return scoped


def render_match_candidate(source, adjustments, locals, source_pixel_scale):
    inputs = _INPUTS.get()
    if inputs is not None and inputs.source is source:
        return inputs.render(adjustments, locals, source_pixel_scale)
    return apply_adjustments(source, adjustments, PreviewKind.SDR, include_grain=False,
                             local_adjustments=locals, source_pixel_scale=source_pixel_scale)


def render_match_target(source, adjustments, locals, source_pixel_scale, color_context):
    """Render the exact CPU HDR target using this fit's fixed inputs."""
    inputs = _INPUTS.get()
    if inputs is not None and inputs.source is source:
        return inputs.render(adjustments, locals, source_pixel_scale,
                             kind=PreviewKind.HDR, color_context=color_context)
    return apply_adjustments(source, adjustments, PreviewKind.HDR, include_grain=False,
                             local_adjustments=locals, source_pixel_scale=source_pixel_scale,
                             color_context=color_context)


def match_spatial_mask(source, expression, geometry):
    inputs = _INPUTS.get()
    if inputs is not None and inputs.source is source:
        return inputs.mask(expression, geometry)
    return compile_geometry_fixed_mask(source, expression, geometry, spatial_only=True)
