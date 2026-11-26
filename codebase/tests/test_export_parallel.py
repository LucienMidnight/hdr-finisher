import numpy as np
import pytest

from hdr_finisher import adjustments, detail
from hdr_finisher.delivery_frames import DeliveryFrame
from hdr_finisher.export_parallel import blur_axis_in_blocks, rows_in_parts
from hdr_finisher.export_timing import export_clock
from hdr_finisher.exporters import _write_hdr_y4m, _write_sdr_y4m


@pytest.mark.parametrize("module", [detail, adjustments])
@pytest.mark.parametrize("shape", [(1100, 1900), (1100, 1900, 3)])
def test_export_blurs_in_blocks_match_the_whole_frame_blur(module, shape):
    values = np.random.default_rng(4).random(shape, dtype=np.float32) * 3 - 1
    for axis in (0, 1):
        for radius in (1, 9, 60):
            whole = module._box_blur_axis(values, radius, axis)
            with export_clock():
                blocks = module._box_blur_axis(values, radius, axis)
            assert blocks.dtype == whole.dtype
            np.testing.assert_array_equal(blocks, whole)


@pytest.mark.parametrize("axis", [0, 1])
def test_detail_running_sum_matches_concatenated_float32_bytes(axis):
    values = np.random.default_rng(17).random((45, 53, 3), dtype=np.float32) * 3 - 1
    values = values[::2, ::2]
    radius = 7
    padding = [(0, 0)] * values.ndim
    padding[axis] = (radius, radius)
    padded = np.pad(values, padding, mode="edge")
    zero_shape = list(padded.shape)
    zero_shape[axis] = 1
    cumulative = np.concatenate(
        (np.zeros(zero_shape, dtype=np.float32), np.cumsum(padded, axis=axis, dtype=np.float32)), axis=axis,
    )
    upper, lower = np.split(cumulative, [2 * radius + 1], axis=axis)[1], np.take(
        cumulative, np.arange(values.shape[axis]), axis=axis,
    )
    expected = (upper - lower) / np.float32(2 * radius + 1)
    assert detail._box_blur_axis_lines(values, radius, axis).tobytes() == expected.tobytes()


def test_export_parallel_blur_keeps_float64_arithmetic():
    values = np.full((1100, 1900), 1.0 + 2.0 ** -40, dtype=np.float64)
    calls = []

    def blur(data, radius, axis):
        calls.append((data.shape, radius, axis))
        return data.copy()

    with export_clock():
        actual = blur_axis_in_blocks(blur, values, 1, 0)
    assert calls == [(values.shape, 1, 0)]
    assert actual.dtype == values.dtype
    np.testing.assert_array_equal(actual, values)


def test_rows_in_parts_matches_one_conversion_inside_and_outside_an_export():
    band = np.random.default_rng(7).random((128, 50, 3), dtype=np.float32)
    convert = lambda rows, top: rows * np.float32(2) + np.arange(top, top + len(rows), dtype=np.float32)[:, None, None]
    whole = convert(band, 256)
    np.testing.assert_array_equal(rows_in_parts(convert, band, 256), whole)
    with export_clock():
        np.testing.assert_array_equal(rows_in_parts(convert, band, 256), whole)


def test_export_y4m_from_a_shared_band_buffer_is_byte_identical(tmp_path):
    pixels = np.random.default_rng(6).random((300, 64, 3), dtype=np.float32) * 1.4
    frame = DeliveryFrame.spill(tmp_path / "frame.rgb", pixels)
    for name, write in (("sdr", lambda path, image: _write_sdr_y4m(path, image, bit_depth=10, chroma_subsampling="420")),
                        ("sdr-dither", lambda path, image: _write_sdr_y4m(path, image, bit_depth=8, chroma_subsampling="420",
                                                                          dithering="subtle")),
                        ("hdr", lambda path, image: _write_hdr_y4m(path, image, bit_depth=10))):
        write(tmp_path / f"{name}-serial.y4m", frame)
        with export_clock():
            write(tmp_path / f"{name}-export.y4m", frame)
        assert (tmp_path / f"{name}-serial.y4m").read_bytes() == (tmp_path / f"{name}-export.y4m").read_bytes()
