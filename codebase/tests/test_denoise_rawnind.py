"""Optional result tests: local verified weights only, no download."""
import numpy as np
import pytest
from types import SimpleNamespace

from tools.denoise_eval.candidates.rawnind import RawNIND, MODEL_ROOT, gather
from tools.denoise_eval.inputs import develop
from tools.denoise_eval.metrics import colour_error


def test_mirror_gather_preserves_packed_cfa_phase():
    mosaic = np.arange(64, dtype=np.float32).reshape(8, 8)
    for row, column in ((0, 0), (0, 1), (1, 0), (1, 1)):
        plane = mosaic[row::2, column::2]
        expected = np.pad(plane, 2, mode='reflect')
        assert np.array_equal(gather(plane, -2, -2, 8, 8), expected)


@pytest.fixture(params=['linear', 'bayer'])
def candidate(request):
    pytest.importorskip('onnxruntime')
    if not (MODEL_ROOT / f'model_{request.param}.onnx').is_file():
        pytest.skip('Research-only RawNIND model not installed')
    return RawNIND(request.param)


def test_tiny_shapes_finite_bypass_strength_and_real_tile_shift(candidate):
    metadata = dict(cfa=[[0, 1], [1, 2]], white_balance=[1, 1, 1], camera_to_acescg=np.eye(3).tolist())
    image = np.full((24, 32, 4), .2, np.float32) if candidate.kind == 'linear' else np.full((24, 32), .2, np.float32)
    if candidate.kind == 'linear':
        image[..., 3] = np.linspace(0, 1, 32)
    state = candidate.prepare(image, metadata)
    output = candidate.process(image, metadata, state)
    assert output.shape == (24, 32, 4 if candidate.kind == 'linear' else 3)
    assert np.isfinite(output).all()
    baseline = image if candidate.kind == 'linear' else develop(image, metadata)
    assert np.array_equal(candidate.process(image, metadata, state, bypass=True), baseline)
    candidate.strength = .5
    blended = candidate.process(image, metadata, state)
    assert np.allclose(blended[..., :3], baseline[..., :3]+.5*(output[..., :3]-baseline[..., :3]), atol=1e-7)
    candidate.strength = 1
    candidate.tile_shift = 16
    shifted = candidate.process(image, metadata, candidate.prepare(image, metadata))
    difference = colour_error(output, shifted)
    assert np.mean(difference) < 1
    assert np.percentile(difference, 99) < 3
    if candidate.kind == 'linear':
        assert np.array_equal(output[..., 3], image[..., 3])


def test_bayer_rejects_gpu_before_loading_weights():
    with pytest.raises(ValueError, match='CPU-only'):
        RawNIND('bayer', provider='CoreMLExecutionProvider')


def test_bayer_unsupported_range_uses_explicit_ahd_fallback():
    image = np.full((24, 24), 1.25, np.float32)
    metadata = dict(cfa=[[0, 1], [1, 2]], white_balance=[1, 1, 1], camera_to_acescg=np.eye(3).tolist())
    candidate = RawNIND('bayer')
    state = candidate.prepare(image, metadata)
    assert state.fallback is not None
    assert state.timing['inference'] == 0
    assert np.array_equal(candidate.process(image, metadata, state), develop(image, metadata))


@pytest.mark.parametrize('phase', [(0, 0), (0, 1), (1, 0), (1, 1)])
def test_all_bayer_orientations_keep_rgb_and_green_order(phase):
    phase_row, phase_column = phase
    image = np.empty((24, 32), np.float32)
    pattern = np.empty((2, 2), int)
    for row, column, channel, value in ((0, 0, 0, .1), (0, 1, 1, .2), (1, 0, 1, .3), (1, 1, 2, .4)):
        original_row, original_column = (row-phase_row)%2, (column-phase_column)%2
        image[original_row::2, original_column::2] = value
        pattern[original_row, original_column] = channel

    class KnownCameraOutput:
        def get_inputs(self):
            return [SimpleNamespace(name='input')]

        def run(self, names, inputs):
            tensor = inputs['input'][0]
            assert np.allclose(tensor.mean(axis=(1, 2)), [.1, .2, .3, .4], atol=1e-6)
            output = np.stack((tensor[0], (tensor[1]+tensor[2])*.5, tensor[3]))
            return [output.repeat(2, axis=1).repeat(2, axis=2)[None]]

    candidate = RawNIND('bayer')
    candidate.session = KnownCameraOutput()
    metadata = dict(cfa=pattern.tolist(), white_balance=[2, 1, .5],
                    camera_to_acescg=np.diag([.8, 1.1, .9]).tolist())
    state = candidate.prepare(image, metadata)
    assert state.fallback is None
    assert np.allclose(state.denoised, [.16, .275, .18], atol=1e-6)
