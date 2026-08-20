from __future__ import annotations

import argparse
import json
from pathlib import Path
from time import perf_counter
from typing import Any

import numpy as np

from hdr_finisher.linear_dng import DngRoute, decode_linear_dng, inspect_dng
from hdr_finisher.models import RawImportSettings
from hdr_finisher.raw_import import decode_raw


CORPUS = Path("local-test-media/inputs/linear-dng")


def _inspection_payload(path: Path) -> tuple[Any, dict[str, Any]]:
    inspection = inspect_dng(path)
    estimate = inspection.resource_estimate
    return inspection, {
        "file": str(path.relative_to(CORPUS)),
        "route": inspection.route.value,
        "dimensions": [inspection.width, inspection.height],
        "samples": inspection.samples_per_pixel,
        "dtype": inspection.dtype,
        "compression": inspection.compression,
        "primary_series": inspection.primary_series_index,
        "primary_offset": inspection.fingerprint.primary_offset,
        "color_path": inspection.color_path,
        "required_opcodes": [opcode.name for opcode in inspection.required_opcodes],
        "warnings": list(inspection.warnings),
        "rejection": None if inspection.rejection is None else inspection.rejection.message,
        "estimated_import_gib": (
            None if estimate is None else round(estimate.conservative_import_peak_bytes / 2**30, 3)
        ),
        "estimated_export_gib": (
            None if estimate is None else round(estimate.conservative_export_peak_bytes / 2**30, 3)
        ),
        "full_frame_gpu_compatible": None if estimate is None else estimate.full_frame_gpu_compatible,
        "proxy_dimensions": None if estimate is None else [estimate.proxy_width, estimate.proxy_height],
    }


def _decode(path: Path, inspection: Any) -> dict[str, Any]:
    started = perf_counter()
    if inspection.route is DngRoute.LINEAR_DNG:
        image, metadata = decode_linear_dng(path, inspection)
    elif inspection.route is DngRoute.MOSAICED_RAW_DNG:
        image, metadata = decode_raw(path, RawImportSettings(), dng_inspection=inspection)
    else:
        raise RuntimeError(inspection.rejection.message if inspection.rejection else inspection.route.value)
    return {
        "seconds": round(perf_counter() - started, 3),
        "output_shape": list(image.shape),
        "output_dtype": str(image.dtype),
        "channel_min": np.min(image, axis=(0, 1)).tolist(),
        "channel_max": np.max(image, axis=(0, 1)).tolist(),
        "operations": metadata.get("dng_operations", "none"),
        "color_path": metadata.get("dng_color_path"),
        "opcode_audit": metadata.get("dng_opcode_audit"),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Inspect the ignored Experimental DNG corpus.")
    parser.add_argument(
        "--decode",
        action="append",
        default=[],
        metavar="FILENAME",
        help="Fully decode a named corpus file; repeat to decode more than one.",
    )
    parser.add_argument("--output", type=Path, help="Optional JSON report path below an ignored output directory.")
    args = parser.parse_args()
    if not CORPUS.is_dir():
        parser.error(f"private corpus is absent: {CORPUS}")
    if args.output is not None:
        output_root = Path("output").resolve()
        output_path = args.output.resolve()
        if not output_path.is_relative_to(output_root):
            parser.error("--output must remain below the ignored codebase/output directory")
        args.output = output_path
    requested = set(args.decode)
    paths = sorted(path for path in CORPUS.rglob("*") if path.suffix.lower() == ".dng")
    unknown = requested - {path.name for path in paths}
    if unknown:
        parser.error(f"unknown corpus filename(s): {', '.join(sorted(unknown))}")
    report: list[dict[str, Any]] = []
    for path in paths:
        inspection, payload = _inspection_payload(path)
        if path.name in requested:
            payload["decode"] = _decode(path, inspection)
        report.append(payload)
    encoded = json.dumps({"corpus": str(CORPUS), "files": report}, indent=2)
    print(encoded)
    if args.output is not None:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
