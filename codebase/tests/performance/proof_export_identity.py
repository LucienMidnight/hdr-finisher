"""Full-size Proof versus export on a real project (PRD section 3).

    python tests/performance/proof_export_identity.py --project <file.hdrfinisher> \
        --out output/performance/review/<run>/proof-identity.json [--formats jpeg_ultrahdr,avif_gain_map]

The project and its source are only read. Each format is exported once through
the export backend and proofed once at full size through the Proof store, with
the same encoding settings, and the two files are compared by SHA-256. Wall
times are recorded for both, one sample each.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import time
from pathlib import Path

from reference_session import isolate_source_cache, open_reference_session

SUFFIX = {"jpeg_ultrahdr": ".jpg", "avif_gain_map": ".avif", "jpegxl_hdr": ".jxl"}
CAPABILITY = {
    "jpeg_ultrahdr": "ultrahdr_encoder",
    "avif_gain_map": "avif_gain_map_encoder",
    "jpegxl_hdr": "jpegxl_export",
}


def _file_state(path: Path) -> dict[str, object]:
    return {
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "modifiedNs": path.stat().st_mtime_ns,
        "bytes": path.stat().st_size,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Full-size Proof versus export identity on a real project")
    parser.add_argument("--project", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--formats", default="jpeg_ultrahdr,avif_gain_map,jpegxl_hdr")
    arguments = parser.parse_args()

    project = Path(arguments.project).resolve()
    output = Path(arguments.out).resolve()
    work = output.parent / f"{output.stem}-files"
    work.mkdir(parents=True, exist_ok=True)
    isolate_source_cache(work / "source-cache")

    from hdr_finisher.capabilities import probe_capabilities
    from hdr_finisher.exporters import build_export_backends
    from hdr_finisher.models import ExportSettings, ProofArtifactRequest
    from hdr_finisher.proofing import ProofArtifactStore

    project_before = _file_state(project)
    started = time.perf_counter()
    _store, session = open_reference_session(project)
    open_seconds = time.perf_counter() - started
    source_path = Path(session.source_path)
    source_before = _file_state(source_path)

    capabilities = probe_capabilities()
    backends = build_export_backends(capabilities)
    report: dict[str, object] = {
        "project": str(project),
        "source": str(source_path),
        "sourceSize": [int(session.image.shape[1]), int(session.image.shape[0])],
        "locals": len(session.local_adjustments),
        "openSeconds": round(open_seconds, 2),
        "samplesPerTiming": 1,
        "formats": [],
    }
    ok = True
    for format_name in [name for name in arguments.formats.split(",") if name]:
        entry: dict[str, object] = {"format": format_name}
        if capabilities[CAPABILITY[format_name]].status.value != "available":
            entry["skipped"] = capabilities[CAPABILITY[format_name]].detail
            report["formats"].append(entry)
            continue
        target = work / f"export-{format_name}{SUFFIX[format_name]}"
        started = time.perf_counter()
        result = backends[format_name].export(
            session, ExportSettings(format=format_name, output_path=str(target), overwrite=True)
        )
        entry["exportSeconds"] = round(time.perf_counter() - started, 2)
        if not result.accepted:
            entry["error"] = result.message
            ok = False
            report["formats"].append(entry)
            continue
        export_sha = hashlib.sha256(Path(result.output_path).read_bytes()).hexdigest()
        proofs = ProofArtifactStore()
        try:
            started = time.perf_counter()
            proof = proofs.create(
                session,
                ProofArtifactRequest(
                    adjustments=session.adjustments,
                    format=format_name,
                    quality=ExportSettings().quality,
                    full_size=True,
                ),
                backends[format_name],
            )
            entry["proofSeconds"] = round(time.perf_counter() - started, 2)
        finally:
            proofs.clear()
        entry.update(
            {
                "exportBytes": Path(result.output_path).stat().st_size,
                "proofBytes": proof.byte_size,
                "proofSize": [proof.width, proof.height],
                "proofFullSize": proof.full_size,
                "exportSha256": export_sha,
                "proofSha256": proof.sha256,
                "identical": proof.sha256 == export_sha,
            }
        )
        ok = ok and bool(entry["identical"])
        report["formats"].append(entry)
        print(json.dumps(entry))

    report["projectUnchanged"] = _file_state(project) == project_before
    report["sourceUnchanged"] = _file_state(source_path) == source_before
    ok = ok and bool(report["projectUnchanged"]) and bool(report["sourceUnchanged"])
    report["ok"] = ok
    output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {output} ok={ok}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
