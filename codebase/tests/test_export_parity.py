"""Unit and end-to-end tests for the export/reference parity file-side check.

The runtime run (``tests/performance/export-parity.js``) trusts this module for
its arithmetic and its two assertions, so both are tested directly:

  * the named encoding's transform, against analytic identities the preview's
    own convention implies (0.18 scene at 203 nits encodes to exactly 1.0);
  * the Lanczos-3 port, which must reproduce the item 6 comparator's behavior
    (identity at scale 1, constants preserved, checkerboards averaged);
  * export correctness, against a real JPEG Ultra HDR encode and decode when
    the bundled encoder is present, and against synthetic metadata when it is
    not.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pytest

PERFORMANCE = Path(__file__).resolve().parent / "performance"
if str(PERFORMANCE) not in sys.path:
    sys.path.insert(0, str(PERFORMANCE))

import export_parity_check as epc  # noqa: E402

from hdr_finisher.models import AdjustmentState, ExportSettings, PreviewKind  # noqa: E402

JPEG_GAIN_MAP_MARKER = b"http://ns.adobe.com/hdr-gain-map/1.0/"


def _write_gain_map_stub(path: Path) -> Path:
    path.write_bytes(b"\xff\xd8" + JPEG_GAIN_MAP_MARKER + b"stub")
    return path


def _session(image: np.ndarray, adjustments: AdjustmentState | None = None) -> object:
    return type(
        "Session",
        (),
        {
            "session_id": "export-parity-test",
            "image": image,
            "sdr_reference_image": None,
            "adjustments": adjustments if adjustments is not None else AdjustmentState(),
            "local_adjustments": [],
        },
    )()


def test_neutral_authoring_anchor_encodes_to_canvas_white() -> None:
    neutral = np.full((1, 1, 3), 0.18, dtype=np.float64)
    encoded = epc.presentation_encode(neutral, hdr_surface=True, reference_white_nits=203)
    assert float(encoded[0, 0, 0]) == pytest.approx(1.0, abs=1e-9)


def test_reference_white_100_follows_the_canvas_convention() -> None:
    neutral = np.full((1, 1, 3), 0.18, dtype=np.float64)
    encoded = epc.presentation_encode(neutral, hdr_surface=True, reference_white_nits=100)
    expected = 1.055 * (100.0 / 203.0) ** (1.0 / 2.4) - 0.055
    assert float(encoded[0, 0, 0]) == pytest.approx(expected, abs=1e-9)
    assert float(encoded[0, 0, 0]) == pytest.approx(0.7305, abs=1e-3)


def test_transport_ceiling_clamps_exposed_highlights() -> None:
    ceiling_scene = epc.TRANSPORT_CEILING_NITS * 0.18 / 203.0
    below = np.full((1, 1, 3), ceiling_scene * 0.5, dtype=np.float64)
    above = np.full((1, 1, 3), ceiling_scene * 3.0, dtype=np.float64)
    far_above = np.full((1, 1, 3), ceiling_scene * 30.0, dtype=np.float64)
    encoded_above = epc.presentation_encode(above, hdr_surface=True, reference_white_nits=203)
    encoded_far_above = epc.presentation_encode(far_above, hdr_surface=True, reference_white_nits=203)
    expected = epc.display_encode(np.array([epc.TRANSPORT_CEILING_NITS / 203.0]))
    assert float(encoded_above[0, 0, 0]) == pytest.approx(float(expected[0]), abs=1e-9)
    assert float(encoded_far_above[0, 0, 0]) == pytest.approx(float(encoded_above[0, 0, 0]), abs=1e-12)
    assert float(encoded_above[0, 0, 0]) > float(
        epc.presentation_encode(below, hdr_surface=True, reference_white_nits=203)[0, 0, 0]
    )


def test_sdr_surface_uses_the_reinhard_fallback() -> None:
    # The shader's acescgToSrgb row sum is 0.9998432826, not 1.0, so a neutral
    # 0.18 is 0.1799718 in linear sRGB before the fallback compresses it.
    row_sum = 1.7048873310 - 0.6241572745 - 0.0808867739
    neutral = np.full((1, 1, 3), 0.18, dtype=np.float64)
    encoded = epc.presentation_encode(neutral, hdr_surface=False, reference_white_nits=203)
    srgb = 0.18 * row_sum
    expected = epc.display_encode(np.array([srgb / (1.0 + srgb)]))
    assert float(encoded[0, 0, 0]) == pytest.approx(float(expected[0]), abs=1e-9)
    assert float(encoded[0, 0, 0]) == pytest.approx(0.4269, abs=1e-3)


def test_decoder_scale_is_rescaled_to_the_project_reference_white() -> None:
    image = np.full((2, 2, 3), 0.18, dtype=np.float32)
    np.testing.assert_array_equal(epc.decoder_scale_to_project(image, 203), image)
    scaled = epc.decoder_scale_to_project(image, 100)
    np.testing.assert_allclose(scaled, image * np.float32(203.0 / 100.0), rtol=1e-6)


def test_peak_nits_reads_bt2020_luma() -> None:
    neutral = np.full((3, 3, 3), 0.18, dtype=np.float32)
    assert epc.peak_nits(neutral, 203) == pytest.approx(203.0, rel=5e-3)


def test_lanczos_identity_at_scale_one() -> None:
    generator = np.random.default_rng(5)
    image = generator.uniform(0.0, 1.0, size=(4, 6, 3))
    resampled = epc.lanczos_resample(image, 6, 4)
    np.testing.assert_allclose(resampled, image, atol=1e-9)


def test_lanczos_preserves_a_constant_field() -> None:
    image = np.full((8, 8, 3), 0.42, dtype=np.float64)
    resampled = epc.lanczos_resample(image, 3, 3)
    np.testing.assert_allclose(resampled, 0.42, atol=1e-9)


def test_lanczos_averages_a_checkerboard_toward_the_midpoint() -> None:
    checker = np.zeros((8, 8, 3), dtype=np.float64)
    for y in range(8):
        for x in range(8):
            checker[y, x, :] = 1.0 if (x + y) % 2 == 0 else 0.0
    resampled = epc.lanczos_resample(checker, 4, 4)
    assert float(np.mean(resampled)) == pytest.approx(0.5, abs=0.05)


def test_lanczos_keeps_a_linear_ramp_linear() -> None:
    ramp = np.linspace(0.0, 1.0, 32, dtype=np.float64).reshape(1, 32, 1)
    ramp = np.repeat(ramp, 3, axis=2)
    resampled = epc.lanczos_resample(ramp, 16, 1)
    # Output index i samples the source at (i + 0.5) * 2 - 0.5 = 2i + 0.5.
    expected = np.array([(2 * i + 0.5) / 31.0 for i in range(2, 14)])
    interior = resampled[0, 2:-2, 0]
    assert np.all(np.abs(interior - expected) < 0.05)


def test_compare_pair_reports_worst_channel_in_levels() -> None:
    a = np.zeros((2, 2, 3), dtype=np.float64)
    b = np.zeros((2, 2, 3), dtype=np.float64)
    b[..., 0] = 2.0 / 255.0
    metrics = epc.compare_pair(a, b)
    assert metrics["maxAbs"] == pytest.approx(2.0)
    assert metrics["meanAbs"] == pytest.approx(2.0)
    assert metrics["differingAbove1"] == 4
    assert metrics["differingAbove2"] == 0
    assert epc.compare_pair(a, a)["maxAbs"] == 0.0


def test_compare_pair_tracks_extended_range_content() -> None:
    a = np.full((1, 1, 3), 1.4, dtype=np.float64)
    b = np.full((1, 1, 3), 1.4, dtype=np.float64)
    assert epc.compare_pair(a, b)["extendedRangePixels"] == 1


def test_band_metrics_crop_by_fixture_proportions() -> None:
    delivered = np.zeros((100, 10, 3), dtype=np.float64)
    preview = np.zeros((100, 10, 3), dtype=np.float64)
    preview[10:30, :, :] = 1.0
    bands = [
        {"id": "target", "y": 100, "height": 200},
        {"id": "elsewhere", "y": 500, "height": 200},
    ]
    metrics = epc.band_metrics(delivered, preview, bands, fixture_height=1000)
    assert metrics["target"]["y0"] == 10 and metrics["target"]["y1"] == 30
    assert metrics["target"]["maxAbs"] == pytest.approx(255.0)
    assert metrics["elsewhere"]["maxAbs"] == 0.0


def _synthetic_jpeg_metadata(capacity_max: float) -> dict:
    return {
        "decoder_reference_white_nits": 203.0,
        "gain_map_metadata": {
            "hdr_capacity_min": 1.0,
            "hdr_capacity_max": capacity_max,
            "min_content_boost": 0.25,
            "max_content_boost": 16.0,
            "gamma": 1.0,
        },
    }


def test_export_correctness_passes_and_fails_on_headroom(tmp_path: Path) -> None:
    path = _write_gain_map_stub(tmp_path / "stub.jpg")
    hdr = np.full((2, 2, 3), 0.18, dtype=np.float32)
    sdr = np.full((2, 2, 3), 0.18, dtype=np.float32)
    metadata = _synthetic_jpeg_metadata(16.0)

    matching = epc.export_correctness(
        path, "jpeg_ultrahdr",
        {"expected_encoded_headroom": 4.0, "expected_width": 2, "expected_height": 2},
        hdr, sdr, metadata, 203,
    )
    assert matching["ok"] is True, [c for c in matching["checks"] if not c["ok"]]

    mismatched = epc.export_correctness(
        path, "jpeg_ultrahdr",
        {"expected_encoded_headroom": 3.0},
        hdr, sdr, metadata, 203,
    )
    assert mismatched["ok"] is False
    failed = {check["name"] for check in mismatched["checks"] if not check["ok"]}
    assert failed == {"headroom_matches_declared"}


def test_export_correctness_flags_wrong_dimensions_and_peak(tmp_path: Path) -> None:
    path = _write_gain_map_stub(tmp_path / "stub.jpg")
    hdr = np.full((2, 2, 3), 0.18, dtype=np.float32)
    sdr = np.full((2, 2, 3), 0.18, dtype=np.float32)
    metadata = _synthetic_jpeg_metadata(16.0)

    result = epc.export_correctness(
        path, "jpeg_ultrahdr",
        {"expected_width": 4, "expected_height": 2, "ceiling_nits": 100.0, "ceiling_active": True},
        hdr, sdr, metadata, 203,
    )
    assert result["ok"] is False
    failed = {check["name"] for check in result["checks"] if not check["ok"]}
    assert failed == {"decoded_dimensions", "peak_within_ceiling"}


def test_export_correctness_records_proof_scale_ceiling_overshoot(tmp_path: Path) -> None:
    """A proof-sized encode records its overshoot; a delivery-scale one asserts."""
    path = _write_gain_map_stub(tmp_path / "stub.jpg")
    hdr = np.full((2, 2, 3), 1.49, dtype=np.float32)
    sdr = np.full((2, 2, 3), 0.18, dtype=np.float32)
    metadata = _synthetic_jpeg_metadata(4.0)

    proof_scale = epc.export_correctness(
        path, "jpeg_ultrahdr",
        {"ceiling_nits": 1000.0, "ceiling_active": True, "encode_scale": "proof"},
        hdr, sdr, metadata, 203,
    )
    assert proof_scale["ok"] is True
    assert proof_scale["ceiling"]["rule"].startswith("recorded")
    assert proof_scale["ceiling"]["peak_nits"] > 1000.0
    assert proof_scale["ceiling"]["exceed_count"] == 4

    delivery_scale = epc.export_correctness(
        path, "jpeg_ultrahdr",
        {"ceiling_nits": 1000.0, "ceiling_active": True, "encode_scale": "delivery"},
        hdr, sdr, metadata, 203,
    )
    assert delivery_scale["ok"] is False
    failed = {check["name"] for check in delivery_scale["checks"] if not check["ok"]}
    assert failed == {"peak_within_ceiling"}
    assert delivery_scale["ceiling"]["strict_ok"] is False


def test_export_correctness_requires_the_gain_map_container(tmp_path: Path) -> None:
    path = tmp_path / "plain.jpg"
    path.write_bytes(b"\xff\xd8plain jpeg without a gain map")
    hdr = np.full((2, 2, 3), 0.18, dtype=np.float32)
    metadata = _synthetic_jpeg_metadata(16.0)
    result = epc.export_correctness(path, "jpeg_ultrahdr", {}, hdr, None, metadata, 203)
    assert result["ok"] is False
    failed = {check["name"] for check in result["checks"] if not check["ok"]}
    assert "gain_map_container" in failed
    assert "sdr_base_present" in failed


@pytest.mark.parametrize(
    "delivered_format",
    ["jpeg_ultrahdr"],
)
def test_real_ultrahdr_export_agrees_with_declared_settings(tmp_path: Path, delivered_format: str) -> None:
    """Assertion 1 against a real encode: the decoded file is the declared one."""
    import hdr_finisher.capabilities as capability_module
    from hdr_finisher.capabilities import CapabilityStatus
    from hdr_finisher.exporters import JPEGUltraHDRExportBackend
    from hdr_finisher.gainmap_decoders import decode_ultrahdr_jpeg
    from hdr_finisher.test_pattern import build_hdr_test_pattern

    capability = capability_module._ultrahdr_status()
    if capability.status != CapabilityStatus.AVAILABLE:
        pytest.skip(capability.detail)

    image = build_hdr_test_pattern(width=64, height=48)
    adjustments = AdjustmentState()
    adjustments.hdr.highlight_section_enabled = True
    adjustments.hdr.highlight_compression_target_nits = 1000.0
    output = tmp_path / "export-parity.jpg"
    result = JPEGUltraHDRExportBackend(capability).export(
        _session(image, adjustments),
        ExportSettings(format="jpeg_ultrahdr", quality=90, output_path=str(output)),
    )
    assert result.accepted, result.message

    hdr, sdr, metadata = decode_ultrahdr_jpeg(output)
    hdr_project = epc.decoder_scale_to_project(hdr, 203)
    correctness = epc.export_correctness(
        output,
        delivered_format,
        {
            "expected_width": 64,
            "expected_height": 48,
            "ceiling_nits": 1000.0,
            "ceiling_active": True,
        },
        hdr_project,
        sdr,
        metadata,
        203,
    )
    assert correctness["ok"], [check for check in correctness["checks"] if not check["ok"]]
    assert correctness["decodedPeakNits"] > 0.0
    assert correctness["decodedPeakNits"] <= 1011.0
    assert metadata["decoder_reference_white_nits"] == 203.0


def test_run_round_trips_a_preview_frame_and_writes_review_images(tmp_path: Path, monkeypatch) -> None:
    """The CLI entry point's plumbing: JSON in, comparison JSON and PNGs out."""
    delivered = _write_gain_map_stub(tmp_path / "delivered.jpg")
    preview_json = tmp_path / "preview.json"
    preview_bin = tmp_path / "preview.f32"
    width, height = 4, 2
    values = np.full((height, width, 4), 0.5, dtype=np.float32)
    values.tofile(preview_bin)
    preview_json.write_text(
        json.dumps(
            {
                "scenario": "unit",
                "target": {"width": width, "height": height, "format": "rgba16float", "realPrecision": True},
                "box": {"width": 2, "height": 1},
                "referenceWhiteNits": 203,
                "hdrSurface": True,
                "ceilingNits": 1000.0,
                "bands": [{"id": "all", "y": 0, "height": 2}],
                "fixture": {"height": 2},
            }
        ),
        encoding="utf-8",
    )
    settings = {
        "expected_encoded_headroom": 4.0,
        "expected_width": 2,
        "expected_height": 2,
    }
    settings_path = tmp_path / "settings.json"
    settings_path.write_text(json.dumps(settings), encoding="utf-8")

    # The stub file cannot be decoded, so patch the decode to a known frame.
    hdr = np.full((2, 2, 3), 0.18, dtype=np.float32)
    sdr = np.full((2, 2, 3), 0.18, dtype=np.float32)
    metadata = _synthetic_jpeg_metadata(16.0)
    monkeypatch.setattr(epc, "decode_delivered", lambda _path, _format: (hdr, sdr, metadata))
    result = epc.run(
        delivered,
        "jpeg_ultrahdr",
        preview_json,
        preview_bin,
        settings,
        tmp_path / "review",
        tmp_path / "compare.json",
    )

    assert result["exportCorrectness"]["ok"] is True
    assert result["encoding"]["name"] == "preview-presentation-p3-extended-203"
    assert (tmp_path / "compare.json").is_file()
    for key in ("deliveredAtBox", "previewAtBox", "differenceAtBox"):
        assert Path(result["files"][key]).is_file()
    assert result["comparison"]["whole"]["comparedPixels"] == 2
    assert result["comparison"]["whole"]["maxAbs"] > 0.0
