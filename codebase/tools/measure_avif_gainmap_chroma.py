"""Measure AVIF gain-map chroma independently from primary-image chroma.

Run from ``codebase`` with the project virtual environment. Generated AVIFs and
the JSON report belong under ignored ``output/``; durable conclusions belong in
``docs/testing`` and the export documentation.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from types import SimpleNamespace

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))


from hdr_finisher.avif_info import inspect_avif
from hdr_finisher.capabilities import probe_capabilities
from hdr_finisher.exporters import (
    AVIFGainMapExportBackend,
    _finishing_adjustments_for_export,
    _render_export_branch,
)
from hdr_finisher.gainmap_decoders import _decode_avif_gain_map
from hdr_finisher.models import AdjustmentState, CapabilityStatus, ExportSettings, PreviewKind
from hdr_finisher.test_pattern import build_delivery_proof_pattern


GAIN_MAP_CHROMA = ("444", "422", "420", "400")
PRIMARY_CHROMA = ("444", "422", "420")


def _summary(error: np.ndarray) -> dict[str, float]:
    return {
        "mae": float(np.mean(error)),
        "p95_abs": float(np.percentile(error, 95)),
        "max_abs": float(np.max(error)),
    }


def _measure(
    authored_hdr: np.ndarray,
    authored_sdr: np.ndarray,
    decoded_hdr: np.ndarray,
    decoded_sdr: np.ndarray,
) -> dict[str, object]:
    hdr_error = np.abs(decoded_hdr - authored_hdr)
    sdr_error = np.abs(decoded_sdr - authored_sdr)
    maximum = np.max(authored_hdr, axis=-1)
    minimum = np.min(authored_hdr, axis=-1)
    saturation = (maximum - minimum) / np.maximum(maximum, np.float32(1e-6))
    highlight_mask = (maximum > 1.0) & (saturation > 0.2)

    chromaticity = authored_hdr / np.maximum(np.sum(authored_hdr, axis=-1, keepdims=True), np.float32(1e-6))
    edge_strength = np.zeros(authored_hdr.shape[:2], dtype=np.float32)
    edge_strength[:, 1:] += np.max(np.abs(np.diff(chromaticity, axis=1)), axis=-1)
    edge_strength[1:, :] += np.max(np.abs(np.diff(chromaticity, axis=0)), axis=-1)
    edge_mask = edge_strength >= np.percentile(edge_strength, 95)

    height, width = authored_hdr.shape[:2]
    margin = max(8, width // 80)
    gradient_y0 = (height * 2) // 3 + max(4, width // 160)
    gradient = decoded_hdr[gradient_y0 : height - margin, margin : width - margin]
    authored_gradient = authored_hdr[gradient_y0 : height - margin, margin : width - margin]
    decoded_luma = np.mean(gradient, axis=(0, 2))
    authored_luma = np.mean(authored_gradient, axis=(0, 2))
    decoded_steps = np.diff(decoded_luma)
    authored_steps = np.diff(authored_luma)
    flat_steps = (np.abs(decoded_steps) < 1e-7) & (np.abs(authored_steps) >= 1e-7)

    return {
        "hdr": _summary(hdr_error),
        "sdr_base": _summary(sdr_error),
        "saturated_highlights": _summary(hdr_error[highlight_mask]) if np.any(highlight_mask) else None,
        "colored_edges": _summary(hdr_error[edge_mask]),
        "gradient": {
            **_summary(np.abs(gradient - authored_gradient)),
            "flat_step_fraction": float(np.mean(flat_steps)),
            "step_error_p95": float(np.percentile(np.abs(decoded_steps - authored_steps), 95)),
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("output/avif-gainmap-chroma"))
    parser.add_argument("--width", type=int, default=1280)
    parser.add_argument("--height", type=int, default=720)
    parser.add_argument("--quality", type=int, default=88)
    args = parser.parse_args()

    capability = probe_capabilities()["avif_gain_map_encoder"]
    if capability.status != CapabilityStatus.AVAILABLE:
        raise SystemExit(capability.detail)
    args.output = args.output.resolve()
    args.output.mkdir(parents=True, exist_ok=True)

    source = build_delivery_proof_pattern(width=args.width, height=args.height)
    adjustments = AdjustmentState()
    session = SimpleNamespace(
        session_id="avif-gainmap-chroma",
        image=source,
        sdr_reference_image=None,
        adjustments=adjustments,
        local_adjustments=[],
    )
    finishing_adjustments = _finishing_adjustments_for_export(session)
    reference_settings = ExportSettings()
    authored_hdr = _render_export_branch(session, reference_settings, PreviewKind.HDR, finishing_adjustments)
    authored_sdr = _render_export_branch(session, reference_settings, PreviewKind.SDR, finishing_adjustments)
    backend = AVIFGainMapExportBackend(capability)

    combinations = {("444", gain) for gain in GAIN_MAP_CHROMA}
    combinations.update({("420", gain) for gain in GAIN_MAP_CHROMA})
    combinations.update({(primary, "444") for primary in PRIMARY_CHROMA})
    rows: list[dict[str, object]] = []
    for primary, gain in sorted(combinations, reverse=True):
        target = args.output / f"primary-{primary}_gain-{gain}.avif"
        settings = ExportSettings(
            format="avif_gain_map",
            quality=args.quality,
            avif_bit_depth=10,
            avif_chroma_subsampling=primary,
            avif_gain_map_chroma_subsampling=gain,
            output_path=str(target),
            overwrite=True,
        )
        result = backend.export(session, settings)
        if not result.accepted:
            rows.append({"primary_chroma": primary, "gain_map_chroma": gain, "encoded": False, "error": result.message})
            continue
        info = inspect_avif(target)
        decoded_hdr, decoded_sdr, _metadata = _decode_avif_gain_map(target, info)
        rows.append(
            {
                "primary_chroma": primary,
                "gain_map_chroma": gain,
                "encoded": True,
                "decoder_compatible": True,
                "bytes": target.stat().st_size,
                "gain_map_description": (info.get("gain_map") or {}).get("description"),
                "metrics": _measure(authored_hdr, authored_sdr, decoded_hdr, decoded_sdr),
            }
        )

    report = {
        "pattern": "built-in HDR delivery proof pattern",
        "dimensions": [args.width, args.height],
        "quality": args.quality,
        "primary_bit_depth": 10,
        "rows": rows,
    }
    report_path = args.output / "report.json"
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    print(f"Report: {report_path.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
