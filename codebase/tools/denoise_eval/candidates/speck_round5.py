"""Relative colour and nearby patch repairs on grain-matched Even keep, research only."""
from functools import partial
from itertools import product

import cv2
import numpy as np

from hdr_finisher import denoise_adaptive as adaptive
from tools.denoise_eval.candidates import colour_speck as colour
from tools.denoise_eval.candidates.even_keep_round4 import annulus, box

LUMA = adaptive.ACESCG_LUMINANCE
CHROMA = adaptive.OPPONENT[1:]
BORDER = cv2.BORDER_REFLECT_101
SMALL = (12, 2)
BROAD = (28, 4)
DONORS = tuple((y * distance, x * distance) for distance in (4, 8, 12, 16)
               for y, x in product((-1, 0, 1), repeat=2) if x or y)
NEIGHBOURS = tuple((y, x) for y, x in product(range(-9, 10, 3), repeat=2) if x or y)


def magnitude(vector):
    a, b = cv2.split(vector)
    return cv2.magnitude(a, b)


def grain(field, *, chroma=False):
    """Estimate the fine grain that actually survived, in the same image units."""
    fine = field - box(field, 2)
    absolute = magnitude(fine) if chroma else np.abs(fine)
    return np.maximum(1.25 * box(absolute, 16), np.float32(1e-7))


def shifted(padded, shape, y, x):
    h, w = shape
    return padded[y:y+h, x:x+w]


def surround(field, reach, tap):
    """Trim extreme opposite-pair averages to reduce influence of nearby blobs."""
    padded = cv2.copyMakeBorder(box(field, tap), reach, reach, reach, reach, BORDER)
    diagonal = round(reach / np.sqrt(2))
    h, w = field.shape[:2]
    pairs = []
    for y, x in ((0, reach), (reach, 0), (diagonal, diagonal), (diagonal, -diagonal)):
        forward = shifted(padded, (h, w), reach+y, reach+x)
        backward = shifted(padded, (h, w), reach-y, reach-x)
        pairs.append(.5 * (forward + backward))
    low = np.minimum(np.minimum(pairs[0], pairs[1]), np.minimum(pairs[2], pairs[3]))
    high = np.maximum(np.maximum(pairs[0], pairs[1]), np.maximum(pairs[2], pairs[3]))
    return .5 * (sum(pairs) - low - high)


def relative_colour(rgb, amount, *, broad=False):
    """Pull both opponent directions toward nearby colour, preserving linear Y."""
    y = rgb @ LUMA
    light = np.maximum(box(y, 1), 0) + 2 * grain(y)
    original = rgb @ CHROMA.T
    chroma = original / light[..., None]
    noise = grain(chroma, chroma=True)
    for reach, tap in (SMALL, BROAD) if broad else (SMALL,):
        # Work on the coherent part of a colour difference. Uncorrelated fine
        # chroma remains in the result. Reach is outside the blob being measured.
        delta = box(chroma, 1 if reach == SMALL[0] else 3) - surround(chroma, reach, tap)
        distance = magnitude(delta)
        weight = amount * colour.ramp(distance / noise, .65, 2.5)
        chroma -= delta * weight[..., None]
    delta = chroma * light[..., None] - original
    return colour.match_luminance(rgb + delta @ CHROMA, rgb, inplace=True)


def patch_heal(rgb):
    """Find dark clumps and borrow brightness and fine grain from matching patches."""
    y = rgb @ LUMA
    centre = box(y, 1)
    small = surround(y, 8, 2)
    large = surround(y, 13, 3)
    target = .5 * (small + large)
    noise = grain(y)
    excess = (target - centre) / noise
    weight = colour.ramp(excess, .45, 1.7)

    reach = 16
    shape = y.shape
    coarse = box(y, 2)
    padded_guide = cv2.copyMakeBorder(coarse, reach, reach, reach, reach, BORDER)
    padded_rgb_y = cv2.copyMakeBorder(y, reach, reach, reach, reach, BORDER)
    best = np.full_like(y, np.inf)
    donor = y.copy()
    donor_coarse = coarse.copy()
    for dy, dx in DONORS:
        guide_shift = shifted(padded_guide, shape, reach+dy, reach+dx)
        context = guide_shift - coarse
        context *= context
        # Omit the damaged centre from the matching footprint. The second
        # term favours a donor centre close to surrounding brightness.
        centre_error = guide_shift - target
        distance = annulus(context, 9, 4) + .40 * centre_error**2
        distance += .015 * (dy*dy + dx*dx) / reach**2 * noise**2
        better = distance < best
        np.copyto(donor, shifted(padded_rgb_y, shape, reach+dy, reach+dx), where=better)
        np.copyto(donor_coarse, guide_shift, where=better)
        np.minimum(best, distance, out=best)

    # Give the surrounding grain a continuous transition into the healed core.
    replacement = box(donor_coarse, 1) + .75 * (donor - donor_coarse)
    lift = box(weight, 1) * (replacement - y)
    # Carry the recipient's colour with its brightness in the repair. Adding
    # neutral light to a saturated dark edge creates a pale outline.
    light = np.maximum(centre, 0) + 2 * noise
    saturation_change = np.maximum(lift / light, -1)
    return rgb + lift[..., None] + (rgb - y[..., None]) * saturation_change[..., None]


def patch_average(rgb):
    """Average overlapping nearby patches by similarity across the whole image."""
    y = rgb @ LUMA
    chroma = rgb @ CHROMA.T
    y_bandwidth = (2.4 * grain(y))**2
    chroma_bandwidth = (3.5 * grain(chroma, chroma=True))**2
    reach = 9
    shape = y.shape
    guide_y = box(y, 1)
    guide_c = box(chroma, 1)
    padded_y = cv2.copyMakeBorder(guide_y, reach, reach, reach, reach, BORDER)
    padded_c = cv2.copyMakeBorder(guide_c, reach, reach, reach, reach, BORDER)
    padded_rgb = cv2.copyMakeBorder(rgb, reach, reach, reach, reach, BORDER)
    total = np.ones_like(y)
    output = rgb.copy()
    for dy, dx in NEIGHBOURS:
        dy, dx = dy+reach, dx+reach
        delta_y = shifted(padded_y, shape, dy, dx) - guide_y
        delta_c = shifted(padded_c, shape, dy, dx) - guide_c
        rb, gm = cv2.split(delta_c)
        distance = box(delta_y**2, 2) / y_bandwidth + box(rb**2 + gm**2, 2) / chroma_bandwidth
        # Discount the portion of patch distance expected from leftover grain.
        weight = np.exp(-np.maximum(distance - .25, 0))
        total += weight
        output += weight[..., None] * shifted(padded_rgb, shape, dy, dx)
    return output / total[..., None]


COLOUR_GENTLE = partial(relative_colour, amount=.45)
COLOUR_STRONG = partial(relative_colour, amount=.9)
COLOUR_BROAD = partial(relative_colour, amount=.9, broad=True)
KERNELS = {
    "colour-gentle": (COLOUR_GENTLE, 36),
    "colour-strong": (COLOUR_STRONG, 36),
    "colour-broad": (COLOUR_BROAD, 68),
    "heal": (patch_heal, 28),
    "average": (patch_average, 18),
}


def native(rgb, key):
    kernel, margin = KERNELS[key]
    return colour.tiled(rgb, margin, lambda tile, _rect, _edges: kernel(tile))
