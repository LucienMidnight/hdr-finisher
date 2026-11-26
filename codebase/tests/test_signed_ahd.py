import numpy as np
import pytest

from hdr_finisher.signed_raw import demosaic, orient


PATTERNS = [[[0, 1], [1, 2]], [[1, 0], [2, 1]], [[1, 2], [0, 1]], [[2, 1], [1, 0]]]


@pytest.mark.parametrize("pattern", PATTERNS)
def test_observed_signed_samples_survive_all_phases_and_borders(pattern):
    black = np.asarray([[100, 120], [130, 150]], dtype=np.float32)
    sensor = np.random.default_rng(7).integers(0, 250, (35, 38), dtype=np.uint16)
    result = demosaic(sensor, pattern, black, np.eye(3))
    for row in range(2):
        for column in range(2):
            np.testing.assert_array_equal(
                result[row::2, column::2, pattern[row][column]],
                sensor[row::2, column::2].astype(np.float32) - black[row, column],
            )
    assert result.min() < 0
    assert np.isfinite(result).all()


@pytest.mark.parametrize("level", [-100, -10, 0, 10, 1000])
def test_neutral_signed_patch_keeps_its_level_and_colour(level):
    sensor = np.full((32, 36), 100 + level, dtype=np.uint16)
    result = demosaic(sensor, PATTERNS[0], np.full((2, 2), 100), np.eye(3))
    np.testing.assert_array_equal(result, np.full((32, 36, 3), level, dtype=np.float32))


def test_strip_seams_and_bounded_half_output_equal_full_development():
    sensor = np.random.default_rng(8).integers(0, 600, (99, 83), dtype=np.uint16)
    whole = demosaic(sensor, PATTERNS[1], np.full((2, 2), 250), np.eye(3))
    stripped = demosaic(sensor, PATTERNS[1], np.full((2, 2), 250), np.eye(3), rows=16)
    np.testing.assert_array_equal(stripped, whole)
    half = demosaic(sensor, PATTERNS[1], np.full((2, 2), 250), np.eye(3), rows=16, half_size=True)
    np.testing.assert_array_equal(half, whole[::2, ::2])


@pytest.mark.parametrize("flip,turns", [(0, 0), (3, 2), (5, 1), (6, -1)])
def test_orientation_preserves_signed_samples(flip, turns):
    image = np.arange(6 * 8 * 3, dtype=np.float32).reshape(6, 8, 3) - 100
    result = orient(image, flip)
    np.testing.assert_array_equal(result, np.rot90(image, turns))
    assert result.flags.c_contiguous


def test_upper_dn_limit_is_unchanged():
    sensor = np.random.default_rng(3).integers(0, 65536, (32, 32), dtype=np.uint16)
    result = demosaic(sensor, PATTERNS[0], np.zeros((2, 2)), np.eye(3))
    assert result.max() <= 65535
