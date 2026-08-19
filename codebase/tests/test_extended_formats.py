from __future__ import annotations

import time
from pathlib import Path

import numpy as np
from PIL import Image

from hdr_finisher.capabilities import probe_capabilities
from hdr_finisher.exporters import JPEGXLHDRExportBackend
from hdr_finisher.import_jobs import ImportJobManager
from hdr_finisher.jpegxl import decode_jpegxl, encode_hdr_jpegxl, inspect_jpegxl, validate_jpegxl
from hdr_finisher.loader import load_image
from hdr_finisher.media_browser import MediaBrowserStore
from hdr_finisher.models import AdjustmentState, CapabilityInfo, CapabilityStatus, EditDocument, ExportSettings, RawImportSettings, SourceReference
from hdr_finisher.models import LensCorrectionSettings
from hdr_finisher.raw_import import _remap_bilinear_strips, apply_lens_correction, list_lens_profiles
from hdr_finisher.sessions import SessionStore


def test_jpegxl_hdr_round_trip_carries_explicit_app_interpretation(tmp_path: Path) -> None:
    image = np.zeros((18, 24, 3), dtype=np.float32)
    image[..., 0] = np.linspace(0.0, 1.8, image.shape[1], dtype=np.float32)
    image[..., 1] = 0.18
    payload = encode_hdr_jpegxl(image, 100)
    assert validate_jpegxl(payload, image.shape[:2]).startswith("Validated")
    path = tmp_path / "round-trip.jxl"
    path.write_bytes(payload)

    info = inspect_jpegxl(path)
    assert info["bits_per_sample"] == 12
    assert info["app_metadata"]["transfer_function"] == "PQ"

    decoded, metadata = decode_jpegxl(path)
    assert decoded.shape == image.shape
    assert metadata["jpegxl_direct_hdr"] is True
    assert metadata["needs_color_override"] is False

    loaded, descriptor, loader_metadata, _analysis, _sdr = load_image(path)
    assert loaded.shape == image.shape
    assert descriptor.source_color_space == "ACEScg"
    assert loader_metadata["jpegxl_app_metadata"]["color_space"] == "BT.2020"


def test_capabilities_report_imagecodecs_jpegxl() -> None:
    capabilities = probe_capabilities()
    assert capabilities["jpegxl_import"].status == "available"
    assert capabilities["jpegxl_export"].status == "available"


def test_unmarked_third_party_jpegxl_requires_color_confirmation(tmp_path: Path) -> None:
    import imagecodecs

    source = np.full((8, 12, 3), 2048, dtype=np.uint16)
    path = tmp_path / "third-party.jxl"
    path.write_bytes(imagecodecs.jpegxl_encode(source, bitspersample=12, usecontainer=True))
    _image, descriptor, metadata, analysis, _sdr = load_image(path)
    assert descriptor.color_space_confident is False
    assert metadata["needs_color_override"] is True
    assert analysis.needs_color_override is True


def test_jpegxl_export_backend_writes_validated_atomic_output(tmp_path: Path) -> None:
    image = np.full((16, 20, 3), 0.18, dtype=np.float32)
    session = type(
        "Session",
        (),
        {"session_id": "jxl", "image": image, "sdr_reference_image": None, "adjustments": AdjustmentState(), "local_adjustments": []},
    )()
    output = tmp_path / "finished.jxl"
    result = JPEGXLHDRExportBackend(
        CapabilityInfo(name="JPEG XL", status=CapabilityStatus.AVAILABLE, detail="test")
    ).export(session, ExportSettings(format="jpegxl_hdr", quality=100, output_path=str(output)))
    assert result.accepted, result.message
    assert output.is_file()
    decoded, metadata = decode_jpegxl(output)
    assert decoded.shape == image.shape
    assert metadata["jpegxl_direct_hdr"] is True


def test_v1_project_document_migrates_raw_settings() -> None:
    document = EditDocument.model_validate(
        {
            "schema_version": 1,
            "source": {"filename": "legacy.exr"},
        }
    )
    assert document.schema_version == 2
    assert document.source.raw_import_settings == RawImportSettings()


def test_source_reference_serializes_manual_lens_selection() -> None:
    source = SourceReference.model_validate(
        {
            "filename": "camera.nef",
            "raw_import_settings": {
                "lens": {
                    "mode": "manual",
                    "profile_id": "Nikon|Z 8|Nikon|NIKKOR Z 24-70mm f/2.8 S",
                    "distortion": True,
                    "chromatic_aberration": False,
                    "vignetting": True,
                    "focal_length_mm": 35,
                }
            },
        }
    )
    assert source.raw_import_settings.lens.mode == "manual"
    assert source.raw_import_settings.lens.focal_length_mm == 35


def test_bounded_bilinear_remapper_preserves_identity() -> None:
    image = np.arange(5 * 7 * 3, dtype=np.float32).reshape(5, 7, 3)
    y, x = np.mgrid[:5, :7]
    coordinates = np.stack([x, y], axis=-1).astype(np.float32)
    remapped = _remap_bilinear_strips(image, coordinates, chromatic=False, rows=2)
    assert np.array_equal(remapped, image)


def test_manual_lensfun_profile_is_named_and_applied() -> None:
    profile = next(item for item in list_lens_profiles(limit=2000) if item.distortion)
    image = np.linspace(0.0, 1.0, 48 * 64 * 3, dtype=np.float32).reshape(48, 64, 3)
    corrected, metadata = apply_lens_correction(
        image,
        LensCorrectionSettings(
            mode="manual",
            profile_id=profile.id,
            focal_length_mm=5.0,
            aperture=4.0,
            distortion=True,
            chromatic_aberration=profile.chromatic_aberration,
            vignetting=False,
        ),
    )
    assert corrected.shape == image.shape
    assert metadata["applied"] is True
    assert metadata["profile"]["id"] == profile.id


def test_media_browser_persists_favorites_and_generates_thumbnail(tmp_path: Path) -> None:
    media = tmp_path / "media"
    media.mkdir()
    source = media / "sample.png"
    Image.new("RGB", (40, 20), (120, 80, 40)).save(source)
    browser = MediaBrowserStore(tmp_path / "app-data")

    listing = browser.list_directory(str(media), "source")
    entry = next(item for item in listing["entries"] if item["name"] == source.name)
    assert entry["supported"] is True
    assert entry["thumbnail_key"]

    favorites = browser.add_favorite(str(media))
    assert favorites[0]["available"] is True
    assert MediaBrowserStore(tmp_path / "app-data").favorites()[0]["path"] == str(media.resolve())
    thumbnail = browser.thumbnail(str(source), 128)
    with Image.open(thumbnail) as image:
        assert image.size == (128, 128)


def test_staged_import_job_exposes_preview_and_ready_session(tmp_path: Path) -> None:
    source = tmp_path / "source.png"
    Image.new("RGB", (64, 32), (80, 120, 160)).save(source)
    sessions = SessionStore()
    browser = MediaBrowserStore(tmp_path / "app-data")
    manager = ImportJobManager(sessions, browser, workers=1)
    try:
        job = manager.start(source, RawImportSettings())
        deadline = time.monotonic() + 5
        while job.state not in {"ready", "error"} and time.monotonic() < deadline:
            time.sleep(0.01)
        assert job.state == "ready", job.error
        assert job.preview_path is not None
        assert job.session_id == sessions.current().session_id
        assert job.payload()["elapsed_ms"] >= 0
    finally:
        manager.close()
