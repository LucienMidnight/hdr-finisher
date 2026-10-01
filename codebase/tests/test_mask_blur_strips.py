import numpy as np
import pytest

from hdr_finisher.local_adjustments import _box_blur_axis, _gaussian_blur_float, _gaussian_box_widths


def whole_frame_box(values, radius, axis):
    padding = [(0, 0)] * values.ndim
    padding[axis] = (radius, radius)
    padded = np.pad(values, padding, mode="edge")
    zero_shape = list(padded.shape)
    zero_shape[axis] = 1
    cumulative = np.concatenate([
        np.zeros(zero_shape, dtype=np.float32),
        np.cumsum(padded, axis=axis, dtype=np.float32),
    ], axis=axis)
    width = radius * 2 + 1
    after = [slice(None)] * values.ndim
    before = [slice(None)] * values.ndim
    after[axis] = slice(width, None)
    before[axis] = slice(None, -width)
    return (cumulative[tuple(after)] - cumulative[tuple(before)]) / np.float32(width)


@pytest.mark.parametrize("shape", [(1, 1), (3, 7), (137, 259), (513, 529)])
@pytest.mark.parametrize("axis", [0, 1])
@pytest.mark.parametrize("radius", [0, 1, 80, 512])
def test_strip_blur_is_bit_identical_to_whole_frame(shape, axis, radius):
    values = np.random.default_rng(42).random(shape, dtype=np.float32)
    np.testing.assert_array_equal(_box_blur_axis(values, radius, axis), whole_frame_box(values, radius, axis))


@pytest.mark.parametrize("sigma", [0.1, 5, 100, 400])
def test_twelve_pass_feather_preserves_low_alpha_and_quantization(sigma):
    values = np.zeros((137, 259), dtype=np.float32)
    values[40:45, 110:120] = 0.003
    expected = values.copy()
    if sigma >= 0.25:
        for axis in [1, 0]:
            for width in _gaussian_box_widths(sigma, 6):
                radius = (width - 1) // 2
                if radius:
                    expected = whole_frame_box(expected, radius, axis)
        expected = np.clip(expected, 0.0, 1.0)
    actual = _gaussian_blur_float(values, sigma)
    np.testing.assert_array_equal(actual, expected)
    scale = np.float32(values.max() / max(float(expected.max()), 1e-12))
    np.testing.assert_array_equal(np.rint(actual * scale * 255), np.rint(expected * scale * 255))


@pytest.mark.parametrize("shape", [(1, 19), (19, 1), (517, 533)])
@pytest.mark.parametrize("sigma", [(0, 80), (80, 0), (5, 100), (0.1, 0.1)])
def test_contiguous_vertical_passes_preserve_anisotropic_float_output(shape, sigma):
    values = np.random.default_rng(73).random(shape, dtype=np.float32)
    original = values.copy()
    expected = values.copy()
    if max(sigma) >= .25:
        for axis, s in [(1, sigma[0]), (0, sigma[1])]:
            for width in _gaussian_box_widths(s, 6):
                if width > 1:
                    expected = whole_frame_box(expected, (width - 1) // 2, axis)
        expected = np.clip(expected, 0, 1)
    np.testing.assert_array_equal(_gaussian_blur_float(values, sigma), expected)
    np.testing.assert_array_equal(values, original)
