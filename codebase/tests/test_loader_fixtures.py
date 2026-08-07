from __future__ import annotations

import numpy as np
import pytest
import tifffile
from PIL import Image, ImageCms

from conftest import fixture_path

from hdr_finisher.color import linear_bt2020_to_acescg
from hdr_finisher.loader import (
    LoaderError,
    _classify_icc_profile_name,
    _infer_exr_color_interop_id,
    _load_tiff,
    _normalize_tiff_layout,
    _resolve_exr_color_space,
    _select_exr_rgb_channels,
    load_image,
)
from hdr_finisher.models import HDRClassification


def test_load_real_png_fixture() -> None:
    image, source, metadata, analysis, sdr_reference = load_image(fixture_path("sdr_gradient.png"))
    assert source.suffix == ".png"
    assert image.shape == (16, 24, 3)
    assert metadata["bit_depth"] == "uint8"
    assert analysis.classification == HDRClassification.SDR_ONLY
    assert sdr_reference is None


def test_load_real_tiff_fixture_with_hdr_headroom() -> None:
    image, source, metadata, analysis, sdr_reference = load_image(fixture_path("hdr_headroom.tiff"))
    assert source.suffix == ".tiff"
    assert image.shape == (14, 20, 3)
    assert metadata["bit_depth"] == "float32"
    assert analysis.classification == HDRClassification.HDR_TRUE
    assert analysis.peak_linear > 1.0
    assert source.source_color_space is None
    assert source.color_space_confident is False
    np.testing.assert_allclose(image, tifffile.imread(fixture_path("hdr_headroom.tiff")))
    assert sdr_reference is None


def test_tiff_planar_and_multipage_layouts_are_normalized_to_first_hwc_image() -> None:
    planar = np.stack([np.full((4, 6), channel, dtype=np.float32) for channel in (1, 2, 3)])
    normalized_planar = _normalize_tiff_layout(planar, "SYX")
    assert normalized_planar.shape == (4, 6, 3)
    np.testing.assert_array_equal(normalized_planar[0, 0], [1, 2, 3])

    multipage = np.stack([normalized_planar, normalized_planar + 10])
    normalized_multipage = _normalize_tiff_layout(multipage, "QYXS")
    np.testing.assert_array_equal(normalized_multipage, normalized_planar)


def test_layered_exr_rgb_channels_prefer_combined_layer() -> None:
    channels = ["ViewLayer.Albedo.R", "ViewLayer.Albedo.G", "ViewLayer.Albedo.B", "ViewLayer.Combined.B", "ViewLayer.Combined.R", "ViewLayer.Combined.G"]
    assert _select_exr_rgb_channels(channels) == (
        "ViewLayer.Combined.R",
        "ViewLayer.Combined.G",
        "ViewLayer.Combined.B",
    )


@pytest.mark.parametrize(
    ("interop_id", "expected"),
    [
        (b"lin_rec709_scene", "sRGB"),
        (b"lin_rec2020_scene", "BT.2020"),
        ("lin_p3d65_scene", "Display P3"),
        ("lin_ap1_scene", "ACEScg"),
    ],
)
def test_known_ocio_color_interop_ids_are_recognized(interop_id, expected) -> None:
    color_space, raw_id, confident = _infer_exr_color_interop_id(interop_id)

    assert color_space == expected
    assert raw_id == (interop_id.decode("utf-8") if isinstance(interop_id, bytes) else interop_id)
    assert confident is True


def test_unknown_ocio_color_interop_id_requires_review() -> None:
    color_space, raw_id, confident = _infer_exr_color_interop_id(b"vendor:unverified_scene")

    assert color_space is None
    assert raw_id == "vendor:unverified_scene"
    assert confident is False


@pytest.mark.parametrize("interop_id", ["LIN_REC2020_SCENE", "lin_rec2020_scene ", "lin_rec2020_display"])
def test_similar_but_non_exact_ocio_color_interop_ids_require_review(interop_id: str) -> None:
    color_space, raw_id, confident = _infer_exr_color_interop_id(interop_id)

    assert color_space is None
    assert raw_id == interop_id
    assert confident is False


@pytest.mark.parametrize(
    ("chroma_name", "chroma_confident", "interop_name", "interop_confident", "expected"),
    [
        ("BT.2020", True, "BT.2020", True, ("BT.2020", "chromaticities", True, False)),
        ("sRGB", True, "BT.2020", True, (None, "conflict", False, True)),
        ("Display P3", False, "BT.2020", True, ("BT.2020", "colorInteropID", True, False)),
        ("ACEScg", True, None, False, ("ACEScg", "chromaticities", True, False)),
        (None, False, None, False, (None, None, False, False)),
    ],
)
def test_exr_color_metadata_precedence_is_safe(
    chroma_name,
    chroma_confident,
    interop_name,
    interop_confident,
    expected,
) -> None:
    assert _resolve_exr_color_space(
        chroma_name,
        chroma_confident,
        interop_name,
        interop_confident,
    ) == expected


def test_pillow_import_applies_exif_orientation(tmp_path) -> None:
    source_path = tmp_path / "rotated.jpg"
    image = Image.new("RGB", (3, 2), (128, 64, 32))
    exif = Image.Exif()
    exif[274] = 6
    image.save(source_path, exif=exif)

    loaded, descriptor, *_ = load_image(source_path)
    assert loaded.shape[:2] == (3, 2)
    assert (descriptor.width, descriptor.height) == (2, 3)


def test_pillow_import_converts_embedded_icc_profile_to_srgb(tmp_path) -> None:
    source_path = tmp_path / "profiled.png"
    profile = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
    Image.new("RGB", (4, 3), (128, 128, 128)).save(source_path, icc_profile=profile)

    loaded, descriptor, metadata, *_ = load_image(source_path)
    assert descriptor.source_color_space == "sRGB"
    assert metadata["icc_converted_to_srgb"] is True
    assert float(loaded.mean()) == pytest.approx(0.216, abs=0.01)


def test_load_float_tiff_with_deflate_predictor(tmp_path) -> None:
    pytest.importorskip("imagecodecs")
    source_path = tmp_path / "darktable-float-predictor.tif"
    source = np.linspace(0.01, 4.0, 18 * 12 * 3, dtype=np.float32).reshape(12, 18, 3)
    tifffile.imwrite(source_path, source, compression="deflate", predictor=True, photometric="rgb")

    decoded, _ = _load_tiff(source_path)
    assert np.array_equal(decoded, source)

    image, descriptor, metadata, analysis, sdr_reference = load_image(
        source_path,
        overrides={"color_space": "BT.2020", "transfer_function": "LINEAR"},
    )

    assert descriptor.suffix == ".tif"
    assert metadata["bit_depth"] == "float32"
    assert image.shape == source.shape
    assert analysis.classification == HDRClassification.HDR_TRUE
    assert sdr_reference is None


def test_darktable_linear_rec2020_profile_name_is_recognized() -> None:
    assert _classify_icc_profile_name("Linear Rec2020 RGB - darktable") == "BT.2020"


def test_loader_wraps_unexpected_decoder_errors(monkeypatch, tmp_path) -> None:
    source_path = tmp_path / "broken.tif"
    source_path.write_bytes(b"not a tiff")

    def fail_tiff_decode(path):
        _ = path
        raise ValueError("decoder exploded")

    monkeypatch.setattr("hdr_finisher.loader._load_tiff", fail_tiff_decode)

    with pytest.raises(LoaderError, match="Could not decode TIFF input: decoder exploded"):
        load_image(source_path)


def test_load_real_linear_exr_fixture() -> None:
    image, source, metadata, analysis, sdr_reference = load_image(fixture_path("linear_unconfirmed.exr"))
    assert source.suffix == ".exr"
    assert image.shape == (12, 18, 3)
    assert metadata["transfer_function"] == "LINEAR"
    assert source.source_color_space is None
    assert source.color_space_confident is False
    assert image.max() <= 1.0
    assert analysis.classification == HDRClassification.HDR_LINEAR_UNCONFIRMED
    assert analysis.needs_color_override is True
    assert sdr_reference is None


def test_load_blender_exr_recognizes_ocio_color_interop_id() -> None:
    image, source, metadata, analysis, sdr_reference = load_image(
        fixture_path("blender_linear_rec2020.exr")
    )

    assert image.shape == (8, 8, 3)
    assert source.source_color_space == "BT.2020"
    assert source.transfer_function == "LINEAR"
    assert source.interpretation_mode == "auto"
    assert source.color_space_confident is True
    assert metadata["color_interop_id"] == "lin_rec2020_scene"
    assert metadata["color_space_source"] == "colorInteropID"
    assert metadata["needs_color_override"] is False
    assert analysis.classification == HDRClassification.HDR_TRUE
    assert analysis.needs_color_override is False
    assert sdr_reference is None


def test_blender_rec2020_fixture_is_numerically_normalized_to_acescg() -> None:
    import OpenEXR

    path = fixture_path("blender_linear_rec2020.exr")
    exr = OpenEXR.File(str(path))
    raw = np.asarray(exr.channels()["RGB"].pixels, dtype=np.float32)[..., :3]
    expected = linear_bt2020_to_acescg(raw)

    normalized, source, _metadata, _analysis, _sdr_reference = load_image(path)

    assert source.working_space == "ACEScg"
    assert normalized.dtype == np.float32
    assert np.all(np.isfinite(normalized))
    assert np.allclose(normalized, expected, rtol=2e-5, atol=2e-6)
    assert not np.allclose(normalized, raw, rtol=1e-4, atol=1e-5)


def test_manual_bt2020_override_applies_to_linear_exr_fixture() -> None:
    image, source, metadata, analysis, sdr_reference = load_image(
        fixture_path("linear_unconfirmed.exr"),
        overrides={"color_space": "BT.2020", "transfer_function": "LINEAR"},
    )
    assert source.source_color_space == "BT.2020"
    assert source.interpretation_mode == "manual"
    assert metadata["user_override"]["color_space"] == "BT.2020"
    assert analysis.classification == HDRClassification.HDR_LINEAR_UNCONFIRMED
    assert analysis.needs_color_override is True
    assert sdr_reference is None


def test_transfer_only_override_does_not_confirm_unknown_exr_primaries() -> None:
    _image, source, metadata, analysis, _sdr_reference = load_image(
        fixture_path("linear_unconfirmed.exr"),
        overrides={"transfer_function": "LINEAR"},
    )

    assert source.interpretation_mode == "manual"
    assert source.source_color_space is None
    assert source.color_space_confident is False
    assert metadata["needs_color_override"] is True
    assert analysis.needs_color_override is True
