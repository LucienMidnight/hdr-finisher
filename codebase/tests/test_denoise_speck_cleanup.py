"""Result-based research tests; no photographs or network weights needed."""
from dataclasses import replace
import numpy as np
from hdr_finisher.denoise_adaptive import AdaptiveNoiseModel, resolve_adaptive
from tools.denoise_eval.candidates.speck_cleanup import make_cache, resolve, cleanup, DEFAULT
from tools.denoise_eval.metrics import shadow_tails


def model():
    return AdaptiveNoiseModel(0, .000001, 0, ((1., .5, .25, .125, .0625),)*3)


def test_cached_baseline_matches_existing_filter_and_bypass_alpha():
    rng = np.random.default_rng(17)
    image = rng.normal(.2, .01, (96, 104, 4)).astype('float32')
    cache = make_cache(image, model())
    from tools.denoise_eval.candidates.speck_cleanup import adaptive
    assert np.max(abs(adaptive(cache, DEFAULT)-resolve_adaptive(image, model(), DEFAULT))) < 3e-7
    assert np.array_equal(resolve(cache, replace(DEFAULT, amount=0)), image)
    assert np.array_equal(resolve(cache)[..., 3], image[..., 3])
    assert np.isfinite(resolve(cache)).all()


def test_guarded_cleanup_protects_positive_point_and_dark_line_and_fills_rim_speck():
    from hdr_finisher.denoise_adaptive import OPPONENT
    image = np.full((80, 80, 3), .1, 'float32')
    image[20, 20] = .15
    image[50, 10:60] = .075
    image[34:39, 34:39] = .102
    image[36, 36] = .075
    correction, stats = cleanup(image, model(), np.full((80, 80), 1e-6, 'float32'))
    rgb = correction.sum(0) @ OPPONENT
    assert np.max(abs(rgb[20, 20])) < 1e-6
    assert np.max(abs(rgb[50, 30])) < 1e-6
    assert np.mean(rgb[36, 36]) > .005
    assert stats['impulse_pixels'] > 0


def test_constant_hdr_negative_no_drift_and_exposure_covariance():
    image = np.full((96, 96, 3), [-.1, 1.5, 8.], 'float32')
    assert np.max(abs(resolve(make_cache(image, model()))-image)) < 3e-6
    rng = np.random.default_rng(5)
    image = rng.normal(.01, .001, (96, 96, 3)).astype('float32')
    original = resolve(make_cache(image, model()))
    scaled = replace(model(), b=model().b*16**2)
    assert np.max(abs(resolve(make_cache(image*16, scaled))/16-original)) < 1e-7


def test_chroma_cleanup_does_not_bleed_across_strong_isoluminant_edge():
    image = np.full((80, 80, 3), [.12, .08, .1], 'float32')
    image[:, 40:] = [.08, .12, .1]
    correction, _ = cleanup(image, model(), np.full((80, 80), 1e-6, 'float32'))
    assert np.max(abs(correction)) < 1e-6


def test_shadow_tail_metric_counts_impulses_not_masked_errors_or_clean_points():
    clean = np.full((80, 80, 3), .005, 'float32')
    clean[20, 20] = .01
    output = clean.copy()
    output[40, 40] = .02
    output[60, 60] = .02
    masks = dict(flat=np.ones((80, 80), bool), valid=np.ones((80, 80), bool))
    masks['valid'][55:65, 55:65] = False
    measured = shadow_tails(output, output, clean, masks)
    assert measured['small_islands'] == 1
    assert measured['luma_tail_pixels'] == 1
    assert shadow_tails(clean, output, clean, masks)['luma_tail_pixels'] == 0
    assert shadow_tails(clean, output, clean, dict(flat=np.zeros((80,80), bool))) is None


def test_tail_metric_uses_original_scene_brightness_when_input_is_already_lifted():
    clean = np.full((80,80,3), .005, 'float32')
    output = clean.copy(); output[40,40] = .02
    masks = dict(flat=np.ones((80,80), bool))
    a = shadow_tails(output, output, clean, masks)
    b = shadow_tails(output*64, output*64, clean*64, masks, source_exposure_stops=6)
    assert a['support_pixels'] == b['support_pixels']
    assert a['luma_tail_pixels'] == b['luma_tail_pixels']
    assert a['luma_abs_p999'] == b['luma_abs_p999']


def test_shadow_variant_keeps_luminance_during_chroma_repair_and_protects_coloured_glint():
    from hdr_finisher.denoise_adaptive import ACESCG_LUMINANCE, OPPONENT
    image = np.full((80,80,3), .002, 'float32')
    image[20:40,20:40,0] += .0008
    image[55,55] = [.04,.02,.01]
    correction, _ = cleanup(image, model(), np.full((80,80), 1e-6, 'float32'), 'shadow')
    assert np.max(abs((correction[1] @ OPPONENT) @ ACESCG_LUMINANCE)) < 1e-9
    assert np.max(abs(correction[:,55,55])) < 1e-8


def test_independently_prepared_haloed_tiles_match_whole_frame():
    from hdr_finisher.denoise_adaptive import _Edges
    from tools.denoise_eval.candidates.speck_cleanup import MARGIN
    from tools.denoise_eval.candidates.pilot_wiener_measure import windows
    rng = np.random.default_rng(88)
    image = rng.normal(.003,.001,(211,237,3)).astype('float32')
    whole = resolve(make_cache(image, model(), 'shadow'))
    for shift in (0,31):
        tiled = np.empty_like(image)
        for core,bounds in windows(211,237,tile=79,shift=shift,margin=MARGIN):
            y0,y1,x0,x1=core; sy,ey,sx,ex=bounds
            cache = make_cache(image[sy:ey,sx:ex],model(),'shadow',_Edges(sy==0,ey==211,sx==0,ex==237,211,237))
            tiled[y0:y1,x0:x1]=resolve(cache)[y0-sy:y1-sy,x0-sx:x1-sx]
        assert np.max(abs(tiled-whole)) < 2e-7


def test_all_live_controls_resolve_from_frozen_evidence():
    from dataclasses import fields
    image = np.random.default_rng(4).normal(.002,.001,(96,96,4)).astype('float32')
    cache = make_cache(image,model(),'shadow')
    frozen = [array.copy() for array in (cache.bands,cache.noise_to_energy,cache.corrections)]
    for field in fields(DEFAULT):
        for value in (0.,1.):
            result=resolve(cache,replace(DEFAULT,**{field.name:value}))
            assert np.isfinite(result).all()
            assert np.array_equal(result[...,3],image[...,3])
    for a,b in zip(frozen,(cache.bands,cache.noise_to_energy,cache.corrections)):
        assert np.array_equal(a,b)
