from __future__ import annotations

import argparse
import json
from pathlib import Path
import resource
import statistics
import sys
from tempfile import TemporaryDirectory
from time import perf_counter


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from hdr_finisher.capabilities import probe_capabilities  # noqa: E402
from hdr_finisher.exporters import build_export_backends  # noqa: E402
from hdr_finisher.media_browser import MediaBrowserStore  # noqa: E402
from hdr_finisher.models import ExportSettings  # noqa: E402
from hdr_finisher.sessions import SessionStore  # noqa: E402


def _rss_mib() -> float:
    value = float(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
    if sys.platform == "darwin":
        return value / (1024.0 * 1024.0)
    return value / 1024.0


def _summary(values: list[float]) -> dict[str, float | int]:
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, int(round((len(ordered) - 1) * 0.95))))
    return {
        "samples": len(values),
        "median_ms": round(statistics.median(values), 3),
        "p95_ms": round(ordered[index], 3),
        "max_ms": round(max(values), 3),
    }


def profile_input(path: Path, repetitions: int, export_formats: list[str], output_root: Path) -> dict[str, object]:
    loads: list[float] = []
    rss_before = _rss_mib()
    preview: dict[str, object]
    with TemporaryDirectory(prefix="hdr-finisher-profile-", dir=output_root) as temporary_name:
        browser = MediaBrowserStore(Path(temporary_name))
        try:
            preview_started = perf_counter()
            thumbnail = browser.thumbnail(str(path), 256)
            cold_preview_ms = (perf_counter() - preview_started) * 1000.0
            preview_started = perf_counter()
            browser.thumbnail(str(path), 256)
            warm_preview_ms = (perf_counter() - preview_started) * 1000.0
            preview = {
                "cold_ms": round(cold_preview_ms, 3),
                "warm_cache_ms": round(warm_preview_ms, 3),
                "cache_bytes": thumbnail.stat().st_size,
            }
        except Exception as exc:
            preview = {"error": str(exc).strip() or exc.__class__.__name__}
    store = SessionStore()
    last_payload = None
    last_session = None
    for _ in range(repetitions):
        started = perf_counter()
        last_payload = store.create_session(path, owns_source_path=False)
        loads.append((perf_counter() - started) * 1000.0)
        last_session = store.get(last_payload.session_id)
    assert last_payload is not None and last_session is not None
    exports: dict[str, object] = {}
    backends = build_export_backends(probe_capabilities())
    for format_name in export_formats:
        backend = backends.get(format_name)
        if backend is None:
            exports[format_name] = {"accepted": False, "message": "Unknown export format"}
            continue
        suffix = {"avif_gain_map": ".avif", "jpeg_ultrahdr": ".jpg", "jpegxl_hdr": ".jxl", "sdr_png": ".png"}[format_name]
        target = output_root / f"{path.stem}-{format_name}{suffix}"
        export_started = perf_counter()
        result = backend.export(
            last_session,
            ExportSettings(format=format_name, quality=90, output_path=str(target), overwrite=True),
        )
        result.timings_ms.setdefault("total", round((perf_counter() - export_started) * 1000.0, 3))
        export_record = result.model_dump(mode="json")
        export_record["output_bytes"] = target.stat().st_size if result.accepted and target.is_file() else None
        exports[format_name] = export_record
    warm_loads = loads[1:]
    return {
        "input": str(path.resolve()),
        "input_bytes": path.stat().st_size,
        "dimensions": [last_payload.source.width, last_payload.source.height],
        "format": last_payload.source.suffix,
        "preview": preview,
        "import": {
            **_summary(loads),
            "cold_ms": round(loads[0], 3),
            "warm": _summary(warm_loads) if warm_loads else None,
        },
        "import_phases_ms": last_session.metadata.get("import_timings_ms", {}),
        "decoder_phases_ms": last_session.metadata.get("decode_timings_ms", {}),
        "peak_rss_mib": round(_rss_mib(), 3),
        "peak_rss_growth_mib": round(max(0.0, _rss_mib() - rss_before), 3),
        "exports": exports,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Profile HDR Finisher import and export phases.")
    parser.add_argument("inputs", nargs="+", type=Path)
    parser.add_argument("--repetitions", type=int, default=5)
    parser.add_argument(
        "--export-formats",
        nargs="*",
        default=[],
        choices=["avif_gain_map", "jpeg_ultrahdr", "jpegxl_hdr", "sdr_png"],
    )
    parser.add_argument("--output", type=Path, default=ROOT / "output" / "performance" / "io-profile.json")
    args = parser.parse_args()
    args.output = args.output.expanduser().resolve()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    export_root = args.output.parent / "exports"
    export_root.mkdir(parents=True, exist_ok=True)
    report = {
        "schema_version": 1,
        "reference_gate": {"target_preview_seconds": 10, "maximum_preview_seconds": 15},
        "repetitions": max(1, args.repetitions),
        "results": [
            profile_input(path.resolve(), max(1, args.repetitions), args.export_formats, export_root)
            for path in args.inputs
        ],
    }
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
