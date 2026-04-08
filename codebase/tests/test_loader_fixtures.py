from __future__ import annotations

from conftest import fixture_path

from hdr_finisher.loader import load_image
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


def test_load_real_linear_exr_fixture() -> None:
    image, source, metadata, analysis, sdr_reference = load_image(fixture_path("linear_unconfirmed.exr"))
    assert source.suffix == ".exr"
    assert image.shape == (12, 18, 3)
    assert metadata["transfer_function"] == "LINEAR"
    assert image.max() <= 1.0
    assert analysis.classification == HDRClassification.HDR_LINEAR_UNCONFIRMED
    assert analysis.needs_color_override is True
    assert sdr_reference is None
