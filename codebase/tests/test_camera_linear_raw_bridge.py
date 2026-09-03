from __future__ import annotations

from pathlib import Path
import sys
from types import SimpleNamespace

import numpy as np
import pytest

from hdr_finisher.models import (
    LensCorrectionSettings,
    RawHighlightReconstructionSettings,
    RawImportSettings,
)
from hdr_finisher.raw_import import (
    CAMERA_LINEAR_PIPELINE,
    LEGACY_RAW_PIPELINE,
    LIBRAW_MATRIX_REFERENCE_WHITE_D65,
    CameraLinearMetadata,
    RawImportError,
    _apply_raw_highlight_reconstruction,
    _camera_linear_metadata_from_libraw,
    _camera_rgb_to_acescg_float32,
    _normalize_camera_rgb_float32,
    _transport_diagnostics,
    decode_raw,
)


def _raw_metadata(**updates: object) -> dict[str, object]:
    values: dict[str, object] = {
        "raw_pattern": np.asarray([[0, 1], [3, 2]], dtype=np.uint8),
        "num_colors": 3,
        "color_desc": b"RGBG",
        "black_level_per_channel": [100, 100, 100, 100],
        "camera_white_level_per_channel": [1100, 1100, 1100, 1100],
        "white_level": 1200,
        "camera_whitebalance": [2.0, 1.0, 1.5, 1.0],
        "daylight_whitebalance": [1.8, 1.0, 1.3, 0.0],
        "rgb_xyz_matrix": np.asarray(
            [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0], [0.0, 0.0, 0.0]],
            dtype=np.float32,
        ),
        "sizes": SimpleNamespace(width=3, height=2, raw_width=3, raw_height=2),
        "lens": None,
        "other": None,
    }
    values.update(updates)
    return values


def _metadata(**updates: object) -> CameraLinearMetadata:
    values: dict[str, object] = {
        "black_level": np.asarray([100.0, 100.0, 100.0]),
        "white_level": np.asarray([1100.0, 1100.0, 1100.0]),
        "raw_black_level": np.asarray([100.0, 100.0, 100.0, 100.0]),
        "raw_white_level": np.asarray([1100.0, 1100.0, 1100.0, 1100.0]),
        "raw_pattern": np.asarray([[0, 1], [3, 2]], dtype=np.uint8),
        "raw_channel_to_rgb": np.asarray([0, 1, 2, 1], dtype=np.int8),
        "as_shot_wb": np.asarray([1.0, 1.0, 1.0]),
        "camera_to_xyz_d65": np.eye(3),
        "camera_to_acescg": np.eye(3),
        "color_description": "RGBG",
        "normalization_basis": "camera_white_minus_black",
        "matrix_source": "synthetic",
        "matrix_reference_white": "D65",
        "white_level_source": "camera_white_level_per_channel",
        "wb_channel_sources": ("R", "G", "B"),
    }
    values.update(updates)
    return CameraLinearMetadata(**values)  # type: ignore[arg-type]


def _install_rawpy(
    monkeypatch: pytest.MonkeyPatch,
    transport: np.ndarray,
    **metadata_updates: object,
) -> tuple[dict[str, object], type]:
    calls: dict[str, object] = {}
    attributes = _raw_metadata(**metadata_updates)

    class FakeRaw:
        def __init__(self) -> None:
            self.raw_image_visible = np.full((4, 4), 100, dtype=np.uint16)

        def __enter__(self):
            return self

        def __exit__(self, *_args: object) -> bool:
            return False

        def postprocess(self, **kwargs: object) -> np.ndarray:
            calls.update(kwargs)
            return transport.copy()

    for name, value in attributes.items():
        setattr(FakeRaw, name, value)
    fake_rawpy = SimpleNamespace(
        __version__="0.27.0",
        libraw_version=(0, 22, 1),
        imread=lambda _path: FakeRaw(),
        DemosaicAlgorithm=SimpleNamespace(AHD="AHD"),
        ColorSpace=SimpleNamespace(ACES="ACES", raw="raw"),
        HighlightMode=SimpleNamespace(Clip="Clip"),
    )
    monkeypatch.setitem(sys.modules, "rawpy", fake_rawpy)
    monkeypatch.setattr("hdr_finisher.raw_import._read_raw_exif", lambda _path: {})
    return calls, FakeRaw


def test_bridge_uses_exact_neutral_libraw_contract_and_records_transport(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    transport = np.asarray(
        [[[0, 1000, 65535], [500, 250, 125], [1000, 500, 250]]] * 2,
        dtype=np.uint16,
    )
    calls, _ = _install_rawpy(monkeypatch, transport)
    path = tmp_path / "ordinary.cr2"
    path.write_bytes(b"synthetic")

    image, metadata = decode_raw(
        path, RawImportSettings(lens=LensCorrectionSettings(mode="off"))
    )

    assert calls == {
        "demosaic_algorithm": "AHD",
        "use_camera_wb": False,
        "use_auto_wb": False,
        "user_wb": [1.0, 1.0, 1.0, 1.0],
        "no_auto_bright": True,
        "no_auto_scale": True,
        "output_color": "raw",
        "gamma": (1.0, 1.0),
        "output_bps": 16,
        "highlight_mode": "Clip",
    }
    assert image.dtype == np.float32
    assert image.flags.c_contiguous
    development = metadata["raw_development"]
    assert development["pipeline"] == CAMERA_LINEAR_PIPELINE
    assert metadata["raw_pipeline"] == CAMERA_LINEAR_PIPELINE
    assert development["transport_exact_65535_count"] == [0, 0, 2]
    assert development["black_subtracted_exactly_once"] is True
    assert development["highlight_reconstruction"]["enabled"] is True
    assert development["highlight_reconstruction"]["applied"] is True
    assert metadata["bit_depth"] == "16-bit LibRaw camera-RGB transport; float32 color development"


def test_opposed_color_reconstruction_repairs_clipped_green_before_ahd() -> None:
    metadata = _metadata(as_shot_wb=np.asarray([2.0, 1.0, 1.5]))
    mosaic = np.full((9, 9), 900, dtype=np.uint16)
    mosaic[4, 5] = 1100  # green photosite in the RGBG pattern
    original = mosaic.copy()
    raw = SimpleNamespace(raw_image_visible=mosaic)
    settings = RawImportSettings(
        lens=LensCorrectionSettings(mode="off"),
        highlight_reconstruction=RawHighlightReconstructionSettings(
            enabled=True,
            method="opposed_color_v1",
            clipping_threshold=1.0,
        ),
    )

    diagnostics = _apply_raw_highlight_reconstruction(raw, metadata, settings)

    assert diagnostics["applied"] is True
    assert diagnostics["clipped_photosites_per_rgb"] == [0, 1, 0]
    assert diagnostics["reconstructed_photosites_per_rgb"] == [0, 1, 0]
    assert mosaic[4, 5] > original[4, 5]
    unchanged = np.ones(mosaic.shape, dtype=bool)
    unchanged[4, 5] = False
    assert np.array_equal(mosaic[unchanged], original[unchanged])


def test_opposed_color_bypass_does_not_touch_raw_mosaic() -> None:
    metadata = _metadata()
    mosaic = np.full((4, 4), 1100, dtype=np.uint16)
    original = mosaic.copy()
    settings = RawImportSettings(
        highlight_reconstruction=RawHighlightReconstructionSettings(enabled=False)
    )

    diagnostics = _apply_raw_highlight_reconstruction(
        SimpleNamespace(raw_image_visible=mosaic), metadata, settings
    )

    assert diagnostics["applied"] is False
    assert diagnostics["reason"] == "bypassed_in_raw_recipe"
    assert np.array_equal(mosaic, original)


def test_opposed_color_reconstruction_is_deterministic_for_xtrans() -> None:
    pattern = np.asarray(
        [
            [0, 2, 1, 2, 0, 1],
            [1, 1, 0, 1, 1, 2],
            [1, 1, 2, 1, 1, 0],
            [2, 0, 1, 0, 2, 1],
            [1, 1, 2, 1, 1, 0],
            [1, 1, 0, 1, 1, 2],
        ],
        dtype=np.uint8,
    )
    metadata = _metadata(
        raw_pattern=pattern,
        raw_channel_to_rgb=np.asarray([0, 1, 2, -1], dtype=np.int8),
        as_shot_wb=np.asarray([1.2, 1.0, 2.2]),
    )
    source = np.full((12, 12), 900, dtype=np.uint16)
    source[6, 8] = 1100  # green in this X-Trans phase
    settings = RawImportSettings()
    first = source.copy()
    second = source.copy()

    first_diagnostics = _apply_raw_highlight_reconstruction(
        SimpleNamespace(raw_image_visible=first), metadata, settings
    )
    second_diagnostics = _apply_raw_highlight_reconstruction(
        SimpleNamespace(raw_image_visible=second), metadata, settings
    )

    assert np.array_equal(first, second)
    assert first_diagnostics == second_diagnostics
    assert first_diagnostics["reconstructed_photosites_per_rgb"] == [0, 1, 0]
    assert first[6, 8] > source[6, 8]


def test_normalization_does_not_subtract_black_twice_and_does_not_clip() -> None:
    transport = np.asarray([[[0, 1000, 2000]]], dtype=np.uint16)
    normalized = _normalize_camera_rgb_float32(transport, _metadata())

    assert normalized.dtype == np.float32
    assert np.array_equal(normalized, np.asarray([[[0.0, 1.0, 2.0]]], dtype=np.float32))


def test_wb_maps_rgbg_through_color_desc_with_green_reference() -> None:
    raw = SimpleNamespace(**_raw_metadata(camera_whitebalance=[4.0, 2.0, 6.0, 2.0]))
    metadata = _camera_linear_metadata_from_libraw(raw)

    assert np.array_equal(metadata.as_shot_wb, np.asarray([2.0, 1.0, 3.0]))
    assert metadata.wb_channel_sources[1] == "color_desc[1]+color_desc[3]"
    assert np.allclose(metadata.camera_to_xyz_d65 @ np.ones(3), LIBRAW_MATRIX_REFERENCE_WHITE_D65)


def test_xtrans_rgb_metadata_qualifies_with_global_white_fallback() -> None:
    pattern = np.asarray(
        [
            [0, 2, 1, 2, 0, 1],
            [1, 1, 0, 1, 1, 2],
            [1, 1, 2, 1, 1, 0],
            [2, 0, 1, 0, 2, 1],
            [1, 1, 2, 1, 1, 0],
            [1, 1, 0, 1, 1, 2],
        ],
        dtype=np.uint8,
    )
    raw = SimpleNamespace(
        **_raw_metadata(
            raw_pattern=pattern,
            camera_white_level_per_channel=None,
            white_level=4095,
            camera_whitebalance=[2.0, 1.0, 1.5, 0.0],
        )
    )

    metadata = _camera_linear_metadata_from_libraw(raw)

    assert metadata.white_level_source == "libraw_global_white_fallback"
    assert np.array_equal(metadata.white_level, np.full(3, 4095.0))


def test_float32_wb_and_matrix_preserve_negative_and_above_one_values() -> None:
    camera = np.asarray([[[0.75, 0.5, 1.5]]], dtype=np.float32)
    metadata = _metadata(
        as_shot_wb=np.asarray([2.0, 1.0, 1.0]),
        camera_to_acescg=np.asarray(
            [[1.0, -4.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 2.0]], dtype=np.float64
        ),
    )

    converted = _camera_rgb_to_acescg_float32(camera, metadata)

    assert converted.dtype == np.float32
    assert converted[0, 0, 0] == pytest.approx(-0.5)
    assert converted[0, 0, 2] == pytest.approx(3.0)


@pytest.mark.parametrize(
    ("updates", "reason"),
    [
        ({"camera_whitebalance": [0.0, 1.0, 1.0, 1.0]}, "white balance"),
        ({"white_level": 0, "camera_white_level_per_channel": None}, "global white"),
        ({"rgb_xyz_matrix": np.zeros((4, 3))}, "camera matrix"),
        ({"rgb_xyz_matrix": [["invalid"]]}, "camera matrix"),
        ({"color_desc": b"GMCY"}, "non-RGB"),
        ({"num_colors": 4}, "four-color"),
        ({"num_colors": None}, "color count"),
    ],
)
def test_invalid_or_unsupported_metadata_takes_explicit_legacy_fallback(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    updates: dict[str, object],
    reason: str,
) -> None:
    calls, _ = _install_rawpy(monkeypatch, np.full((2, 3, 3), 1000, dtype=np.uint16), **updates)
    path = tmp_path / "fallback.raw"
    path.write_bytes(b"synthetic")

    _, metadata = decode_raw(
        path, RawImportSettings(lens=LensCorrectionSettings(mode="off"))
    )

    assert calls["output_color"] == "ACES"
    assert "no_auto_scale" not in calls
    assert metadata["raw_development"]["pipeline"] == LEGACY_RAW_PIPELINE
    assert reason in metadata["raw_development"]["fallback_reason"]
    assert metadata["raw_pipeline"] == LEGACY_RAW_PIPELINE
    assert reason in metadata["raw_fallback_reason"]


def test_route_selection_depends_on_metadata_not_transport_content(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    pipelines = []
    for index, fill in enumerate((0, 65535)):
        calls, _ = _install_rawpy(
            monkeypatch, np.full((2, 3, 3), fill, dtype=np.uint16)
        )
        path = tmp_path / f"content-{index}.nef"
        path.write_bytes(bytes([index]))
        _, metadata = decode_raw(
            path, RawImportSettings(lens=LensCorrectionSettings(mode="off"))
        )
        pipelines.append(metadata["raw_development"]["pipeline"])
        assert calls["output_color"] == "raw"
    assert pipelines == [CAMERA_LINEAR_PIPELINE, CAMERA_LINEAR_PIPELINE]


def test_bridge_bounded_stages_honor_cancellation() -> None:
    transport = np.zeros((4, 4, 3), dtype=np.uint16)
    with pytest.raises(RawImportError, match="cancelled"):
        _normalize_camera_rgb_float32(transport, _metadata(), rows=1, cancelled=lambda: True)
    with pytest.raises(RawImportError, match="cancelled"):
        _camera_rgb_to_acescg_float32(
            transport.astype(np.float32), _metadata(), rows=1, cancelled=lambda: True
        )
    with pytest.raises(RawImportError, match="cancelled"):
        _transport_diagnostics(transport, rows=1, cancelled=lambda: True)


def test_bridge_applies_lensfun_after_float_color_development(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _install_rawpy(monkeypatch, np.full((2, 3, 3), 500, dtype=np.uint16))
    events: list[str] = []

    def convert(image: np.ndarray, _metadata: object, **_kwargs: object) -> np.ndarray:
        events.append("float_color")
        image.fill(np.float32(2.5))
        return image

    def correct(image: np.ndarray, *_args: object, **_kwargs: object):
        events.append("lensfun")
        assert image.dtype == np.float32
        assert np.all(image == np.float32(2.5))
        return image, {"mode": "manual", "applied": True}

    monkeypatch.setattr("hdr_finisher.raw_import._camera_rgb_to_acescg_float32", convert)
    monkeypatch.setattr("hdr_finisher.raw_import.apply_lens_correction", correct)
    path = tmp_path / "lens-order.arw"
    path.write_bytes(b"synthetic")

    image, metadata = decode_raw(
        path, RawImportSettings(lens=LensCorrectionSettings(mode="manual"))
    )

    assert events == ["float_color", "lensfun"]
    assert np.all(image == np.float32(2.5))
    assert metadata["lens_correction"]["applied"] is True
