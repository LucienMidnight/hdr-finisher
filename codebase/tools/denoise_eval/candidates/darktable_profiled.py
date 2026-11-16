"""Camera-linear profiled wavelet reference, not a shipping darktable module.

Ported maths: darktable src/iop/denoiseprofile.c and src/common/eaw.c,
b407398a1b9d03d552f59d7227bd3eff66045495 (generalised Anscombe/RGB mode).
Copyright (C) 2012-2026 darktable developers.
EAW helper copyright (C) 2017-2024 darktable developers.
This file is free software under GNU GPL version 3 or (at your option) later.
Distributed WITHOUT ANY WARRANTY, including MERCHANTABILITY or FITNESS FOR
A PARTICULAR PURPOSE. See the repository LICENSE for the GNU GPL text.

Upstream's b is read standard deviation; this adapter accepts read variance.
Changes: sampled frame-global Bayes thresholds, exact exp2 rather than the
fast approximation, per-CFA fits averaged by colour, no profile database.
The eaw.c boundary is nearest/clamped, NOT reflect. The seven-scale cap and
25-tap weights come from the pinned source. AHD correlation is not calibrated.
"""
from __future__ import annotations

import numpy as np
from tools.denoise_eval.adapters import DenoiseV2


def vst(image, shot, read_variance):
    shot = np.maximum(np.asarray(shot, dtype=np.float32), np.float32(1e-12))
    return 2 * np.sqrt(np.maximum(image / shot + read_variance / shot**2 + .375, 0))


def inverse_vst(value, shot, read_variance, *, unbiased=True):
    safe = np.maximum(value, .5)
    correction = (.25 * np.sqrt(1.5) / safe - 1.375 / safe**2
                  + .625 * np.sqrt(1.5) / safe**3) if unbiased else 0
    offset = .125 if unbiased else .375
    result = shot * (.25 * value**2 + correction - read_variance / shot**2 - offset)
    return np.where(value < .5, 0, result).astype(np.float32)


def active_scales(shape):
    support = min(257, max(shape[:2]) * .2)
    if support <= 5:
        return 1
    index = np.log2((support - 1) * .5)
    return max(1, min(7, int(np.ceil(index - .5))))


def decompose(image, scale):
    stride = 2**scale
    padded = np.pad(image, ((2*stride, 2*stride), (2*stride, 2*stride), (0, 0)), mode='edge')
    total = np.zeros_like(image)
    weights = np.zeros(image.shape[:2], dtype=np.float32)
    kernel = (1, 4, 6, 4, 1)
    noise_variance = (70/256)**scale
    height, width = image.shape[:2]
    for row in range(5):
        for column in range(5):
            neighbour = padded[row*stride:row*stride+height, column*stride:column*stride+width]
            distance = np.sum((image-neighbour)**2, axis=-1)
            weight = np.exp2(-np.maximum(.02*distance/noise_variance-9, 0))
            weight *= kernel[row]*kernel[column]/256
            total += weight[..., None]*neighbour
            weights += weight
    coarse = total / weights[..., None]
    return coarse, image-coarse


class DarktableProfiled:
    input_kind = 'rgb'
    supports_alpha = True
    supports_bypass = True

    def __init__(self, strength=1., tile_size=512):
        if not 0 <= strength <= 1:
            raise ValueError('strength must be within 0..1')
        self.strength = strength
        self.tile_size = tile_size
        self.margin = 254

    def description(self):
        return dict(algorithm='darktable-profiled-generalised-anscombe-eaw',
                    source_commit='b407398a1b9d03d552f59d7227bd3eff66045495',
                    input_kind=self.input_kind, strength=self.strength,
                    threshold_fit='nine bounded frame-global windows',
                    ahd_correlation='not empirically corrected', boundary='nearest')

    def _camera(self, image, state):
        return (image[..., :3] / state['lift']) @ state['inverse_matrix'].T

    def prepare(self, image, metadata):
        parameters = metadata.get('noise_parameters') or metadata.get('noise_fit_positions')
        if not parameters or not metadata.get('camera_to_acescg'):
            return {'fallback': DenoiseV2().prepare(image, metadata)}
        if any(parameter is None for parameter in parameters):
            raise ValueError('Camera profile is incomplete')
        cfa = np.asarray(metadata['cfa']).ravel()
        shot = np.array([np.mean([p['a'] for p, colour in zip(parameters, cfa) if colour == channel])
                         for channel in range(3)], dtype=np.float32)
        read = np.array([np.mean([p['b'] for p, colour in zip(parameters, cfa) if colour == channel])
                         for channel in range(3)], dtype=np.float32)
        wb = np.asarray(metadata['white_balance'], dtype=np.float32)
        scales = active_scales(metadata.get('frame_shape', image.shape))
        self.margin = 2*(2**scales-1)
        state = dict(shot=np.maximum(shot*wb, 1e-12), read=read*wb**2,
                     matrix=np.asarray(metadata['camera_to_acescg'], dtype=np.float32),
                     lift=np.float32(2**metadata.get('exposure_stops', 0)), scales=scales)
        state['inverse_matrix'] = np.linalg.inv(state['matrix']).astype(np.float32)
        sums = np.zeros((scales, 3), dtype=np.float64)
        counts = np.zeros(scales, dtype=np.int64)
        height, width = image.shape[:2]
        size = min(256, height, width)
        positions = {(int(row), int(column)) for row in np.linspace(0, height-size, 3)
                     for column in np.linspace(0, width-size, 3)}
        for row, column in sorted(positions):
            value = vst(self._camera(image[row:row+size, column:column+size], state), state['shot'], state['read'])
            for scale in range(scales):
                value, detail = decompose(value, scale)
                sums[scale] += np.sum(detail.astype(np.float64)**2, axis=(0, 1))
                counts[scale] += detail.shape[0]*detail.shape[1]
        variance = sums / np.maximum(counts[:, None]-1, 1)
        noise = (70/256)**np.arange(scales)
        state['thresholds'] = (8*noise[:, None] / np.sqrt(np.maximum(1e-6, variance-noise[:, None]))).astype(np.float32)
        return state

    def _process_tile(self, image, state):
        camera = self._camera(image, state)
        transformed = vst(camera, state['shot'], state['read'])
        current = transformed
        accumulated = np.zeros_like(current)
        for scale, threshold in enumerate(state['thresholds']):
            current, detail = decompose(current, scale)
            accumulated += np.maximum(detail-threshold, 0) + np.minimum(detail+threshold, 0)
        corrected = inverse_vst(current+accumulated, state['shot'], state['read'])
        corrected[camera < 0] = camera[camera < 0]
        value = image.copy()
        value[..., :3] += np.float32(self.strength)*((corrected @ state['matrix'].T)*state['lift']-image[..., :3])
        return value

    def process(self, image, metadata, state, *, bypass=False):
        if bypass or self.strength == 0 or state is None:
            return image.copy()
        if 'fallback' in state:
            return DenoiseV2().process(image, metadata, state['fallback'])
        height, width = image.shape[:2]
        if max(height, width) <= self.tile_size+2*self.margin:
            return self._process_tile(image, state)
        result = np.empty_like(image)
        for row in range(0, height, self.tile_size):
            for column in range(0, width, self.tile_size):
                bottom, right = min(height, row+self.tile_size), min(width, column+self.tile_size)
                top, left = max(0, row-self.margin), max(0, column-self.margin)
                end_y, end_x = min(height, bottom+self.margin), min(width, right+self.margin)
                tile = self._process_tile(image[top:end_y, left:end_x], state)
                result[row:bottom, column:right] = tile[row-top:bottom-top, column-left:right-left]
        return result


def factory():
    return DarktableProfiled()


def half():
    return DarktableProfiled(.5)


def three_quarters():
    return DarktableProfiled(.75)
