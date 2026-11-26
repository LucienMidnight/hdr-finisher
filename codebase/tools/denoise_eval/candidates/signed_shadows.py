"""Research-only signed, unpacked AHD and a deliberately qualified pedestal trial.

The AHD stages follow the repository's GPL GPU implementation, itself based on
LibRaw AHD. Integer-scale arithmetic is retained to isolate signed range from
an unrelated interpolation change. Signed Lab extends the existing linear toe.
"""
from __future__ import annotations

import ctypes
from dataclasses import dataclass
import hashlib
import io
import os
from pathlib import Path
from types import SimpleNamespace

import numpy as np

from tools.denoise_eval.candidates.native_build import build_shared
import rawpy
import tifffile

from hdr_finisher.raw_import import _camera_rgb_to_acescg_float32
from tools.denoise_eval.inputs import unsigned_ahd_control
from tools.denoise_eval.candidates.denoise_v2_appdefault import AppDefault

ROOT = Path(__file__).resolve().parents[3]
BUILD = ROOT / 'output/denoise-v1/signed-shadows/build'
_LIBRARY = None


def library():
    global _LIBRARY
    if _LIBRARY is None:
        source = Path(__file__).with_name('signed_ahd.c')
        digest = hashlib.sha256(source.read_bytes()).hexdigest()[:16]
        BUILD.mkdir(parents=True, exist_ok=True)
        binary = BUILD / (digest + ('.dll' if os.name == 'nt' else '.so'))
        if not binary.exists():
            build_shared(source, binary)
        _LIBRARY = ctypes.CDLL(str(binary))
        pointer = np.ctypeslib.ndpointer(dtype=np.float32, flags='C_CONTIGUOUS')
        integers = np.ctypeslib.ndpointer(dtype=np.int32, flags='C_CONTIGUOUS')
        _LIBRARY.signed_ahd.argtypes = [pointer, ctypes.c_int, ctypes.c_int, integers,
                                      pointer, ctypes.c_int, pointer]
        _LIBRARY.signed_ahd.restype = ctypes.c_int
    return _LIBRARY


def camera_ahd(mosaic, cfa, *, clipped=False, lab_matrix=None, rows=256):
    sensor = np.ascontiguousarray(mosaic, dtype=np.float32)
    pattern = np.ascontiguousarray(cfa, dtype=np.int32)
    if (sensor.ndim != 2 or min(sensor.shape) < 16 or not np.isfinite(sensor).all()
            or np.max(np.abs(sensor)) > 2):
        raise ValueError('Expected a finite, unlifted normalised Bayer mosaic in [-2,2]')
    if pattern.shape != (2, 2) or sorted(pattern.ravel()) != [0, 1, 1, 2]:
        raise ValueError('Expected an RGB Bayer CFA')
    if rows < 16 or rows % 2:
        raise ValueError('Even strip height of at least 16 required')
    matrix = np.ascontiguousarray(np.eye(3) if lab_matrix is None else lab_matrix, dtype=np.float32)
    if matrix.shape != (3, 3) or not np.isfinite(matrix).all():
        raise ValueError('Expected finite AHD camera-to-normalised-XYZ matrix')
    result = np.empty((*sensor.shape, 3), dtype=np.float32)
    height, width = sensor.shape
    for top in range(0, height, rows):
        bottom = min(top + rows, height)
        first, last = max(0, top - 8), min(height, bottom + 8)
        part = np.ascontiguousarray(sensor[first:last])
        output = np.empty((*part.shape, 3), dtype=np.float32)
        if library().signed_ahd(part, part.shape[0], width, pattern, matrix, int(clipped), output):
            raise MemoryError('AHD strip allocation failed')
        result[top:bottom] = output[top - first:bottom - first]
    return result


def to_aces(camera, metadata):
    info = SimpleNamespace(as_shot_wb=np.asarray(metadata['white_balance']),
                           camera_to_acescg=np.asarray(metadata['camera_to_acescg']))
    result = _camera_rgb_to_acescg_float32(camera, info)
    result *= np.float32(2 ** metadata.get('exposure_stops', 0))
    return result


def develop_signed(mosaic, metadata, *, clipped=False):
    return to_aces(camera_ahd(mosaic, metadata['cfa'], clipped=clipped), metadata)


def develop_pedestal(mosaic, metadata, pedestal=0.125):
    image = np.asarray(mosaic, dtype=np.float32)
    if not 0 <= pedestal < 1 or image.min() < -pedestal:
        raise ValueError('Pedestal does not cover the negative sensor range')
    buffer = io.BytesIO()
    identity = tuple(value for index in range(9) for value in (int(index % 4 == 0), 1))
    tags = [(50706, 'B', 4, (1, 4, 0, 0), False), (50707, 'B', 4, (1, 1, 0, 0), False),
            (271, 's', 0, 'DenoiseEval', False), (272, 's', 0, 'Bayer', False),
            (50708, 's', 0, 'DenoiseEval Bayer', False), (33421, 'H', 2, (2, 2), False),
            (33422, 'B', 4, tuple(np.asarray(metadata['cfa']).ravel()), False),
            (50714, 'I', 1, 0, False), (50717, 'I', 1, 65535, False),
            (50721, '2i', 9, identity, False), (50728, '2I', 3, (1, 1, 1, 1, 1, 1), False),
            (50778, 'H', 1, 21, False)]
    shifted = (np.clip(image, -pedestal, 1) + pedestal) / (1 + pedestal)
    tifffile.imwrite(buffer, np.rint(shifted * 65535).astype('uint16'),
                     photometric=32803, metadata=None, extratags=tags)
    buffer.seek(0)
    with rawpy.imread(buffer) as raw:
        camera = unsigned_ahd_control(raw, rawpy).astype('float32')
    camera *= np.float32((1 + pedestal) / 65535)
    camera -= np.float32(pedestal)
    return to_aces(camera, metadata)


@dataclass
class Prepared:
    rgb: np.ndarray
    model: object


class SignedShadows:
    input_kind = 'bayer'
    margin = 74
    supports_alpha = False
    supports_bypass = False

    def __init__(self, denoise=False):
        self.denoise = denoise
        self.current = AppDefault()

    def prepare(self, image, metadata):
        rgb = develop_signed(image, metadata)
        return Prepared(rgb, self.current.prepare(rgb, metadata) if self.denoise else None)

    def process(self, image, metadata, state, *, bypass=False):
        if bypass:
            raise ValueError('RAW development bypass must be selected upstream')
        return self.current.process(state.rgb, metadata, state.model) if self.denoise else state.rgb.copy()

    def description(self):
        return dict(algorithm='signed-unpacked-ahd-research', input_kind='bayer',
                    denoise=self.current.description() if self.denoise else None,
                    lab='identity temporary-DNG camera; linear Lab toe continued below zero',
                    qualification='Not production integration or measured CPU/GPU parity')


def alone():
    return SignedShadows()


def with_denoise():
    return SignedShadows(True)
