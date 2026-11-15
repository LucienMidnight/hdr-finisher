from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass

import colour
import numpy as np

from .adjustments import _linear_luma, apply_adjustments
from .color_context import RenderColorContext
from .local_adjustments import mask_influence_opacity
from .models import LocalGrade, PreviewKind
from .sdr_gamut import compress_to_srgb_gamut, linear_srgb_to_oklab
from .sdr_match import SDRMatchMaterializationError, _quality_metrics, _translate_local_grade, build_sdr_match_target


LOCAL_MATCH_EDGE = 256


class LocalMatchRefused(SDRMatchMaterializationError):
    def __init__(self, metrics):
        super().__init__("This adjustment could not be matched closely enough in the current SDR picture. "
                         "The previous SDR settings are unchanged. Try a smaller HDR change or adjust SDR manually.")
        self.metrics = metrics


def local_match_signature(document) -> str:
    context = document.model_dump(mode="json")
    context.pop("sdr_match", None)
    context["global_adjustments"]["hdr"].pop("highlight_compression_source_peak_nits", None)
    context["global_adjustments"]["sdr"].pop("highlight_compression_source_peak_percent", None)
    for local in context["local_adjustments"]:
        local.pop("sdr_match", None)
        local.pop("name", None)
    return hashlib.sha256(json.dumps(context, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


@dataclass(frozen=True)
class LocalMatchResult:
    grade: LocalGrade | None
    message: str
    metrics: dict


def fit_local_sdr(source, adjustments, locals_, target_id, *, reference_white_nits=203,
                  source_pixel_scale=1., masks=None, sdr_source=None, sdr_reference=None) -> LocalMatchResult:
    index = next(index for index, local in enumerate(locals_) if local.id == target_id)
    parent = locals_[index]
    if (not parent.enabled or not parent.hdr_grade.enabled or parent.opacity <= 0
            or not adjustments.shared.local_adjustments_enabled):
        return LocalMatchResult(None, "No change: this adjustment's HDR contribution is disabled.", {})
    context = RenderColorContext(hdr_reference_white_nits=reference_white_nits)

    def render(lane, grade):
        stack = list(locals_)
        stack[index] = parent.model_copy(update={f"{lane.value}_grade": grade})
        return apply_adjustments(
            sdr_source if lane == PreviewKind.SDR and sdr_source is not None else source,
            adjustments, lane, local_adjustments=stack, include_grain=False,
            sdr_reference_image=sdr_reference,
            color_context=context, source_pixel_scale=source_pixel_scale,
            compiled_local_masks=masks.get(lane.value) if masks else None,
        )

    disabled = LocalGrade(enabled=False)
    hdr_off = render(PreviewKind.HDR, disabled)
    hdr_on = render(PreviewKind.HDR, parent.hdr_grade)
    change = build_sdr_match_target(hdr_on) - build_sdr_match_target(hdr_off)
    sdr_off = render(PreviewKind.SDR, disabled)
    target = compress_to_srgb_gamut(np.maximum(sdr_off + change, 0))
    if masks:
        coverage = np.maximum(masks["hdr"][parent.id], masks["sdr"][parent.id]) / 255.
        coverage *= parent.opacity * mask_influence_opacity(parent.mask)
        support = coverage >= .01
    else:
        support = np.max(np.abs(change), axis=-1) >= 1e-5
    if np.count_nonzero(support) < 16 or np.mean(support) < .0001:
        return LocalMatchResult(None, "No change: the mask is empty or has negligible coverage.", {})
    if float(np.max(np.abs(change[support]))) < 1e-5:
        return LocalMatchResult(None, "No change: this adjustment has no visible HDR contribution.", {})
    body = support & (_linear_luma(target) <= .9) & (_linear_luma(target) >= .0008)
    target_lab = linear_srgb_to_oklab(target)

    def loss(pixels):
        difference = linear_srgb_to_oklab(pixels) - target_lab
        distances = np.linalg.norm(difference, axis=-1)[support]
        return float(np.mean(distances ** 2) + .25 * np.percentile(distances, 95) ** 2)

    best_grade = _translate_local_grade(parent.hdr_grade, 1., reference_white_nits=reference_white_nits,
                                       target_peak_nits=adjustments.hdr.highlight_compression_target_nits)
    best_pixels = render(PreviewKind.SDR, best_grade)
    best = loss(best_pixels)
    neutral = LocalGrade(highlights_center=1.75, highlights_width=3.5,
                         detail=parent.hdr_grade.detail.model_copy(deep=True))
    pixels = render(PreviewKind.SDR, neutral)
    if loss(pixels) < best:
        best_grade, best_pixels, best = neutral, pixels, loss(pixels)
    controls = (("exposure", .5, -8, 8), ("contrast", .2, -2, 2),
                ("blacks", 25, -100, 100), ("shadows", 25, -100, 100),
                ("midtones", 25, -100, 100), ("highlights", 25, -100, 100),
                ("whites", 25, -100, 100), ("saturation", .15, -1, 3),
                ("white_balance_kelvin", 500, 1000, 25000), ("tint", .08, -2, 2))
    for scale in (1., .4, .15, .05):
        for name, step, lower, upper in controls:
            original = getattr(best_grade, name)
            for direction in (-1, 1):
                value = float(np.clip(original + direction * step * scale, lower, upper))
                if name == "white_balance_kelvin":
                    value = int(round(value))
                trial = best_grade.model_copy(update={name: value})
                pixels = render(PreviewKind.SDR, trial)
                score = loss(pixels)
                if score < best:
                    best_grade, best_pixels, best = trial, pixels, score
    metrics = _quality_metrics(target[support][None, ...], best_pixels[support][None, ...],
                               body[support][None, ...]).model_dump()
    converted = [colour.XYZ_to_Lab(colour.RGB_to_XYZ(pixels[support], colour.RGB_COLOURSPACES["sRGB"]))
                 for pixels in (target, best_pixels)]
    delta = colour.difference.delta_E_CIE2000(*converted)
    regions = [region[support] for region in (body, support & ~body)]
    errors = [delta[region] for region in regions if np.any(region)]
    metrics.update(mean_delta_e=max(float(np.mean(error)) for error in errors),
                   p95_delta_e=max(float(np.percentile(error, 95)) for error in errors),
                   coverage=float(np.mean(support)))
    if (not all(np.isfinite(value) for value in metrics.values())
            or metrics["median_luma_error"] > .01 or metrics["p95_luma_error"] > .05
            or metrics["median_oklab_error"] > .015 or metrics["p95_oklab_error"] > .04
            or metrics["mean_delta_e"] > 1 or metrics["p95_delta_e"] > 3):
        raise LocalMatchRefused(metrics)
    return LocalMatchResult(best_grade, f"Matched {parent.name} to SDR.", metrics)
