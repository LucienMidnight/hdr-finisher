from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from threading import Event
from types import SimpleNamespace

import numpy as np
import pytest
from PIL import Image

from hdr_finisher.capabilities import probe_capabilities
from hdr_finisher.exporters import JPEGXLHDRExportBackend
from hdr_finisher.import_jobs import ImportJobManager
from hdr_finisher.jpegxl import (
    _box,
    _parse_codestream_basic_info,
    decode_jpegxl,
    encode_hdr_jpegxl,
    encode_sdr_jpegxl,
    inspect_jpegxl,
    validate_jpegxl,
    validate_sdr_jpegxl,
)
from hdr_finisher.loader import load_image
from hdr_finisher.media_browser import MediaBrowserError, MediaBrowserStore, _apply_libraw_orientation
from hdr_finisher.models import AdjustmentState, CapabilityInfo, CapabilityStatus, EditCommand, EditDocument, ExportSettings, RawImportSettings, SourceInterpretationOverride, SourceReference
from hdr_finisher.models import LensCorrectionSettings
from hdr_finisher.raw_import import RawImportError, _remap_bilinear_strips, apply_lens_correction, decode_raw, list_lens_profiles
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
    assert info["app_metadata"]["sample_type"] == "integer"

    decoded, metadata = decode_jpegxl(path)
    assert decoded.shape == image.shape
    assert metadata["jpegxl_direct_hdr"] is True
    assert metadata["sample_type"] == "integer"
    assert metadata["needs_color_override"] is False
    assert metadata["decoder_normalized_to_acescg"] is True

    loaded, descriptor, loader_metadata, _analysis, _sdr = load_image(path)
    assert loaded.shape == image.shape
    assert descriptor.source_color_space == "ACEScg"
    assert loader_metadata["jpegxl_app_metadata"]["color_space"] == "BT.2020"


@pytest.mark.parametrize(
    ("precision", "bit_depth", "sample_type", "decoded_dtype"),
    [
        ("uint10", 10, "integer", np.dtype(np.uint16)),
        ("uint12", 12, "integer", np.dtype(np.uint16)),
        ("uint16", 16, "integer", np.dtype(np.uint16)),
        ("float16", 16, "float", np.dtype(np.float16)),
        ("float32", 32, "float", np.dtype(np.float32)),
    ],
)
def test_jpegxl_export_preserves_selected_precision(
    tmp_path: Path,
    precision: str,
    bit_depth: int,
    sample_type: str,
    decoded_dtype: np.dtype,
) -> None:
    import imagecodecs

    image = np.linspace(0.0, 2.0, 18 * 24 * 3, dtype=np.float32).reshape(18, 24, 3)
    payload = encode_hdr_jpegxl(image, 100, precision)
    validation = validate_jpegxl(payload, image.shape[:2], precision)
    path = tmp_path / f"{precision}.jxl"
    path.write_bytes(payload)

    info = inspect_jpegxl(path)
    raw = np.asarray(imagecodecs.jpegxl_decode(payload))

    assert f"{bit_depth}-bit {sample_type}" in validation
    assert info["bits_per_sample"] == bit_depth
    assert info["exponent_bits_per_sample"] > 0 if sample_type == "float" else info["exponent_bits_per_sample"] == 0
    assert info["app_metadata"]["bit_depth"] == bit_depth
    assert info["app_metadata"]["sample_type"] == sample_type
    assert raw.dtype == decoded_dtype

    decoded, metadata = decode_jpegxl(path)
    assert decoded.shape == image.shape
    assert metadata["bit_depth"] == str(bit_depth)
    assert metadata["sample_type"] == sample_type


def test_jpegxl_rejects_unoffered_eight_bit_precision() -> None:
    image = np.full((4, 6, 3), 0.18, dtype=np.float32)
    with pytest.raises(RuntimeError, match="Unsupported JPEG XL precision"):
        encode_hdr_jpegxl(image, 100, "uint8")


def test_sdr_jpegxl_round_trip_is_explicit_eight_bit_srgb(tmp_path: Path) -> None:
    import imagecodecs

    image = np.linspace(0.0, 1.0, 18 * 24 * 3, dtype=np.float32).reshape(18, 24, 3)
    payload = encode_sdr_jpegxl(image, 100)
    assert validate_sdr_jpegxl(payload, image.shape[:2]).startswith("Validated")
    path = tmp_path / "sdr-round-trip.jxl"
    path.write_bytes(payload)

    info = inspect_jpegxl(path)
    raw = np.asarray(imagecodecs.jpegxl_decode(payload))
    decoded, metadata = decode_jpegxl(path)

    assert info["bits_per_sample"] == 8
    assert info["app_metadata"]["color_space"] == "sRGB"
    assert info["app_metadata"]["transfer_function"] == "sRGB"
    assert raw.dtype == np.uint8
    assert decoded.shape == image.shape
    assert metadata["bit_depth"] == "8"
    assert metadata["sample_type"] == "integer"
    assert metadata["jpegxl_direct_hdr"] is False
    assert metadata["needs_color_override"] is False


def test_jpegxl_decode_reads_the_container_once(tmp_path: Path, monkeypatch) -> None:
    image = np.full((8, 12, 3), 0.18, dtype=np.float32)
    path = tmp_path / "single-read.jxl"
    path.write_bytes(encode_hdr_jpegxl(image, 100))
    original_read_bytes = Path.read_bytes
    reads = 0

    def tracked_read_bytes(candidate: Path) -> bytes:
        nonlocal reads
        if candidate == path:
            reads += 1
        return original_read_bytes(candidate)

    monkeypatch.setattr(Path, "read_bytes", tracked_read_bytes)

    decode_jpegxl(path)

    assert reads == 1


@pytest.mark.parametrize("bit_depth", [8, 10, 12, 16])
def test_jpegxl_basic_info_fallback_reads_codestream_precision(bit_depth: int) -> None:
    import imagecodecs

    dtype = np.uint8 if bit_depth == 8 else np.uint16
    source = np.zeros((18, 24, 3), dtype=dtype)
    payload = bytes(
        imagecodecs.jpegxl_encode(
            source,
            bitspersample=bit_depth,
            lossless=True,
            usecontainer=True,
        )
    )

    info = _parse_codestream_basic_info(payload)

    assert info["width"] == 24
    assert info["height"] == 18
    assert info["bits_per_sample"] == bit_depth
    assert info["exponent_bits_per_sample"] == 0


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


def test_dark_twelve_bit_jpegxl_never_infers_precision_from_brightness(tmp_path: Path, monkeypatch) -> None:
    import imagecodecs

    source = np.full((8, 12, 3), 64, dtype=np.uint16)
    marker = {
        "schema_version": 3,
        "color_space": "BT.2020",
        "transfer_function": "PQ",
        "bit_depth": 12,
        "sample_type": "integer",
        "reference_white_nits": 203.0,
    }
    payload = bytes(imagecodecs.jpegxl_encode(source, bitspersample=12, usecontainer=True))
    payload += _box(b"hfmd", json.dumps(marker, separators=(",", ":")).encode("utf-8"))
    path = tmp_path / "dark-12-bit.jxl"
    path.write_bytes(payload)
    monkeypatch.setattr("hdr_finisher.jpegxl._probe_basic_info", lambda _payload: {})

    decoded, _metadata = decode_jpegxl(path)

    # PQ decoding is nonlinear, but resolving 64 as 8-bit would make this value
    # hundreds of times brighter than the declared 12-bit signal.
    expected_code = np.float32(64.0 / 4095.0)
    from hdr_finisher.color import normalize_to_acescg

    expected = normalize_to_acescg(np.full_like(source, expected_code, dtype=np.float32), "BT.2020", "PQ")
    assert np.allclose(decoded, expected, rtol=1e-5, atol=1e-7)


def test_unmarked_high_precision_jpegxl_rejects_ambiguous_precision(tmp_path: Path, monkeypatch) -> None:
    import imagecodecs

    source = np.full((8, 12, 3), 64, dtype=np.uint16)
    path = tmp_path / "ambiguous.jxl"
    path.write_bytes(imagecodecs.jpegxl_encode(source, bitspersample=12, usecontainer=True))
    monkeypatch.setattr("hdr_finisher.jpegxl._probe_basic_info", lambda _payload: {})

    with pytest.raises(RuntimeError, match="refusing to infer bit depth"):
        decode_jpegxl(path)


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
    ).export(
        session,
        ExportSettings(
            format="jpegxl_hdr",
            quality=100,
            jpegxl_precision="float16",
            output_path=str(output),
        ),
    )
    assert result.accepted, result.message
    assert output.is_file()
    decoded, metadata = decode_jpegxl(output)
    assert decoded.shape == image.shape
    assert metadata["jpegxl_direct_hdr"] is True
    assert metadata["bit_depth"] == "16"
    assert metadata["sample_type"] == "float"


def test_v1_project_document_is_rejected_without_migration() -> None:
    with pytest.raises(ValueError, match="Unsupported prototype project schema"):
        EditDocument.model_validate(
            {
                "schema_version": 1,
                "source": {"filename": "prototype.exr"},
            }
        )


def test_source_reference_serializes_manual_lens_selection() -> None:
    source = SourceReference.model_validate(
        {
            "filename": "camera.nef",
            "luminance": {"luminance_semantics": "scene_relative", "transfer_function": "linear"},
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


def test_raw_decoder_returns_canonical_acescg_without_second_loader_transform(
    tmp_path: Path, monkeypatch
) -> None:
    developed = np.zeros((4, 6, 3), dtype=np.uint16)
    developed[..., 0] = 8192
    developed[..., 1] = 4096

    class FakeRaw:
        raw_pattern = np.array([[0, 1], [1, 2]], dtype=np.uint8)
        camera_whitebalance = [2.0, 1.0, 1.5, 1.0]
        daylight_whitebalance = [1.8, 1.0, 1.4, 1.0]
        sizes = SimpleNamespace(width=6, height=4, raw_width=6, raw_height=4)

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def postprocess(self, **_kwargs):
            return developed.copy()

    fake_rawpy = SimpleNamespace(
        imread=lambda _path: FakeRaw(),
        DemosaicAlgorithm=SimpleNamespace(AHD="AHD"),
        ColorSpace=SimpleNamespace(ACES="ACES"),
        HighlightMode=SimpleNamespace(Clip="Clip"),
    )
    monkeypatch.setitem(sys.modules, "rawpy", fake_rawpy)
    monkeypatch.setattr("hdr_finisher.raw_import._read_raw_exif", lambda _path: {})
    source = tmp_path / "synthetic.dng"
    source.write_bytes(b"synthetic raw")

    image, metadata = decode_raw(
        source,
        RawImportSettings(lens=LensCorrectionSettings(mode="off")),
    )

    assert image.shape == developed.shape
    assert image.dtype == np.float32
    assert metadata["decoder_normalized_to_acescg"] is True
    assert metadata["color_space"] == "ACEScg"
    assert np.all(np.isfinite(image))


def test_bounded_bilinear_remapper_honors_import_cancellation() -> None:
    image = np.zeros((8, 8, 3), dtype=np.float32)
    y, x = np.mgrid[:8, :8]
    coordinates = np.stack([x, y], axis=-1).astype(np.float32)

    with pytest.raises(RawImportError, match="Import cancelled"):
        _remap_bilinear_strips(
            image,
            coordinates,
            chromatic=False,
            rows=2,
            cancelled=lambda: True,
        )


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


def test_lens_profile_catalog_has_unique_resolvable_camera_mount_ids() -> None:
    profiles = list_lens_profiles(limit=1000)
    ids = [profile.id for profile in profiles]
    assert len(ids) == len(set(ids))
    assert all(profile.camera_maker and profile.camera_model and profile.mount for profile in profiles)
    assert all(len(profile_id.split("|")) == 5 for profile_id in ids)


def test_auto_lens_correction_soft_falls_back_when_database_is_missing(monkeypatch) -> None:
    image = np.ones((4, 6, 3), dtype=np.float32)
    monkeypatch.setattr("hdr_finisher.raw_import._lens_database", lambda: None)

    corrected, metadata = apply_lens_correction(image, LensCorrectionSettings(mode="auto"))

    assert corrected is image
    assert metadata["applied"] is False
    assert "continued without lens correction" in metadata["reason"]


def test_media_browser_persists_pins_recents_and_generates_thumbnail(tmp_path: Path) -> None:
    media = tmp_path / "médïa space"
    media.mkdir()
    source = media / "sample.png"
    Image.new("RGB", (40, 20), (120, 80, 40)).save(source)
    browser = MediaBrowserStore(tmp_path / "app-data")

    listing = browser.list_directory(str(media), "source")
    entry = next(item for item in listing["entries"] if item["name"] == source.name)
    assert entry["supported"] is True
    assert entry["thumbnail_key"]
    assert entry["kind_label"] == "PNG image"
    assert isinstance(entry["date_added_ms"], int)

    pinned = browser.add_pin(str(media))
    assert pinned[0]["available"] is True
    restored = MediaBrowserStore(tmp_path / "app-data")
    assert restored.pinned()[0]["path"] == str(media.resolve())
    assert restored.recents() == []
    browser.record_import(str(source))
    assert restored.recents()[0]["path"] == str(media.resolve())
    thumbnail = browser.thumbnail(str(source), 128)
    with Image.open(thumbnail) as image:
        assert image.size == (40, 20)


def test_media_browser_exposes_named_mounted_volume_roots(tmp_path: Path, monkeypatch) -> None:
    roots = [tmp_path / "C-drive", tmp_path / "D-drive"]
    for root in roots:
        root.mkdir()
    monkeypatch.setattr("hdr_finisher.media_browser._connected_roots", lambda: roots)
    browser = MediaBrowserStore(tmp_path / "app-data")

    listing = browser.list_directory(str(roots[0]), "source")

    assert listing["drives"] == [
        {"name": root.name, "path": str(root), "available": True} for root in roots
    ]


def test_media_browser_keeps_only_three_recent_locations_in_mru_order(tmp_path: Path) -> None:
    app_data = tmp_path / "app-data"
    folders = [tmp_path / f"folder-{index}" for index in range(4)]
    sources = []
    for index, folder in enumerate(folders):
        folder.mkdir()
        source = folder / f"source-{index}.png"
        Image.new("RGB", (4, 4)).save(source)
        sources.append(source)
    browser = MediaBrowserStore(app_data)

    for folder in folders:
        browser.list_directory(str(folder), "source")
    assert browser.recents() == []
    for source in sources:
        browser.record_import(str(source))
    browser.record_import(str(sources[1]))

    assert [item["path"] for item in MediaBrowserStore(app_data).recents()] == [
        str(folders[1].resolve()),
        str(folders[3].resolve()),
        str(folders[2].resolve()),
    ]


def test_media_browser_migrates_legacy_favorites_to_pinned(tmp_path: Path) -> None:
    app_data = tmp_path / "app-data"
    folder = tmp_path / "legacy-pin"
    app_data.mkdir()
    folder.mkdir()
    (app_data / "favorite-folders.json").write_text(f'["{folder}"]', encoding="utf-8")
    browser = MediaBrowserStore(app_data)

    assert browser.pinned()[0]["path"] == str(folder)
    browser.add_pin(str(tmp_path))
    assert (app_data / "pinned-folders.json").is_file()


@pytest.mark.parametrize(
    ("flip", "expected"),
    [
        (0, np.array([[1, 2, 3], [4, 5, 6]], dtype=np.uint8)),
        (3, np.array([[6, 5, 4], [3, 2, 1]], dtype=np.uint8)),
        (5, np.array([[3, 6], [2, 5], [1, 4]], dtype=np.uint8)),
        (6, np.array([[4, 1], [5, 2], [6, 3]], dtype=np.uint8)),
    ],
)
def test_raw_thumbnail_orientation_uses_libraw_flip(flip: int, expected: np.ndarray) -> None:
    source = np.repeat(np.array([[1, 2, 3], [4, 5, 6]], dtype=np.uint8)[..., None], 3, axis=2)

    actual = _apply_libraw_orientation(source, flip)

    np.testing.assert_array_equal(actual[..., 0], expected)


@pytest.mark.skipif(os.name != "nt", reason="Windows drive-letter behavior")
def test_connected_roots_excludes_assigned_non_volume_drive_letters(monkeypatch) -> None:
    from hdr_finisher import media_browser

    letters = "CDEGH"
    mask = sum(1 << (ord(letter) - ord("A")) for letter in letters)
    monkeypatch.setattr(media_browser, "_logical_drive_mask", lambda: mask)
    monkeypatch.setattr(
        media_browser,
        "_is_volume_backed_windows_drive",
        lambda root: root[0] in {"C", "D", "E"},
    )

    assert media_browser._connected_roots() == [Path("C:\\"), Path("D:\\"), Path("E:\\")]


def test_windows_device_target_filter_rejects_cloud_volume_mounts() -> None:
    from hdr_finisher.media_browser import _is_local_windows_device_target

    assert _is_local_windows_device_target(3, r"\Device\HarddiskVolume3") is True
    assert _is_local_windows_device_target(2, r"\Device\HarddiskVolume7") is True
    assert _is_local_windows_device_target(5, r"\Device\CdRom0") is True
    assert _is_local_windows_device_target(3, r"\Device\Volume{cloud-drive-guid}") is False
    assert _is_local_windows_device_target(3, r"\Device\WinFsp.Drive") is False
    assert _is_local_windows_device_target(4, r"\Device\LanmanRedirector\server\share") is False


def test_bitmap_thumbnail_uses_the_bounded_pillow_path(tmp_path: Path, monkeypatch) -> None:
    source = tmp_path / "large.png"
    Image.new("RGB", (2048, 1024), (120, 80, 40)).save(source)
    browser = MediaBrowserStore(tmp_path / "app-data")

    monkeypatch.setattr(
        "hdr_finisher.loader.load_image",
        lambda *_args, **_kwargs: pytest.fail("bitmap thumbnail invoked the authoritative loader"),
    )

    thumbnail = browser.thumbnail(str(source), 128)

    with Image.open(thumbnail) as image:
        assert image.size == (128, 64)


def test_media_browser_uses_neutral_placeholder_for_unmarked_jpegxl(tmp_path: Path) -> None:
    import imagecodecs

    source = tmp_path / "unmarked.jxl"
    pixels = np.zeros((16, 24, 3), dtype=np.uint16)
    pixels[..., 0] = 2048
    source.write_bytes(imagecodecs.jpegxl_encode(pixels, bitspersample=12, usecontainer=True))
    browser = MediaBrowserStore(tmp_path / "app-data")

    thumbnail = browser.thumbnail(str(source), 128)

    with Image.open(thumbnail) as image:
        array = np.asarray(image.convert("RGB"))
    assert np.max(np.abs(array[..., 0].astype(int) - array[..., 1].astype(int))) <= 2
    assert np.max(np.abs(array[..., 1].astype(int) - array[..., 2].astype(int))) <= 2


def test_fast_staged_thumbnail_refuses_formats_that_require_full_decode(tmp_path: Path) -> None:
    source = tmp_path / "large.tiff"
    Image.new("RGB", (32, 16), (80, 120, 160)).save(source)
    browser = MediaBrowserStore(tmp_path / "app-data")

    with pytest.raises(MediaBrowserError, match="no cheap staged-preview"):
        browser.thumbnail(str(source), 128, fast_only=True)


def test_staged_tiff_import_decodes_authoritative_pixels_only_once(tmp_path: Path, monkeypatch) -> None:
    source = tmp_path / "source.tiff"
    Image.new("RGB", (64, 32), (80, 120, 160)).save(source)
    sessions = SessionStore()
    browser = MediaBrowserStore(tmp_path / "app-data")
    manager = ImportJobManager(sessions, browser, workers=1)
    original_thumbnail = browser.thumbnail
    thumbnail_calls: list[bool] = []

    def tracked_thumbnail(value, size=256, *, fast_only=False):
        thumbnail_calls.append(fast_only)
        return original_thumbnail(value, size, fast_only=fast_only)

    monkeypatch.setattr(browser, "thumbnail", tracked_thumbnail)
    try:
        job = manager.start(source, RawImportSettings())
        deadline = time.monotonic() + 5
        while job.state not in {"ready", "error"} and time.monotonic() < deadline:
            time.sleep(0.01)

        assert job.state == "ready", job.error
        assert thumbnail_calls == [True]
        assert job.preview_path is None
        assert sessions.current() is not None
    finally:
        manager.close()


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


def test_avif_import_reports_preview_work_and_cancel_keeps_current_session(
    tmp_path: Path, monkeypatch
) -> None:
    current_source = tmp_path / "current.png"
    Image.new("RGB", (32, 16), (80, 120, 160)).save(current_source)
    candidate = tmp_path / "candidate.avif"
    candidate.write_bytes(b"synthetic-avif")
    sessions = SessionStore()
    current = sessions.create_session(current_source)
    browser = MediaBrowserStore(tmp_path / "app-data")
    manager = ImportJobManager(sessions, browser, workers=1)
    preview_started = Event()
    release_preview = Event()

    def delayed_thumbnail(*_args, **_kwargs):
        preview_started.set()
        assert release_preview.wait(5)
        return tmp_path / "preview.jpg"

    monkeypatch.setattr(browser, "thumbnail", delayed_thumbnail)
    try:
        job = manager.start(candidate, RawImportSettings())
        assert preview_started.wait(5)
        assert job.phase == "previewing"
        assert job.phase_label == "Decoding AVIF base preview"

        manager.cancel(job.job_id)
        release_preview.set()
        deadline = time.monotonic() + 5
        while job.state != "cancelled" and time.monotonic() < deadline:
            time.sleep(0.01)

        assert job.state == "cancelled"
        assert sessions.current() is not None
        assert sessions.current().session_id == current.session_id
    finally:
        release_preview.set()
        manager.close()


def test_raw_redevelopment_preserves_edit_document_and_session_identity(tmp_path: Path) -> None:
    source = tmp_path / "source.png"
    Image.new("RGB", (64, 32), (80, 120, 160)).save(source)
    sessions = SessionStore()
    initial = sessions.create_session(source)
    current = sessions.get(initial.session_id)
    adjustments = current.adjustments.model_copy(deep=True)
    adjustments.hdr.exposure = 2.0
    sessions.apply_edit_commands(
        initial.session_id,
        [
            EditCommand(
                expected_revision=0,
                command_type="set_global_adjustments",
                payload={"adjustments": adjustments.model_dump(mode="json")},
            )
        ],
    )
    original_history = list(current.undo_history)

    developed = sessions.prepare_session(
        source,
        raw_import_settings=RawImportSettings(lens=LensCorrectionSettings(mode="off")),
    )
    payload = sessions.redevelop_session(initial.session_id, developed)
    reloaded = sessions.get(initial.session_id)

    assert payload.session_id == initial.session_id
    assert reloaded.adjustments.hdr.exposure == 2.0
    assert reloaded.edit_revision == 2
    assert reloaded.dirty is True
    assert reloaded.undo_history == original_history
    assert reloaded.raw_import_settings.lens.mode == "off"


def test_latest_import_wins_even_when_previous_decode_is_in_flight(tmp_path: Path, monkeypatch) -> None:
    first = tmp_path / "first.png"
    second = tmp_path / "second.png"
    Image.new("RGB", (64, 32), (255, 0, 0)).save(first)
    Image.new("RGB", (64, 32), (0, 255, 0)).save(second)
    sessions = SessionStore()
    browser = MediaBrowserStore(tmp_path / "app-data")
    manager = ImportJobManager(sessions, browser, workers=2)
    decode_started = Event()
    release_decode = Event()
    original_prepare = sessions.prepare_session

    def delayed_prepare(path, *args, **kwargs):
        if path == first:
            decode_started.set()
            assert release_decode.wait(5)
        return original_prepare(path, *args, **kwargs)

    monkeypatch.setattr(sessions, "prepare_session", delayed_prepare)
    try:
        stale = manager.start(first, RawImportSettings())
        assert decode_started.wait(5)
        current = manager.start(second, RawImportSettings())
        release_decode.set()
        deadline = time.monotonic() + 5
        while current.state not in {"ready", "error"} and time.monotonic() < deadline:
            time.sleep(0.01)

        assert stale.state == "cancelled"
        assert current.state == "ready", current.error
        assert sessions.current() is not None
        assert sessions.current().source_path == second
        assert stale.session_id is None
    finally:
        release_decode.set()
        manager.close()


def test_replace_document_rejects_interpretation_without_reloading_pixels(tmp_path: Path) -> None:
    source = tmp_path / "source.png"
    Image.new("RGB", (16, 16), (80, 120, 160)).save(source)
    sessions = SessionStore()
    payload = sessions.create_session(source)
    document = sessions.get(payload.session_id).edit_document().model_copy(deep=True)
    document.interpretation_override = SourceInterpretationOverride(
        color_space="BT.2020", transfer_function="LINEAR"
    )

    with pytest.raises(ValueError, match="interpretation endpoint"):
        sessions.replace_edit_document(payload.session_id, document, expected_revision=0)
