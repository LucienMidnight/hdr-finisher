"""RawNIND UtNet2 research: fixed tiles, native colour tails, global gain only."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace
import hashlib
import time

import numpy as np

from hdr_finisher.color import acescg_to_linear_bt2020, linear_bt2020_to_acescg
from hdr_finisher.raw_import import _camera_rgb_to_acescg_float32
from tools.denoise_eval.inputs import develop

MODEL_ROOT = Path(__file__).resolve().parents[3] / 'output/denoise-v1/candidates/rawnind/rawdenoise-nind'
HASHES = {
    'linear': 'df957efadcc152c007d5d3b0917bdff9e41c0d4a0efe56584ef30b36393cd181',
    'bayer': 'da27509dab6a2915da67e988acd86cf71f9d5bbc8d1aa0ed32933578a887b901',
}


def mirror_indices(start, count, length):
    coordinates = np.arange(start, start + count)
    if length == 1:
        return np.zeros(count, dtype=np.intp)
    period = 2 * (length - 1)
    folded = coordinates % period
    return np.minimum(folded, period - folded)


def gather(image, top, left, height, width):
    rows = mirror_indices(top, height, image.shape[0])
    columns = mirror_indices(left, width, image.shape[1])
    return image[rows[:, None], columns[None, :]]


@dataclass
class Prepared:
    denoised: np.ndarray
    gain: float
    timing: dict
    domain: dict
    fallback: str | None = None


class RawNIND:
    margin = 128
    supports_alpha = True
    supports_bypass = True

    def __init__(self, kind='linear', strength=1., *, model_root=None, tile_shift=0,
                 provider='CPUExecutionProvider'):
        if kind not in HASHES or not 0 <= strength <= 1:
            raise ValueError('Expected linear/bayer and strength in [0,1]')
        if kind == 'bayer' and provider != 'CPUExecutionProvider':
            raise ValueError('RawNIND Bayer is CPU-only')
        self.kind = kind
        self.input_kind = 'rgb' if kind == 'linear' else 'bayer'
        self.strength = strength
        self.margin = 64 if kind == 'linear' else 128
        self.tile_shift = tile_shift
        if kind == 'bayer' and tile_shift % 2:
            raise ValueError('Bayer tile shift must preserve even CFA phase')
        self.provider = provider
        self.model_path = Path(model_root or MODEL_ROOT) / f'model_{kind}.onnx'
        self.session = None

    def description(self):
        return dict(algorithm='RawNIND-UtNet2', input_kind=self.input_kind, strength=self.strength,
                    model_sha256=HASHES[self.kind], provider=self.provider, tile=512,
                    halo=self.margin, core=384 if self.kind == 'linear' else 768,
                    gain='one frame-global ratio; Bayer anchor is unity-WB AHD camera RGB',
                    clipping='normalised Bayer sensor only, upstream [0,1]' if self.kind == 'bayer' else False,
                    bayer_out_of_domain='clip finite sensor samples; unsupported CFA uses AHD',
                    linear_out_of_domain='unclipped extrapolation; not established HDR support',
                    seam_probe='prepared-frame slices are cached; use independent tile_shift preparations')

    def state_description(self, state):
        return dict(gain=state.gain, domain=state.domain, fallback=state.fallback, timing=state.timing)

    def _session(self):
        if self.session is None:
            import onnxruntime as ort
            if hashlib.sha256(self.model_path.read_bytes()).hexdigest() != HASHES[self.kind]:
                raise ValueError(f'Model hash mismatch: {self.model_path}')
            if self.provider not in ort.get_available_providers():
                raise ValueError(f'Provider unavailable: {self.provider}')
            options = ort.SessionOptions()
            options.intra_op_num_threads = 1
            options.inter_op_num_threads = 1
            options.enable_cpu_mem_arena = False
            options.enable_mem_pattern = False
            options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            self.session = ort.InferenceSession(str(self.model_path), sess_options=options,
                                                providers=[self.provider])
            self.session.disable_fallback()
        return self.session

    def prepare(self, image, metadata, *, destination=None):
        start = time.perf_counter()
        height, width = image.shape[:2]
        if min(height, width) < 2:
            raise ValueError('Expected finite image with dimensions >=2')
        minimum, maximum = float('inf'), float('-inf')
        for top in range(0, height, 128):
            strip = image[top:top+128]
            if not np.isfinite(strip).all():
                raise ValueError('Expected finite image')
            colours = strip[..., :3] if self.kind == 'linear' else strip
            minimum = min(minimum, float(np.min(colours)))
            maximum = max(maximum, float(np.max(colours)))
        domain = dict(minimum=minimum, maximum=maximum, negative=minimum < 0, above_one=maximum > 1,
                      clipped=False, extrapolated=minimum < 0 or maximum > 1)
        phase_row = phase_column = 0
        if self.kind == 'bayer':
            if image.ndim != 2 or height % 2 or width % 2:
                raise ValueError('Bayer requires an even HxW normalised mosaic')
            pattern = np.asarray(metadata.get('cfa'))
            supported_cfa = pattern.shape == (2, 2) and sorted(pattern.ravel().tolist()) == [0, 1, 1, 2]
            if supported_cfa:
                phase_row, phase_column = (int(value) for value in np.argwhere(pattern == 0)[0])
                supported_cfa = pattern[1-phase_row, 1-phase_column] == 2
            if not supported_cfa:
                reason = 'unsupported CFA'
                return Prepared(develop(image, metadata), 1., dict(total=time.perf_counter()-start,
                                inference=0., stitch_colour=0., session=0., tiles=0), domain, reason)
            domain['canonical_phase_offset'] = [phase_row, phase_column]
            domain['clipped'] = minimum < 0 or maximum > 1
            domain['extrapolated'] = False
            domain['clipped_fraction'] = float(np.count_nonzero((image < 0) | (image > 1))) / image.size
            camera_anchor = develop(image, {**metadata, 'white_balance': [1, 1, 1],
                                           'camera_to_acescg': np.eye(3).tolist(), 'exposure_stops': 0})
            anchor_mean = float(np.mean(camera_anchor, dtype=np.float64))
            domain['ahd_camera_anchor_mean'] = anchor_mean
            del camera_anchor
        session_start = time.perf_counter()
        session = self._session()
        session_seconds = time.perf_counter() - session_start
        output = np.empty((height, width, 3), np.float32) if destination is None else destination
        core = 384 if self.kind == 'linear' else 768
        input_sum = output_sum = 0.
        input_count = output_count = tiles = 0
        inference_seconds = 0.
        model_minimum, model_maximum = float('inf'), float('-inf')
        shift = self.tile_shift % core
        for top in range(-shift, height+phase_row, core):
            for left in range(-shift, width+phase_column, core):
                canonical_first_row, canonical_first_column = max(phase_row, top), max(phase_column, left)
                canonical_last_row, canonical_last_column = min(height+phase_row, top+core), min(width+phase_column, left+core)
                first_row, first_column = canonical_first_row-phase_row, canonical_first_column-phase_column
                last_row, last_column = canonical_last_row-phase_row, canonical_last_column-phase_column
                if self.kind == 'linear':
                    tile = acescg_to_linear_bt2020(gather(image[..., :3], top-64, left-64, 512, 512))
                    retained_input = tile[64+first_row-top:64+last_row-top,
                                          64+first_column-left:64+last_column-left]
                    tensor = np.ascontiguousarray(tile.transpose(2, 0, 1)[None], dtype=np.float32)
                else:
                    packed_tile = np.stack([gather(image[(row-phase_row)%2::2, (column-phase_column)%2::2],
                                            top//2-64+(row-phase_row)//2, left//2-64+(column-phase_column)//2, 512, 512)
                                            for row, column in ((0, 0), (0, 1), (1, 0), (1, 1))])
                    tensor = np.ascontiguousarray(packed_tile[None], dtype=np.float32)
                    np.clip(tensor, 0, 1, out=tensor)
                    retained_input = image[first_row:last_row, first_column:last_column]
                inference_start = time.perf_counter()
                model_minimum = min(model_minimum, float(np.min(tensor)))
                model_maximum = max(model_maximum, float(np.max(tensor)))
                prediction = session.run(None, {session.get_inputs()[0].name: tensor})[0]
                inference_seconds += time.perf_counter() - inference_start
                prediction = prediction[0].transpose(1, 2, 0)
                halo = self.margin
                retained_output = prediction[halo+canonical_first_row-top:halo+canonical_last_row-top,
                                             halo+canonical_first_column-left:halo+canonical_last_column-left]
                if retained_output.shape != (last_row-first_row, last_column-first_column, 3) or not np.isfinite(retained_output).all():
                    raise ValueError('Invalid model output; no retry')
                output[first_row:last_row, first_column:last_column] = retained_output
                input_sum += float(np.sum(retained_input, dtype=np.float64))
                input_count += retained_input.size
                output_sum += float(np.sum(retained_output, dtype=np.float64))
                output_count += retained_output.size
                tiles += 1
        input_mean, output_mean = input_sum/input_count, output_sum/output_count
        if self.kind == 'bayer':
            input_mean = anchor_mean
        domain.update(model_input_minimum=model_minimum, model_input_maximum=model_maximum,
                      extrapolated=model_minimum < 0 or model_maximum > 1)
        if not np.isfinite(output_mean) or abs(output_mean) < 1e-12:
            raise ValueError('Near-zero/nonfinite model mean; global gain undefined')
        gain = input_mean/output_mean
        if not np.isfinite(gain) or abs(gain) < 1e-12:
            raise ValueError('Invalid frame-global gain; no invented normalization')
        colour_metadata = SimpleNamespace(as_shot_wb=np.asarray(metadata.get('white_balance')),
                                          camera_to_acescg=np.asarray(metadata.get('camera_to_acescg')))
        for top in range(0, height, 128):
            strip = output[top:top+128]
            strip *= np.float32(gain)
            if self.kind == 'linear':
                strip[:] = linear_bt2020_to_acescg(strip)
            else:
                _camera_rgb_to_acescg_float32(strip, colour_metadata)
                strip *= np.float32(2**metadata.get('exposure_stops', 0))
            if not np.isfinite(strip).all():
                raise ValueError('Nonfinite colour-tail output; no retry')
        total = time.perf_counter()-start
        return Prepared(output, gain, dict(total=total, inference=inference_seconds,
                        session=session_seconds, stitch_colour=total-inference_seconds-session_seconds,
                        tiles=tiles), domain)

    def process(self, image, metadata, state, *, bypass=False):
        if self.kind == 'linear' and (bypass or self.strength == 0):
            return image.copy()
        top, left = metadata.get('tile_origin', (0, 0))
        denoised = state.denoised[top:top+image.shape[0], left:left+image.shape[1]]
        if self.kind == 'bayer':
            baseline = develop(image, metadata) if bypass or self.strength != 1 else None
            if bypass or self.strength == 0:
                return baseline
            if self.strength == 1:
                return denoised.copy()
        else:
            baseline = image[..., :3]
        result = denoised.copy() if self.strength == 1 else baseline + np.float32(self.strength)*(denoised-baseline)
        if image.ndim == 3 and image.shape[-1] == 4:
            result = np.concatenate((result, image[..., 3:4]), axis=-1)
        return result


def linear():
    return RawNIND('linear')


def linear_half():
    return RawNIND('linear', .5)


def linear_three_quarters():
    return RawNIND('linear', .75)


def bayer():
    return RawNIND('bayer')


def bayer_half():
    return RawNIND('bayer', .5)


def bayer_three_quarters():
    return RawNIND('bayer', .75)
