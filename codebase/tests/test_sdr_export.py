from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image
import pytest

import hdr_finisher.exporters as exporter_module
from hdr_finisher.exporters import (
    ExportProcessError,
    SDRJPEGExportBackend,
    SDRJPEGXLExportBackend,
    _write_sdr_jpeg,
    build_export_backends,
)
from hdr_finisher.models import AdjustmentState, CapabilityInfo, CapabilityStatus, ExportSettings, PreviewKind


def _available_capability() -> CapabilityInfo:
    return CapabilityInfo(name="Pillow", status=CapabilityStatus.AVAILABLE, detail="test")


def _session() -> object:
    return type(
        "Session",
        (),
        {
            "session_id": "sdr-test",
            "image": np.full((4, 6, 3), 0.18, dtype=np.float32),
            "sdr_reference_image": None,
            "adjustments": AdjustmentState(),
            "local_adjustments": [],
        },
    )()


def test_sdr_jpeg_export_uses_sdr_branch_quality_and_jpg_suffix(monkeypatch, tmp_path: Path) -> None:
    observed: dict[str, object] = {}

    def fake_render(session, settings, kind, adjustments):
        _ = session, settings, adjustments
        observed["kind"] = kind
        return np.full((4, 6, 3), 0.2, dtype=np.float32)

    def fake_write(path, image, *, quality, chroma_subsampling, dithering, exif_payload):
        observed.update(
            path=path,
            shape=image.shape,
            quality=quality,
            chroma_subsampling=chroma_subsampling,
            dithering=dithering,
            exif_payload=exif_payload,
        )
        Image.fromarray(np.full(image.shape, 128, dtype=np.uint8)).save(path, format="JPEG")

    monkeypatch.setattr(exporter_module, "_render_export_branch", fake_render)
    monkeypatch.setattr(exporter_module, "_write_sdr_jpeg", fake_write)

    result = SDRJPEGExportBackend(_available_capability()).export(
        _session(), ExportSettings(
            format="sdr_jpeg",
            quality=91,
            jpeg_chroma_subsampling="422",
            output_path=str(tmp_path / "scan.png"),
        )
    )

    assert result.accepted is True
    assert result.backend == "sdr_jpeg"
    assert result.output_path is not None and result.output_path.endswith("scan.jpg")
    assert observed == {
        "kind": PreviewKind.SDR,
        "path": observed["path"],
        "shape": (4, 6, 3),
            "quality": 91,
            "chroma_subsampling": "422",
            "dithering": "auto",
            "exif_payload": None,
    }
    assert Path(observed["path"]).parent == Path(result.output_path).parent
    assert Path(observed["path"]).name.endswith(".sdr.tmp.jpg")


@pytest.mark.parametrize("format_name", ["sdr_jpeg", "sdr_png"])
def test_sdr_export_failure_preserves_existing_output(monkeypatch, tmp_path: Path, format_name: str) -> None:
    output = tmp_path / ("existing.jpg" if format_name == "sdr_jpeg" else "existing.png")
    output.write_bytes(b"previous-good")

    def fail_after_partial_write(path, *_args, **_kwargs):
        path.write_bytes(b"partial")
        raise OSError("disk full")

    monkeypatch.setattr(exporter_module, "_render_export_branch", lambda *_args: np.full((4, 6, 3), 0.2, dtype=np.float32))
    backend = SDRJPEGExportBackend(_available_capability()) if format_name == "sdr_jpeg" else exporter_module.SDRPNGExportBackend(_available_capability())
    writer_name = "_write_sdr_jpeg" if format_name == "sdr_jpeg" else "_write_sdr_png"
    monkeypatch.setattr(exporter_module, writer_name, fail_after_partial_write)

    result = backend.export(_session(), ExportSettings(format=format_name, output_path=str(output), overwrite=True))

    assert result.accepted is False
    assert output.read_bytes() == b"previous-good"


def test_sdr_jpegxl_export_uses_sdr_branch_quality_and_jxl_suffix(monkeypatch, tmp_path: Path) -> None:
    observed: dict[str, object] = {}

    def fake_render(session, settings, kind, adjustments):
        _ = session, settings, adjustments
        observed["kind"] = kind
        return np.full((4, 6, 3), 0.2, dtype=np.float32)

    def fake_encode(image, quality, *, dithering, exif_payload):
        observed.update(shape=image.shape, quality=quality, dithering=dithering, exif_payload=exif_payload)
        return b"jxl"

    def fake_validate(payload, expected_shape):
        observed.update(payload=payload, expected_shape=expected_shape)
        return "validated"

    monkeypatch.setattr(exporter_module, "_render_export_branch", fake_render)
    monkeypatch.setattr(exporter_module, "encode_sdr_jpegxl", fake_encode)
    monkeypatch.setattr(exporter_module, "validate_sdr_jpegxl", fake_validate)

    result = SDRJPEGXLExportBackend(_available_capability()).export(
        _session(),
        ExportSettings(format="sdr_jpegxl", quality=92, output_path=str(tmp_path / "scan.png")),
    )

    assert result.accepted is True
    assert result.backend == "sdr_jpegxl"
    assert result.output_path is not None and result.output_path.endswith("scan.jxl")
    assert Path(result.output_path).read_bytes() == b"jxl"
    assert observed == {
        "kind": PreviewKind.SDR,
        "shape": (4, 6, 3),
            "quality": 92,
            "dithering": "auto",
            "exif_payload": None,
            "payload": b"jxl",
        "expected_shape": (4, 6),
    }


@pytest.mark.parametrize(
    ("subsampling", "luma_sampling"),
    [("420", (2, 2)), ("422", (2, 1)), ("444", (1, 1))],
)
def test_sdr_jpeg_writer_creates_requested_chroma_subsampling(
    tmp_path: Path, subsampling: str, luma_sampling: tuple[int, int]
) -> None:
    output = tmp_path / f"scan-{subsampling}.jpg"
    image = np.linspace(0.0, 1.0, 8 * 5 * 3, dtype=np.float32).reshape(5, 8, 3)

    _write_sdr_jpeg(output, image, quality=87, chroma_subsampling=subsampling)

    with Image.open(output) as decoded:
        assert decoded.format == "JPEG"
        assert decoded.mode == "RGB"
        assert decoded.size == (8, 5)
        assert decoded.layer[0][1:3] == luma_sampling


def test_sdr_jpeg_writer_reports_bundled_encoder_dimension_limit(tmp_path: Path) -> None:
    too_wide = np.zeros((1, 65_501, 3), dtype=np.float32)

    with pytest.raises(ExportProcessError, match="65,500"):
        _write_sdr_jpeg(tmp_path / "too-wide.jpg", too_wide, quality=85)


def test_sdr_jpeg_writer_accepts_bundled_encoder_maximum_width(tmp_path: Path) -> None:
    output = tmp_path / "maximum-width.jpg"
    maximum_width = np.zeros((1, 65_500, 3), dtype=np.float32)

    _write_sdr_jpeg(output, maximum_width, quality=85)

    with Image.open(output) as decoded:
        assert decoded.size == (65_500, 1)


def test_export_backend_registry_includes_sdr_jpeg_and_jpegxl() -> None:
    capability = _available_capability()
    capabilities = {
        "avif_gain_map_encoder": capability,
        "ultrahdr_encoder": capability,
        "jpegxl_export": capability,
        "pillow": capability,
    }

    assert isinstance(build_export_backends(capabilities)["sdr_jpeg"], SDRJPEGExportBackend)
    assert isinstance(build_export_backends(capabilities)["sdr_jpegxl"], SDRJPEGXLExportBackend)
