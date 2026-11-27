"""Bounded picture-based search over ordinary SDR Tone and shoulder controls."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .adjustments import (
    SDR_SCENE_TO_DISPLAY_SCALE, TONE_EQUALIZER_MAX_ADJUSTMENT_EV,
    TONE_EQUALIZER_MAX_EV, TONE_EQUALIZER_MIN_EV, _apply_hdr_tone_equalizer,
    _linear_luma, _sample_tone_equalizer_target_ev,
)
from .tone import apply_tone
from .models import SDRAdjustments, ToneEqualizerNode
from .sdr_gamut import linear_srgb_to_oklab

TONE_ZONES = ("blacks", "shadows", "midtones", "highlights", "whites")
TONE_FIELDS = ("tone_section_enabled", "exposure", "output_exposure", "contrast", *TONE_ZONES,
               "tone_equalizer_section_enabled", "tone_equalizer_nodes")
SHOULDER_FIELDS = ("highlight_section_enabled", "highlight_compression_mode",
                   "highlight_compression_start_percent", "highlight_compression_softness",
                   "highlight_compression_color_handling", "highlight_compression_peak_detail",
                   "highlight_compression_bias", "highlight_compression_attenuation",
                   "highlight_compression_peak_measurement")
_START = ("highlight_compression_start_percent", 1., 99.)


def _band_points(luma, body):
    luma = luma[body]
    ev = np.log2(np.maximum(luma, 1e-8) / .18)
    middle = np.quantile(ev, [.1, .5, .9])
    low, high = TONE_EQUALIZER_MIN_EV, TONE_EQUALIZER_MAX_EV
    spacing = .75
    for index in range(3):
        lower = middle[index - 1] + spacing if index else low + spacing
        middle[index] = np.clip(middle[index], lower, high - (3 - index) * spacing)
    return [ToneEqualizerNode(input_ev=float(value), adjustment_ev=0.)
            for value in (low, *middle, high)]


def _seed_bands(hdr, luma, body, *, reference_white_nits, smoothing):
    """Approximate the HDR's early tonal response on the SDR band's scale.

    This gives the stock a similar input even on grades with large HDR
    Exposure Band or zone changes. The picture-based search still decides
    whether to keep/refine the seed. Contrast has its own SDR control.
    """
    seed = _band_points(luma * .5, body)
    if not (hdr.tone_section_enabled or hdr.tone_equalizer_section_enabled):
        return seed
    ev = np.linspace(-6, 6, 97, dtype=np.float32)
    grey = .18 * np.exp2(ev) / SDR_SCENE_TO_DISPLAY_SCALE
    ramp = np.broadcast_to(grey[None, :, None], (1, len(ev), 3)).copy()
    if hdr.tone_equalizer_section_enabled:
        ramp = _apply_hdr_tone_equalizer(ramp, hdr)
    if hdr.tone_section_enabled:
        ramp = apply_tone(ramp, hdr.model_copy(update={"contrast": 0.}), True, reference_white_nits)
    desired = np.clip(np.log2(np.maximum(ramp[0, :, 0], 1e-8) / grey), -2, 2)
    if np.max(np.abs(desired)) < .005:
        return seed

    # Dark, middle and bright picture regions get a say, while the ramp
    # preserves any shoulder/zone bends between those regions.
    sample = np.log2(np.maximum(luma[body] * .5, 1e-8) / .18)
    weights = np.histogram(np.clip(sample, ev[0], ev[-1]),
                           bins=np.r_[ev - .0625, ev[-1] + .0625])[0]
    weights = 1. + (weights / max(weights.sum(), 1)) * len(ev)
    centers = np.array([node.input_ev for node in seed], dtype=np.float32)

    def rank(at):
        shifts = np.interp(at, ev, desired).astype(np.float32)
        estimate = _sample_tone_equalizer_target_ev(ev, at, shifts, smoothing)
        return np.average((estimate - (ev + desired)) ** 2, weights=weights)

    for _ in range(2):
        for index in range(1, 4):
            lo, hi = centers[index - 1] + .75, centers[index + 1] - .75
            candidates = [centers[index], *ev[(ev >= lo) & (ev <= hi)][::2]]
            def candidate(value):
                trial = centers.copy()
                trial[index] = value
                return rank(trial)
            centers[index] = min(candidates, key=candidate)

    nodes = [ToneEqualizerNode(input_ev=float(x), adjustment_ev=float(y))
             for x, y in zip(centers, np.interp(centers, ev, desired))]
    for left, right in zip(nodes, nodes[1:]):
        right.adjustment_ev = max(right.adjustment_ev,
                                  left.input_ev + left.adjustment_ev + .001 - right.input_ev)
    return nodes


@dataclass
class _Trial:
    pixels: np.ndarray
    score: float
    safe: bool

    @property
    def rank(self):
        return not self.safe, self.score


class PictureToneFit:
    def __init__(self, target, body, render, review_luma_limit, *, shoulder_start):
        self.body = body & (_linear_luma(target) >= .0008)
        if not self.body.any():
            self.body = body if body.any() else np.ones(body.shape, dtype=bool)
        self.high = ~body
        self.highlight_weight = .5 * min(1., 10. * float(self.high.mean()))
        self.target_lab = linear_srgb_to_oklab(target)
        self.target_luma = _linear_luma(target)
        self.render = render
        self.review_luma_limit = review_luma_limit
        self.shoulder_start_percent = float(shoulder_start) * 100.

    def measure(self, sdr, *, fitting_tone):
        pixels = self.render(sdr)
        delta = np.linalg.norm(linear_srgb_to_oklab(np.clip(pixels, 0, 1)) - self.target_lab, axis=-1)
        body_error = delta[self.body]
        p95 = float(np.quantile(body_error, .95))
        luma_error = np.abs(_linear_luma(pixels) - self.target_luma)[self.body]
        p95_luma = float(np.quantile(luma_error, .95))
        score = float(body_error.mean()) + .5 * p95
        if self.highlight_weight:
            score += self.highlight_weight * float(delta[self.high].mean())
        if fitting_tone:
            score += .002 * sum(node.adjustment_ev ** 2 for node in sdr.tone_equalizer_nodes)
        # Guide an initially poor fit back under the unchanged acceptance gates.
        score += max(0., p95_luma - self.review_luma_limit) + max(0., p95 - .05)
        safe = p95_luma <= self.review_luma_limit and p95 <= .05
        if not np.isfinite(pixels).all():
            return _Trial(pixels, float("inf"), False)
        return _Trial(pixels, score, safe)

    def fit(self, current, hdr, *, tone, shoulder, reference_white_nits=203):
        tone_axes = []
        if tone:
            tone_axes.append((("output_exposure", -5., 5.), .36))
            if hdr.tone_section_enabled and hdr.contrast != 0:
                tone_axes.append((("contrast", -2., 2.), .40))
        shoulder_axes = [(_START, 20.)] if shoulder else []
        seed = _seed_bands(hdr, self.target_luma, self.body,
                           reference_white_nits=reference_white_nits,
                           smoothing=current.tone_equalizer_smoothing) if tone else []
        results = []
        for mode in ("soft_ceiling", "peak_fit") if shoulder else (None,):
            sdr = current.model_copy(deep=True)
            if tone:
                # Keep the HDR exposure at the input to Film Look. Fit the
                # overall SDR lift at the output, where it cannot re-expose stock.
                sdr.exposure = hdr.exposure if hdr.tone_section_enabled else 0.
                sdr.output_exposure = 0.
                sdr.contrast = 0.
                sdr.tone_section_enabled = True
                sdr.tone_equalizer_section_enabled = True
                sdr.tone_equalizer_nodes = [node.model_copy() for node in seed]
                for name in TONE_ZONES:
                    setattr(sdr, name, 0.)
            if mode is not None:
                self._seed_shoulder(sdr, hdr, mode)
            best = self.measure(sdr, fitting_tone=tone)
            if tone:
                # The median body ratio seeds the gain on the finished picture.
                rendered = _linear_luma(best.pixels)[self.body]
                ratio = np.log2(np.maximum(self.target_luma[self.body], 1e-6) / np.maximum(rendered, 1e-6))
                best = self._axis(sdr, best, tone_axes[0][0], [float(np.median(ratio))], tone)
            elif current.highlight_section_enabled:
                best = self._axis(sdr, best, _START,
                                  [current.highlight_compression_start_percent - sdr.highlight_compression_start_percent], tone)
            for fraction in (1., .5, .25):
                for axis, step in tone_axes + shoulder_axes:
                    best = self._axis(sdr, best, axis, (step * fraction, -step * fraction), tone)
            if tone:
                # Heavy HDR shoulder/zone edits may need multiple larger
                # moves before the usual fine search can compare candidates.
                coarse = (.50, .50, .50) if best.score > .03 and not best.safe else ()
                for step in (*coarse, .28, .14, .07, .035):
                    for index, node in enumerate(sdr.tone_equalizer_nodes):
                        best = self._axis(node, best, self._band_limits(sdr.tone_equalizer_nodes, index),
                                          (step, -step), tone, sdr=sdr)
                # Settle the global knobs again after the bands change their response.
                for fraction in (.25, .125):
                    for axis, step in tone_axes + shoulder_axes:
                        best = self._axis(sdr, best, axis, (step * fraction, -step * fraction), tone)
            results.append((sdr, best))
        sdr, best = min(results, key=lambda pair: pair[1].rank)
        if tone and shoulder and best.safe and sdr.highlight_compression_mode == "soft_ceiling":
            sdr, best = self._protect_highlight_headroom(sdr, best)
        return sdr, best

    def _protect_highlight_headroom(self, sdr, best):
        # Keep room for a follow-up brightness edit. Check a few neighbouring
        # starts only if the closest fit flattens new highlights at +0.5 EV.
        def clips(sdr, trial):
            raised = self.render(sdr.model_copy(update={"output_exposure": min(5., sdr.output_exposure + .5)}))
            return float((_linear_luma(raised) >= .999).mean() - (_linear_luma(trial.pixels) >= .999).mean())

        if clips(sdr, best) <= .01:
            return sdr, best
        candidates = []
        for offset in (-2.5, 2.5, -5., 5.):
            start = float(np.clip(sdr.highlight_compression_start_percent + offset, 1., 99.))
            if start == sdr.highlight_compression_start_percent:
                continue
            nearby = sdr.model_copy(update={"highlight_compression_start_percent": start})
            trial = self.measure(nearby, fitting_tone=True)
            if trial.safe and clips(nearby, trial) <= .01:
                candidates.append((nearby, trial))
        return min(candidates, key=lambda pair: pair[1].rank) if candidates else (sdr, best)

    def _axis(self, controls, best, spec, offsets, tone, *, sdr=None):
        name, lower, upper = spec
        original = chosen = getattr(controls, name)
        for offset in offsets:
            value = float(np.clip(original + offset, lower, upper))
            if abs(value - original) < 1e-5:
                continue
            setattr(controls, name, value)
            trial = self.measure(controls if sdr is None else sdr, fitting_tone=tone)
            if (not trial.safe, trial.score + 1e-6) < (not best.safe, best.score):
                chosen, best = value, trial
        setattr(controls, name, chosen)
        return best

    @staticmethod
    def _band_limits(nodes, index):
        # Stay within the editor's legal range and do not rely on the
        # renderer to silently straighten a reversed interval.
        limit = TONE_EQUALIZER_MAX_ADJUSTMENT_EV
        center = nodes[index].input_ev
        lower, upper = -limit, limit
        if index:
            left = nodes[index - 1]
            lower = max(lower, left.input_ev + left.adjustment_ev + .001 - center)
        if index < len(nodes) - 1:
            right = nodes[index + 1]
            upper = min(upper, right.input_ev + right.adjustment_ev - .001 - center)
        return "adjustment_ev", lower, upper

    def _seed_shoulder(self, sdr: SDRAdjustments, hdr, mode):
        sdr.highlight_section_enabled = True
        sdr.highlight_compression_mode = mode
        sdr.highlight_compression_start_percent = self.shoulder_start_percent
        if mode == "soft_ceiling":
            sdr.highlight_compression_softness = 100.
            sdr.highlight_compression_color_handling = "preserve_color"
        else:
            sdr.highlight_compression_peak_measurement = "robust"
            for name in ("highlight_compression_color_handling", "highlight_compression_peak_detail",
                         "highlight_compression_bias", "highlight_compression_attenuation"):
                setattr(sdr, name, getattr(hdr, name))
