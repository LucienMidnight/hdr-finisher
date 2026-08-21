from __future__ import annotations

from pathlib import Path
import sys
from threading import Event, Thread
from time import perf_counter, sleep
from types import SimpleNamespace

import numpy as np
from PIL import Image
import pytest

import hdr_finisher.gainmap_decoders as gainmap_decoders
from hdr_finisher.adjustments import apply_adjustments
from hdr_finisher.capabilities import probe_capabilities
from hdr_finisher.exporters import AVIFGainMapExportBackend, JPEGUltraHDRExportBackend
from hdr_finisher.loader import LoaderError, load_image
from hdr_finisher.models import AdjustmentState, CapabilityStatus, ExportSettings, HDRClassification, PreviewKind
from hdr_finisher.preview import render_preview_bytes
from hdr_finisher.test_pattern import build_hdr_test_pattern


def _session(image: np.ndarray, sdr_reference: np.ndarray | None = None) -> SimpleNamespace:
    adjustments = AdjustmentState()
    if sdr_reference is not None:
        adjustments.sdr.highlight_recovery = 0.0
    return SimpleNamespace(
        session_id="gainmap-import",
        image=image,
        sdr_reference_image=sdr_reference,
        adjustments=adjustments,
    )


def _luma(image: np.ndarray) -> np.ndarray:
    return 0.2722287 * image[..., 0] + 0.6740818 * image[..., 1] + 0.0536895 * image[..., 2]


def test_plain_jpeg_still_uses_the_sdr_pillow_path(tmp_path: Path) -> None:
    path = tmp_path / "plain.jpg"
    Image.new("RGB", (12, 8), (128, 64, 32)).save(path, quality=95)

    image, descriptor, metadata, analysis, sdr_reference = load_image(path)

    assert descriptor.suffix == ".jpg"
    assert analysis.classification == HDRClassification.SDR_ONLY
    assert metadata.get("jpeg_ultrahdr") is None
    assert sdr_reference is None
    assert image.shape == (8, 12, 3)


def test_avif_preview_decodes_only_the_color_managed_primary_rendition(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    path = tmp_path / "preview.avif"
    path.write_bytes(b"synthetic-avif")
    decoded = np.zeros((4, 6, 3), dtype=np.uint8)
    decoded[..., 0] = 128
    calls = {"primary": 0}

    monkeypatch.setattr(
        gainmap_decoders,
        "inspect_avif",
        lambda _path: {
            "gain_map_present": True,
            "color_primaries": 1,
            "transfer_char": 13,
        },
    )

    def decode_primary(_payload: bytes) -> np.ndarray:
        calls["primary"] += 1
        return decoded

    monkeypatch.setitem(sys.modules, "imagecodecs", SimpleNamespace(avif_decode=decode_primary))
    monkeypatch.setattr(
        gainmap_decoders,
        "_decode_avif_gain_map",
        lambda *_args, **_kwargs: pytest.fail("thumbnail preview reconstructed the gain map"),
    )

    preview = gainmap_decoders.decode_avif_preview(path)

    assert calls["primary"] == 1
    assert preview.shape == decoded.shape
    assert preview.dtype == np.float32
    assert np.all(np.isfinite(preview))


def test_large_avif_color_conversion_is_strip_bounded_and_matches_full_frame(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    rng = np.random.default_rng(42)
    hdr_encoded = rng.random((513, 37, 3), dtype=np.float32)
    sdr_encoded = rng.random((513, 37, 3), dtype=np.float32)
    expected_hdr = gainmap_decoders.normalize_to_acescg(hdr_encoded.copy(), "BT.2020", "PQ")
    expected_sdr = np.clip(
        gainmap_decoders.acescg_to_linear_srgb(
            gainmap_decoders.normalize_to_acescg(sdr_encoded.copy(), "BT.2020", "BT.709")
        ),
        0.0,
        1.0,
    )
    original_normalize = gainmap_decoders.normalize_to_acescg
    observed_rows: list[int] = []

    def tracked_normalize(image, color_space, transfer):
        observed_rows.append(image.shape[0])
        return original_normalize(image, color_space, transfer)

    monkeypatch.setattr(gainmap_decoders, "normalize_to_acescg", tracked_normalize)
    actual_hdr = gainmap_decoders._normalize_to_acescg_in_strips(
        hdr_encoded.copy(), "BT.2020", "PQ", rows=64
    )
    actual_sdr = gainmap_decoders._normalize_sdr_reference_in_strips(
        sdr_encoded.copy(), "BT.2020", "BT.709", rows=64
    )

    assert max(observed_rows) <= 64
    assert np.allclose(actual_hdr, expected_hdr, rtol=2e-5, atol=2e-6)
    assert np.allclose(actual_sdr, expected_sdr, rtol=2e-5, atol=2e-6)


def test_decoder_subprocess_can_be_cancelled_promptly() -> None:
    cancelled = Event()
    trigger = Thread(target=lambda: (sleep(0.1), cancelled.set()), daemon=True)
    started = perf_counter()
    trigger.start()

    with pytest.raises(gainmap_decoders.GainMapDecodeError, match="Import cancelled"):
        gainmap_decoders._run(
            [sys.executable, "-c", "import time; time.sleep(10)"],
            cancelled=cancelled.is_set,
        )

    trigger.join(timeout=1)
    assert perf_counter() - started < 2.0


def test_jpeg_embedded_image_marker_does_not_imply_a_gain_map(tmp_path: Path) -> None:
    path = tmp_path / "plain-with-secondary-marker.jpg"
    Image.new("RGB", (12, 8), (128, 64, 32)).save(path, quality=95)
    path.write_bytes(path.read_bytes() + b"\xff\xd8thumbnail-like-data")

    _image, _descriptor, metadata, analysis, sdr_reference = load_image(path)

    assert analysis.classification == HDRClassification.SDR_ONLY
    assert metadata.get("jpeg_ultrahdr") is None
    assert sdr_reference is None


def test_gainmap_jpeg_never_silently_falls_back_when_decoder_is_missing(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    path = tmp_path / "advertised-ultrahdr.jpg"
    Image.new("RGB", (8, 6), (96, 96, 96)).save(path)
    path.write_bytes(path.read_bytes() + b"http://ns.adobe.com/hdr-gain-map/1.0/")
    monkeypatch.setattr(gainmap_decoders, "resolve_binary", lambda _name: None)

    with pytest.raises(LoaderError, match="refusing to silently open only the SDR fallback"):
        load_image(path)


@pytest.mark.skipif(
    probe_capabilities()["avif_gain_map_decoder"].status != CapabilityStatus.AVAILABLE,
    reason="AVIF gain-map decoder tools are unavailable",
)
def test_tracked_avif_gainmap_import_recovers_both_renditions() -> None:
    path = Path(__file__).resolve().parents[1] / "samples" / "hdr_reference.avif"

    image, descriptor, metadata, analysis, sdr_reference = load_image(path)

    assert descriptor.suffix == ".avif"
    assert descriptor.source_color_space == "ACEScg"
    assert descriptor.transfer_function == "LINEAR"
    assert analysis.classification == HDRClassification.HDR_TRUE
    assert metadata["avif_gain_map"] is True
    assert metadata["gain_map_applied"] is True
    assert metadata["sdr_base_preserved"] is True
    assert metadata["reference_white_nits"] == 100.0
    assert metadata["hdr_capacity_stops"] == pytest.approx(3.71, abs=0.01)
    assert sdr_reference is not None
    assert sdr_reference.shape == image.shape
    assert float(np.max(image)) > 1.0
    assert 0.9 < float(np.max(sdr_reference)) <= 1.0


def test_avif_gainmap_accepts_bt709_transfer_on_sdr_base(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    info = {
        "color_primaries": 9,
        "transfer_char": 1,
        "matrix_coeffs": 9,
        "gain_map": {"base_headroom": 0.0, "alternate_headroom": 2.3},
        "alternate_image": {
            "color_primaries": 9,
            "transfer_char": 16,
            "matrix_coeffs": 9,
            "bit_depth": 10,
        },
    }
    monkeypatch.setattr(gainmap_decoders, "resolve_binary", lambda name: tmp_path / name)

    commands: list[list[str]] = []

    def fake_run(command: list[str], **_kwargs) -> SimpleNamespace:
        commands.append(command)
        return SimpleNamespace(stdout="Base Headroom: 0.00\nAlternate Headroom: 2.30", stderr="")

    monkeypatch.setattr(gainmap_decoders, "_run", fake_run)
    monkeypatch.setattr(
        gainmap_decoders,
        "_decode_png_pixels",
        lambda _path: np.full((2, 3, 3), 0.25, dtype=np.float32),
    )

    monkeypatch.setattr(
        gainmap_decoders,
        "_decode_avif_primary_pixels",
        lambda _path, **_kwargs: np.full((2, 3, 3), 0.5, dtype=np.float32),
    )

    _hdr, linear_sdr, metadata = gainmap_decoders._decode_avif_gain_map(tmp_path / "lightroom.avif", info)

    assert gainmap_decoders._cicp_transfer(1) == "BT.709"
    assert metadata["hdr_capacity_stops"] == pytest.approx(2.3)
    assert metadata["sdr_base_preserved"] is True
    assert float(np.mean(linear_sdr)) == pytest.approx(0.2596, abs=0.001)
    tonemap_command = next(command for command in commands if "tonemap" in command)
    assert tonemap_command[3].endswith("hdr.png")


@pytest.mark.skipif(
    probe_capabilities()["avif_decoder"].status != CapabilityStatus.AVAILABLE,
    reason="avifdec is unavailable",
)
def test_direct_pq_avif_import_does_not_double_decode(tmp_path: Path) -> None:
    source = build_hdr_test_pattern(width=96, height=54)
    body, _media_type = render_preview_bytes(source, AdjustmentState(), PreviewKind.HDR, long_edge=96)
    path = tmp_path / "direct-hdr.avif"
    path.write_bytes(body)

    decoded, _descriptor, metadata, analysis, sdr_reference = load_image(path)

    assert metadata["avif_direct_hdr"] is True
    assert metadata["gain_map_applied"] is False
    assert analysis.classification == HDRClassification.HDR_TRUE
    assert sdr_reference is None
    source_luma = _luma(apply_adjustments(source, AdjustmentState(), PreviewKind.HDR))
    decoded_luma = _luma(decoded)
    assert float(np.percentile(decoded_luma, 99)) == pytest.approx(
        float(np.percentile(source_luma, 99)), rel=0.08
    )


@pytest.mark.parametrize("format_name", ["avif_gain_map", "jpeg_ultrahdr"])
def test_production_export_reimports_hdr_and_authored_sdr(tmp_path: Path, format_name: str) -> None:
    capabilities = probe_capabilities()
    capability_name = "avif_gain_map_encoder" if format_name == "avif_gain_map" else "ultrahdr_encoder"
    if capabilities[capability_name].status != CapabilityStatus.AVAILABLE:
        pytest.skip(capabilities[capability_name].detail)

    image = build_hdr_test_pattern(width=96, height=54)
    adjustments = AdjustmentState()
    session = _session(image)
    suffix = ".avif" if format_name == "avif_gain_map" else ".jpg"
    output = tmp_path / f"roundtrip{suffix}"
    backend = (
        AVIFGainMapExportBackend(capabilities[capability_name])
        if format_name == "avif_gain_map"
        else JPEGUltraHDRExportBackend(capabilities[capability_name])
    )
    result = backend.export(
        session,
        ExportSettings(format=format_name, quality=95, output_path=str(output)),
    )
    assert result.accepted, result.message

    decoded, descriptor, metadata, analysis, decoded_sdr = load_image(output)
    authored_hdr = apply_adjustments(image, adjustments, PreviewKind.HDR)
    authored_sdr = apply_adjustments(image, adjustments, PreviewKind.SDR)

    assert descriptor.width == image.shape[1]
    assert descriptor.height == image.shape[0]
    assert analysis.classification == HDRClassification.HDR_TRUE
    assert metadata["gain_map_applied"] is True
    assert decoded_sdr is not None
    assert decoded_sdr.shape == authored_sdr.shape
    assert float(np.percentile(_luma(decoded), 99)) == pytest.approx(
        float(np.percentile(_luma(authored_hdr), 99)), rel=0.22
    )
    assert float(np.mean(np.abs(decoded_sdr - authored_sdr))) < 0.06
    highlight_order = np.argsort(_luma(decoded).reshape(-1))[-16:]
    authored_at_decoded_highlights = _luma(authored_hdr).reshape(-1)[highlight_order]
    assert float(np.median(authored_at_decoded_highlights)) > float(np.percentile(_luma(authored_hdr), 90))

    # A second lossy generation need not be pixel-identical, but it must keep
    # the authored HDR/SDR relationship and capacity metadata stable enough to edit again.
    second_output = tmp_path / f"roundtrip-second{suffix}"
    second_result = backend.export(
        _session(decoded, decoded_sdr),
        ExportSettings(format=format_name, quality=95, output_path=str(second_output)),
    )
    assert second_result.accepted, second_result.message
    second_hdr, second_descriptor, second_metadata, second_analysis, second_sdr = load_image(second_output)
    assert (second_descriptor.width, second_descriptor.height) == (descriptor.width, descriptor.height)
    assert second_analysis.classification == HDRClassification.HDR_TRUE
    assert second_sdr is not None
    # The independently authored SDR rendition is encoded again, so bound the
    # measured second-generation 8/10-bit compression drift rather than demand identity.
    assert float(np.mean(np.abs(second_sdr - decoded_sdr))) < 0.075
    assert float(np.percentile(_luma(second_hdr), 99)) == pytest.approx(
        float(np.percentile(_luma(decoded), 99)), rel=0.25
    )
    assert second_metadata["hdr_capacity_stops"] == pytest.approx(
        metadata["hdr_capacity_stops"], abs=0.35
    )
