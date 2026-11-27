"""Research-only RawTherapee LMMSE, with explicit signed-domain boundary changes.

The pinned upstream algorithm is retained verbatim in vendor/rawtherapee.
The build changes only dependency includes, signed range gates and output floors.
The stock control uses those exact original gates; no app imports this adapter.
"""
from __future__ import annotations

import ctypes
from dataclasses import dataclass
import hashlib
import os
from pathlib import Path

import numpy as np

from tools.denoise_eval.candidates.native_build import build_shared

from hdr_finisher.signed_raw import _library as shipping_ahd_library
from tools.denoise_eval.candidates.dark_noise import factory as calibrated
from tools.denoise_eval.candidates.demosaic_noise import validate
from tools.denoise_eval.candidates.signed_shadows import to_aces

ROOT = Path(__file__).resolve().parents[3]
VENDOR = Path(__file__).with_name('vendor') / 'rawtherapee' / 'lmmse_demosaic.cc'
SHIM = Path(__file__).with_name('lmmse_shim.hpp')
UPSTREAM_COMMIT = '64c2d90a3248c7ad41842d9162368858b61aac6a'
ITERATIONS = 3
HALO = 32
_LIBRARIES = {}


def library(upstream_control=False):
    if upstream_control not in _LIBRARIES:
        source = VENDOR.read_text()
        source = '\n'.join(line for line in source.splitlines() if not line.startswith('#include'))
        replacements = (
            ('gamtab->makeIdentity(65535.f);', 'gamtab->makeIdentity(65535.f); gamtab->signed_domain = signed_domain;'),
            ('std::max(0.f, (*gamtab)[65535.f * rix[0]])', 'output_floor((*gamtab)[65535.f * rix[0]])'),
            ('std::max(0.f, v0)', 'output_floor(v0)'),
        )
        for old, new in (() if upstream_control else replacements):
            if old not in source:
                raise RuntimeError('Pinned upstream boundary not found: ' + old)
            source = source.replace(old, new)
        entry = '''
extern "C"
#ifdef _WIN32
__declspec(dllexport)
#endif
int rt_lmmse(float* sensor, int height, int width, const int* cfa,
                         int iterations, int signed_mode, float* output) {
    try {
        rtengine::RawImageSource image(height, width, cfa, signed_mode != 0);
        rtengine::array2D<float> raw(sensor, width);
        image.lmmse_interpolate_omp(width, height, raw, image.red, image.green, image.blue, iterations);
        for (int row = 0; row < height; ++row) {
            for (int column = 0; column < width; ++column) {
                size_t offset = (size_t(row) * width + column) * 3;
                output[offset] = image.red[row][column];
                output[offset + 1] = image.green[row][column];
                output[offset + 2] = image.blue[row][column];
            }
        }
        return 0;
    } catch (...) { return 1; }
}
'''
        translation = '#include "' + SHIM.as_posix() + '"\n' + source + entry
        digest = hashlib.sha256((translation + SHIM.read_text()).encode()).hexdigest()[:16]
        build = ROOT / 'output/denoise-v1/lmmse-demosaic/build'
        build.mkdir(parents=True, exist_ok=True)
        binary = build / (digest + ('.dll' if os.name == 'nt' else '.so'))
        if not binary.exists():
            unit = build / (digest + '.cc')
            unit.write_text(translation)
            try:
                build_shared(unit, binary, cpp=True)
            finally:
                unit.unlink(missing_ok=True)
        loaded = ctypes.CDLL(str(binary))
        floats = np.ctypeslib.ndpointer(dtype=np.float32, flags='C_CONTIGUOUS')
        integers = np.ctypeslib.ndpointer(dtype=np.int32, flags='C_CONTIGUOUS')
        loaded.rt_lmmse.argtypes = [floats, ctypes.c_int, ctypes.c_int, integers,
                                     ctypes.c_int, ctypes.c_int, floats]
        loaded.rt_lmmse.restype = ctypes.c_int
        _LIBRARIES[upstream_control] = loaded
    return _LIBRARIES[upstream_control]


def camera_lmmse(mosaic, cfa, *, iterations=ITERATIONS, signed=True, rows=256, upstream_control=False):
    sensor, pattern = validate(mosaic, cfa)
    if np.max(np.abs(sensor)) > 2 or not 0 <= iterations <= 8:
        raise ValueError('Expected unlifted sensor in [-2,2] and iterations 0..8')
    if rows is not None and (rows < 16 or rows % 2):
        raise ValueError('Expected even strip height >=16 or None for whole image')
    if iterations > 4 and rows is not None:
        raise ValueError('Optional in-place edge reinforcement requires whole-image mode')
    if upstream_control and signed:
        raise ValueError('The unmodified upstream oracle is unsigned only')
    pattern = np.ascontiguousarray(pattern, dtype=np.int32)
    height, width = sensor.shape
    result = np.empty((height, width, 3), np.float32)
    step = height if rows is None else rows
    for top in range(0, height, step):
        bottom = min(top + step, height)
        first, last = max(0, top - HALO), min(height, bottom + HALO)
        part = np.ascontiguousarray(sensor[first:last] * np.float32(65535))
        output = np.empty((*part.shape, 3), np.float32)
        if library(upstream_control).rt_lmmse(part, part.shape[0], width, pattern, iterations, int(signed), output):
            raise MemoryError('RawTherapee LMMSE allocation failed; no alternate algorithm substituted')
        result[top:bottom] = output[top-first:bottom-first] / np.float32(65535)
    if not np.isfinite(result).all():
        raise FloatingPointError('Nonfinite LMMSE result')
    return result


def develop(mosaic, metadata, *, iterations=ITERATIONS, rows=256):
    return to_aces(camera_lmmse(mosaic, metadata['cfa'], iterations=iterations, rows=rows), metadata)


def develop_ahd(mosaic, metadata, *, rows=256):
    sensor, pattern = validate(mosaic, metadata['cfa'])
    pattern = np.ascontiguousarray(pattern, dtype=np.int32)
    matrix = np.ascontiguousarray(metadata.get('ahd_lab_matrix', np.eye(3)), dtype=np.float32)
    height, width = sensor.shape
    result = np.empty((height, width, 3), np.float32)
    for top in range(0, height, rows):
        bottom = min(top + rows, height)
        first, last = max(0, top - 8), min(height, bottom + 8)
        part = np.ascontiguousarray(sensor[first:last] * np.float32(65535))
        output = np.empty((*part.shape, 3), np.float32)
        if shipping_ahd_library().signed_ahd(part, part.shape[0], width, pattern, matrix, output):
            raise MemoryError('Shipping signed AHD allocation failed')
        result[top:bottom] = output[top-first:bottom-first] / np.float32(65535)
    return to_aces(result, metadata)


@dataclass
class Prepared:
    rgb: np.ndarray
    model: object


class Lmmse:
    input_kind = 'bayer'
    margin = 98
    supports_alpha = False
    supports_bypass = False

    def __init__(self, iterations=ITERATIONS):
        self.iterations = iterations
        self.current = calibrated()

    def prepare(self, image, metadata):
        rgb = develop(image, metadata, iterations=self.iterations)
        return Prepared(rgb, self.current.prepare(rgb, metadata))

    def process(self, image, metadata, state, *, bypass=False):
        if bypass:
            raise ValueError('Select RAW development bypass upstream')
        return self.current.process(state.rgb, metadata, state.model)

    def description(self):
        return dict(algorithm='RawTherapee-LMMSE-signed-research', upstream_commit=UPSTREAM_COMMIT,
                    iterations=self.iterations, gamma='2.4 slope 17; linear toe continued below zero',
                    signed_changes='linear negative LUT toe, analytic above-white gamma, no positivity/unit clamps',
                    calibration_repair=True, controls=self.current.description()['controls'],
                    qualification='CPU research; no production GPU/delivery qualification')


def factory():
    return Lmmse()


def linear():
    return Lmmse(0)


class SignedAhd(Lmmse):
    def __init__(self, denoise=True):
        super().__init__()
        self.denoise = denoise

    def prepare(self, image, metadata):
        rgb = develop_ahd(image, metadata)
        return Prepared(rgb, self.current.prepare(rgb, metadata) if self.denoise else None)

    def process(self, image, metadata, state, *, bypass=False):
        if bypass:
            raise ValueError('Select RAW development bypass upstream')
        return self.current.process(state.rgb, metadata, state.model) if self.denoise else state.rgb.copy()

    def description(self):
        return dict(algorithm='shipping-signed-AHD-core-research-bridge', denoise=self.denoise,
                    calibration_repair=self.denoise, controls=self.current.description()['controls'],
                    qualification='Common normalized sensor, identity temporary-DNG Lab; not whole RAW import')


def ahd():
    return SignedAhd()


def off():
    return SignedAhd(False)
