"""Measure AVIF gain-map chroma independently from primary-image chroma.

Run from ``codebase`` with the project virtual environment. Generated AVIFs and
the JSON report belong under ignored ``output/``; durable conclusions belong in
local maintainer QA notes and the export documentation.
"""

from __future__ import annotations

import argparse
import gc
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
from hdr_finisher.loader import load_image
from hdr_finisher.models import AdjustmentState, CapabilityStatus, ExportSettings, PreviewKind
from hdr_finisher.preview import downsample_image
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


def _measure_photo(
    authored_hdr: np.ndarray,
    authored_sdr: np.ndarray,
    decoded_hdr: np.ndarray,
    decoded_sdr: np.ndarray,
) -> dict[str, object]:
    hdr_error = np.abs(decoded_hdr - authored_hdr)
    sdr_error = np.abs(decoded_sdr - authored_sdr)
    positive_hdr = np.clip(authored_hdr, 0.0, None)
    maximum = np.max(positive_hdr, axis=-1)
    minimum = np.min(positive_hdr, axis=-1)
    saturation = (maximum - minimum) / np.maximum(maximum, np.float32(1e-6))
    highlight_mask = (maximum > 1.0) & (saturation > 0.2)

    chromaticity = positive_hdr / np.maximum(
        np.sum(positive_hdr, axis=-1, keepdims=True), np.float32(1e-6)
    )
    chroma_edge = np.zeros(authored_hdr.shape[:2], dtype=np.float32)
    chroma_edge[:, 1:] = np.maximum(
        chroma_edge[:, 1:], np.max(np.abs(np.diff(chromaticity, axis=1)), axis=-1)
    )
    chroma_edge[1:, :] = np.maximum(
        chroma_edge[1:, :], np.max(np.abs(np.diff(chromaticity, axis=0)), axis=-1)
    )
    positive_edges = chroma_edge[chroma_edge > 0]
    edge_threshold = float(np.percentile(positive_edges, 95)) if positive_edges.size else 0.0
    edge_mask = chroma_edge >= edge_threshold

    luma = np.sum(
        positive_hdr * np.asarray([0.2722287, 0.6740818, 0.0536895], dtype=np.float32), axis=-1
    )
    luma_gradient = np.zeros_like(luma)
    luma_gradient[:, 1:] = np.maximum(luma_gradient[:, 1:], np.abs(np.diff(luma, axis=1)))
    luma_gradient[1:, :] = np.maximum(luma_gradient[1:, :], np.abs(np.diff(luma, axis=0)))
    finite_gradient = luma_gradient[np.isfinite(luma_gradient)]
    smooth_threshold = float(np.percentile(finite_gradient, 35)) if finite_gradient.size else 0.0
    smooth_mask = (luma_gradient <= smooth_threshold) & (luma > np.float32(1e-5))

    return {
        "hdr": _summary(hdr_error),
        "sdr_base": _summary(sdr_error),
        "saturated_highlights": _summary(hdr_error[highlight_mask]) if np.any(highlight_mask) else None,
        "colored_edges": _summary(hdr_error[edge_mask]) if np.any(edge_mask) else None,
        "smooth_regions": _summary(hdr_error[smooth_mask]) if np.any(smooth_mask) else None,
        "content": {
            "peak": float(np.max(maximum)),
            "saturated_highlight_fraction": float(np.mean(highlight_mask)),
            "colored_edge_fraction": float(np.mean(edge_mask)),
            "smooth_region_fraction": float(np.mean(smooth_mask)),
        },
    }


def _parse_csv(value: str, allowed: tuple[str, ...]) -> tuple[str, ...]:
    selected = tuple(item.strip() for item in value.split(",") if item.strip())
    invalid = sorted(set(selected) - set(allowed))
    if not selected or invalid:
        raise argparse.ArgumentTypeError(
            f"Expected a comma-separated subset of {', '.join(allowed)}; invalid: {', '.join(invalid) or 'empty'}"
        )
    return selected


def _aggregate(rows: list[dict[str, object]]) -> list[dict[str, object]]:
    encoded = [row for row in rows if row.get("encoded")]
    baselines = {
        (row["source"], row["gain_map_scale"]): row
        for row in encoded
        if row["gain_map_chroma"] == "444"
    }
    groups: dict[tuple[str, str], list[dict[str, object]]] = {}
    for row in encoded:
        key = (str(row["gain_map_scale"]), str(row["gain_map_chroma"]))
        baseline = baselines.get((row["source"], row["gain_map_scale"]))
        if baseline is None:
            continue
        metrics = row["metrics"]
        baseline_metrics = baseline["metrics"]
        item = {
            "bytes": float(row["bytes"]),
            "size_ratio_to_444": float(row["bytes"]) / max(float(baseline["bytes"]), 1.0),
            "hdr_mae": float(metrics["hdr"]["mae"]),
            "hdr_mae_ratio_to_444": float(metrics["hdr"]["mae"])
            / max(float(baseline_metrics["hdr"]["mae"]), 1e-12),
            "edge_mae": float(metrics["colored_edges"]["mae"]),
            "edge_mae_ratio_to_444": float(metrics["colored_edges"]["mae"])
            / max(float(baseline_metrics["colored_edges"]["mae"]), 1e-12),
        }
        highlight = metrics.get("saturated_highlights")
        baseline_highlight = baseline_metrics.get("saturated_highlights")
        if highlight is not None and baseline_highlight is not None:
            item["highlight_mae"] = float(highlight["mae"])
            item["highlight_mae_ratio_to_444"] = float(highlight["mae"]) / max(
                float(baseline_highlight["mae"]), 1e-12
            )
        groups.setdefault(key, []).append(item)

    aggregate: list[dict[str, object]] = []
    for (scale, chroma), items in sorted(groups.items()):
        summary: dict[str, object] = {
            "gain_map_scale": scale,
            "gain_map_chroma": chroma,
            "images": len(items),
        }
        for metric in items[0]:
            values = [float(item[metric]) for item in items if metric in item]
            if values:
                summary[f"median_{metric}"] = float(np.median(values))
                summary[f"p90_{metric}"] = float(np.percentile(values, 90))
        aggregate.append(summary)
    return aggregate


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("output/avif-gainmap-chroma"))
    parser.add_argument("--input-dir", type=Path, help="Directory of real source images to test instead of the pattern.")
    parser.add_argument("--long-edge", type=int, default=2048, help="Bound real-image working copies to this long edge.")
    parser.add_argument("--width", type=int, default=1280)
    parser.add_argument("--height", type=int, default=720)
    parser.add_argument("--quality", type=int, default=88)
    parser.add_argument("--primary-chroma", choices=PRIMARY_CHROMA, default="420")
    parser.add_argument(
        "--gain-map-chroma",
        type=lambda value: _parse_csv(value, GAIN_MAP_CHROMA),
        default=("444", "422", "420"),
    )
    parser.add_argument(
        "--gain-map-scales",
        type=lambda value: _parse_csv(value, ("full", "half")),
        default=("full",),
    )
    args = parser.parse_args()

    capability = probe_capabilities()["avif_gain_map_encoder"]
    if capability.status != CapabilityStatus.AVAILABLE:
        raise SystemExit(capability.detail)
    args.output = args.output.resolve()
    args.output.mkdir(parents=True, exist_ok=True)

    backend = AVIFGainMapExportBackend(capability)
    rows: list[dict[str, object]] = []
    if args.input_dir:
        sources = sorted(path for path in args.input_dir.resolve().iterdir() if path.suffix.lower() == ".dng")
        if not sources:
            raise SystemExit(f"No DNG sources found in {args.input_dir.resolve()}")
    else:
        sources = [None]

    for source_path in sources:
        if source_path is None:
            source = build_delivery_proof_pattern(width=args.width, height=args.height)
            source_name = "built-in-pattern"
            dimensions_original = [args.width, args.height]
            measure = _measure
        else:
            loaded, descriptor, metadata, analysis, _sdr_reference = load_image(source_path)
            dimensions_original = [descriptor.width, descriptor.height]
            source = np.ascontiguousarray(downsample_image(loaded, args.long_edge), dtype=np.float32)
            del loaded
            gc.collect()
            source_name = source_path.stem
            measure = _measure_photo

        adjustments = AdjustmentState()
        session = SimpleNamespace(
            session_id=source_name,
            source_path=str(source_path) if source_path else None,
            image=source,
            sdr_reference_image=None,
            adjustments=adjustments,
            local_adjustments=[],
        )
        finishing_adjustments = _finishing_adjustments_for_export(session)
        reference_settings = ExportSettings()
        authored_hdr = _render_export_branch(session, reference_settings, PreviewKind.HDR, finishing_adjustments)
        authored_sdr = _render_export_branch(session, reference_settings, PreviewKind.SDR, finishing_adjustments)
        source_output = args.output if source_path is None else args.output / source_name
        source_output.mkdir(parents=True, exist_ok=True)

        if source_path is None:
            legacy_combinations = {("444", gain) for gain in GAIN_MAP_CHROMA}
            legacy_combinations.update({("420", gain) for gain in GAIN_MAP_CHROMA})
            legacy_combinations.update({(primary, "444") for primary in PRIMARY_CHROMA})
            variants = [(primary, gain, "full") for primary, gain in sorted(legacy_combinations, reverse=True)]
        else:
            variants = [
                (args.primary_chroma, gain, scale)
                for scale in args.gain_map_scales
                for gain in args.gain_map_chroma
            ]

        for primary, gain, scale in variants:
            target = source_output / f"primary-{primary}_gain-{gain}_scale-{scale}.avif"
            settings = ExportSettings(
                format="avif_gain_map",
                quality=args.quality,
                avif_bit_depth=10,
                avif_chroma_subsampling=primary,
                avif_gain_map_chroma_subsampling=gain,
                avif_gain_map_scale=scale,
                output_path=str(target),
                overwrite=True,
            )
            result = backend.export(session, settings)
            row: dict[str, object] = {
                "source": source_name,
                "source_path": str(source_path.resolve()) if source_path else None,
                "dimensions_original": dimensions_original,
                "dimensions_tested": [int(source.shape[1]), int(source.shape[0])],
                "primary_chroma": primary,
                "gain_map_chroma": gain,
                "gain_map_scale": scale,
                "encoded": result.accepted,
            }
            if not result.accepted:
                row["error"] = result.message
                rows.append(row)
                continue
            info = inspect_avif(target)
            decoded_hdr, decoded_sdr, _metadata = _decode_avif_gain_map(target, info)
            row.update(
                {
                    "decoder_compatible": True,
                    "bytes": target.stat().st_size,
                    "gain_map_description": (info.get("gain_map") or {}).get("description"),
                    "metrics": measure(authored_hdr, authored_sdr, decoded_hdr, decoded_sdr),
                }
            )
            if source_path is not None:
                row["source_metadata"] = {
                    "software": metadata.get("software"),
                    "dng_route": metadata.get("dng_route"),
                    "matrix_path": metadata.get("dng_color_matrix_path"),
                    "peak_stops_above_diffuse_white": analysis.peak_stops_above_diffuse_white,
                }
            rows.append(row)
        del source, authored_hdr, authored_sdr
        gc.collect()

    report = {
        "corpus": str(args.input_dir.resolve()) if args.input_dir else "built-in HDR delivery proof pattern",
        "long_edge": args.long_edge if args.input_dir else None,
        "quality": args.quality,
        "primary_bit_depth": 10,
        "primary_chroma": args.primary_chroma,
        "gain_map_chroma": list(args.gain_map_chroma),
        "gain_map_scales": list(args.gain_map_scales),
        "aggregate": _aggregate(rows) if args.input_dir else [],
        "rows": rows,
    }
    report_path = args.output / "report.json"
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    print(f"Report: {report_path.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
