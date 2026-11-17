"""Threshold-only and less-luma/more-chroma research ablations."""
from dataclasses import replace

from tools.denoise_eval.candidates.early_outlier import Controls, EarlyOutlier


def threshold(value, *, grain=False, strength=.75):
    adapter = EarlyOutlier(controls=Controls(threshold=value, strength=strength))
    if grain:
        adapter.denoise.controls = replace(adapter.denoise.controls, luminance=.25, color_noise=1.)
    return adapter


def raw_sigma2():
    return threshold(2.)


def raw_sigma2_5():
    return threshold(2.5)


def raw_sigma3():
    return threshold(3.)


def raw_sigma4():
    return threshold(4.)


def grain_only():
    return threshold(2.5, grain=True, strength=0.)


def grain_sigma2_5():
    return threshold(2.5, grain=True)


def grain_sigma4():
    return threshold(4., grain=True)
