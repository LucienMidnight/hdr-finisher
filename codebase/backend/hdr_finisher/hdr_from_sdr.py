"""Unexposed X2 research fitter. Not a public action or a qualified recipe.

Only ordinary HDR controls are proposed. Callers must not install a proposal
until body, family, transition, native delivery and UI qualification is complete.
"""

from dataclasses import dataclass
import math

import numpy as np

from .adjustments import SDR_DISPLAY_REFERENCE_WHITE, _linear_luma, apply_adjustments
from .color import acescg_to_linear_bt2020, acescg_to_linear_srgb
from .color_context import RenderColorContext, scene_linear_to_nits
from .models import AdjustmentState, HDRAdjustments, LocalAdjustment, PreviewKind
from .sdr_gamut import linear_srgb_to_oklab
from .sdr_match import _translate_color_grading_wheels


BODY_LIMITS = dict(median_luma_error=.01, p95_luma_error=.03,
                   median_oklab_error=.015, p95_oklab_error=.04)
FAMILY_NAMES = ("red", "yellow", "green", "cyan", "blue", "magenta")


@dataclass(frozen=True)
class HDRStartProposal:
    adjustments: AdjustmentState
    local_adjustments: list[LocalAdjustment]
    metrics: dict
    body_accepted: bool
    message: str


def seed_hdr_from_sdr(adjustments, locals_, *, reference_white_nits=203):
    context = RenderColorContext(reference_white_nits)
    result = adjustments.model_copy(deep=True)
    payload = adjustments.sdr.model_dump()
    fields = {name: value for name, value in payload.items()
              if name in HDRAdjustments.model_fields and not name.startswith("highlight_compression")
              and name != "highlight_section_enabled"}
    previous = adjustments.hdr.model_dump()
    cap = {name: value for name, value in previous.items()
           if name.startswith("highlight_compression") or name == "highlight_section_enabled"}
    fields.update(cap)
    fields["exposure"] = float(np.clip(adjustments.sdr.exposure
        + math.log2(100 / context.hdr_reference_white_nits), -8, 8))
    fields["contrast_pivot"] = float(np.clip(adjustments.sdr.contrast_pivot * .18
        / float(SDR_DISPLAY_REFERENCE_WHITE), .0001, 18))
    fields["highlight_desaturation_start"] = adjustments.sdr.highlight_desaturation_start * .18 / float(SDR_DISPLAY_REFERENCE_WHITE)
    if not adjustments.hdr.highlight_section_enabled or adjustments.hdr.highlight_compression_mode == "off":
        fields.update(highlight_section_enabled=True, highlight_compression_mode="fixed_cap",
                      highlight_compression_start_nits=.8 * adjustments.hdr.highlight_compression_target_nits)
    result.hdr = HDRAdjustments.model_validate(fields)
    _translate_color_grading_wheels(result.hdr.color_grading, adjustments.sdr.color_grading,
                                    source_lane=PreviewKind.SDR)
    result_locals = [local.model_copy(deep=True) for local in locals_]
    for local in result_locals:
        local.hdr_grade = local.sdr_grade.model_copy(deep=True)
        _translate_color_grading_wheels(local.hdr_grade.color_grading, local.sdr_grade.color_grading,
                                        source_lane=PreviewKind.SDR)
    return result, result_locals


def hdr_comparison_pixels(pixels, reference_white_nits):
    context = RenderColorContext(reference_white_nits)
    return acescg_to_linear_srgb(pixels) * np.float32(context.hdr_reference_white_nits / (.18 * 203))


def fixed_body_selection(target):
    luma = _linear_luma(target)
    return (np.all(np.isfinite(target), axis=-1) & (luma >= .005)
            & (luma <= .9) & (np.max(target, axis=-1) < .98))


def colour_families(target):
    lab = linear_srgb_to_oklab(target)
    chroma = np.linalg.norm(lab[..., 1:], axis=-1)
    hue = np.degrees(np.arctan2(lab[..., 2], lab[..., 1])) % 360
    centers = (29., 110., 142., 195., 265., 328.)
    distance = np.stack([np.abs((hue - center + 180) % 360 - 180) for center in centers], axis=-1)
    nearest = np.argmin(distance, axis=-1)
    return {**{name: (nearest == index) & (chroma >= .025)
               for index, name in enumerate(FAMILY_NAMES)}, "neutral": chroma < .025}


def body_metrics(target, candidate, body):
    luma_error = np.abs(_linear_luma(candidate) - _linear_luma(target))
    colour_error = np.linalg.norm(linear_srgb_to_oklab(candidate)
                                  - linear_srgb_to_oklab(target), axis=-1)
    def region_metrics(selection, minimum):
        count = int(np.count_nonzero(selection))
        if count < minimum:
            return dict(samples=count, status="insufficient_coverage")
        if not np.all(np.isfinite(candidate[selection])):
            return dict(samples=count, status="nonfinite")
        metrics = dict(median_luma_error=float(np.median(luma_error[selection])),
                       p95_luma_error=float(np.percentile(luma_error[selection], 95)),
                       median_oklab_error=float(np.median(colour_error[selection])),
                       p95_oklab_error=float(np.percentile(colour_error[selection], 95)))
        return dict(samples=count, status="pass" if all(metrics[name] <= limit
                    for name, limit in BODY_LIMITS.items()) else "fail", **metrics)
    families = {name: region_metrics(body & selection, 16)
                for name, selection in colour_families(target).items()}
    overall = region_metrics(body, 64)
    accepted = overall["status"] == "pass" and all(
        row["status"] in ("pass", "insufficient_coverage") for row in families.values())
    return dict(overall=overall, families=families), accepted


def delivery_ceiling_metrics(pixels, adjustments, reference_white_nits):
    channels = acescg_to_linear_bt2020(pixels)
    peak = float(scene_linear_to_nits(np.max(channels), reference_white_nits))
    target = adjustments.hdr.highlight_compression_target_nits
    return dict(peak_nits=peak, target_nits=target, finite=bool(np.all(np.isfinite(pixels))),
                passed=bool(np.all(np.isfinite(pixels)) and peak <= target))


def fit_hdr_from_sdr(source, adjustments, locals_, *, reference_white_nits=203,
                     sdr_reference=None, source_pixel_scale=1., passes=5):
    if source.ndim != 3 or source.shape[-1] != 3 or source.shape[0] * source.shape[1] > 65536:
        raise ValueError("X2 research requires a bounded RGB proxy of at most 65,536 pixels.")
    if not np.all(np.isfinite(source)) or not 0 <= passes <= 5:
        raise ValueError("X2 research requires finite pixels and at most five fitting passes.")
    context = RenderColorContext(reference_white_nits)
    target = apply_adjustments(source, adjustments, PreviewKind.SDR, sdr_reference,
                              include_grain=False, local_adjustments=locals_, color_context=context,
                              source_pixel_scale=source_pixel_scale).copy()
    target.setflags(write=False)
    if not np.all(np.isfinite(target)):
        raise ValueError("The SDR target contains invalid pixels. HDR is unchanged.")
    body = fixed_body_selection(target)
    body.setflags(write=False)
    if np.count_nonzero(body) < 64:
        raise ValueError("Too little unclipped SDR body to fit. HDR is unchanged.")
    result, translated = seed_hdr_from_sdr(adjustments, locals_, reference_white_nits=reference_white_nits)
    target_lab = linear_srgb_to_oklab(target)[body]
    target_luma = _linear_luma(target)[body]
    def render():
        pixels = apply_adjustments(source, result, PreviewKind.HDR, include_grain=False,
                                   local_adjustments=translated, color_context=context,
                                   source_pixel_scale=source_pixel_scale)
        common = hdr_comparison_pixels(pixels, reference_white_nits)
        if not np.all(np.isfinite(common)):
            return pixels, common, float("inf")
        luma_error = np.abs(_linear_luma(common)[body] - target_luma)
        colour_error = np.linalg.norm(linear_srgb_to_oklab(common)[body] - target_lab, axis=-1)
        score = float(np.mean(luma_error) + np.percentile(luma_error, 95)
                      + np.mean(colour_error) + np.percentile(colour_error, 95))
        return pixels, common, score
    pixels, candidate, best = render()
    seed_score = best
    controls = (("exposure", 2., -8, 8, "tone_section_enabled"),
                ("contrast", .4, -2, 2, "tone_section_enabled"),
                ("blacks", 32., -100, 100, "tone_section_enabled"),
                ("shadows", 32., -100, 100, "tone_section_enabled"),
                ("midtones", 32., -100, 100, "tone_section_enabled"),
                ("highlights", 32., -100, 100, "tone_section_enabled"),
                ("whites", 32., -100, 100, "tone_section_enabled"),
                ("saturation", .16, -1, 3, "color_section_enabled"),
                ("white_balance_kelvin", 1000, 1000, 25000, "color_section_enabled"),
                ("tint", .16, -2, 2, "color_section_enabled"))
    renders = 1
    for iteration in range(passes):
        for name, step, lower, upper, section in controls:
            if not getattr(result.hdr, section):
                continue
            center = getattr(result.hdr, name)
            chosen = center
            for direction in (-1, 1):
                value = float(np.clip(center + direction * step / (2 ** iteration), lower, upper))
                if name == "white_balance_kelvin":
                    value = int(round(value))
                setattr(result.hdr, name, value)
                trial_pixels, trial_common, score = render()
                renders += 1
                if score < best:
                    chosen, pixels, candidate, best = value, trial_pixels, trial_common, score
            setattr(result.hdr, name, chosen)
    metrics, accepted = body_metrics(target, candidate, body)
    metrics.update(ceiling=delivery_ceiling_metrics(pixels, result, reference_white_nits),
                   seed_score=seed_score, fitted_score=best, candidate_renders=renders,
                   body_samples=int(np.count_nonzero(body)))
    accepted = accepted and metrics["ceiling"]["passed"]
    return HDRStartProposal(result, translated, metrics, accepted,
        "Research body fit passes; native delivery/transition qualification still required." if accepted else
        "The SDR brightness and colour could not be retained closely enough. HDR is unchanged.")
