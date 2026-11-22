import numpy as np
import pytest

from hdr_finisher import adjustments, detail
from hdr_finisher.delivery_frames import DeliveryFrame
from hdr_finisher.export_parallel import rows_in_parts
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
