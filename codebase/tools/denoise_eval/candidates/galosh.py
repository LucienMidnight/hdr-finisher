"""Serial FP32 GALOSH RAW adapter, Apache-2.0 pinned reference in vendor/galosh.

Reference commit 11de0593cc8091933ad76d1d6d873f7dee537f15. Retains LICENSE/NOTICE.
Noise and IRLS dark anchor are fitted once per input; all tiles receive them.
The calibrated reference uses the mean of the four CFA variance models.
RGGB canonicalisation flips axes without shifting/cropping the sensor lattice.
Conservative support: two 8px WHT passes + 2px overlap + 7*8px coarse LOESS
+ two 3*8px reconstruction supports + AHD 16px = 138px; round to 160,
aligned to the eight-pixel coarsest CFA pyramid. Shifted-grid tests qualify it.
"""
from pathlib import Path
import os
import subprocess
import tempfile
import numpy as np
from tools.denoise_eval.inputs import develop
from .build_galosh import BINARY


def canonical(image, metadata):
    pattern = np.asarray(metadata['cfa'])
    if pattern.shape != (2, 2) or sorted(pattern.ravel().tolist()) != [0, 1, 1, 2]:
        raise ValueError('GALOSH needs a 2x2 Bayer CFA')
    red_row, red_column = np.argwhere(pattern == 0)[0]
    return image[::-1 if red_row else 1, ::-1 if red_column else 1]


class Galosh:
    input_kind = 'bayer'
    supports_alpha = False
    supports_bypass = False
    margin = 160

    def __init__(self, strength=1., blind=False, tile_size=768):
        if not 0 <= strength <= 1:
            raise ValueError('strength must be within 0..1')
        self.strength, self.blind, self.tile_size = strength, blind, tile_size

    def description(self):
        return dict(algorithm='GALOSH-RAW-O-FP32-serial', input_kind='bayer',
                    source_commit='11de0593cc8091933ad76d1d6d873f7dee537f15',
                    strength=self.strength, blind=self.blind, sigma='1, globally fixed',
                    noise='global native blind or mean of per-CFA a/read variance',
                    dark_anchor='global native IRLS', tile_size=self.tile_size, margin=self.margin)

    def prepare(self, image, metadata):
        if not BINARY.is_file():
            raise FileNotFoundError('Build offline with python -m tools.denoise_eval.candidates.build_galosh')
        if any(size % 2 for size in image.shape):
            raise ValueError('GALOSH requires even sensor dimensions')
        parameters = metadata.get('noise_parameters') or metadata.get('noise_fit_positions')
        if not self.blind and (not parameters or any(value is None for value in parameters)):
            raise ValueError('Calibrated GALOSH needs all four CFA fits')
        alpha = 0 if self.blind else float(np.mean([value['a'] for value in parameters]))
        read = 0 if self.blind else float(np.mean([value['b'] for value in parameters]))
        with tempfile.TemporaryDirectory(prefix='galosh-fit-', dir=BINARY.parent) as folder:
            path = Path(folder)/'input.bin'
            np.ascontiguousarray(canonical(image, metadata), dtype=np.float32).tofile(path)
            result = subprocess.run([str(BINARY), 'fit', str(path), str(image.shape[1]), str(image.shape[0]), str(alpha), str(read)],
                                    capture_output=True, text=True, check=True, timeout=120)
        values = np.fromstring(result.stdout, sep=' ')
        if values.size != 7 or not np.isfinite(values).all() or values[0] <= 0 or values[1] < 0:
            raise ValueError('Invalid GALOSH photo-global noise fit')
        return dict(alpha=float(values[0]), read=float(values[1]), sigma=float(values[2]), dark=values[3:].tolist())

    def denoise_mosaic(self, image, metadata, state):
        if self.strength == 0:
            return image.copy()
        source = canonical(image, metadata)
        height, width = image.shape
        origin = metadata.get('tile_origin', [0, 0])
        if any(value % 8 for value in origin):
            raise ValueError('GALOSH tile origins must align with its 8px pyramid')
        with tempfile.TemporaryDirectory(prefix='galosh-tile-', dir=BINARY.parent) as folder:
            input_path, output_path = Path(folder)/'in.bin', Path(folder)/'out.bin'
            np.ascontiguousarray(source, dtype=np.float32).tofile(input_path)
            command = [str(BINARY), str(input_path), str(output_path), str(width), str(height), 'galosh',
                       str(self.strength), str(.5*self.strength), str(self.strength),
                       str(state['alpha']), str(state['read']), '--unified-sigma=1']
            environment = {**os.environ, 'OMP_NUM_THREADS':'1',
                           'GALOSH_EVAL_DARK':','.join(format(value, '.9g') for value in state['dark'])}
            subprocess.run(command, env=environment, capture_output=True, check=True, timeout=120)
            value = np.fromfile(output_path, dtype=np.float32)
        if value.size != height*width or not np.isfinite(value).all():
            raise ValueError('Invalid GALOSH output')
        return canonical(value.reshape(height, width), metadata).copy()

    def process(self, image, metadata, state, *, bypass=False):
        if bypass or self.strength == 0:
            return develop(image, metadata)
        if max(image.shape) <= self.tile_size+2*self.margin:
            return develop(self.denoise_mosaic(image, metadata, state), metadata)
        height, width = image.shape
        result = np.empty((height, width, 3), dtype=np.float32)
        for row in range(0, height, self.tile_size):
            for column in range(0, width, self.tile_size):
                bottom, right = min(height, row+self.tile_size), min(width, column+self.tile_size)
                top, left = max(0, row-self.margin), max(0, column-self.margin)
                end_y, end_x = min(height, bottom+self.margin), min(width, right+self.margin)
                md = {**metadata, 'tile_origin':[top, left]}
                value = develop(self.denoise_mosaic(image[top:end_y, left:end_x], md, state), md)
                result[row:bottom, column:right] = value[row-top:bottom-top, column-left:right-left]
        return result


def factory():
    return Galosh()


def half():
    return Galosh(.5)


def three_quarters():
    return Galosh(.75)


def blind():
    return Galosh(blind=True)


def blind_half():
    return Galosh(.5, blind=True)


def blind_three_quarters():
    return Galosh(.75, blind=True)
