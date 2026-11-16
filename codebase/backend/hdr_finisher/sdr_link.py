"""Safe linked SDR: one HDR creative prefix and one SDR output tail."""
from __future__ import annotations
import numpy as np
from .adjustments import (SDR_SCENE_TO_DISPLAY_SCALE, _acescg_luma, _linear_luma,
                          apply_adjustments, apply_sdr_output_highlight_compression)
from .color import acescg_to_linear_srgb
from .color_context import RenderColorContext
from .models import LocalGrade, PreviewKind, SDRAdjustments


def linked_creative_changed(previous, updated):
    def creative(branch):
        return {k: v for k, v in branch.model_dump().items()
                if not k.startswith('highlight_compression_')
                and k not in {'linked_to_hdr', 'output_exposure', 'highlight_section_enabled'}}
    return creative(previous) != creative(updated)


def linked_highlight_order_is_safe(hdr, target, candidate):
    """Steve, Nov 16: only additional inversions beyond the target fail.

    Identical HDR-brightness quantiles, inclusive bins, sample minimum and
    .005 allowance to the independent diagnostic. That diagnostic is unchanged.
    """
    from .sdr_match import MATCH_SHOULDER_START
    normalized = np.maximum(_acescg_luma(hdr), 0) * SDR_SCENE_TO_DISPLAY_SCALE
    selection = normalized > MATCH_SHOULDER_START
    if int(np.count_nonzero(selection)) < 8:
        return True
    x = normalized[selection]
    expected, actual = _linear_luma(target)[selection], _linear_luma(candidate)[selection]
    edges = np.quantile(x, np.linspace(0., 1., 9))
    medians, target_medians = [], []
    for lower, upper in zip(edges[:-1], edges[1:], strict=True):
        members = (x >= lower) & (x <= upper)
        if np.any(members):
            medians.append(float(np.median(actual[members])))
            target_medians.append(float(np.median(expected[members])))
    return len(medians) < 2 or bool(np.all(np.diff(medians) - np.minimum(np.diff(target_medians), 0.) >= -.005))


def acceptance_reason(hdr, target, candidate, raised, *, relative_order=True):
    from .sdr_match import MATCH_SHOULDER_START, _highlight_order_is_safe, _quality_metrics
    if not np.isfinite(candidate).all() or not np.isfinite(raised).all():
        return 'the linked picture contains invalid values', None
    if np.min(candidate) < 0 or np.max(candidate) > 1:
        return 'the linked picture is outside the SDR range', None
    q = _quality_metrics(target, candidate, _acescg_luma(hdr) * SDR_SCENE_TO_DISPLAY_SCALE <= MATCH_SHOULDER_START)
    if q.median_luma_error > .010 or q.p95_luma_error > .030 or q.median_oklab_error > .015 or q.p95_oklab_error > .040:
        return 'the linked picture changes body brightness or colour too much', q
    order_safe = linked_highlight_order_is_safe(hdr, target, candidate) if relative_order else _highlight_order_is_safe(hdr, candidate)
    if not order_safe:
        return 'the linked highlights change brightness order', q
    y, lifted = _linear_luma(candidate), _linear_luma(raised)
    if float(np.mean(lifted >= .999) - np.mean(y >= .999)) > .01:
        return 'a small exposure increase makes too much of the linked picture white', q
    editable, robust = (y >= .10) & (y <= .80), (y >= .05) & (y <= .75)
    if not np.any(editable) or not np.any(robust):
        return 'the linked picture has too little midtone range to check exposure', q
    delta = lifted[robust] - y[robust]
    if (float(np.median(lifted[editable] - y[editable])) <= .05
            or float(np.percentile(lifted[editable], 75) - np.percentile(y[editable], 75)) <= .02
            or float(np.percentile(delta, 5)) <= .02
            or float(np.median(lifted[robust] / y[robust])) <= 1.20
            or float(np.mean(delta > .005)) <= .95):
        return 'the linked picture leaves too little room for exposure edits', q
    return None, q


def try_linked_match(source, adjustments, locals_, settled_hdr, *, reference_white_nits, source_pixel_scale, relative_order=True):
    from .sdr_match import MaterializedSDRMatch, _semantic_sdr_translation, build_sdr_match_target
    common = apply_adjustments(source, adjustments, PreviewKind.HDR, include_grain=False,
        include_output_highlight_compression=False, apply_output_clamp=False,
        local_adjustments=adjustments.enabled_locals(locals_),
        color_context=RenderColorContext(reference_white_nits), source_pixel_scale=source_pixel_scale)
    placed = acescg_to_linear_srgb(common) * SDR_SCENE_TO_DISPLAY_SCALE
    target = build_sdr_match_target(settled_hdr)
    result = adjustments.model_copy(deep=True)
    result.sdr = _semantic_sdr_translation(adjustments, settled_hdr)
    result.sdr.linked_to_hdr, result.sdr.use_authored_base = True, False
    result.sdr.output_exposure = 0
    # Fit the trial's colour/body-best tail first, then judge it. Searching
    # only guard-passing tails can conceal a substantially different bright
    # look by selecting a broader/darker shoulder just to get a link.
    defaults = SDRAdjustments()
    for key, value in defaults.model_dump().items():
        if key.startswith('highlight_compression_'):
            setattr(result.sdr, key, value)
    best = None
    for mode in ('soft_ceiling', 'fixed_cap', 'peak_fit', 'clip'):
        for start in ((90,) if mode == 'clip' else (70, 80, 85, 90, 95, 99)):
            sdr = result.sdr
            sdr.highlight_section_enabled = True
            sdr.highlight_compression_mode, sdr.highlight_compression_start_percent = mode, start
            sdr.highlight_compression_softness, sdr.highlight_compression_peak_detail = 100, 35
            sdr.highlight_compression_bias = 0
            candidate = apply_sdr_output_highlight_compression(placed, result)
            raised = apply_sdr_output_highlight_compression(placed * np.float32(2 ** .5), result)
            from .sdr_match import MATCH_SHOULDER_START, _quality_metrics
            quality = _quality_metrics(target, candidate, _acescg_luma(settled_hdr) * SDR_SCENE_TO_DISPLAY_SCALE <= MATCH_SHOULDER_START)
            body_safe = (quality.p95_oklab_error <= .040 and quality.median_oklab_error <= .015
                         and quality.median_luma_error <= .010 and quality.p95_luma_error <= .030)
            rank = (not body_safe, float(np.mean(np.square(candidate.astype(np.float64) - target))))
            if best is None or rank < best[0]:
                best = rank, result.model_copy(deep=True), quality, candidate, raised
    reason, quality = acceptance_reason(settled_hdr, target, best[3], best[4], relative_order=relative_order)
    if reason:
        return None, reason
    independent_locals = [local.model_copy(update={'sdr_grade': LocalGrade.model_validate(
        local.hdr_grade.model_dump()), 'sdr_match': None}, deep=True) for local in locals_]
    return MaterializedSDRMatch(best[1], independent_locals, best[2], 'matched'), None
