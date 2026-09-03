from __future__ import annotations

from pathlib import Path
import struct
import sys
from types import SimpleNamespace

import numpy as np
import pytest

from hdr_finisher.dng_opcodes import DngOpcode
from hdr_finisher.models import LensCorrectionSettings, RawImportSettings
from hdr_finisher.raw_import import RawImportError, decode_raw


def _inspection() -> SimpleNamespace:
    gain_header = struct.pack(
        ">8I2I4dI",
        0, 0, 4, 4, 0, 3, 1, 1,
        1, 1, 1.0, 1.0, 0.0, 0.0, 1,
    )
    gain = gain_header + struct.pack(">f", 2.0)
    warp = struct.pack(">I", 1) + struct.pack(">6d", 1, 0, 0, 0, 0, 0) + struct.pack(">2d", 0.5, 0.5)
    return SimpleNamespace(
        required_opcodes=(
            DngOpcode("OpcodeList3", 0, 9, "GainMap", (1, 3, 0, 0), 0, gain),
            DngOpcode("OpcodeList3", 1, 1, "WarpRectilinear", (1, 3, 0, 0), 0, warp),
        ),
        optional_opcodes=(),
        metadata={
            "color_matrix1": np.eye(3),
            "forward_matrix1": np.eye(3),
            "color_matrix2": None,
            "forward_matrix2": None,
            "camera_calibration1": None,
            "camera_calibration2": None,
            "analog_balance": np.ones(3),
            "as_shot_neutral": np.ones(3),
            "black_level": np.zeros(3),
            "white_level": np.ones(3),
            "baseline_exposure": 0.0,
            "calibration_illuminant1": 23,
            "calibration_illuminant2": None,
            "active_area": np.asarray([0, 0, 4, 4]),
            "default_crop_origin": np.asarray([0.0, 0.0]),
            "default_crop_size": np.asarray([4.0, 4.0]),
            "orientation": 1,
        },
    )


def _install_rawpy(monkeypatch: pytest.MonkeyPatch, *, libraw_version: tuple[int, int, int] = (0, 22, 1)) -> dict[str, object]:
    calls: dict[str, object] = {}

    class FakeRaw:
        raw_pattern = np.asarray([[0, 1], [1, 2]])
        camera_whitebalance = [2, 1, 1.5, 1]
        daylight_whitebalance = [1.8, 1, 1.4, 1]
        sizes = SimpleNamespace(width=4, height=4, raw_width=4, raw_height=4)

        def __enter__(self) -> FakeRaw:
            return self

        def __exit__(self, *_args: object) -> bool:
            return False

        def postprocess(self, **kwargs: object) -> np.ndarray:
            calls.update(kwargs)
            return np.full((4, 4, 3), 16_384, dtype=np.uint16)

    fake = SimpleNamespace(
        __version__="0.27.0",
        libraw_version=libraw_version,
        imread=lambda _path: FakeRaw(),
        DemosaicAlgorithm=SimpleNamespace(AHD="AHD"),
        ColorSpace=SimpleNamespace(ACES="ACES", raw="raw"),
        HighlightMode=SimpleNamespace(Clip="Clip"),
    )
    monkeypatch.setitem(sys.modules, "rawpy", fake)
    monkeypatch.setattr("hdr_finisher.raw_import._read_raw_exif", lambda _path: {})
    return calls


def test_mandatory_dng_operations_run_once_in_camera_linear_order_and_disable_auto_lensfun(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    calls = _install_rawpy(monkeypatch)
    path = tmp_path / "source.dng"
    path.write_bytes(b"DNG")
    image, metadata = decode_raw(path, RawImportSettings(), dng_inspection=_inspection())
    assert calls["output_color"] == "raw"
    assert calls["use_camera_wb"] is False
    assert calls["user_flip"] == 0
    assert calls["highlight_mode"] == "Clip"
    assert metadata["raw_development"]["highlight_mode"] == "clip"
    audit = metadata["dng_opcode_audit"]
    assert [item["name"] for item in audit["operations"]] == ["GainMap", "WarpRectilinear"]
    assert [item["status"] for item in audit["operations"]] == ["applied", "applied"]
    assert audit["application_stage"] == "camera_linear_after_demosaic_before_dng_color_transform"
    assert metadata["lens_correction"]["requested_mode"] == "auto"
    assert metadata["lens_correction"]["applied"] is False
    assert image.dtype == np.float32


def test_unaudited_libraw_version_rejects_before_mandatory_operations(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _install_rawpy(monkeypatch, libraw_version=(0, 23, 0))
    path = tmp_path / "source.dng"
    path.write_bytes(b"DNG")
    with pytest.raises(RawImportError, match="has not been audited"):
        decode_raw(path, RawImportSettings(), dng_inspection=_inspection())


def test_manual_lensfun_cannot_stack_with_mandatory_dng_operations(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _install_rawpy(monkeypatch)
    path = tmp_path / "source.dng"
    path.write_bytes(b"DNG")
    settings = RawImportSettings(lens=LensCorrectionSettings(mode="manual", profile_id="profile"))
    with pytest.raises(RawImportError, match="cannot be combined"):
        decode_raw(path, settings, dng_inspection=_inspection())
