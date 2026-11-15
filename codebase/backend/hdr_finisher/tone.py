from functools import lru_cache

import numpy as np

from .color import acescg_to_linear_bt2020


ZONES = ("shadows", "midtones", "highlights")
SDR_REFERENCE_WHITE = 100.0 / 203.0
WHITE_DOWN_STOPS = np.log2(1.0 / 0.775)


def reference_grey(hdr: bool) -> float:
    return 0.18 * (0.18 if hdr else SDR_REFERENCE_WHITE)


def _smooth(value):
    clipped = np.clip(value, 0.0, 1.0)
    return clipped * clipped * (3.0 - 2.0 * clipped)


def _mul(left, right):
    products = np.stack(np.broadcast_arrays(*(a * b for a in left for b in right)))
    return products.min(axis=0), products.max(axis=0)


def _add(left, right):
    return left[0] + right[0], left[1] + right[1]


def _scale(interval, amount):
    return _mul(interval, (amount, amount))


def _smooth_bounds(low, high):
    low, high = np.clip(low, 0.0, 1.0), np.clip(high, 0.0, 1.0)
    slope_low, slope_high = 6 * low * (1 - low), 6 * high * (1 - high)
    return (_smooth(low), _smooth(high)), (np.minimum(slope_low, slope_high),
        np.where((low <= 0.5) & (high >= 0.5), 1.5, np.maximum(slope_low, slope_high)))


@lru_cache(maxsize=128)
def _parameters(grey, peak, blacks, whites, shapes):
    """Interval bounds over all luminances and brightest-channel/luma ratios.

    Each cell bounds complete polynomial ranges, including interior derivative
    extrema, rather than certifying only sample points. Independent Y/M bounds
    include every fixed-colour ray, even signed out-of-gamut input. The additive
    floor bound certifies luminance order; negative Blacks may clip at zero.
    """
    knee = min(grey / 8, peak / 16)
    black_start = np.log2(knee / (2 * grey))
    minimum = min(black_start, *(center - half for _, center, half in shapes))
    maximum = max(black_start + 1, *(center + half for _, center, half in shapes))
    knots = np.unique(np.concatenate((np.arange(np.floor(minimum * 8), np.ceil(maximum * 8) + 1) / 8,
        [black_start, black_start + 1],
        [value for _, center, half in shapes for value in (center - half, center, center + half)])))
    low, high = knots[:-1, None], knots[1:, None]
    black_gate, black_slope = _smooth_bounds(low - black_start, high - black_start)
    white_low = np.arange(16)[None, :] / 16
    white_high = white_low + 1 / 16
    white_gate_base, white_gate_slope = _smooth_bounds(2 * white_low, 2 * white_high)
    white_gate = (1 - white_gate_base[1], 1 - white_gate_base[0])
    white_slope = (-2 * white_gate_slope[1], -2 * white_gate_slope[0])
    gate = _mul(black_gate, white_gate)
    gate_slope = _add(_mul(black_slope, white_gate), _mul(black_gate, white_slope))
    weights, slopes, amounts = [], [], []
    for strength, center, half in shapes:
        distance_low = np.maximum(np.maximum(center - high, low - center), 0)
        distance_high = np.maximum(np.abs(low - center), np.abs(high - center))
        bump_base, bump_slope = _smooth_bounds(distance_low / half, distance_high / half)
        bump = (1 - bump_base[1], 1 - bump_base[0])
        direction = np.where(high <= center, 1.0, -1.0)
        derivative = _mul(bump_slope, (direction / half, direction / half))
        weight = _mul(bump, gate)
        slope = _add(_mul(derivative, gate), _mul(bump, gate_slope))
        bound = max(float(np.max(np.abs(slope))), 1.5 / half)
        amounts.append(strength * 0.9 / bound)
        weights.append(weight)
        slopes.append(slope)
    white_amount = whites * (1.0 if whites >= 0 else WHITE_DOWN_STOPS)
    exponent = _scale((white_low ** 2, white_high ** 2), white_amount)
    derivative = _scale((2 * white_low, 2 * white_high), white_amount)
    for amount, weight, slope in zip(amounts, weights, slopes):
        exponent = _add(exponent, _scale(weight, amount))
        derivative = _add(derivative, _scale(slope, amount))
    gain = (np.exp2(exponent[0]), np.exp2(exponent[1]))
    response = _mul(gain, (1 + derivative[0], 1 + derivative[1]))[0]
    floor_derivative = -0.9 * max(blacks, 0) * np.maximum(1 - grey * np.exp2(low) / knee, 0)
    lowest = min(1 - 0.9 * max(blacks, 0), float(np.min(response + floor_derivative)))
    limiter = 1.0 if lowest >= 0.1 else 0.9 / (1 - lowest)
    return (*amounts, limiter, knee)


def parameters(branch, hdr: bool, reference_white_nits=203.0):
    grey = reference_grey(hdr)
    peak = float(branch.highlight_compression_target_nits) * 0.18 / reference_white_nits if hdr else 1.0
    shapes = tuple((float(getattr(branch, zone)) / 100, float(getattr(branch, f"{zone}_center")),
        float(getattr(branch, f"{zone}_width")) / 2) for zone in ZONES)
    return _parameters(grey, peak, float(branch.blacks) / 100, float(branch.whites) / 100, shapes)


def apply_tone(image, branch, hdr: bool, reference_white_nits=203.0):
    if not any(float(getattr(branch, name)) for name in ("blacks", *ZONES, "whites")):
        return image
    amounts = parameters(branch, hdr, reference_white_nits)
    grey = reference_grey(hdr)
    peak = float(branch.highlight_compression_target_nits) * 0.18 / reference_white_nits if hdr else 1.0
    weights = np.array([0.2722287, 0.6740818, 0.0536895] if hdr else [0.2126, 0.7152, 0.0722], np.float32)
    luminance = np.maximum(np.sum(image * weights, axis=-1), 0)
    delivery = acescg_to_linear_bt2020(image) if hdr else image
    brightest = np.maximum(np.max(delivery, axis=-1), 0)
    del delivery
    stops = np.log2(np.maximum(luminance, 1e-30) / grey)
    white_position = np.clip(np.log2(np.maximum(brightest, 1e-30) / (peak / 2)), 0, 1)
    gate = _smooth(np.log2(np.maximum(luminance, 1e-30) / (amounts[4] / 2))) * (1 - _smooth(2 * white_position))
    white_strength = float(branch.whites) / 100
    delta = white_position ** 2 * white_strength * (1 if white_strength >= 0 else WHITE_DOWN_STOPS)
    for amount, zone in zip(amounts[:3], ZONES):
        half = float(getattr(branch, f"{zone}_width")) / 2
        delta += amount * (1 - _smooth(np.abs(stops - float(getattr(branch, f"{zone}_center"))) / half)) * gate
    floor = 0.45 * float(branch.blacks) / 100 * amounts[4] * np.maximum(1 - luminance / amounts[4], 0) ** 2
    result = image * np.exp2(delta)[..., None]
    result += floor[..., None]
    result -= image
    result *= np.float32(amounts[3])
    result += image
    if branch.blacks < 0:
        np.maximum(result, 0, out=result, where=(floor < 0)[..., None])
    return result.astype(np.float32, copy=False)
