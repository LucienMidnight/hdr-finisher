"""Colour-only research candidates. No imports from an app entry point."""
import cv2
import numpy as np

from hdr_finisher import denoise_adaptive as adaptive
from hdr_finisher.cpu_budget import CpuExecutor
from tools.denoise_eval.marking_page import CONTROLS

LUMA = adaptive.ACESCG_LUMINANCE
BAND_LUMA = adaptive.OPPONENT @ LUMA
# Change either opponent coordinate without changing AP1 luminance or the other coordinate.
CHROMA_RGB = adaptive.OPPONENT[1:] - BAND_LUMA[1:, None]
A_MARGIN = 64
A_TILE = 512
GUIDE_OFFSETS = tuple((dy, dx) for radius, diagonal in ((5, 4), (10, 7))
                      for dy, dx in ((radius, 0), (-radius, 0), (0, radius), (0, -radius),
                                     (diagonal, diagonal), (-diagonal, diagonal),
                                     (diagonal, -diagonal), (-diagonal, -diagonal)))


def ramp(value, low, high):
    return np.clip((value-low) / (high-low), 0, 1)


def noise_at(luma, model):
    light = np.maximum(luma, 0)
    return np.sqrt(np.maximum((np.float32(model.c) * light + np.float32(model.a)) * light
                              + np.float32(model.b), 1e-20))


def offset(padded, shape, dy, dx):
    radius = max(abs(d) for pair in GUIDE_OFFSETS for d in pair)
    h, w = shape
    return padded[radius+dy:radius+dy+h, radius+dx:radius+dx+w]


def guide(luma, colour, model):
    """Reference from two broad rings, blocking paths that cross brightness boundaries."""
    packed = np.dstack((luma, colour))
    samples = cv2.pyrDown(cv2.pyrDown(packed))
    y = samples[..., 0]
    noise = noise_at(y, model)
    # Lower brightness noise at the guide scale. The proportional term admits gradual shading.
    limit = np.maximum(.8 * noise, .10*np.abs(y)) + np.float32(1e-7)
    radius = max(abs(d) for pair in GUIDE_OFFSETS for d in pair)
    extended = np.pad(samples, ((radius, radius), (radius, radius), (0, 0)),
                      mode="constant", constant_values=np.nan)
    first = np.zeros_like(samples)
    second = np.zeros_like(samples[..., 1:])
    count = np.zeros_like(y)
    for dy, dx in GUIDE_OFFSETS:
        outer = offset(extended, y.shape, dy, dx)
        distance = np.abs(outer[..., 0] - y)
        for fraction in (.25, .5, .75):
            mid = offset(extended, y.shape, round(fraction*dy), round(fraction*dx))
            np.maximum(distance, np.abs(mid[..., 0] - y), out=distance)
        weight = np.where(np.isfinite(distance), 1-ramp(distance, .35*limit, limit), 0)
        sample = np.nan_to_num(outer, nan=0.)
        first += sample * weight[..., None]
        second += sample[..., 1:]**2 * weight[..., None]
        count += weight
    normalizer = np.maximum(count, 1)[..., None]
    mean = first / normalizer
    spread = np.sqrt(np.maximum(second / normalizer - mean[..., 1:]**2, 0))
    # Both hue axes must agree across the surviving samples. Use the coarse noise floor,
    # with a relative allowance for smoothly varying light on a saturated surface.
    mixed = np.max(spread / (.33*noise[..., None] + .12*np.abs(mean[..., 1:]) + 1e-7), axis=-1)
    confidence = ramp(count, 3, 8) * (1-ramp(mixed, .75, 1.5))
    coarse = np.dstack((mean, confidence))
    return cv2.pyrUp(cv2.pyrUp(coarse))[:luma.shape[0], :luma.shape[1]]


def wide_colour(rgb, structure_rgb, model, weights, *, before):
    """A. Change only the regional colour excess that also has a compact footprint."""
    luma = structure_rgb @ LUMA
    chroma = rgb @ adaptive.OPPONENT[1:].T
    reference = guide(luma, chroma, model)
    local_y = cv2.GaussianBlur(luma, (5, 5), 1.05)
    parent_y = cv2.GaussianBlur(local_y, (13, 13), 2.5)
    noise = noise_at(parent_y, model)
    # Require aligned brightness support across scales to protect a genuine ridge/point.
    fine_y, medium_y = luma-local_y, local_y-parent_y
    fine_support = ramp(np.abs(fine_y) / (noise * model.band_sigmas[0][0] + 1e-12), 1.3, 3.)
    medium_support = ramp(np.abs(medium_y) / (noise * model.band_sigmas[0][1] + 1e-12), 1.3, 3.)
    structure = np.where(fine_y * medium_y > 0, np.minimum(fine_support, medium_support), 0.)
    same_surface = 1-ramp(np.abs(local_y-reference[..., 0]),
                          .4*noise+.045*np.abs(parent_y), 1.15*noise+.14*np.abs(parent_y)+1e-7)
    weight = .8 * reference[..., 3] * same_surface * (1-structure)
    # This local high pass only limits the size of the correction. Similar pixels
    # around a candidate never give it permission to survive.
    local_c = cv2.GaussianBlur(chroma, (17, 17), 3.0)
    compact = chroma-local_c
    delta = chroma-reference[..., 1:3]
    sigma = np.array([np.linalg.norm(model.band_sigmas[c][:3]) for c in (1, 2)], np.float32)
    envelope = (.85 if before else .45) * noise[..., None] * sigma
    excess = np.minimum(np.maximum(np.abs(delta)-envelope, 0), np.abs(compact))
    correction = -np.sign(delta) * excess * (compact*delta > 0) * weight[..., None] * weights
    return rgb + correction @ CHROMA_RGB


def band_guided(rgb, model, edges, controls=CONTROLS):
    """B. Change already computed fine/medium chroma gains using aligned AP1 luminance."""
    y_strength, c_strength = controls.strengths()
    variance = adaptive._noise_variance(rgb @ LUMA, model, edges)
    std = np.sqrt(variance)
    current = rgb @ adaptive.OPPONENT.T
    out = np.zeros_like(current)
    previous_y = None
    for level in range(adaptive.LEVELS):
        smooth = adaptive._atrous(current, level, edges)
        band = current - smooth
        energy = adaptive._box(band * band, adaptive.WIENER_RADIUS)
        size = controls.size_multiplier(level)
        if level < 2:
            size *= controls.fine_band_multiplier()
        if level <= 2:
            band_y = band @ BAND_LUMA
            if level in (1, 2):
                # A strong luminance coefficient and same-polarity evidence from
                # the finer level protect points and edges, without voting by neighbours.
                band_support = ramp(np.abs(band_y) / (std * model.band_sigmas[0][level] + 1e-12), 1.2, 3.2)
                previous_support = ramp(np.abs(previous_y) / (std * model.band_sigmas[0][level-1] + 1e-12), .8, 2.5)
                support = np.where(previous_y * band_y > 0, np.minimum(band_support, previous_support), 0)
                strength = np.float32(.65) * (1-support)
            previous_y = band_y
        for channel in range(3):
            sigma = (y_strength if channel == 0 else c_strength) * size * model.band_sigmas[channel][level]
            noise = np.float32(sigma**2) * variance
            e = energy[..., channel]
            gain = np.maximum(e-noise, 0) / np.maximum(e, np.float32(1e-20))
            if level < 2 and controls.fine_band_floor() > 0:
                gain = np.maximum(gain, np.float32(controls.fine_band_floor()))
            kept = band[..., channel] * gain
            out[..., channel] += kept
            if channel and level in (1, 2):
                delta = -kept * strength
                out[..., channel] += delta
                # Opponent component 0 is average RGB, not scene luminance.
                out[..., 0] -= delta * np.float32(BAND_LUMA[channel] / BAND_LUMA[0])
        current = smooth
    out += current
    return (out @ adaptive.OPPONENT).astype(np.float32)


def match_luminance(candidate, baseline, *, inplace=False):
    output = candidate if inplace else candidate.copy()
    output += ((baseline @ LUMA) - (output @ LUMA))[..., None]
    return output


def tiled(rgb, margin, kernel, *, tile=adaptive.TILE_SIZE):
    """Use the production CPU tile layout and worker pool with a research kernel."""
    height, width = rgb.shape[:2]
    result = np.empty_like(rgb)
    origins = [(y, x) for y in range(0, height, tile) for x in range(0, width, tile)]

    def run(origin):
        y, x = origin
        b, r = min(height, y+tile), min(width, x+tile)
        left, top = max(0, x-margin), max(0, y-margin)
        right, bottom = min(width, r+margin), min(height, b+margin)
        edges = adaptive._Edges(top == 0, bottom == height, left == 0, right == width, height, width)
        rect = np.s_[top:bottom, left:right]
        out = kernel(rgb[rect], rect, edges)
        result[y:b, x:r] = out[y-top:b-top, x-left:r-left]

    with CpuExecutor() as pool:
        list(pool.map(run, origins))
    if not np.isfinite(result).all():
        raise FloatingPointError("Research candidate produced a non-finite value")
    return result


def native_a(tamed, baseline, model, weights, *, before):
    rgb = tamed if before else baseline
    result = tiled(rgb, A_MARGIN, lambda image, rect, _: wide_colour(image, tamed[rect], model, weights,
                                                                    before=before), tile=A_TILE)
    if before:
        result = adaptive.resolve_adaptive(result, model, CONTROLS)
        return match_luminance(result, baseline, inplace=True)
    return result


def native_b(tamed, model):
    return tiled(tamed, adaptive.TILE_MARGIN, lambda image, _, edges: band_guided(image, model, edges))
