from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from hdr_finisher.binaries import resolve_binary
from hdr_finisher.capabilities import probe_capabilities
from hdr_finisher.exporters import JPEGUltraHDRExportBackend, _inspect_ultrahdr_markers, _run_command
from hdr_finisher.models import AdjustmentState, CapabilityStatus, ExportSettings
from hdr_finisher.test_pattern import build_hdr_test_pattern


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate and validate a synthetic JPEG Ultra HDR reference.")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--json", type=Path, required=True)
    args = parser.parse_args()

    width, height = 256, 144
    image = build_hdr_test_pattern(width=width, height=height)
    session = type(
        "SampleSession",
        (),
        {
            "session_id": "ultrahdr_reference",
            "image": image,
            "sdr_reference_image": None,
            "adjustments": AdjustmentState(),
        },
    )()
    capability = probe_capabilities()["ultrahdr_encoder"]
    if capability.status != CapabilityStatus.AVAILABLE:
        raise RuntimeError(capability.detail)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    response = JPEGUltraHDRExportBackend(capability).export(
        session,
        ExportSettings(format="jpeg_ultrahdr", quality=90, output_path=str(args.output)),
    )
    if not response.accepted:
        raise RuntimeError(response.message)

    encoder = resolve_binary("ultrahdr_app")
    if encoder is None:
        raise RuntimeError("ultrahdr_app disappeared after capability probing.")

    with Image.open(args.output) as legacy:
        legacy_rgb = np.asarray(legacy.convert("RGB"), dtype=np.float32) / 255.0
    legacy_linear = np.where(
        legacy_rgb <= 0.04045,
        legacy_rgb / 12.92,
        np.power((legacy_rgb + 0.055) / 1.055, 2.4),
    )

    with TemporaryDirectory(prefix="hdr_finisher_ultrahdr_qa_") as temp_dir:
        decoded_path = Path(temp_dir) / "decoded_linear_rgba_f16.raw"
        _run_command(
            [
                str(encoder),
                "-m",
                "1",
                "-j",
                str(args.output),
                "-o",
                "0",
                "-O",
                "4",
                "-z",
                str(decoded_path),
            ]
        )
        decoded_hdr = np.fromfile(decoded_path, dtype="<f2").astype(np.float32).reshape(height, width, 4)[..., :3]

    markers = _inspect_ultrahdr_markers(args.output)
    sdr_p99 = float(np.percentile(legacy_linear, 99))
    hdr_p99 = float(np.percentile(decoded_hdr, 99))
    if hdr_p99 <= sdr_p99:
        raise RuntimeError(f"Decoded HDR p99 ({hdr_p99}) did not exceed the legacy SDR p99 ({sdr_p99}).")

    report = {
        "output": str(args.output.resolve()),
        "bytes": args.output.stat().st_size,
        "jpeg_signature": args.output.read_bytes()[:2].hex(),
        "embedded_jpeg_images": markers.jpeg_images,
        "ultra_hdr_v1_xmp": markers.ultra_hdr_v1,
        "iso_21496_1": markers.iso_21496_1,
        "legacy_jpeg_decode": True,
        "libultrahdr_hdr_decode": True,
        "legacy_sdr_p99_linear": sdr_p99,
        "decoded_hdr_p99_linear": hdr_p99,
        "hdr_brighter_than_sdr": True,
        "message": response.message,
    }
    args.json.parent.mkdir(parents=True, exist_ok=True)
    args.json.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
