"""Own GPL-3 research: observable variance fitting and pre-AHD dark outliers.

No app imports this module. A sensor's ISO/black/white metadata alone does not
specify conversion gain or read noise; empirical fits remain provisional.
"""
from __future__ import annotations

from dataclasses import replace
from statistics import NormalDist

import numpy as np
import cv2

from hdr_finisher import denoise_adaptive as adaptive
from tools.denoise_eval.candidates.denoise_v2_appdefault import AppDefault
from tools.denoise_eval.inputs import develop, flat_observations, fit_observations


def variance_observations(source, windows):
    measurements = []
    for top, left, bottom, right in windows:
        luminance = source[top:bottom, left:right, :3] @ adaptive.ACESCG_LUMINANCE
        smooth = adaptive._conv3(luminance, np.full((3, 3), 1 / 9, 'float32'))
        response = adaptive._conv3(luminance, adaptive._IMMERKAER)
        gradient = np.hypot(adaptive._conv3(smooth, adaptive._SOBEL_X),
                            adaptive._conv3(smooth, adaptive._SOBEL_X.T))
        measurements.append((smooth.ravel(), response.ravel(), gradient.ravel()))
    brightness, residual, gradient = (np.concatenate(parts) for parts in zip(*measurements))
    selected = brightness > 0
    brightness, residual, gradient = (values[selected] for values in (brightness, residual, gradient))
    if brightness.size < 1000:
        return []
    boundaries = np.quantile(brightness, np.linspace(.02, .98, 13))
    calibration = NormalDist().inv_cdf(.625) * 6
    observations = []
    for low, high in zip(boundaries[:-1], boundaries[1:]):
        selected = (brightness >= low) & (brightness < high)
        if selected.sum() < 500:
            continue
        flat = selected & (gradient <= np.quantile(gradient[selected], .3))
        deviation = float(np.quantile(abs(residual[flat]), .25) / calibration)
        observations.append(dict(signal=float(np.median(brightness[flat])), variance=deviation**2,
                                 pixels=int(flat.sum()), zero_fraction=float(np.mean(residual[flat] == 0))))
    return observations


def constrained_shape(observations, *, quadratic=True):
    """Fit relative-error Poisson/Gaussian terms after removing censored bins.

    Zero 25th-percentile residuals cannot identify sensor variance. Keep the
    procedure's positive observations, not just nonzero individual residuals.
    Rescale both axes before NNLS to avoid tiny sensor-unit column conditioning.
    """
    informative = [row for row in observations if row['variance'] > 0 and row['zero_fraction'] < .25]
    if not informative:
        return None
    signal = np.array([row['signal'] for row in informative], float)
    variance = np.array([row['variance'] for row in informative], float)
    weights = np.sqrt([row['pixels'] for row in informative])
    signal_scale, variance_scale = max(float(signal.max()), 1e-20), float(np.median(variance))
    signal, variance = signal / signal_scale, variance / variance_scale
    weights /= np.maximum(variance, .02)
    choices = []
    columns = dict(c=signal**2, a=signal, b=np.ones_like(signal))
    subsets = ('c', 'a', 'b', 'ca', 'cb', 'ab', 'cab') if quadratic else ('a', 'b', 'ab')
    for names in subsets:
        design = np.column_stack([columns[name] for name in names])
        coefficients = np.linalg.lstsq(design * weights[:, None], variance * weights, rcond=None)[0]
        if np.any(coefficients < 0):
            continue
        choices.append((float(np.sum(((design @ coefficients - variance) * weights)**2)),
                        dict(zip(names, coefficients))))
    terms = min(choices, key=lambda candidate: candidate[0])[1]
    return (float(terms.get('a', 0) * variance_scale / signal_scale),
            float(max(terms.get('b', 0) * variance_scale, min(row['variance'] for row in informative) * .02)),
            float(terms.get('c', 0) * variance_scale / signal_scale**2))


def calibrate_shape(source, shape, windows):
    """Remeasure the existing band factors and tail correction, with new shape."""
    height, width = source.shape[:2]
    model = adaptive.AdaptiveNoiseModel(*shape, ((0.,) * adaptive.LEVELS,) * 3)
    luminance_blocks, fine, coarse = [], [[], [], []], [[], [], []]
    for top, left, bottom, right in windows:
        rgb = source[top:bottom, left:right, :3]
        edges = adaptive._Edges(top == 0, bottom == height, left == 0, right == width, height, width)
        sigma = np.sqrt(adaptive._noise_variance(rgb @ adaptive.ACESCG_LUMINANCE, model, edges))[..., None]
        opponent = rgb @ adaptive.OPPONENT.T
        smooth = adaptive._atrous(opponent, 0, edges)
        band0 = (opponent - smooth) / sigma
        band1 = (smooth - adaptive._atrous(smooth, 1, edges)) / sigma
        luminance_blocks.append(adaptive._block_stds(band0[..., 0]))
        for component in range(3):
            fine[component].append(adaptive._block_stds(band0[..., component]))
            coarse[component].append(adaptive._block_stds(band1[..., component]))
    luminance_blocks = np.concatenate(luminance_blocks)
    flat = luminance_blocks <= np.quantile(luminance_blocks, adaptive.FLAT_BLOCK_QUANTILE)
    calibration = adaptive._quantile_calibration(.1)
    rows = []
    for component in range(3):
        sigma0 = float(np.quantile(np.concatenate(fine[component])[flat], .1) * calibration)
        sigma1 = float(np.quantile(np.concatenate(coarse[component])[flat], .1) * calibration)
        ratio = float(np.clip(sigma1 / max(sigma0, 1e-12), *adaptive.BAND_RATIO_RANGE))
        decay = float(np.clip(ratio, *adaptive.COARSE_DECAY_RANGE))
        rows.append(tuple([sigma0] + [sigma0 * ratio * decay ** (level - 1) for level in range(1, adaptive.LEVELS)]))
    model = replace(model, band_sigmas=tuple(rows))
    limits, reference = adaptive._tail_reference()
    tails, fraction = adaptive._energy_tails(source, windows, model, limits)
    confidence = adaptive._tail_confidence(fraction)
    rows = []
    for component, row in enumerate(model.band_sigmas):
        factors = []
        for level in (0, 1):
            measured = tails[component][level] / reference[component][level]
            measured = float(np.clip(measured, *adaptive.TAIL_FACTOR_RANGE)) if np.isfinite(measured) else 1.
            factors.append(1 + confidence * (measured - 1))
        rows.append(tuple(float(sigma * np.sqrt(factors[level])) if level < 2 else sigma
                          for level, sigma in enumerate(row)))
    return replace(model, band_sigmas=tuple(rows))


def prepare_model(source, *, quadratic=True):
    windows = adaptive._sample_tiles(*source.shape[:2])
    observations = variance_observations(source, windows)
    shape = constrained_shape(observations, quadratic=quadratic)
    if shape is None:
        return adaptive._estimate(source), dict(observations=observations, fallback='no informative variance bins')
    return calibrate_shape(source, shape, windows), dict(observations=observations, variance_shape=list(shape), fallback=None)


class RobustModel(AppDefault):
    def __init__(self, quadratic=True):
        super().__init__()
        self.quadratic = quadratic

    def prepare(self, image, metadata):
        return prepare_model(image, quadratic=self.quadratic)

    def process(self, image, metadata, state, *, bypass=False):
        return super().process(image, metadata, state[0], bypass=bypass)

    def state_description(self, state):
        return dict(model=state[0].as_dict(), **state[1])

    def description(self):
        return dict(**super().description(), research='censor-zero-bins, scaled NNLS; same band/tail calibration',
                    variance_model='c*Y*Y+a*Y+b' if self.quadratic else 'a*Y+b')


def sensor_parameters(mosaic, metadata):
    supplied = metadata.get('noise_parameters') or metadata.get('noise_fit_positions')
    if supplied and len(supplied) == 4:
        return [dict(a=float(row['a']), b=float(row['b'])) for row in supplied]
    result = []
    for row, column in ((0, 0), (0, 1), (1, 0), (1, 1)):
        observations = flat_observations(mosaic[row::2, column::2])
        if len(observations) < 2:
            raise ValueError('Insufficient RAW flat samples; no sensor noise profile is guessed')
        fit = fit_observations(observations)
        result.append(dict(a=fit['a'], b=fit['b']))
    return result


def repair_sensor(mosaic, parameters, threshold=2.5):
    """Dark-only isolated outlier repair in four separate CFA-position planes.

    Positive points and supported lines are untouched. This deliberately does
    not claim to distinguish a true dark dot from an isolated sensor outlier.
    """
    result = np.asarray(mosaic, dtype='float32').copy()
    count = 0
    for index, (row, column) in enumerate(((0, 0), (0, 1), (1, 0), (1, 1))):
        plane = np.ascontiguousarray(mosaic[row::2, column::2], dtype='float32')
        median = cv2.medianBlur(plane, 5)
        sigma = np.sqrt(np.maximum(parameters[index]['a'] * np.maximum(median, 0) + parameters[index]['b'], 0))
        difference = median - plane
        candidate = (difference > threshold * sigma) & (difference > 0)
        padded = np.pad(plane, 1, mode='reflect')
        height, width = plane.shape
        supported = np.zeros(plane.shape, bool)
        for vertical, horizontal in ((0, 1), (1, 0), (1, 1), (1, -1)):
            first = padded[1+vertical:1+vertical+height, 1+horizontal:1+horizontal+width]
            second = padded[1-vertical:1-vertical+height, 1-horizontal:1-horizontal+width]
            supported |= (first <= plane + sigma) | (second <= plane + sigma)
        candidate &= ~supported
        candidate[:2] = candidate[-2:] = False
        candidate[:, :2] = candidate[:, -2:] = False
        result[row::2, column::2][candidate] = median[candidate]
        count += int(candidate.sum())
    return result, count


class RawSpecks(AppDefault):
    input_kind = 'bayer'
    margin = 80
    supports_alpha = False

    def __init__(self, corrected=False):
        super().__init__()
        self.corrected = corrected

    def prepare(self, image, metadata):
        parameters = sensor_parameters(image, metadata)
        repaired, count = repair_sensor(image, parameters)
        rgb = develop(repaired, metadata)
        model, details = prepare_model(rgb) if self.corrected else (adaptive.estimate_adaptive_model(rgb, workers=1), {})
        return dict(rgb=rgb, model=model, parameters=parameters, repaired_pixels=count, details=details,
                    origin=metadata.get('tile_origin', [0, 0]))

    def process(self, image, metadata, state, *, bypass=False):
        if bypass:
            return develop(image, metadata)
        output = adaptive.resolve_adaptive(state['rgb'], state['model'], self.controls)
        top, left = metadata.get('tile_origin', [0, 0])
        base_top, base_left = state['origin']
        return output[top-base_top:top-base_top+image.shape[0], left-base_left:left-base_left+image.shape[1]].copy()

    def state_description(self, state):
        return dict(model=state['model'].as_dict(), sensor_parameters=state['parameters'],
                    repaired_pixels=state['repaired_pixels'], **state['details'])

    def description(self):
        return dict(**super().description(),
                    research='dark-only 2.5-sigma per-CFA isolated repair before AHD', corrected_model=self.corrected,
                    seam_limitation='cached whole-frame slicing only; independent raw/AHD tile preparation not qualified')


def factory():
    return RobustModel()


def raw():
    return RawSpecks()


def raw_corrected():
    return RawSpecks(corrected=True)


def poisson_gaussian():
    return RobustModel(quadratic=False)
