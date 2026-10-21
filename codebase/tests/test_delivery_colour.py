import numpy as np
import pytest
from hdr_finisher.delivery_colour import compare_finished_pixels


@pytest.mark.parametrize("lane", ["hdr", "sdr"])
def test_same_finished_pixels_have_no_perceptual_difference(lane):
    image = np.random.default_rng(18).random((9, 11, 3), dtype=np.float32)
    result = compare_finished_pixels(image, image, lane)
    assert result.passed
    assert result.mean == 0 and result.p999 == 0


@pytest.mark.parametrize("lane", ["hdr", "sdr"])
def test_stray_pixel_does_not_fail_but_widespread_visible_change_does(lane):
    original = np.full((100, 100, 3), .18, dtype=np.float32)
    changed = original.copy()
    changed[0, 0] = 1
    assert compare_finished_pixels(original, changed, lane).passed
    changed[:] = 1
    assert not compare_finished_pixels(original, changed, lane).passed


def test_hdr_difference_uses_absolute_brightness_not_normalized_peaks():
    image = np.full((3, 4, 3), .18, dtype=np.float32)
    assert not compare_finished_pixels(image, image * 2, "hdr").passed


def test_invalid_pixels_cannot_pass_through_percentile_filtering():
    image = np.ones((2, 2, 3))
    with pytest.raises(ValueError, match="matching"):
        compare_finished_pixels(image, image[:1], "hdr")
    image[0, 0, 0] = float("nan")
    with pytest.raises(ValueError, match="finite"):
        compare_finished_pixels(image, image, "sdr")


def test_gpu_alpha_is_not_part_of_colour_comparison():
    rgb = np.full((2, 3, 3), .18, dtype=np.float32)
    rgba = np.concatenate([rgb, np.zeros((2, 3, 1), dtype=np.float32)], axis=2)
    assert compare_finished_pixels(rgb, rgba, "hdr").passed
