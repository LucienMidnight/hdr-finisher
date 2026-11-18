"""Research-only filters for finer residual grain after signed development."""
from itertools import product

import cv2
import numpy as np

from hdr_finisher import denoise_adaptive as adaptive
from hdr_finisher.cpu_budget import CpuExecutor
from tools.denoise_eval.candidates import canon_ladder as ladder, colour_speck as colour
from tools.denoise_eval.marking_page import CONTROLS

DISTANCES = (12, 18, 24, 32)
SHADOW_HALO = 40
COLOUR_HALO = 40
BOX_BORDER = cv2.BORDER_REPLICATE
FRAME_BORDER = cv2.BORDER_REFLECT_101


def box(field, radius):
    width = 2 * radius + 1
    return cv2.boxFilter(field, -1, (width, width), borderType=BOX_BORDER)


def resolve_region(rgb, model, edges, radius, grain_weighted=False, calibration=None):
    """Production CPU reconstruction, with a running mean on two brightness gains."""
    y_strength, c_strength = CONTROLS.strengths()
    fine_multiplier = CONTROLS.fine_band_multiplier()
    fine_floor = np.float32(CONTROLS.fine_band_floor())
    variance = adaptive._noise_variance(rgb @ adaptive.ACESCG_LUMINANCE, model, edges)
    current = rgb @ adaptive.OPPONENT.T
    result = np.zeros_like(current)
    for level in range(adaptive.LEVELS):
        smooth = adaptive._atrous(current, level, edges)
        band = current - smooth
        energy = adaptive._box(band * band, adaptive.WIENER_RADIUS)
        size = CONTROLS.size_multiplier(level)
        if level < 2:
            size *= fine_multiplier
        for component in range(3):
            strength = y_strength if component == 0 else c_strength
            noise = np.float32((strength * size * model.band_sigmas[component][level])**2) * variance
            e = energy[..., component]
            gain = np.maximum(e - noise, 0) / np.maximum(e, np.float32(1e-20))
            if level < 2 and fine_floor > 0:
                gain = np.maximum(gain, fine_floor)
            if radius and level in ladder.BANDS and component == 0:
                if grain_weighted:
                    # Average locally in retained band energy. This is still
                    # bounded to the window and needs no whole-frame reduction.
                    power = band[..., 0] ** 2
                    kept = power * gain * gain
                    fraction = box(kept, radius) / np.maximum(box(power, radius), 1e-20)
                    gain = np.sqrt(np.clip(fraction, 0, 1))
                else:
                    gain = box(gain, radius)
                    if calibration is not None:
                        scale, offset = calibration[level, radius]
                        gain = np.clip(gain * scale + offset, 0, 1)
            result[..., component] += band[..., component] * gain
        current = smooth
    result += current
    return result @ adaptive.OPPONENT


def resolve(rgb, model, radius, grain_weighted=False, calibration=None):
    # Medium's cumulative wavelet reach is 14, plus 3 for local power.
    # All four trial radii fit inside production's coarsest-band tile margin.
    margin = max(adaptive.TILE_MARGIN, 17 + radius)
    result = rgb.copy()
    height, width = rgb.shape[:2]
    tile = adaptive.TILE_SIZE

    def run(origin):
        y, x = origin
        b, r = min(height, y+tile), min(width, x+tile)
        top, left = max(0, y-margin), max(0, x-margin)
        bottom, right = min(height, b+margin), min(width, r+margin)
        edges = adaptive._Edges(top == 0, bottom == height, left == 0, right == width, height, width)
        filtered = resolve_region(rgb[top:bottom, left:right], model, edges, radius, grain_weighted, calibration)
        result[y:b, x:r] = filtered[y-top:b-top, x-left:r-left]

    origins = product(range(0, height, tile), range(0, width, tile))
    with CpuExecutor() as pool:
        list(pool.map(run, origins))
    if not np.isfinite(result).all():
        raise FloatingPointError("Even keep produced a non-finite value")
    return result


def calibrate_brightness(rgb, model, radii):
    """Reuse the ladder's frame-energy target for any brightness-only radius."""
    height, width = rgb.shape[:2]
    tile = adaptive.TILE_SIZE
    margin = max(adaptive.TILE_MARGIN, 17 + max(radii))

    def sums(origin):
        y, x = origin
        b, r = min(height, y+tile), min(width, x+tile)
        t, l = max(0, y-margin), max(0, x-margin)
        eb, er = min(height, b+margin), min(width, r+margin)
        edges = adaptive._Edges(t == 0, eb == height, l == 0, er == width, height, width)
        core = np.s_[y-t:b-t, x-l:r-l]
        result = np.zeros((len(ladder.BANDS), 1+len(radii), 3), np.float64)
        for level, band, gains, *_ in ladder.starting_bands(rgb[t:eb, l:er], model, edges):
            if level in ladder.BANDS:
                idx = ladder.BANDS.index(level)
                power = np.square(band[core][..., 0], dtype=np.float64)
                gain = gains[..., 0]
                original = gain[core]
                result[idx, 0] = power.sum(), 0, (power*original*original).sum()
                for j, radius in enumerate(radii, 1):
                    held = box(gain, radius)[core]
                    result[idx, j, 1:] = (power*held).sum(), (power*held*held).sum()
            if level == ladder.BANDS[-1]:
                break
        return result

    origins = product(range(0, height, tile), range(0, width, tile))
    with CpuExecutor() as pool:
        totals = np.sum(list(pool.map(sums, origins)), axis=0)
    result = {}
    for i, level in enumerate(ladder.BANDS):
        power, _, goal = totals[i, 0]
        for j, radius in enumerate(radii, 1):
            _, first, second = totals[i, j]
            slope = np.sqrt(goal / max(second, 1e-30))
            linear = 2 * (first-second)
            square = max(power-2*first+second, 0)
            increase = max(goal-second, 0)
            blend = (2*increase) / max(linear + np.sqrt(linear**2+4*square*increase), 1e-30)
            result[level, radius] = np.float32(min(1, slope)*(1-blend)), np.float32(blend)
    return result


def robust_surround(chroma):
    """Middle two of four opposite-pair means, excluding the entire centre."""
    reach = 24
    pad = cv2.copyMakeBorder(chroma, reach, reach, reach, reach, FRAME_BORDER)
    h, w = chroma.shape[:2]
    pairs = []
    for dy, dx in ((0, 24), (24, 0), (17, 17), (17, -17)):
        y, x = reach+dy, reach+dx
        iy, ix = reach-dy, reach-dx
        pairs.append(.5 * (pad[y:y+h, x:x+w] + pad[iy:iy+h, ix:ix+w]))
    low = np.minimum(np.minimum(pairs[0], pairs[1]), np.minimum(pairs[2], pairs[3]))
    high = np.maximum(np.maximum(pairs[0], pairs[1]), np.maximum(pairs[2], pairs[3]))
    return .5 * (sum(pairs) - low - high)


def blobs(mask, *, max_span, min_area):
    _, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), connectivity=8)
    w, h, area = stats[:, 2:].T
    keep = (w <= max_span) & (h <= max_span) & (area >= min_area)
    keep[0] = False
    return keep[labels].astype(np.uint8)


def chroma_fields(rgb, model):
    """Find compact green/magenta islands through hue alone."""
    chroma = rgb @ adaptive.OPPONENT[1:].T
    # The five-pixel binomial smooth reduces one-pixel noise at the ring taps.
    reference = robust_surround(cv2.sepFilter2D(chroma, -1, adaptive.B3, adaptive.B3,
                                                borderType=FRAME_BORDER))
    rb, mg = cv2.split(chroma)
    outer_rb, outer_mg = cv2.split(reference)
    delta = chroma - reference
    delta_rb, delta_mg = cv2.split(delta)
    # Scene brightness is used only to set expected colour-noise amplitude.
    # Neither brightness edges nor brightness texture can veto a hue.
    scale = colour.noise_at(box(rgb @ colour.LUMA, 12), model)
    sigma = scale * np.float32(np.linalg.norm(model.band_sigmas[2][1:4])) + np.float32(1e-10)
    compact = mg - box(mg, 7)
    weight = np.zeros_like(mg)
    for sign in (-1, 1):
        hue = sign * mg - .85 * np.abs(rb)
        outer_hue = sign * outer_mg - .85 * np.abs(outer_rb)
        comparable = (hue > .18*sigma).astype(np.float32)
        # The central 13×13 is removed from the hue vote. Nearby islands
        # in a field of real colour vote together, surrounding orange does not.
        support = (49**2 * box(comparable, 24) - 13**2 * box(comparable, 6)) / (49**2 - 13**2)
        excess = sign * delta_mg / sigma
        # Label by local contrast before applying the stricter isolation gate.
        mask = (hue > .05*sigma) & (excess > .48) & (sign*compact > .16*sigma)
        compact_blob = blobs(mask, max_span=12, min_area=2)
        isolation = (1 - colour.ramp(support, .13, .33)) * (1 - colour.ramp(outer_hue/sigma, -.1, .45))
        current = (compact_blob * isolation * colour.ramp(hue/sigma, .05, .48)
                   * colour.ramp(excess, .48, 1.6)
                   * colour.ramp(sign*compact/sigma, .16, .60)
                   * colour.ramp(sign*delta_mg - .65*np.abs(delta_rb), 0, .65*sigma))
        np.maximum(weight, current, out=weight)
    return delta, weight


def annulus(field, outer, inner):
    outer_area = (2*outer+1)**2
    inner_area = (2*inner+1)**2
    return (outer_area*box(field, outer) - inner_area*box(field, inner))/(outer_area-inner_area)


def nearest_local_hue(hue, chroma, sigma):
    """Chroma-weighted robust hue sectors, with a 25-pixel central exclusion."""
    bins = 24
    width = np.float32(360/bins)
    # Clip votes from exceptionally colourful samples. Colourless pixels have
    # no vote. A sector has to carry a meaningful share of the outer ring.
    votes = np.minimum(chroma, 2.5*sigma) * colour.ramp(chroma/sigma, .10, .45)
    total = annulus(votes, 24, 12)
    minimum = np.maximum(.075*total, .009*sigma)
    sectors = np.floor((hue + .5*width)/width).astype(np.int16) % bins
    best = np.full_like(hue, np.inf)
    toward = np.zeros_like(hue)
    for index in range(bins):
        weight = annulus(np.where(sectors == index, votes, 0), 24, 12)
        offset = index*width - hue
        offset -= np.where(offset > 180, 360, np.where(offset < -180, -360, 0))
        # The nearest point is the edge of the supported sector. Aim one
        # degree inside it, with no change when the input is already inside.
        distance = np.maximum(np.abs(offset)-.5*width, 0)
        eligible = (weight >= minimum) & (distance < best) & (total >= .08*sigma)
        np.copyto(best, distance, where=eligible)
        np.copyto(toward, np.sign(offset)*(distance+1), where=eligible & (distance > 0))
        np.copyto(toward, 0, where=eligible & (distance == 0))
    typical = annulus(votes * np.minimum(chroma, 3.5*sigma), 24, 12) / np.maximum(total, 1e-10)
    return toward, typical


def unify_hue(rgb, model, amount):
    chroma = rgb @ adaptive.OPPONENT[1:].T
    rb, mg = cv2.split(chroma)
    degree = cv2.phase(rb, mg, angleInDegrees=True)
    magnitude = cv2.magnitude(rb, mg)
    sigma = (colour.noise_at(box(rgb @ colour.LUMA, 12), model)
             * np.float32(np.linalg.norm(model.band_sigmas[2][1:4])) + np.float32(1e-10))
    toward, typical = nearest_local_hue(degree, magnitude, sigma)
    # Sign-independent hue cones read green and magenta but leave redward
    # and blueward candidates for a separate, evidence-based trial.
    cone = np.abs(mg) - .85*np.abs(rb)
    compact = (mg-box(mg, 7))*np.sign(mg) / sigma
    shape = np.zeros_like(cone, dtype=np.uint8)
    eligible = (cone > .05*sigma) & (compact > .22) & (magnitude > .52*sigma) & (np.abs(toward) > 2)
    for sign in (-1, 1):
        selected = blobs(eligible & (sign*mg > 0), max_span=12, min_area=2)
        np.maximum(shape, selected, out=shape)
    strength = (amount * shape * colour.ramp(cone/sigma, .05, .42)
                * colour.ramp(compact, .22, .85)
                * colour.ramp(np.abs(toward), 2, 35))
    angle = toward * strength * np.float32(np.pi/180)
    level = magnitude - strength * np.maximum(magnitude - typical - .55*sigma, 0)
    # Express the rotation in the same axes, without quantising hue or
    # clipping negative scene samples.
    relative = level / np.maximum(magnitude, 1e-20)
    c, s = np.cos(angle), np.sin(angle)
    corrected = np.stack((relative*(rb*c - mg*s), relative*(mg*c + rb*s)), axis=-1)
    delta = np.where((strength > 0)[..., None], corrected-chroma, 0)
    return rgb + delta @ colour.CHROMA_RGB


def clean_colour(rgb, model, mode, amount):
    if mode == "hue":
        return unify_hue(rgb, model, amount)
    delta, weight = chroma_fields(rgb, model)
    weight *= amount
    if mode == "balance":
        return rgb - (delta[..., 1] * weight)[..., None] * colour.CHROMA_RGB[1]
    return rgb - (delta * weight[..., None]) @ colour.CHROMA_RGB


def dark_fields(luma, model):
    """Find compact pits relative to locally measured grain size and depth."""
    fine_base = cv2.sepFilter2D(luma, -1, adaptive.B3, adaptive.B3, borderType=FRAME_BORDER)
    fine = luma - fine_base
    shade = box(fine_base, 12)
    model_sigma = colour.noise_at(shade, model)
    fine_sigma = np.float32(np.linalg.norm(model.band_sigmas[0][:2])) * colour.BAND_LUMA[0] * model_sigma
    grain = np.maximum(1.2533 * box(np.minimum(np.abs(fine), 2*fine_sigma), 12), .26*fine_sigma)
    negative = (fine < -.22*grain).astype(np.float32)
    nearby_x = cv2.boxFilter(negative, -1, (2, 1), borderType=BOX_BORDER)
    nearby_y = cv2.boxFilter(negative, -1, (1, 2), borderType=BOX_BORDER)
    # The conditional chance of the preceding pixel also being dark estimates
    # a typical run in each direction. Their product approximates grain area.
    count = box(negative, 12)
    runs = []
    for adjacent in (nearby_x, nearby_y):
        continuation = box(negative * (2*adjacent-1), 12) / np.maximum(count, .03)
        runs.append(1 / np.maximum(1-continuation, .33))
    typical_area = runs[0]*runs[1]

    depth = (shade - fine_base) / np.maximum(grain, 1e-10)
    seed = depth > 1.10
    _, labels, stats, _ = cv2.connectedComponentsWithStats(seed.astype(np.uint8), connectivity=8)
    w, h, areas = stats[:, 2:].T
    compact = (w <= 14) & (h <= 14) & (areas >= 5)
    compact[0] = False
    size = areas.astype(np.float32)[labels]
    large = colour.ramp(size / typical_area, 1.40, 4.0)
    deep = colour.ramp(depth, 1.95, 3.8)
    interior = cv2.distanceTransform(seed.astype(np.uint8), cv2.DIST_L2, 5)
    centre = colour.ramp(interior, 1.0, 2.3)
    return shade, fine_base, grain, compact[labels] * centre * np.maximum(large, deep)


def break_dark(rgb, model, edges, mode, amount):
    luma = rgb @ colour.LUMA
    shade, fine_base, grain, weight = dark_fields(luma, model)
    if mode == "medium":
        # Use the production Medium split of the already-resolved brightness.
        fine = adaptive._atrous(adaptive._atrous(luma, 0, edges), 1, edges)
        medium_base = adaptive._atrous(fine, 2, edges)
        lift = np.maximum(medium_base - fine, 0)
    else:
        # Raise the base under the fine residual. The same signed fine
        # residual remains on top of the lifted interior.
        lift = np.maximum(shade - fine_base - .40*grain, 0)
    return rgb + (amount * weight * lift)[..., None]


def native_colour(rgb, model, mode, amount):
    return colour.tiled(rgb, COLOUR_HALO, lambda tile, _rect, _edges: clean_colour(tile, model, mode, amount))


def native_dark(rgb, model, mode, amount):
    return colour.tiled(rgb, SHADOW_HALO, lambda tile, _rect, edges: break_dark(tile, model, edges, mode, amount))
