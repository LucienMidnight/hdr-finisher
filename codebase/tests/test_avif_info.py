from __future__ import annotations

from pathlib import Path

import pytest

from hdr_finisher.avif_info import inspect_avif, parse_avifdec_info
from hdr_finisher.binaries import resolve_binary
from hdr_finisher.models import AdjustmentState, HDRAdjustments, PreviewKind
from hdr_finisher.preview import render_preview_bytes
from hdr_finisher.test_pattern import build_hdr_test_pattern


def test_parse_avifdec_gain_map_info() -> None:
    parsed = parse_avifdec_info(
        """
Image decoded: sample.avif
 * Bit Depth      : 8
 * Color Primaries: 1
 * Transfer Char. : 13
 * Matrix Coeffs. : 0
 * Gain map       : 1024x576 pixels, 10 bit, YUV444, Full Range, Matrix Coeffs. 2, Base Headroom 0.00 (SDR), Alternate Headroom 3.71 (HDR)
 * Alternate image:
    * Color Primaries: 9
    * Transfer Char. : 16
    * Matrix Coeffs. : 9
    * Bit Depth      : 10
"""
    )
    assert parsed["gain_map_present"] is True
    assert parsed["bit_depth"] == 8
    assert parsed["color_primaries"] == 1
    assert parsed["transfer_char"] == 13
    assert parsed["matrix_coeffs"] == 0
    assert parsed["gain_map"]["bit_depth"] == 10
    assert parsed["gain_map"]["base_headroom_label"] == "SDR"
    assert parsed["gain_map"]["alternate_headroom_label"] == "HDR"
    assert parsed["alternate_image"]["color_primaries"] == 9
    assert parsed["alternate_image"]["transfer_char"] == 16
    assert parsed["alternate_image"]["bit_depth"] == 10


@pytest.mark.skipif(resolve_binary("avifdec") is None, reason="avifdec is not available")
def test_sample_avif_contains_expected_gain_map_metadata() -> None:
    sample = Path(__file__).resolve().parents[1] / "samples" / "hdr_reference.avif"
    info = inspect_avif(sample)
    assert info["gain_map_present"] is True
    assert info["color_primaries"] == 1
    assert info["transfer_char"] == 13
    assert info["matrix_coeffs"] == 0
    assert info["gain_map"]["bit_depth"] == 10
    assert info["gain_map"]["base_headroom_label"] == "SDR"
    assert info["gain_map"]["alternate_headroom_label"] == "HDR"
    assert info["alternate_image"]["color_primaries"] == 9
    assert info["alternate_image"]["transfer_char"] == 16
    assert info["alternate_image"]["matrix_coeffs"] == 9
    assert info["alternate_image"]["bit_depth"] == 10


@pytest.mark.skipif(resolve_binary("avifenc") is None or resolve_binary("avifdec") is None, reason="AVIF tools are not available")
def test_hdr_preview_avif_is_pq_bt2020_without_gain_map(tmp_path: Path) -> None:
    image = build_hdr_test_pattern(width=96, height=54)
    adjustments = AdjustmentState(hdr=HDRAdjustments(highlight_rolloff=0))
    body, media_type = render_preview_bytes(image, adjustments, PreviewKind.HDR, long_edge=96)
    assert media_type == "image/avif"
    preview_path = tmp_path / "preview.avif"
    preview_path.write_bytes(body)

    info = inspect_avif(preview_path)
    assert info["gain_map_present"] is False
    assert info["color_primaries"] == 9
    assert info["transfer_char"] == 16
    assert info["matrix_coeffs"] == 9
    assert info["bit_depth"] == 10
