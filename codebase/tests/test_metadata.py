from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from hdr_finisher.metadata import extract_metadata
from hdr_finisher.models import LensCorrectionSettings
from hdr_finisher.raw_import import (
    _merge_missing_metadata,
    _read_libraw_metadata,
    _read_raw_exif,
    _resolve_lens_profile,
)


@pytest.mark.parametrize(
    ("camera_maker", "camera_model", "lens_model"),
    [
        ("SONY", "ILCE-7RM3", "E 35mm F2.8 F053"),
        ("Canon", "Canon EOS R5", "RF24-70mm F2.8 L IS USM"),
        ("NIKON CORPORATION", "NIKON Z 8", "NIKKOR Z 24-70mm f/2.8 S"),
        ("FUJIFILM", "X-T5", "XF16-55mmF2.8 R LM WR"),
    ],
)
def test_extract_metadata_reads_vendor_neutral_nested_raw_identity(
    camera_maker: str, camera_model: str, lens_model: str
) -> None:
    payload = extract_metadata(
        Path("camera.raw"),
        {
            "raw_exif": {
                "camera_maker": camera_maker,
                "camera_model": camera_model,
                "lens_model": lens_model,
                "iso": "800",
                "shutter_speed": "1/250",
            }
        },
    )

    assert payload.camera_model == camera_model
    assert payload.lens == lens_model
    assert payload.iso == "800"
    assert payload.shutter_speed == "1/250"


def test_extract_metadata_exposes_all_left_panel_raw_fields() -> None:
    payload = extract_metadata(
        Path("camera.arw"),
        {
            "raw_exif": {
                "camera_maker": "SONY",
                "camera_model": "ILCE-7RM3",
                "lens_maker": "ZEISS",
                "lens_model": "E 35mm F2.8 F053",
                "iso": "800",
                "shutter_speed": "1/250",
                "focal_length_mm": 35.0,
                "aperture": 4.0,
            }
        },
    )

    assert payload.model_dump(exclude={"extra"}) == {
        "camera_maker": "SONY",
        "camera_model": "ILCE-7RM3",
        "lens_maker": "ZEISS",
        "lens": "E 35mm F2.8 F053",
        "iso": "800",
        "shutter_speed": "1/250",
        "focal_length_mm": "35.0",
        "aperture": "4.0",
        "bit_depth": "unknown",
        "color_space": "unknown",
        "transfer_function": None,
    }


def test_extract_metadata_supports_legacy_nested_lens_name() -> None:
    payload = extract_metadata(
        Path("legacy.nef"),
        {"raw_exif": {"camera_model": "NIKON D850", "lens_name": "24.0-70.0 mm f/2.8"}},
    )

    assert payload.camera_model == "NIKON D850"
    assert payload.lens == "24.0-70.0 mm f/2.8"


def test_top_level_canonical_metadata_wins_over_nested_fallback() -> None:
    payload = extract_metadata(
        Path("camera.cr3"),
        {
            "camera_model": "Top-level camera",
            "lens": "Top-level lens",
            "raw_exif": {"camera_model": "Nested camera", "lens_model": "Nested lens"},
        },
    )

    assert payload.camera_model == "Top-level camera"
    assert payload.lens == "Top-level lens"


def test_raw_exif_reader_uses_standard_cross_vendor_tags(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[dict[str, object]] = []

    def process_file(_handle, **kwargs):
        calls.append(kwargs)
        return {
            "Image Make": "NIKON CORPORATION",
            "Image Model": "NIKON Z 8",
            "EXIF LensMake": "NIKON",
            "EXIF LensModel": "NIKKOR Z 24-70mm f/2.8 S",
            "EXIF ISOSpeedRatings": "640",
            "EXIF ExposureTime": "1/200",
            "EXIF FocalLength": 35,
            "EXIF FNumber": 2.8,
        }

    monkeypatch.setitem(sys.modules, "exifread", SimpleNamespace(process_file=process_file))
    source = tmp_path / "camera.nef"
    source.write_bytes(b"raw")

    metadata = _read_raw_exif(source)

    assert metadata == {
        "camera_maker": "NIKON CORPORATION",
        "camera_model": "NIKON Z 8",
        "lens_maker": "NIKON",
        "lens_model": "NIKKOR Z 24-70mm f/2.8 S",
        "iso": "640",
        "shutter_speed": "1/200",
        "focal_length_mm": 35.0,
        "aperture": 2.8,
    }
    assert calls == [{"details": False, "extract_thumbnail": False}]


def test_libraw_metadata_fills_vendor_aware_lens_and_shot_fallbacks() -> None:
    raw = SimpleNamespace(
        lens=SimpleNamespace(make="SIGMA\x00", model="24-70mm F2.8 DG DN | A\x00"),
        other=SimpleNamespace(focal_length=50.0, aperture=4.0, iso_speed=1250.0, shutter_speed=0.004),
    )

    fallback = _read_libraw_metadata(raw)
    merged = _merge_missing_metadata(
        {"camera_maker": "Panasonic", "camera_model": "DC-S5M2", "iso": "1000"},
        fallback,
    )

    assert merged["camera_maker"] == "Panasonic"
    assert merged["camera_model"] == "DC-S5M2"
    assert merged["lens_maker"] == "SIGMA"
    assert merged["lens_model"] == "24-70mm F2.8 DG DN | A"
    assert merged["focal_length_mm"] == 50.0
    assert merged["aperture"] == 4.0
    assert merged["iso"] == "1000"
    assert merged["shutter_speed"] == 0.004


def test_auto_lensfun_match_passes_exact_camera_and_lens_identity() -> None:
    camera = SimpleNamespace(
        maker="NIKON CORPORATION",
        model="NIKON Z 8",
        mount="Nikon Z",
        crop_factor=1.0,
    )
    lens = SimpleNamespace(
        maker="Nikon",
        model="NIKKOR Z 24-70mm f/2.8 S",
        mounts=["Nikon Z"],
        calib_distortion=[SimpleNamespace(focal=24.0)],
        calib_tca=[],
        calib_vignetting=[],
    )
    expected_lens = lens
    calls: list[tuple[object, ...]] = []

    class FakeDatabase:
        def find_cameras(self, maker, model):
            calls.append(("camera", maker, model))
            return [camera]

        def find_lenses(self, selected_camera, *, maker, lens):
            calls.append(("lens", selected_camera, maker, lens))
            return [expected_lens]

    resolved = _resolve_lens_profile(
        FakeDatabase(),
        LensCorrectionSettings(mode="auto"),
        camera_maker="NIKON CORPORATION",
        camera_model="NIKON Z 8",
        lens_maker="Nikon",
        lens_name="NIKKOR Z 24-70mm f/2.8 S",
    )

    assert resolved is not None
    assert resolved[0] is camera
    assert resolved[1] is lens
    assert calls == [
        ("camera", "NIKON CORPORATION", "NIKON Z 8"),
        ("lens", camera, "Nikon", "NIKKOR Z 24-70mm f/2.8 S"),
    ]
