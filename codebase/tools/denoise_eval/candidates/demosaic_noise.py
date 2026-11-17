"""Signed sensor-domain demosaic research, never imported by the application.

Independent GPL-3 implementation. The directional trial uses local linear
MMSE estimates of horizontal/vertical colour differences, not RawTherapee's
LMMSE implementation. There is no gamma LUT, pedestal or black clipping.
"""
from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from tools.denoise_eval.candidates.denoise_v2_appdefault import AppDefault
from tools.denoise_eval.candidates.dark_noise import factory as calibrated
from tools.denoise_eval.candidates.pixel_cleanup import noise_positions
from tools.denoise_eval.candidates.signed_shadows import camera_ahd, to_aces


def validate(mosaic, cfa):
    sensor = np.asarray(mosaic, dtype=np.float32)
    pattern = np.asarray(cfa)
    if sensor.ndim != 2 or min(sensor.shape) < 16 or not np.isfinite(sensor).all():
        raise ValueError('Expected finite signed Bayer with both dimensions >=16')
    if pattern.shape != (2, 2) or sorted(pattern.ravel()) != [0, 1, 1, 2]:
        raise ValueError('Expected RGB Bayer CFA')
    return sensor, pattern


def convolve(image, kernel):
    return cv2.filter2D(image, -1, np.asarray(kernel, np.float32), borderType=cv2.BORDER_REFLECT_101)


def interpolate(values, mask):
    kernel = np.outer([1, 2, 1], [1, 2, 1]).astype('float32')
    estimate = convolve(values * mask, kernel) / np.maximum(convolve(mask, kernel), 1e-12)
    return np.where(mask != 0, values, estimate)


def local_mmse(difference, axis):
    smooth_kernel = np.array([1, 4, 6, 4, 1], np.float32) / 16
    kernel = smooth_kernel[None, :] if axis == 1 else smooth_kernel[:, None]
    pilot = convolve(difference, kernel)
    box = np.ones((1, 9) if axis == 1 else (9, 1), np.float32) / 9
    mean = convolve(pilot, box)
    signal = np.maximum(convolve(pilot * pilot, box) - mean * mean, 0) + 1e-12
    noise = convolve((difference - pilot) ** 2, box) + 1e-12
    gain = signal / (signal + noise)
    return gain * difference + (1 - gain) * pilot, signal * noise / (signal + noise)


def camera_linear(mosaic, cfa, method='bilinear'):
    sensor, pattern = validate(mosaic, cfa)
    if method not in ('bilinear', 'lmmse'):
        raise ValueError('Unknown signed demosaic trial')
    sites = np.tile(pattern, ((sensor.shape[0] + 1) // 2, (sensor.shape[1] + 1) // 2))[
        :sensor.shape[0], :sensor.shape[1]]
    masks = [(sites == component).astype('float32') for component in range(3)]
    if method == 'bilinear':
        return np.stack([interpolate(sensor, mask) for mask in masks], -1)
    horizontal_kernel = np.array([[-.25, .5, .5, .5, -.25]], np.float32)
    horizontal = convolve(sensor, horizontal_kernel)
    vertical = convolve(sensor, horizontal_kernel.T)
    green_sites = sites == 1
    horizontal_difference = np.where(green_sites, sensor - horizontal, horizontal - sensor)
    vertical_difference = np.where(green_sites, sensor - vertical, vertical - sensor)
    horizontal_estimate, horizontal_variance = local_mmse(horizontal_difference, 1)
    vertical_estimate, vertical_variance = local_mmse(vertical_difference, 0)
    difference = (horizontal_estimate * vertical_variance + vertical_estimate * horizontal_variance) / (
        horizontal_variance + vertical_variance)
    green = np.where(green_sites, sensor, sensor + difference)
    result = np.empty((*sensor.shape, 3), np.float32)
    result[..., 1] = green
    for component in (0, 2):
        result[..., component] = green + interpolate(sensor - green, masks[component])
        result[..., component][sites == component] = sensor[sites == component]
    return result


def stabilize(plane, shot, read):
    deviation = np.sqrt(max(read, 1e-12))
    if shot <= 1e-12:
        return plane / deviation
    positive = 2 * plane / (np.sqrt(shot * np.maximum(plane, 0) + deviation ** 2) + deviation)
    return np.where(plane >= 0, positive, plane / deviation).astype('float32')


def unstabilize(plane, shot, read):
    deviation = np.sqrt(max(read, 1e-12))
    return (plane * deviation + np.where(plane > 0, shot * plane * plane / 4, 0)).astype('float32')


def raw_smooth(mosaic, metadata, strength=.65):
    sensor, _ = validate(mosaic, metadata['cfa'])
    if not 0 <= strength <= 1:
        raise ValueError('Raw smoothing strength must be in [0,1]')
    parameters = noise_positions(metadata)
    if parameters is None:
        raise ValueError('Raw smoothing requires the four provisional sensor noise fits')
    if strength == 0:
        return sensor.copy()
    result = sensor.copy()
    kernel = np.outer([1, 2, 1], [1, 2, 1]).astype('float32') / 16
    for phase, (shot, read) in enumerate(parameters):
        row_phase, column_phase = divmod(phase, 2)
        plane = stabilize(sensor[row_phase::2, column_phase::2], shot, read)
        smooth = convolve(plane, kernel)
        band = plane - smooth
        energy = cv2.boxFilter(band * band, -1, (5, 5), borderType=cv2.BORDER_REFLECT_101)
        noise_variance = 1 - 2 * kernel[1, 1] + float(np.sum(kernel * kernel))
        gain = np.maximum(1 - strength ** 2 * noise_variance / np.maximum(energy, 1e-12), 0)
        filtered = unstabilize(smooth + gain * band, shot, read)
        result[row_phase::2, column_phase::2] = filtered
    return result


def develop(mosaic, metadata, method='ahd', raw_strength=0, rows=256):
    sensor, pattern = validate(mosaic, metadata['cfa'])
    if raw_strength:
        sensor = raw_smooth(sensor, metadata, raw_strength)
    if method == 'ahd':
        return to_aces(camera_ahd(sensor, pattern, rows=rows), metadata)
    if rows < 16 or rows % 2:
        raise ValueError('Even strip height >=16 required')
    height, width = sensor.shape
    result = np.empty((height, width, 3), np.float32)
    for top in range(0, height, rows):
        bottom = min(top + rows, height)
        first, last = max(0, top - 16), min(height, bottom + 16)
        camera = camera_linear(sensor[first:last], pattern, method)
        result[top:bottom] = to_aces(camera[top-first:bottom-first], metadata)
    return result


@dataclass
class Prepared:
    rgb: np.ndarray
    model: object


class DemosaicNoise:
    input_kind = 'bayer'
    margin = 98
    supports_alpha = False
    supports_bypass = False

    def __init__(self, method='bilinear', raw_strength=0, repair=False):
        self.method = method
        self.raw_strength = raw_strength
        self.repair = repair
        self.current = calibrated() if repair else AppDefault()

    def prepare(self, image, metadata):
        rgb = develop(image, metadata, self.method, self.raw_strength)
        return Prepared(rgb, self.current.prepare(rgb, metadata))

    def process(self, image, metadata, state, *, bypass=False):
        if bypass:
            raise ValueError('RAW development bypass must be selected upstream')
        return self.current.process(state.rgb, metadata, state.model)

    def description(self):
        return dict(algorithm='signed-demosaic-noise-research', input_kind='bayer',
                    demosaic=self.method, raw_strength=self.raw_strength, calibration_repair=self.repair,
                    controls=self.current.description()['controls'],
                    qualification='Independent linear-MMSE-style trial, not upstream LMMSE; no GPU parity')


def bilinear():
    return DemosaicNoise()


def bilinear_fix():
    return DemosaicNoise(repair=True)


def lmmse():
    return DemosaicNoise('lmmse')


def lmmse_fix():
    return DemosaicNoise('lmmse', repair=True)


def raw_ahd():
    return DemosaicNoise('ahd', .65)


def raw_ahd_fix():
    return DemosaicNoise('ahd', .65, True)


def raw_lmmse():
    return DemosaicNoise('lmmse', .65)


def raw_lmmse_fix():
    return DemosaicNoise('lmmse', .65, True)
