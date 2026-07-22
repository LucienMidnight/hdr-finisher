from __future__ import annotations

import io
from pathlib import Path
import subprocess

import numpy as np
from PIL import Image
import pytest

import hdr_finisher.binaries as binaries
import hdr_finisher.capabilities as capability_module
import hdr_finisher.exporters as exporter_module
from hdr_finisher.exporters import (
    ExportProcessError,
    JPEGUltraHDRExportBackend,
    _build_ultrahdr_encode_command,
    _inspect_ultrahdr_markers,
    _run_command,
    _validate_ultrahdr_output,
)
from hdr_finisher.models import AdjustmentState, CapabilityInfo, CapabilityStatus, ExportSettings, PreviewKind
from hdr_finisher.test_pattern import build_hdr_test_pattern


def _available_capability() -> CapabilityInfo:
    return CapabilityInfo(name="JPEG Ultra HDR", status=CapabilityStatus.AVAILABLE, detail="test")


def _session(image: np.ndarray | None = None, adjustments: AdjustmentState | None = None) -> object:
    return type(
        "Session",
        (),
        {
            "session_id": "ultrahdr-test",
            "image": image if image is not None else np.full((4, 6, 3), 0.18, dtype=np.float32),
            "sdr_reference_image": None,
            "adjustments": adjustments or AdjustmentState(),
        },
    )()


def _jpeg_bytes(color: tuple[int, int, int] = (90, 120, 150)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (8, 6), color).save(buffer, format="JPEG", quality=90)
    return buffer.getvalue()


def test_ultrahdr_capability_missing(monkeypatch) -> None:
    monkeypatch.setattr(capability_module, "resolve_binary", lambda _name: None)
    capability = capability_module._ultrahdr_status()
    assert capability.status == CapabilityStatus.MISSING
    assert "bin/" in capability.detail


def test_ultrahdr_capability_present_with_current_cli(monkeypatch, tmp_path: Path) -> None:
    binary = tmp_path / "ultrahdr_app.exe"
    binary.write_bytes(b"test")
    monkeypatch.setattr(capability_module, "resolve_binary", lambda _name: binary)
    monkeypatch.setattr(
        capability_module.subprocess,
        "run",
        lambda *args, **kwargs: subprocess.CompletedProcess(
            args=args[0], returncode=255, stdout="", stderr="ultra hdr demo application\n-P Probe mode"
        ),
    )
    capability = capability_module._ultrahdr_status()
    assert capability.status == CapabilityStatus.AVAILABLE
    assert str(binary) in capability.detail


def test_binary_discovery_checks_resource_and_packaged_runtime_dirs(monkeypatch, tmp_path: Path) -> None:
    resource_root = tmp_path / "resource"
    runtime_root = tmp_path / "runtime"
    runtime_binary = runtime_root / "bin" / "ultrahdr_app.exe"
    runtime_binary.parent.mkdir(parents=True)
    runtime_binary.write_bytes(b"binary")
    monkeypatch.setattr(binaries, "BIN_DIR", resource_root / "bin")
    monkeypatch.setattr(binaries, "RUNTIME_ROOT", runtime_root)
    monkeypatch.setattr(binaries.shutil, "which", lambda _command: None)
    assert binaries.resolve_binary("ultrahdr_app") == runtime_binary.resolve()


def test_ultrahdr_command_uses_current_raw_intent_cli_and_quality(tmp_path: Path) -> None:
    command = _build_ultrahdr_encode_command(
        tmp_path / "ultrahdr_app.exe",
        tmp_path / "hdr.raw",
        tmp_path / "sdr.raw",
        tmp_path / "finished.jpg",
        width=640,
        height=480,
        quality=87,
        target_peak_nits=1250.5,
    )
    assert command[:3] == [str(tmp_path / "ultrahdr_app.exe"), "-m", "0"]
    assert command[command.index("-a") + 1] == "4"
    assert command[command.index("-b") + 1] == "3"
    assert command[command.index("-t") + 1] == "0"
    assert command[command.index("-C") + 1] == "2"
    assert command[command.index("-c") + 1] == "0"
    assert command[command.index("-q") + 1] == "87"
    assert command[command.index("-Q") + 1] == "87"
    assert command[command.index("-L") + 1] == "1250.5"
    assert command[command.index("-z") + 1].endswith("finished.jpg")


@pytest.mark.parametrize("quality", [0, 101])
def test_ultrahdr_command_rejects_out_of_range_quality(tmp_path: Path, quality: int) -> None:
    with pytest.raises(ValueError, match="quality"):
        _build_ultrahdr_encode_command(
            tmp_path / "ultrahdr_app.exe",
            tmp_path / "hdr.raw",
            tmp_path / "sdr.raw",
            tmp_path / "finished.jpg",
            width=2,
            height=2,
            quality=quality,
            target_peak_nits=1000,
        )


def test_export_uses_independent_hdr_and_sdr_branches_and_forces_jpg(monkeypatch, tmp_path: Path) -> None:
    binary = tmp_path / "ultrahdr_app.exe"
    binary.write_bytes(b"test")
    observed: dict[str, object] = {"kinds": []}

    def fake_adjustments(image, adjustments, kind, sdr_reference_image=None):
        _ = image, adjustments, sdr_reference_image
        observed["kinds"].append(kind)
        level = 1.8 if kind == PreviewKind.HDR else 0.2
        return np.full((4, 6, 3), level, dtype=np.float32)

    def fake_run(command: list[str]):
        observed["command"] = command
        output = Path(command[command.index("-z") + 1])
        output.write_bytes(b"encoded")
        return subprocess.CompletedProcess(command, 0, "", "")

    monkeypatch.setattr(exporter_module, "resolve_binary", lambda _name: binary)
    monkeypatch.setattr(exporter_module, "apply_adjustments", fake_adjustments)
    monkeypatch.setattr(exporter_module, "_run_command", fake_run)
    monkeypatch.setattr(exporter_module, "_validate_ultrahdr_output", lambda *_args: "validated")

    requested = tmp_path / "custom-name.jpeg"
    result = JPEGUltraHDRExportBackend(_available_capability()).export(
        _session(), ExportSettings(format="jpeg_ultrahdr", quality=73, output_path=str(requested))
    )

    assert result.accepted is True
    assert result.output_path == str((tmp_path / "custom-name.jpg").resolve())
    assert Path(result.output_path).read_bytes() == b"encoded"
    assert observed["kinds"] == [PreviewKind.HDR, PreviewKind.SDR]
    command = observed["command"]
    assert command[command.index("-q") + 1] == "73"


def test_encoder_failure_cleans_staged_file_and_preserves_existing_output(monkeypatch, tmp_path: Path) -> None:
    binary = tmp_path / "ultrahdr_app.exe"
    binary.write_bytes(b"test")
    output = tmp_path / "existing.jpg"
    output.write_bytes(b"previous-good-export")

    def failing_run(command: list[str]):
        staged = Path(command[command.index("-z") + 1])
        staged.write_bytes(b"partial")
        raise ExportProcessError("encoder exploded")

    monkeypatch.setattr(exporter_module, "resolve_binary", lambda _name: binary)
    monkeypatch.setattr(exporter_module, "_run_command", failing_run)
    result = JPEGUltraHDRExportBackend(_available_capability()).export(
        _session(), ExportSettings(format="jpeg_ultrahdr", quality=85, output_path=str(output))
    )

    assert result.accepted is False
    assert "encoder exploded" in result.message
    assert output.read_bytes() == b"previous-good-export"
    assert list(tmp_path.glob(".*.ultrahdr.tmp.jpg")) == []


def test_marker_and_legacy_validation_accepts_both_metadata_formats(monkeypatch, tmp_path: Path) -> None:
    output = tmp_path / "valid.jpg"
    output.write_bytes(
        _jpeg_bytes()
        + b"http://ns.adobe.com/hdr-gain-map/1.0/ hdrgm:Version=\"1.0\""
        + b"urn:iso:std:iso:ts:21496:-1"
        + _jpeg_bytes((200, 200, 200))
    )
    monkeypatch.setattr(
        exporter_module,
        "_run_command",
        lambda command: subprocess.CompletedProcess(
            command, 0, "--maxContentBoost 4\n--hdrCapacityMax 4", ""
        ),
    )
    message = _validate_ultrahdr_output(output, tmp_path / "ultrahdr_app.exe")
    markers = _inspect_ultrahdr_markers(output)
    assert markers.jpeg_images == 2
    assert markers.ultra_hdr_v1 is True
    assert markers.iso_21496_1 is True
    assert "Ultra HDR v1" in message


def test_validation_rejects_invalid_jpeg_signature(tmp_path: Path) -> None:
    output = tmp_path / "invalid.jpg"
    output.write_bytes(b"not a jpeg")
    with pytest.raises(ExportProcessError, match="valid JPEG"):
        _validate_ultrahdr_output(output, tmp_path / "ultrahdr_app.exe")


def test_validation_rejects_missing_iso_metadata(monkeypatch, tmp_path: Path) -> None:
    output = tmp_path / "xmp-only.jpg"
    output.write_bytes(
        _jpeg_bytes()
        + b"http://ns.adobe.com/hdr-gain-map/1.0/ hdrgm:Version=\"1.0\""
        + _jpeg_bytes((200, 200, 200))
    )
    monkeypatch.setattr(exporter_module, "_run_command", lambda command: subprocess.CompletedProcess(command, 0, "", ""))
    with pytest.raises(ExportProcessError, match="ISO 21496-1"):
        _validate_ultrahdr_output(output, tmp_path / "ultrahdr_app.exe")


def test_real_ultrahdr_export_and_decode_when_encoder_is_available(tmp_path: Path) -> None:
    capability = capability_module._ultrahdr_status()
    if capability.status != CapabilityStatus.AVAILABLE:
        pytest.skip(capability.detail)
    binary = binaries.resolve_binary("ultrahdr_app")
    assert binary is not None

    image = build_hdr_test_pattern(width=64, height=48)
    output = tmp_path / "real-ultrahdr.jpg"
    result = JPEGUltraHDRExportBackend(capability).export(
        _session(image, AdjustmentState()),
        ExportSettings(format="jpeg_ultrahdr", quality=90, output_path=str(output)),
    )
    assert result.accepted, result.message
    assert output.read_bytes()[:2] == b"\xff\xd8"

    with Image.open(output) as legacy:
        legacy_rgb = np.asarray(legacy.convert("RGB"), dtype=np.float32) / 255.0
    legacy_linear = np.where(
        legacy_rgb <= 0.04045,
        legacy_rgb / 12.92,
        np.power((legacy_rgb + 0.055) / 1.055, 2.4),
    )

    decoded_hdr_path = tmp_path / "decoded-linear-rgba-f16.raw"
    _run_command(
        [str(binary), "-m", "1", "-j", str(output), "-o", "0", "-O", "4", "-z", str(decoded_hdr_path)]
    )
    decoded_hdr = np.fromfile(decoded_hdr_path, dtype="<f2").astype(np.float32).reshape(48, 64, 4)[..., :3]
    assert float(decoded_hdr.max()) > float(legacy_linear.max())
    assert float(np.percentile(decoded_hdr, 99)) > float(np.percentile(legacy_linear, 99))
