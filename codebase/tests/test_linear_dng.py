from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
import tifffile

from hdr_finisher.linear_dng import DngRoute, decode_linear_dng, inspect_dng
from hdr_finisher.resource_preflight import GIB, ResourceSnapshot


RESOURCES = ResourceSnapshot(64 * GIB, 48 * GIB, "test")


def _write_linear(path: Path, image: np.ndarray, *, subifd: bool = False) -> None:
    color_matrix = tuple(value for item in np.eye(3, dtype=int).reshape(-1) for value in (int(item), 1))
    neutral = (96422, 100000, 1, 1, 82521, 100000)
    extra = [
        (50706, "B", 4, b"\x01\x04\x00\x00", False),
        (50721, "2i", 9, color_matrix, False),
        (50964, "2i", 9, color_matrix, False),
        (50778, "H", 1, 23, False),
        (50728, "2I", 3, neutral, False),
    ]
    if subifd:
        with tifffile.TiffWriter(path) as tif:
            tif.write(np.zeros((2, 3, 3), np.uint8), photometric="rgb", subfiletype=1, subifds=1, extratags=extra)
            tif.write(
                image,
                photometric=34892,
                planarconfig="contig",
                metadata={"axes": "YXS"},
                subfiletype=0,
                extratags=extra,
            )
    else:
        tifffile.imwrite(
            path,
            image,
            photometric=34892,
            planarconfig="contig",
            metadata={"axes": "YXS"},
            extratags=extra,
        )


def test_root_preview_full_primary_subifd_is_selected_and_decoded(tmp_path: Path) -> None:
    path = tmp_path / "linear.dng"
    source = np.asarray([[[0, 32768, 65535], [65535, 0, 32768]]], dtype=np.uint16)
    _write_linear(path, source, subifd=True)
    inspection = inspect_dng(path, resource_snapshot=RESOURCES)
    assert inspection.route is DngRoute.LINEAR_DNG
    assert (inspection.width, inspection.height) == (2, 1)
    assert inspection.primary_series_index == 1
    image, metadata = decode_linear_dng(path, inspection)
    assert image.shape == source.shape
    assert image.dtype == np.float32
    assert metadata["experimental_dng_label"] == "Experimental DNG Import"


def test_mosaiced_primary_wins_over_reduced_linear_proxy(tmp_path: Path) -> None:
    path = tmp_path / "mosaic.dng"
    with tifffile.TiffWriter(path) as tif:
        tif.write(
            np.zeros((8, 12), np.uint16),
            photometric=32803,
            subifds=1,
            extratags=[
                (50706, "B", 4, b"\x01\x04\x00\x00", False),
                (33422, "B", 4, b"\x00\x01\x01\x02", False),
            ],
        )
        tif.write(np.zeros((2, 3, 3), np.uint16), photometric=34892, subfiletype=1)
    inspection = inspect_dng(path, resource_snapshot=RESOURCES)
    assert inspection.route is DngRoute.MOSAICED_RAW_DNG
    assert (inspection.width, inspection.height) == (12, 8)


def test_inspection_does_not_decode_payload(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    path = tmp_path / "linear.dng"
    _write_linear(path, np.zeros((2, 3, 3), np.uint16))

    def forbidden(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("payload decode attempted")

    monkeypatch.setattr(tifffile.TiffPage, "asarray", forbidden)
    assert inspect_dng(path, resource_snapshot=RESOURCES).route is DngRoute.LINEAR_DNG


def test_changed_file_fingerprint_rejects_before_decode(tmp_path: Path) -> None:
    path = tmp_path / "linear.dng"
    _write_linear(path, np.zeros((2, 3, 3), np.uint16))
    inspection = inspect_dng(path, resource_snapshot=RESOURCES)
    path.touch()
    with pytest.raises(Exception, match="changed after inspection"):
        decode_linear_dng(path, inspection)


def test_real_local_corpus_routes_when_present() -> None:
    root = Path("local-test-media/inputs/linear-dng")
    if not root.exists():
        pytest.skip("Ignored private Linear DNG corpus is not present.")
    expected = {
        "2018-05-26-11-35-40_NECTA0000_fbcb8f8f1d37db8bf93c0d46fb748355c01b7f8b.dng": DngRoute.LINEAR_DNG,
        "DSC06885_DxO.dng": DngRoute.LINEAR_DNG,
        "lightroom-classic-DNG-test-1.dng": DngRoute.MOSAICED_RAW_DNG,
        "DSC01204_ACR_Linear.dng": DngRoute.LINEAR_DNG,
        "DJI_0071-2-HDR.dng": DngRoute.LINEAR_DNG,
        "DJI_0071.DNG": DngRoute.MOSAICED_RAW_DNG,
        "DJI_0072.DNG": DngRoute.MOSAICED_RAW_DNG,
    }
    for path in root.rglob("*.[dD][nN][gG]"):
        inspection = inspect_dng(path, resource_snapshot=RESOURCES)
        assert inspection.route is expected[path.name], (path, inspection.rejection)
