from pathlib import Path
import subprocess
import sys
from types import ModuleType, SimpleNamespace

import numpy as np
import pytest

from hdr_finisher import denoise_grain, denoise_micro_grain, loader, raw_pixel_cleanup, raw_speck_cleanup
from test_raw_pixel_cleanup import config, metadata


@pytest.fixture(autouse=True)
def switches_off(monkeypatch):
    for candidate in ('COLOUR_LEVELS', 'MICRO_GUARD', 'RAW_LEVELS'):
        monkeypatch.delenv(f'HDR_FINISHER_QUAL_{candidate}', raising=False)


def previous(module, monkeypatch):
    root = Path(__file__).resolve().parents[2]
    blob = f'ef31bd78:codebase/backend/hdr_finisher/{module.__name__.rsplit(".", 1)[-1]}.py'
    try:
        source = subprocess.check_output(['git', 'cat-file', 'blob', blob], cwd=root, stderr=subprocess.DEVNULL)
    except (OSError, subprocess.CalledProcessError):
        pytest.skip('The pre-qualification revision is not available in this checkout')
    original = ModuleType(module.__name__ + '_qual_reference')
    original.__package__ = module.__package__
    monkeypatch.setitem(sys.modules, original.__name__, original)
    exec(compile(source, blob, 'exec'), original.__dict__)
    return original


def test_off_threshold_candidates_match_pre_qualification_bytes_with_the_same_fit(monkeypatch):
    rng = np.random.default_rng(306)
    sensor = rng.integers(980, 1020, (128, 160), dtype=np.uint16) + np.arange(160, dtype=np.uint16)
    sensor[35, 37] = 5100
    sensor[37, 43] = 1130
    old_pixel = previous(raw_pixel_cleanup, monkeypatch)
    settings = raw_pixel_cleanup.configuration(sensor, metadata())
    assert settings is not None
    actual, expected = sensor.copy(), sensor.copy()
    assert raw_pixel_cleanup.apply(actual, settings) == old_pixel.apply(expected, settings)
    assert actual.tobytes() == expected.tobytes()
    old_speck = previous(raw_speck_cleanup, monkeypatch)
    assert raw_speck_cleanup.apply(actual, settings) == old_speck.apply(expected, settings)
    assert actual.tobytes() == expected.tobytes()

    camera = SimpleNamespace(**vars(metadata()), black_level=np.full(3, 1000), white_level=np.full(3, 13000),
                             as_shot_wb=np.ones(3), camera_to_acescg=np.eye(3))
    profile = denoise_micro_grain.BayerProfile.from_camera(settings, camera, None)
    old_micro = previous(denoise_micro_grain, monkeypatch)
    controls = denoise_micro_grain.MicroGrainControls(1, 1, 0)
    center = np.s_[4:-4, 4:-4]
    actual = denoise_micro_grain.BayerTile(actual, profile).apply(controls, center)
    expected = old_micro.BayerTile(expected, profile).apply(controls, center)
    assert [value.tobytes() for value in actual] == [value.tobytes() for value in expected]

    rgb = rng.normal(np.linspace(.002, .15, 128)[None, :, None], .002, (120, 128, 3)).astype(np.float32)
    old_grain = previous(denoise_grain, monkeypatch)
    for broad in (False, True):
        assert denoise_grain.colour_delta(rgb, broad).tobytes() == old_grain.colour_delta(rgb, broad).tobytes()


def test_micro_guard_tracks_signal_and_noise_scale(monkeypatch):
    cells = np.zeros((30, 30, 4), np.float32)
    cells[7, 7, 0] = .13
    cells[21, 21, :2] = .01
    profile = SimpleNamespace(shot=np.zeros(4, np.float32), read=np.full(4, .001**2, np.float32))
    legacy = denoise_micro_grain._highlight_guard(cells, profile)
    monkeypatch.setenv('HDR_FINISHER_QUAL_MICRO_GUARD', '1')
    assert legacy[7, 7] and legacy[21, 21] and not legacy[15, 15]
    for scale in (.125, 1, 8):
        scaled = SimpleNamespace(shot=profile.shot * scale, read=profile.read * scale**2)
        np.testing.assert_array_equal(denoise_micro_grain._highlight_guard(cells * scale, scaled), legacy)


def test_raw_excess_tracks_read_noise_and_separates_cache(monkeypatch):
    image = np.zeros((48, 48), np.float32)
    image[16, 16] = .012
    settings = config()
    assert raw_pixel_cleanup.filter_sensor(image, settings)[16, 16] == image[16, 16]
    original = loader.source_decoder_version(True, bayer_cleanup=True)
    monkeypatch.setenv('HDR_FINISHER_QUAL_RAW_LEVELS', '1')
    settings['thresholds'] = raw_pixel_cleanup.cleanup_thresholds()
    assert raw_pixel_cleanup.filter_sensor(image, settings)[16, 16] == 0
    assert loader.source_decoder_version(True, bayer_cleanup=True) != original


def test_weighted_fit_keeps_deep_shadow_observations():
    sensor = np.random.default_rng(13).integers(963, 999, (128, 160), dtype=np.uint16)
    settings = raw_pixel_cleanup.configuration(sensor, metadata())
    assert settings is not None
    assert all(phase['a'] == 0 and phase['b'] > 0 for phase in settings['noise'])
