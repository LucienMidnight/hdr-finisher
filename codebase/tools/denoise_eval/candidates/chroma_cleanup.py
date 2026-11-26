"""Own GPL-3 colour-cleanup research; never imported by the application.

Green-phase matching and differential-colour median filtering are independent
implementations of published techniques, not ports of RT/darktable source.
"""
from __future__ import annotations
from dataclasses import asdict, dataclass
import cv2
import numpy as np
from hdr_finisher import denoise_adaptive as adaptive
from tools.denoise_eval.candidates import early_outlier as early
from tools.denoise_eval.candidates.dark_noise import factory as calibrated
from tools.denoise_eval.candidates.demosaic_noise import validate
from tools.denoise_eval.candidates.pixel_cleanup import noise_positions
from tools.denoise_eval.candidates.signed_shadows import camera_ahd, to_aces

Y = np.asarray(adaptive.ACESCG_LUMINANCE, dtype=np.float64)
GM = np.array([-.5, 1., -.5])
OB = np.array([1., 0., -1.])
GM_DIRECTION = np.array([-Y[1], 1-Y[1], -Y[1]], np.float32)
OB_DIRECTION = np.array([.5-.5*(Y[0]-Y[2]), -.5*(Y[0]-Y[2]), -.5-.5*(Y[0]-Y[2])], np.float32)


@dataclass(frozen=True)
class Controls:
    post: bool = False
    local_noise: bool = False
    radius: int = 2
    green: bool = False
    median_steps: int = 0
    median_keep_y: bool = False
    threshold: float = 0.
    max_area: int = 9
    orange_blue: bool = False
    strength: float = .75

    def __post_init__(self):
        if (self.median_steps not in (0, 1, 3) or self.max_area not in (1, 9, 25, 81) or self.radius not in (2, 4)
                or not np.isfinite(self.threshold) or self.threshold < 0
                or not 0 <= self.strength <= 1):
            raise ValueError('Invalid chroma-cleanup research controls')


def match_greens(sensor, pattern, parameters):
    """Locally balance the green-phase means only on low-structure CFA cells.

    Opposite shifts preserve each 2x2 cell's sum of measured green samples.
    The variance gate is a provisional noise/structure test, not scene truth.
    """
    result = sensor.copy()
    positions = np.argwhere(pattern == 1)
    p, q = positions
    first = sensor[p[0]::2, p[1]::2]
    second = sensor[q[0]::2, q[1]::2]
    height, width = min(first.shape[0], second.shape[0]), min(first.shape[1], second.shape[1])
    a, b = first[:height, :width], second[:height, :width]
    mean_a, mean_b = (cv2.blur(v, (5, 5)) for v in (a, b))
    variances = []
    for plane, centre, pos in ((a, mean_a, p), (b, mean_b, q)):
        shot, read = parameters[pos[0]*2+pos[1]]
        predicted = shot * np.maximum(centre, 0) + read
        observed = np.maximum(cv2.blur(plane*plane, (5, 5))-centre*centre, 0)
        variances.append((predicted, observed))
    flat = (variances[0][1] <= 2*variances[0][0]) & (variances[1][1] <= 2*variances[1][0])
    flat &= cv2.dilate(((a >= 1) | (b >= 1)).astype('uint8'), np.ones((5, 5), 'uint8')) == 0
    flat[:4] = flat[-4:] = False
    flat[:, :4] = flat[:, -4:] = False
    correction = np.where(flat, .375 * (mean_a-mean_b), 0)
    result[p[0]::2, p[1]::2][:height, :width] = a-correction
    result[q[0]::2, q[1]::2][:height, :width] = b+correction
    return result, dict(green_cells=int(np.count_nonzero(correction)))


def false_colour(camera, steps):
    result = camera.copy()
    for _ in range(steps):
        for channel in (0, 2):
            difference = result[..., channel] - result[..., 1]
            result[..., channel] = result[..., 1] + cv2.medianBlur(difference, 3)
    return result


def component_sigma(camera, metadata, component):
    """Provisional propagated sensor-noise floor; no clean target is consulted.

    Half the un-interpolated sigma approximates AHD averaging. Correlations
    and taming are not calibrated; local MAD can raise this floor.
    """
    parameters = noise_positions(metadata)
    pattern = np.asarray(metadata['cfa'])
    matrix = np.asarray(metadata['camera_to_acescg']) * np.asarray(metadata['white_balance'])[None, :]
    coefficients = component @ matrix
    variance = np.zeros(camera.shape[:2], np.float32)
    for channel in range(3):
        shot, read = parameters[pattern.ravel() == channel].mean(axis=0)
        variance += np.float32(coefficients[channel]**2) * (shot*np.maximum(camera[..., channel], 0)+read)
    return np.sqrt(np.maximum(variance, 1e-24)) * np.float32(.5 * 2**metadata.get('exposure_stops', 0))


def spatial_median(plane, radius):
    if radius == 2:
        return cv2.medianBlur(plane, 5)
    # Full 9x9 median, bounded by caller windows. No unsigned quantisation.
    windows = np.lib.stride_tricks.sliding_window_view(np.pad(plane, radius, mode='reflect'), (2*radius+1, 2*radius+1))
    return np.median(windows, axis=(-2, -1)).astype('float32')


def repair_component(rgb, sigma_floor, component=GM, direction=GM_DIRECTION, *, threshold=3., max_area=9, strength=.75, radius=2):
    plane = (rgb @ component).astype('float32')
    median = spatial_median(plane, radius)
    residual = plane-median
    sigma = np.maximum(sigma_floor, 1.4826*spatial_median(abs(residual), radius))
    sigma = np.maximum(sigma, 1e-12)
    distance = abs(residual)/sigma
    candidates = distance > threshold
    candidates[:5] = candidates[-5:] = False
    candidates[:, :5] = candidates[:, -5:] = False
    support = np.zeros(plane.shape, np.uint8)
    reach = 3 if radius == 2 else 6
    padded = np.pad(plane, reach, mode='reflect')
    height, width = plane.shape
    # Exclude the correlated immediate blob; two similar outer samples veto.
    for dy in range(-reach, reach+1):
        for dx in range(-reach, reach+1):
            if max(abs(dy), abs(dx)) < radius:
                continue
            neighbour = padded[reach+dy:reach+dy+height, reach+dx:reach+dx+width]
            support += abs(neighbour-plane) <= sigma
    oversized = np.zeros(plane.shape, bool)
    for sign in (residual > 0, residual < 0):
        count, labels, stats, _ = cv2.connectedComponentsWithStats((candidates & sign).astype('uint8'), connectivity=8)
        reject = np.zeros(count, bool)
        reject[1:] = stats[1:, cv2.CC_STAT_AREA] > max_area
        oversized |= reject[labels]
    eligible = candidates & (support < 2) & ~oversized
    ramp = np.clip((distance-threshold)/threshold, 0, 1)
    ramp = ramp*ramp*(3-2*ramp)
    delta = np.where(eligible, -strength*ramp*residual, 0)
    result = rgb + delta[..., None] * direction
    return result.astype('float32'), dict(candidates=int(candidates.sum()), changed=int(np.count_nonzero(delta)),
        supported=int((candidates & (support >= 2)).sum()), oversized=int((candidates & oversized).sum()),
        luminance_max_abs_drift=float(np.max(abs((result-rgb) @ Y))))


def develop(sensor, metadata, controls=Controls()):
    source, pattern = validate(sensor, metadata['cfa'])
    if any(value % 2 for value in metadata.get('tile_origin', (0, 0))):
        raise ValueError('Even sensor origin required')
    parameters = noise_positions(metadata)
    if parameters is None:
        raise ValueError('Chroma cleanup requires four sensor noise fits')
    source = source.copy()
    counts = dict(raw=[])
    for phase, (shot, read) in enumerate(parameters):
        py, px = divmod(phase, 2)
        source[py::2, px::2], count = early.tame_plane(source[py::2, px::2], shot, read)
        counts['raw'].append(count)
    if controls.green:
        source, counts['green'] = match_greens(source, pattern, parameters)
    camera = camera_ahd(source, pattern)
    # The production colour tail mutates its input; preserve camera RGB for
    # colour-difference filtering and sensor-noise propagation.
    rgb = to_aces(camera.copy(), metadata)
    if controls.median_steps:
        filtered = to_aces(false_colour(camera, controls.median_steps), metadata)
        drift = (filtered-rgb) @ Y
        counts['median_luminance_drift_before_projection'] = float(np.max(abs(drift)))
        if controls.median_keep_y:
            filtered -= drift[..., None].astype('float32')
        rgb = filtered
    if controls.threshold and not controls.post:
        rgb, counts['gm'] = repair_component(rgb, component_sigma(camera, metadata, GM),
            threshold=controls.threshold, max_area=controls.max_area, strength=controls.strength, radius=controls.radius)
        if controls.orange_blue:
            rgb, counts['ob'] = repair_component(rgb, component_sigma(camera, metadata, OB), OB, OB_DIRECTION,
                threshold=controls.threshold, max_area=controls.max_area, strength=controls.strength, radius=controls.radius)
    return rgb, counts


class ChromaCleanup:
    input_kind = 'bayer'
    margin = 128
    supports_alpha = False
    supports_bypass = False

    def __init__(self, controls=Controls()):
        self.controls = controls
        self.denoise = calibrated()

    def prepare(self, image, metadata):
        rgb, counts = develop(image, metadata, self.controls)
        return rgb, self.denoise.prepare(rgb, metadata), counts

    def process(self, image, metadata, state, *, bypass=False):
        if bypass:
            raise ValueError('Select signed Off upstream for Bayer bypass')
        result = self.denoise.process(state[0], metadata, state[1])
        if self.controls.post:
            # Explicit post-Denoise ablation: robust residual MAD, with 10%
            # un-interpolated sensor sigma floor (component_sigma uses 50%).
            matrix = np.asarray(metadata['camera_to_acescg']) * np.asarray(metadata['white_balance'])[None, :]
            camera = (state[0] / np.float32(2**metadata.get('exposure_stops', 0))) @ np.linalg.inv(matrix).T
            sigma = (np.full(result.shape[:2], 1e-7 * 2**metadata.get('exposure_stops', 0), np.float32)
                     if self.controls.local_noise else component_sigma(camera, metadata, GM) * .2)
            if self.controls.threshold == 0:
                plane = (result @ GM).astype('float32')
                delta = self.controls.strength * (spatial_median(plane, self.controls.radius)-plane)
                changed = result + delta[..., None] * GM_DIRECTION
                counts = dict(changed=int(np.count_nonzero(delta)),
                    luminance_max_abs_drift=float(np.max(abs((changed-result) @ Y))))
                result = changed.astype('float32')
            else:
                result, counts = repair_component(result, sigma, threshold=self.controls.threshold,
                    max_area=self.controls.max_area, strength=self.controls.strength, radius=self.controls.radius)
            state[2]['post_gm'] = counts
        return result

    def description(self):
        return dict(algorithm='chroma-cleanup-research', controls=asdict(self.controls),
            noise_floor=('local residual MAD, numerical 1e-7 linear floor scaled with exposure' if self.controls.local_noise
                         else '10% propagated sensor sigma plus MAD' if self.controls.post
                         else '50% propagated sensor sigma plus MAD; provisional'),
            luminance='ACEScg Y preserved by targeted repair; G-hold median and CFA match can change Y',
            denoise=self.denoise.description())


def taming(): return ChromaCleanup()
def green(): return ChromaCleanup(Controls(green=True))
def median1(): return ChromaCleanup(Controls(median_steps=1))
def median3(): return ChromaCleanup(Controls(median_steps=3))
def median1_y(): return ChromaCleanup(Controls(median_steps=1, median_keep_y=True))
def gm2_a1(): return ChromaCleanup(Controls(threshold=2, max_area=1))
def gm2_a9(): return ChromaCleanup(Controls(threshold=2, max_area=9))
def gm2_a25(): return ChromaCleanup(Controls(threshold=2, max_area=25))
def gm3_a1(): return ChromaCleanup(Controls(threshold=3, max_area=1))
def gm3_a9(): return ChromaCleanup(Controls(threshold=3, max_area=9))
def gm3_a25(): return ChromaCleanup(Controls(threshold=3, max_area=25))
def gm4_a1(): return ChromaCleanup(Controls(threshold=4, max_area=1))
def gm4_a9(): return ChromaCleanup(Controls(threshold=4, max_area=9))
def gm4_a25(): return ChromaCleanup(Controls(threshold=4, max_area=25))
def green_gm(): return ChromaCleanup(Controls(green=True, threshold=2, max_area=25))
def gm_ob(): return ChromaCleanup(Controls(threshold=2, max_area=25, orange_blue=True))

# Post-hoc placement diagnostic, explicitly separate from the requested pre-stage.
def post2_a1(): return ChromaCleanup(Controls(post=True, threshold=2, max_area=1))
def post2_a9(): return ChromaCleanup(Controls(post=True, threshold=2, max_area=9))
def post2_a25(): return ChromaCleanup(Controls(post=True, threshold=2, max_area=25))
def post3_a1(): return ChromaCleanup(Controls(post=True, threshold=3, max_area=1))
def post3_a9(): return ChromaCleanup(Controls(post=True, threshold=3, max_area=9))
def post3_a25(): return ChromaCleanup(Controls(post=True, threshold=3, max_area=25))
def post4_a1(): return ChromaCleanup(Controls(post=True, threshold=4, max_area=1))
def post4_a9(): return ChromaCleanup(Controls(post=True, threshold=4, max_area=9))
def post4_a25(): return ChromaCleanup(Controls(post=True, threshold=4, max_area=25))

# Local-MAD-only residual model, with a numerical floor in linear units.
def local2_a1(): return ChromaCleanup(Controls(post=True, local_noise=True, threshold=2, max_area=1))
def local2_a9(): return ChromaCleanup(Controls(post=True, local_noise=True, threshold=2, max_area=9))
def local2_a25(): return ChromaCleanup(Controls(post=True, local_noise=True, threshold=2, max_area=25))
def local3_a1(): return ChromaCleanup(Controls(post=True, local_noise=True, threshold=3, max_area=1))
def local3_a9(): return ChromaCleanup(Controls(post=True, local_noise=True, threshold=3, max_area=9))
def local3_a25(): return ChromaCleanup(Controls(post=True, local_noise=True, threshold=3, max_area=25))
def local4_a1(): return ChromaCleanup(Controls(post=True, local_noise=True, threshold=4, max_area=1))
def local4_a9(): return ChromaCleanup(Controls(post=True, local_noise=True, threshold=4, max_area=9))
def local4_a25(): return ChromaCleanup(Controls(post=True, local_noise=True, threshold=4, max_area=25))

# Wider colour blobs: full 9x9 statistics and outer support ring 4..6px.
def wide_pre2(): return ChromaCleanup(Controls(post=False, local_noise=False, radius=4, threshold=2, max_area=25))
def wide_pre2_a81(): return ChromaCleanup(Controls(post=False, local_noise=False, radius=4, threshold=2, max_area=81))
def wide_pre3(): return ChromaCleanup(Controls(post=False, local_noise=False, radius=4, threshold=3, max_area=25))
def wide_pre3_a81(): return ChromaCleanup(Controls(post=False, local_noise=False, radius=4, threshold=3, max_area=81))
def wide_post2(): return ChromaCleanup(Controls(post=True, local_noise=True, radius=4, threshold=2, max_area=25))
def wide_post2_a81(): return ChromaCleanup(Controls(post=True, local_noise=True, radius=4, threshold=2, max_area=81))
def wide_post3(): return ChromaCleanup(Controls(post=True, local_noise=True, radius=4, threshold=3, max_area=25))
def wide_post3_a81(): return ChromaCleanup(Controls(post=True, local_noise=True, radius=4, threshold=3, max_area=81))

def wide_unguarded(): return ChromaCleanup(Controls(post=True, local_noise=True, radius=4))
