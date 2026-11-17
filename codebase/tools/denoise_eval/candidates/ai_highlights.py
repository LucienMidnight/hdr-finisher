"""Research only: original-sensor RawNIND plus normal highlight reconstruction."""
from __future__ import annotations

from dataclasses import dataclass
from types import SimpleNamespace
import time

import cv2
import numpy as np

from hdr_finisher import raw_import, signed_raw
from hdr_finisher.highlight_edge_colour import reconstruct_edge_colour
from hdr_finisher.models import RawImportSettings, RawHighlightReconstructionSettings
from .rawnind import RawNIND


def settings(method='opposed_color_v1', expand=1.):
    return RawImportSettings(highlight_reconstruction=RawHighlightReconstructionSettings(
        enabled=True, method=method, clipping_threshold=1., edge_colour_expand_percent=expand))


def camera_develop(sensor, metadata, matrix):
    camera = signed_raw.demosaic(sensor, metadata.raw_channel_to_rgb[metadata.raw_pattern],
                                metadata.raw_black_level[metadata.raw_pattern], matrix)
    return raw_import._normalize_camera_rgb_float32(camera, metadata)


def to_scene(camera, metadata):
    return raw_import._camera_rgb_to_acescg_float32(camera, metadata)


def model_sensor(sensor, metadata, global_white):
    output = np.empty(sensor.shape, np.float32)
    for phase_row in range(2):
        for phase_column in range(2):
            channel = metadata.raw_pattern[phase_row, phase_column]
            black = metadata.raw_black_level[channel]
            output[phase_row::2, phase_column::2] = (
                sensor[phase_row::2, phase_column::2].astype(np.float32) - black
            ) / np.float32(global_white - black)
    return output


def sensor_clip_ratio(sensor, metadata, threshold=1.):
    normalized = raw_import._normalize_raw_mosaic_float32(sensor, metadata)
    height, width = normalized.shape
    if height % 2 or width % 2:
        raise ValueError('Even Bayer dimensions required')
    maximum = normalized.reshape(height // 2, 2, width // 2, 2).max(axis=(1, 3))
    return maximum.repeat(2, axis=0).repeat(2, axis=1) / np.float32(
        threshold * raw_import.OPPOSED_COLOR_THRESHOLD_SAFETY)


def protect_weight(clip_ratio, *, feather=32, changed=None, demosaic_radius=8):
    if not np.isfinite(clip_ratio).all() or feather <= 0 or demosaic_radius < 0:
        raise ValueError('Finite clip ratios and positive feather required')
    protected = clip_ratio >= .92
    if changed is not None:
        if changed.shape != protected.shape:
            raise ValueError('Reconstruction support shape mismatch')
        protected |= changed
    if not np.any(protected):
        return np.zeros(clip_ratio.shape, np.float32)
    if demosaic_radius:
        size = 2 * demosaic_radius + 1
        protected = cv2.dilate(protected.astype(np.uint8), np.ones((size, size), np.uint8)) > 0
    distance = cv2.distanceTransform((~protected).astype(np.uint8), cv2.DIST_L2, cv2.DIST_MASK_PRECISE)
    fraction = np.clip(distance / np.float32(feather), 0, 1)
    return (1 - fraction * fraction * (3 - 2 * fraction)).astype(np.float32)


def region_blend(neural, normal, weight, *, strength=1.):
    if not 0 <= strength <= 1 or neural.shape != normal.shape or weight.shape != normal.shape[:2]:
        raise ValueError('Compatible RGB arrays, mask and strength required')
    if (not np.isfinite(neural).all() or not np.isfinite(normal).all()
            or not np.isfinite(weight).all() or np.any(weight < 0) or np.any(weight > 1)):
        raise ValueError('Finite images and weights in [0,1] required')
    amount = np.float32(strength) * (1 - weight[..., None])
    result = normal + amount * (neural - normal)
    result = np.where(amount == 0, normal, result)
    result = np.where(amount == 1, neural, result)
    return result.astype(np.float32)


def reconstruction_support(normal, off, *, tolerance=1e-6):
    if normal.shape != off.shape or tolerance <= 0:
        raise ValueError('Compatible RGB and positive numerical support threshold required')
    return np.max(np.abs(normal - off), axis=-1) > tolerance


@dataclass
class Combined:
    image: np.ndarray
    weight: np.ndarray
    gain: float
    diagnostics: dict


def combine(sensor, metadata, matrix, global_white, *, method='opposed_color_v1',
            expand=1., feather=32, strength=1., model=None):
    started = time.perf_counter()
    original_camera = camera_develop(sensor, metadata, matrix)
    anchor = float(original_camera.mean(dtype=np.float64))
    off = to_scene(original_camera, metadata)
    repaired = sensor.copy()
    reconstruction = raw_import._apply_raw_highlight_reconstruction(
        SimpleNamespace(raw_image_visible=repaired), metadata, settings(method, expand))
    camera = camera_develop(repaired, metadata, matrix)
    ratio = np.max(camera, axis=-1) / np.float32(raw_import.OPPOSED_COLOR_THRESHOLD_SAFETY)
    normal = to_scene(camera, metadata)
    edge = None
    if method == 'edge_colour_v1':
        normal, edge = reconstruct_edge_colour(normal, ratio, expand)
    model = model or RawNIND('bayer')
    model_metadata = dict(cfa=metadata.raw_channel_to_rgb[metadata.raw_pattern].tolist(),
                          white_balance=metadata.as_shot_wb.tolist(),
                          camera_to_acescg=metadata.camera_to_acescg.tolist(), exposure_stops=0.)
    neural = model.prepare(model_sensor(sensor, metadata, global_white), model_metadata,
                           camera_anchor_mean=anchor)
    clip_ratio = sensor_clip_ratio(sensor, metadata)
    changed = reconstruction_support(normal, off)
    weight = protect_weight(clip_ratio, feather=feather, changed=changed)
    return Combined(region_blend(neural.denoised, normal, weight, strength=strength), weight,
                    neural.gain, dict(reconstruction=reconstruction, edge=edge,
                    model=model.state_description(neural), seconds=time.perf_counter()-started,
                    anchor_domain='original, signed, unrepaired unity-WB AHD camera RGB',
                    protected_fraction=float(np.mean(weight == 1)),
                    fully_neural_fraction=float(np.mean(weight == 0))))
