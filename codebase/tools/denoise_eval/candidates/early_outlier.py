"""Research-only noise-envelope clamping before Denoise, never app imported."""
from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from tools.denoise_eval.candidates.dark_noise import factory as calibrated
from tools.denoise_eval.candidates.demosaic_noise import validate
from tools.denoise_eval.candidates.pixel_cleanup import noise_positions
from tools.denoise_eval.candidates.signed_shadows import camera_ahd, to_aces


@dataclass(frozen=True)
class Controls:
    strength: float = .75
    threshold: float = 2.5
    envelope: float = 1.5
    max_area: int = 5
    support: bool = True

    def __post_init__(self):
        if (not 0 <= self.strength <= 1 or not 0 < self.envelope < self.threshold
                or not np.isfinite(self.threshold) or not isinstance(self.max_area, int)
                or not 1 <= self.max_area <= 25):
            raise ValueError('Invalid early-outlier research controls')


def tame_plane(plane, shot, read, controls=Controls(), *, correlated=False):
    source = np.asarray(plane, dtype=np.float32)
    if (source.ndim != 2 or min(source.shape) < 9 or not np.isfinite(source).all()
            or not np.isfinite([shot, read]).all() or min(shot, read) < 0 or shot + read <= 0):
        raise ValueError('Expected finite plane and positive calibrated noise variance')
    if controls.strength == 0:
        return source.copy(), dict(changed=0, candidates=0, supported=0, oversized=0)
    centre = cv2.medianBlur(source, 5)
    deviation = cv2.medianBlur(np.abs(source - centre), 5) * np.float32(1.4826)
    sigma = np.maximum(np.sqrt(shot * np.maximum(centre, 0) + read), deviation)
    sigma = np.maximum(sigma, 1e-12)
    residual = source - centre
    distance = np.abs(residual) / sigma
    candidates = distance > controls.threshold
    clipped_support = cv2.dilate((source >= 1).astype('uint8'), np.ones((5, 5), 'uint8')).astype(bool)
    candidates &= ~clipped_support
    candidates[:4] = candidates[-4:] = False
    candidates[:, :4] = candidates[:, -4:] = False
    support_count = np.zeros(source.shape, np.uint8)
    radius = 3 if correlated else 2
    if controls.support:
        padded = np.pad(source, radius, mode='reflect')
        height, width = source.shape
        for row in range(-radius, radius + 1):
            for column in range(-radius, radius + 1):
                separation = max(abs(row), abs(column))
                if separation == 0 or (correlated and separation < 2):
                    continue
                neighbour = padded[radius+row:radius+row+height, radius+column:radius+column+width]
                support_count += np.abs(neighbour - source) <= sigma
    supported = candidates & (support_count >= 2)
    eligible = candidates & ~supported
    oversized = np.zeros(source.shape, bool)
    for polarity in (residual > 0, residual < 0):
        count, labels, stats, _ = cv2.connectedComponentsWithStats(
            (candidates & polarity).astype('uint8'), connectivity=8)
        rejected = np.zeros(count, bool)
        rejected[1:] = stats[1:, cv2.CC_STAT_AREA] > controls.max_area
        oversized |= rejected[labels]
    eligible &= ~oversized
    ramp = np.clip((distance - controls.threshold) / (controls.threshold - controls.envelope), 0, 1)
    ramp = ramp * ramp * (3 - 2 * ramp)
    correction = np.sign(residual) * np.maximum(np.abs(residual) - controls.envelope * sigma, 0)
    result = source - np.where(eligible, controls.strength * ramp * correction, 0)
    return result.astype('float32'), dict(changed=int(np.count_nonzero(result != source)),
        candidates=int(candidates.sum()), supported=int(supported.sum()), oversized=int(oversized.sum()))


def develop(mosaic, metadata, stage='raw', controls=Controls()):
    sensor, pattern = validate(mosaic, metadata['cfa'])
    parameters = noise_positions(metadata)
    if parameters is None:
        raise ValueError('Early outlier taming requires four sensor noise fits')
    if any(value % 2 for value in metadata.get('tile_origin', (0, 0))):
        raise ValueError('Even sensor origin required')
    if stage not in ('raw', 'rgb', 'raw_rgb'):
        raise ValueError('Choose raw, rgb or raw_rgb stage')
    diagnostics = []
    if stage in ('raw', 'raw_rgb'):
        sensor = sensor.copy()
        for phase, (shot, read) in enumerate(parameters):
            row, column = divmod(phase, 2)
            sensor[row::2, column::2], counts = tame_plane(sensor[row::2, column::2], shot, read, controls)
            diagnostics.append(counts)
    camera = camera_ahd(sensor, pattern)
    if stage in ('rgb', 'raw_rgb'):
        for component in range(3):
            shot, read = parameters[pattern.ravel() == component].mean(axis=0)
            camera[..., component], counts = tame_plane(camera[..., component], shot, read,
                                                         controls, correlated=True)
            diagnostics.append(counts)
    return to_aces(camera, metadata), diagnostics


class EarlyOutlier:
    input_kind = 'bayer'
    margin = 90
    supports_alpha = False
    supports_bypass = False

    def __init__(self, stage='raw', controls=Controls()):
        self.stage, self.controls = stage, controls
        self.denoise = calibrated()

    def prepare(self, image, metadata):
        rgb, diagnostics = develop(image, metadata, self.stage, self.controls)
        return rgb, self.denoise.prepare(rgb, metadata), diagnostics

    def process(self, image, metadata, state, *, bypass=False):
        if bypass:
            raise ValueError('Select signed Off upstream for a Bayer bypass')
        return self.denoise.process(state[0], metadata, state[1])

    def description(self):
        from dataclasses import asdict
        return dict(algorithm='early-outlier-soft-envelope-research', stage=self.stage,
                    controls=asdict(self.controls), denoise=self.denoise.description())


def raw_support():
    return EarlyOutlier()


def raw_unprotected():
    return EarlyOutlier(controls=Controls(support=False))


def rgb_support():
    return EarlyOutlier('rgb')


def rgb_unprotected():
    return EarlyOutlier('rgb', Controls(support=False))


def raw_stronger():
    return EarlyOutlier(controls=Controls(threshold=1.75, envelope=1., support=False))


def raw_four_single():
    return EarlyOutlier(controls=Controls(threshold=4., envelope=2.5, max_area=1))


def raw_four_double():
    return EarlyOutlier(controls=Controls(threshold=4., envelope=2.5, max_area=2))


def raw_rgb_support():
    return EarlyOutlier('raw_rgb')
