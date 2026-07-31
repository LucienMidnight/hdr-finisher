from __future__ import annotations

import numpy as np
import pytest
import tifffile

from conftest import fixture_path

from hdr_finisher.loader import LoaderError, _classify_icc_profile_name, _load_tiff, load_image
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
    assert sdr_reference is None


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
