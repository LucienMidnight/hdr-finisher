from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from hdr_finisher.adjustments import apply_adjustments
from hdr_finisher.binaries import resolve_binary
from hdr_finisher.capabilities import probe_capabilities
from hdr_finisher.color import linear_srgb_to_acescg
from hdr_finisher.exporters import JPEGUltraHDRExportBackend
from hdr_finisher.loader import load_image
from hdr_finisher.models import AdjustmentState, CapabilityStatus, ExportSettings, PreviewKind


def main() -> None:
    parser = argparse.ArgumentParser(description="Compare half/Q85 and full/Q100 Ultra HDR gain maps.")
    parser.add_argument("input", type=Path)
    parser.add_argument("--adjustments", type=Path, help="Optional AdjustmentState JSON exported by a caller.")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "output" / "qa" / "jpeg_reliability")
    args = parser.parse_args()

    args.output_dir = args.output_dir.resolve()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    adjustments = _load_adjustments(args.adjustments)
    image, _source, _metadata, _analysis, sdr_reference = load_image(args.input)
    capability = probe_capabilities()["ultrahdr_encoder"]
    if capability.status != CapabilityStatus.AVAILABLE:
        raise SystemExit(capability.detail)
    binary = resolve_binary("ultrahdr_app")
    if binary is None:
        raise SystemExit("ultrahdr_app is unavailable")

    session = SimpleNamespace(
        session_id="jpeg-reliability",
        image=image,
        sdr_reference_image=sdr_reference,
        adjustments=adjustments,
    )
    expected_hdr = apply_adjustments(image, adjustments, PreviewKind.HDR)
    expected_sdr = apply_adjustments(
        image,
        adjustments,
        PreviewKind.SDR,
        sdr_reference_image=sdr_reference,
    )
    backend = JPEGUltraHDRExportBackend(capability)
    variants = {
        "half_q85": (85, "half"),
        "full_q100": (100, "full"),
    }
    report: dict[str, object] = {
        "input": str(args.input.resolve()),
        "dimensions": [int(image.shape[1]), int(image.shape[0])],
        "variants": {},
    }
    for name, (gain_quality, scale) in variants.items():
        output = args.output_dir / f"{args.input.stem}-{name}.jpg"
        response = backend.export(
            session,
            ExportSettings(
                format="jpeg_ultrahdr",
                quality=85,
                jpeg_gain_map_quality=gain_quality,
                jpeg_gain_map_scale=scale,
                output_path=str(output),
            ),
        )
        if not response.accepted:
            raise RuntimeError(response.message)
        decoded = _decode_hdr(binary, output, image.shape[1], image.shape[0], args.output_dir / f"{name}.rgba-f16.raw")
        metadata = _probe_metadata(binary, output)
        report["variants"][name] = {
            "path": str(output.resolve()),
            "bytes": output.stat().st_size,
            "metadata": metadata,
            "hdr_edge_error": _edge_error(expected_hdr, decoded),
            "sdr_fallback_error": _sdr_error(expected_sdr, output),
        }

    report_path = args.output_dir / "report.json"
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


def _load_adjustments(path: Path | None) -> AdjustmentState:
    if path is None:
        return AdjustmentState()
    return AdjustmentState.model_validate_json(path.read_text(encoding="utf-8"))


def _decode_hdr(binary: Path, jpeg: Path, width: int, height: int, raw: Path) -> np.ndarray:
    result = subprocess.run(
        [str(binary), "-m", "1", "-j", str(jpeg), "-o", "0", "-O", "4", "-z", str(raw)],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "Ultra HDR decode failed")
    decoded = np.fromfile(raw, dtype="<f2").astype(np.float32).reshape(height, width, 4)[..., :3]
    decoded *= np.float32(203.0 * 0.18 / 100.0)
    return np.clip(linear_srgb_to_acescg(decoded), 0.0, None)


def _probe_metadata(binary: Path, jpeg: Path) -> dict[str, float | int]:
    result = subprocess.run(
        [str(binary), "-m", "1", "-j", str(jpeg), "-P"],
        capture_output=True,
        text=True,
        check=False,
    )
    values: dict[str, float | int] = {}
    for line in f"{result.stdout}\n{result.stderr}".splitlines():
        parts = line.strip().split()
        if len(parts) != 2 or not parts[0].startswith("--"):
            continue
        try:
            value = float(parts[1])
        except ValueError:
            continue
        values[parts[0][2:]] = int(value) if value.is_integer() else value
    return values


def _edge_error(expected: np.ndarray, actual: np.ndarray) -> dict[str, float]:
    luma = np.sum(np.clip(expected, 0.0, None) * np.array([0.2722287, 0.6740818, 0.0536895]), axis=-1)
    gradient = np.zeros_like(luma)
    gradient[:, 1:] = np.maximum(gradient[:, 1:], np.abs(np.diff(luma, axis=1)))
    gradient[1:, :] = np.maximum(gradient[1:, :], np.abs(np.diff(luma, axis=0)))
    positive_gradient = gradient[gradient > 0]
    threshold = float(np.percentile(positive_gradient, 90)) if positive_gradient.size else 0.0
    edge = gradient >= threshold
    expected_chroma = _chromaticity(expected)
    actual_chroma = _chromaticity(actual)
    error = np.mean(np.abs(actual_chroma - expected_chroma), axis=-1)
    edge_error = error[edge]
    return {
        "edge_pixels": int(edge_error.size),
        "mean_chromaticity_error": float(np.mean(edge_error)) if edge_error.size else 0.0,
        "p95_chromaticity_error": float(np.percentile(edge_error, 95)) if edge_error.size else 0.0,
        "p99_chromaticity_error": float(np.percentile(edge_error, 99)) if edge_error.size else 0.0,
        "colored_outliers_over_0_08_percent": float(np.mean(edge_error > 0.08) * 100.0) if edge_error.size else 0.0,
        "severe_outliers_over_0_15_percent": float(np.mean(edge_error > 0.15) * 100.0) if edge_error.size else 0.0,
    }


def _sdr_error(expected: np.ndarray, jpeg: Path) -> dict[str, float]:
    with Image.open(jpeg) as image:
        encoded = np.asarray(image.convert("RGB"), dtype=np.float32) / 255.0
    linear = np.where(encoded <= 0.04045, encoded / 12.92, np.power((encoded + 0.055) / 1.055, 2.4))
    expected_chroma = _chromaticity(np.clip(expected, 0.0, 1.0))
    actual_chroma = _chromaticity(linear)
    error = np.mean(np.abs(actual_chroma - expected_chroma), axis=-1)
    return {
        "mean_chromaticity_error": float(np.mean(error)),
        "p99_chromaticity_error": float(np.percentile(error, 99)),
        "severe_outliers_over_0_15_percent": float(np.mean(error > 0.15) * 100.0),
    }


def _chromaticity(image: np.ndarray) -> np.ndarray:
    positive = np.clip(image.astype(np.float32, copy=False), 0.0, None)
    total = np.maximum(np.sum(positive, axis=-1, keepdims=True), 1e-7)
    return positive / total


if __name__ == "__main__":
    main()
