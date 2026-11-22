import numpy as np
import pytest

from hdr_finisher import exporters
from hdr_finisher.delivery_frames import DeliveryFrame


def _whole_frame_y4m(yuv, bit_depth, chroma):
    height, width = yuv.shape[:2]
    name = ("420jpeg" if chroma == "420" else chroma) if bit_depth == 8 else f"{chroma}p{bit_depth}"
    header = f"YUV4MPEG2 W{width} H{height} F1:1 Ip A1:1 C{name} XYSCSS={name.upper()}\nFRAME\n"
    dtype = "u1" if bit_depth == 8 else "<u2"
    vertical = 2 if chroma == "420" else 1
    horizontal = 2 if chroma != "444" else 1
    planes = [yuv[..., 0]]
    for index in (1, 2):
        plane = yuv[..., index]
        if chroma != "444":
            plane = np.pad(plane, ((0, height % vertical), (0, width % horizontal)), mode="edge")
            plane = np.round(plane.reshape(
                plane.shape[0] // vertical, vertical, plane.shape[1] // horizontal, horizontal
            ).mean(axis=(1, 3)))
        planes.append(plane)
    return header.encode("ascii") + b"".join(plane.astype(dtype).tobytes() for plane in planes)


@pytest.mark.parametrize("chroma", ["444", "422", "420"])
@pytest.mark.parametrize("bit_depth,dithering", [(8, "off"), (8, "subtle"), (8, "auto"), (10, "off"), (12, "off")])
def test_banded_sdr_y4m_matches_whole_frame(tmp_path, chroma, bit_depth, dithering):
    image = np.random.default_rng(31).uniform(-0.1, 1.1, (259, 35, 3)).astype(np.float32)
    image[127:130, 0, :] = [0, 0.0031308, 1]
    image[-1, -1, :] = [-100, 100, 0.5]
    path = tmp_path / "sdr.y4m"
    expected = _whole_frame_y4m(exporters._linear_sdr_to_yuv(image, bit_depth, dithering, 0), bit_depth, chroma)
    exporters._write_sdr_y4m(path, image, bit_depth=bit_depth, chroma_subsampling=chroma, dithering=dithering)
    assert path.read_bytes() == expected
    frame = DeliveryFrame.spill(tmp_path / "sdr.rgb", image)
    exporters._write_sdr_y4m(path, frame, bit_depth=bit_depth, chroma_subsampling=chroma, dithering=dithering)
    assert path.read_bytes() == expected


@pytest.mark.parametrize("chroma", ["444", "422", "420"])
@pytest.mark.parametrize("bit_depth", [8, 10, 12])
def test_banded_hdr_y4m_matches_whole_frame(tmp_path, chroma, bit_depth):
    image = np.random.default_rng(17).uniform(-0.1, 1.1, (259, 35, 4)).astype(np.float32)[..., :3]
    image[127:130, 0, :] = [0, 0.18, 20]
    image[-1, -1, :] = [-100, 100, 0.5]
    path = tmp_path / "hdr.y4m"
    expected = _whole_frame_y4m(exporters._linear_to_bt2020_pq_yuv(image, bit_depth, 100), bit_depth, chroma)
    exporters._write_hdr_y4m(path, image, bit_depth=bit_depth, chroma_subsampling=chroma, reference_white_nits=100)
    assert path.read_bytes() == expected
    frame = DeliveryFrame.spill(tmp_path / "hdr.rgb", image)
    exporters._write_hdr_y4m(path, frame, bit_depth=bit_depth, chroma_subsampling=chroma, reference_white_nits=100)
    assert path.read_bytes() == expected


def test_y4m_bands_reject_a_partial_chroma_row_before_the_last_band(tmp_path):
    import numpy as np
    import pytest
    from hdr_finisher.y4m import write_y4m_bands

    bands = (np.zeros((3, 4, 3), np.uint16), np.zeros((3, 4, 3), np.uint16))
    with pytest.raises(ValueError):
        write_y4m_bands(tmp_path / "odd.y4m", 6, 4, bands, bit_depth=10, chroma_subsampling="420")


@pytest.mark.parametrize("writer", [exporters._write_sdr_y4m, exporters._write_hdr_y4m])
def test_avif_writer_closes_delivery_frame_when_band_write_fails(monkeypatch, tmp_path, writer):
    frame = DeliveryFrame.spill(tmp_path / "delivery.rgb", np.ones((259, 35, 3), np.float32))
    handles = []
    path_open = type(frame.path).open

    def track_open(path, *args, **kwargs):
        file = path_open(path, *args, **kwargs)
        if path == frame.path and args == ("rb",):
            handles.append(file)
        return file

    def fail_mid_write(path, height, width, bands, **kwargs):
        next(bands)
        assert not handles[0].closed
        raise OSError("disk full")

    monkeypatch.setattr(type(frame.path), "open", track_open)
    monkeypatch.setattr(exporters, "write_y4m_bands", fail_mid_write)
    with pytest.raises(OSError, match="disk full") as caught:
        writer(tmp_path / "failed.y4m", frame, bit_depth=10, chroma_subsampling="444")
    # The live traceback still owns the suspended band iterator.
    assert caught.value.__traceback__ is not None
    assert len(handles) == 1 and handles[0].closed
    frame.path.unlink()


def test_watermark_overwrite_counts_existing_frame_as_reusable(monkeypatch, tmp_path):
    from types import SimpleNamespace

    from hdr_finisher import delivery_frames

    path = tmp_path / "delivery.rgb"
    pixels = np.ones((16, 24, 3), np.float32)

    def render(allocate):
        mapped = allocate(pixels.shape)
        mapped[:] = pixels
        monkeypatch.setattr(delivery_frames.shutil, "disk_usage", lambda _: SimpleNamespace(free=0))
        return mapped + pixels

    frame = exporters._render_branch_to_file(path, render)
    assert path.read_bytes() == (pixels + pixels).tobytes()
    with pytest.raises(OSError, match="free scratch disk space"):
        DeliveryFrame.spill(tmp_path / "new.rgb", pixels)
    assert frame.path.exists()
