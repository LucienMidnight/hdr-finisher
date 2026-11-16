import numpy as np
import pytest

from hdr_finisher.denoise_adaptive import AdaptiveControls, AdaptiveNoiseModel, _Edges
from tools.denoise_eval.adapters import tiled
from tools.denoise_eval.candidates.pilot_wiener import (
    PilotWiener, control_gains, make_cache, resolve,
)


@pytest.fixture
def inputs():
    rng = np.random.default_rng(1416)
    image = rng.normal(.3, .03, (80, 84, 4)).astype(np.float32)
    pilot = np.full_like(image, .3)
    pilot[..., 0] += np.linspace(0, .1, 84)
    model = AdaptiveNoiseModel(0., .001, 0., ((1., .4, .2, .1, .05),) * 3)
    return image, pilot, model


def test_coefficient_attenuation_cannot_invent_energy(inputs):
    cache = make_cache(*inputs)
    for strength in (0., .5, 1.):
        gains = control_gains(cache.gains, AdaptiveControls(amount=strength))
        assert np.all((0 <= gains) & (gains <= 1))
        assert np.all(np.square(gains * cache.bands) <= np.square(cache.bands))


def test_structured_pilot_cannot_add_detail_to_constant_source(inputs):
    image, pilot, model = inputs
    source = np.full_like(image, .25)
    pilot = np.random.default_rng(88).normal(.25, .2, image.shape).astype(np.float32)
    result = resolve(make_cache(source, pilot, model))
    np.testing.assert_array_equal(result, source)


def test_direct_chroma_is_explicit_pilot_exception(inputs):
    from hdr_finisher.denoise_adaptive import OPPONENT
    image, pilot, model = inputs
    result = resolve(make_cache(image, pilot, model), direct_chroma=True)
    np.testing.assert_allclose((result[..., :3] @ OPPONENT.T)[..., 1:],
                               (pilot[..., :3] @ OPPONENT.T)[..., 1:], atol=2e-7, rtol=0)
    assert np.array_equal(result[..., 3], image[..., 3])


@pytest.mark.parametrize('controls', [AdaptiveControls(amount=0),
    AdaptiveControls(luminance=0, color_noise=0),
    AdaptiveControls(finest_noise=0, fine_noise=0, medium_noise=0, coarse_noise=0)])
def test_neutral_is_exact(inputs, controls):
    cache = make_cache(*inputs)
    assert np.array_equal(resolve(cache, controls), inputs[0])
    assert np.array_equal(resolve(cache, controls, direct_chroma=True), inputs[0])


def test_bypass_alpha_finite_and_shifted_resolve(inputs):
    image, pilot, model = inputs
    cache = make_cache(image, pilot, model)
    adapter = PilotWiener()
    result = adapter.process(image, {}, cache)
    assert np.isfinite(result).all()
    assert np.array_equal(result[..., 3], image[..., 3])
    assert np.array_equal(adapter.process(image, {}, cache, bypass=True), image)
    np.testing.assert_allclose(tiled(adapter, image, {}, cache, tile=29),
                               tiled(adapter, image, {}, cache, tile=29, shift=13), atol=2e-7, rtol=0)


def test_independent_decomposition_grid(inputs):
    image, pilot, model = inputs
    image = np.tile(image, (3, 3, 1))
    pilot = np.tile(pilot, (3, 3, 1))
    whole = resolve(make_cache(image, pilot, model))
    height, width = image.shape[:2]
    for shift in (0, 17):
        output = np.empty_like(image)
        for top in range(-shift, height, 91):
            for left in range(-shift, width, 91):
                end_y, end_x = min(height, top+91), min(width, left+91)
                top, left = max(0, top), max(0, left)
                start_y, start_x = max(0, top-66), max(0, left-66)
                stop_y, stop_x = min(height, end_y+66), min(width, end_x+66)
                region = np.s_[start_y:stop_y, start_x:stop_x]
                edges = _Edges(start_y == 0, stop_y == height, start_x == 0, stop_x == width, height, width)
                value = resolve(make_cache(image[region], pilot[region], model, edges=edges))
                output[top:end_y, left:end_x] = value[top-start_y:end_y-start_y, left-start_x:end_x-start_x]
        np.testing.assert_allclose(output, whole, atol=2e-7, rtol=0)


def test_controls_do_not_reanalyse(inputs, monkeypatch):
    cache = make_cache(*inputs)
    def fail(*args, **kwargs):
        raise AssertionError('Live resolve must not analyse')
    monkeypatch.setattr('tools.denoise_eval.candidates.pilot_wiener._atrous', fail)
    for control in ('amount', 'color_noise'):
        changes = [np.linalg.norm(resolve(cache, AdaptiveControls(**{control: value})) - cache.original)
                   for value in (0., .5, 1.)]
        assert changes[0] < changes[1] < changes[2]


def test_constant_hdr_and_exposure_scaling(inputs):
    image, pilot, model = inputs
    constant = np.full_like(image, [-.125, 1.5, 8., .4])
    assert np.array_equal(resolve(make_cache(constant, constant, model)), constant)
    base = resolve(make_cache(image, pilot, model))
    for scale in (1/64, 64):
        scaled_model = AdaptiveNoiseModel(0, model.b * scale**2, 0, model.band_sigmas)
        scaled = resolve(make_cache(image*scale, pilot*scale, scaled_model)) / scale
        np.testing.assert_allclose(scaled, base, atol=2e-7, rtol=0)


def test_half_resolution_is_two_by_two_scene_linear_mean():
    from tools.denoise_eval.metrics import area_half
    image = np.arange(6*8*3, dtype=np.float32).reshape(6, 8, 3)
    expected = (image[::2, ::2] + image[1::2, ::2] + image[::2, 1::2] + image[1::2, 1::2]) / 4
    np.testing.assert_array_equal(area_half(image), expected)


def test_half_resolution_excludes_every_partly_invalid_pair_block():
    from tools.denoise_eval.metrics import evaluate
    clean = np.full((32, 32, 3), .3, dtype=np.float32)
    output = clean.copy()
    output[8:10, 8:10] = .9
    valid = np.ones((32, 32), dtype=bool)
    valid[8, 8] = False
    masks = dict(valid=valid, flat=valid, texture=np.zeros_like(valid), edge=valid)
    measured = evaluate(output, output, clean, masks)
    for lane in ('sdr', 'hdr'):
        assert measured['half_resolution'][lane]['psnr_db'] is None
        assert measured['half_resolution'][lane]['colour_difference']['mean'] == 0
        assert measured[lane]['psnr_db'] is not None
