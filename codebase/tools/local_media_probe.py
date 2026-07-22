from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from hdr_finisher.avif_info import AVIFInfoError, inspect_avif
from hdr_finisher.capabilities import probe_capabilities
from hdr_finisher.exporters import AVIFGainMapExportBackend
from hdr_finisher.loader import load_image
from hdr_finisher.models import AdjustmentState, CapabilityStatus, ExportSettings, PreviewKind, ScopeMode
from hdr_finisher.preview import render_preview_bytes
from hdr_finisher.scopes import build_scope


def main() -> None:
    parser = argparse.ArgumentParser(description="Probe local private HEIC/EXR/HDR media without committing it.")
    parser.add_argument("paths", nargs="+", type=Path)
    parser.add_argument("--export", action="store_true", help="Also attempt AVIF gain-map export for each input.")
    parser.add_argument("--json", dest="json_path", type=Path, default=ROOT / "output" / "qa" / "local_media_report.json")
    args = parser.parse_args()

    report = {
        "inputs": [str(path) for path in args.paths],
        "export_enabled": args.export,
        "items": [_probe_path(path, args.export) for path in args.paths],
    }
    args.json_path.parent.mkdir(parents=True, exist_ok=True)
    args.json_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


def _probe_path(path: Path, export: bool) -> dict[str, Any]:
    item: dict[str, Any] = {"path": str(path)}
    try:
        image, source, metadata, analysis, sdr_reference = load_image(path)
        hdr_scope = build_scope(image, AdjustmentState(), PreviewKind.HDR, ScopeMode.WAVEFORM)
        sdr_scope = build_scope(image, AdjustmentState(), PreviewKind.SDR, ScopeMode.HISTOGRAM, sdr_reference_image=sdr_reference)
        item.update(
            {
                "ok": True,
                "source": source.model_dump(),
                "analysis": analysis.model_dump(),
                "metadata": {key: str(value) for key, value in metadata.items()},
                "sdr_reference_present": sdr_reference is not None,
                "hdr_peak_stat": _stat_value(hdr_scope.stats, "Peak"),
                "hdr_percent_above_1000": _stat_value(hdr_scope.stats, "% > 1000"),
                "sdr_peak_stat": _stat_value(sdr_scope.stats, "Peak"),
                "preview": _preview_probe(image, sdr_reference),
            }
        )
        if export:
            item["export"] = _export_probe(path, image, sdr_reference)
    except Exception as exc:
        item.update({"ok": False, "error": str(exc)})
    return item


def _preview_probe(image, sdr_reference) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for kind in (PreviewKind.HDR, PreviewKind.SDR):
        try:
            body, media_type = render_preview_bytes(image, AdjustmentState(), kind, 1200, sdr_reference_image=sdr_reference)
            result[kind.value] = {"ok": True, "media_type": media_type, "bytes": len(body)}
        except Exception as exc:
            result[kind.value] = {"ok": False, "error": str(exc)}
    return result


def _export_probe(path: Path, image, sdr_reference) -> dict[str, Any]:
    capabilities = probe_capabilities()
    capability = capabilities["avif_gain_map_encoder"]
    if capability.status != CapabilityStatus.AVAILABLE:
        return {"ok": False, "message": capability.detail}

    output_dir = ROOT / "output" / "qa" / "local_exports"
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{_safe_stem(path.stem)}.avif"
    backend = AVIFGainMapExportBackend(capability)
    session = SimpleNamespace(
        session_id=_safe_stem(path.stem),
        image=image,
        adjustments=AdjustmentState(),
        sdr_reference_image=sdr_reference,
    )
    response = backend.export(session, ExportSettings(format="avif_gain_map", quality=85, output_path=str(output_path)))
    payload = response.model_dump()
    if response.accepted:
        try:
            payload["avif_info"] = inspect_avif(Path(response.output_path or output_path))
        except AVIFInfoError as exc:
            payload["avif_info_error"] = str(exc)
    return payload


def _stat_value(stats, label: str) -> str | None:
    for stat in stats:
        if stat.label == label:
            return stat.value
    return None


def _safe_stem(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", value) or "media"


if __name__ == "__main__":
    main()
