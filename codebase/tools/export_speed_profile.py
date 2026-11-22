"""Time one batch export of the export-speed recipe on a test RAW.

Usage, from ``codebase`` with the venv Python:

    python tools/export_speed_profile.py build --source <RAW copy> --out <dir>
    python tools/export_speed_profile.py run --profile A --out <dir>

``build`` writes two saved grades beside each other in ``--out``:

* Profile A transplants the Santorini recipe in
  ``tests/fixtures/export-speed/santorini-2026-0068-grade.json`` onto the
  source (only the source reference changes) and uses the ``play_raw``
  preset: AVIF gain map, 1920 px long edge, frame on.
* Profile B is the source's own default grade with only Clean Grain Small
  in HDR and SDR, exported as a native-size AVIF gain map without a frame.
  It covers the bounded strip path.

``run`` exports through ``BatchExports`` with the real isolated worker, as the
app does, and samples the physical footprint (macOS) or charged bytes of this
process tree four times a second. It writes ``<profile>-run.json`` with the
wall time, peak, progress samples, the worker's ``export_timing`` records and
the SHA-256 of the file. The source photo is only read.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
FIXTURES = ROOT / "tests" / "fixtures" / "export-speed"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def build(source: Path, out: Path) -> None:
    from hdr_finisher.projects import validate_saved_document
    from hdr_finisher.sessions import SessionStore

    out.mkdir(parents=True, exist_ok=True)
    recipe = json.loads((FIXTURES / "santorini-2026-0068-grade.json").read_text(encoding="utf-8"))["grade"]
    store = SessionStore(grade_import_parallel=True)
    try:
        payload = store.create_session(source, owns_source_path=False)
        own = store.get(payload.session_id).edit_document().model_dump(mode="json")
    finally:
        store.clear()
    # Profile A: the whole recipe; the source reference names this RAW. The
    # recipe's RAW import settings stay, so the RAW develops the same way.
    grade_a = dict(recipe)
    grade_a["source"] = dict(own["source"], raw_import_settings=recipe["source"]["raw_import_settings"],
                             durable_path=None)
    validate_saved_document(grade_a)
    # Profile B: the photo's own grade plus the recipe's Clean Grain Small.
    grade_b = dict(own)
    grade_b["source"] = dict(own["source"], durable_path=None)
    grade_b["denoise"] = recipe["denoise"]
    validate_saved_document(grade_b)
    preset_a = json.loads((FIXTURES / "play-raw-export-preset.json").read_text(encoding="utf-8"))
    preset_b = json.loads(json.dumps(preset_a))
    preset_b["name"] = "native_clean_grain"
    settings = preset_b["versions"][0]["settings"]
    settings["export_with_frame"] = False
    settings["output_finishing"].update(resize_mode="original", long_edge=None)
    for name, grade, preset in (("A", grade_a, preset_a), ("B", grade_b, preset_b)):
        (out / f"profile-{name}-grade.json").write_text(json.dumps(grade, indent=1), encoding="utf-8")
        (out / f"profile-{name}-preset.json").write_text(json.dumps(preset, indent=1), encoding="utf-8")
    (out / "source.txt").write_text(str(source.resolve()), encoding="utf-8")
    print(f"Wrote profiles A and B for {source.name} to {out}")


def run(profile: str, out: Path, label: str) -> dict:
    from hdr_finisher.app_memory import process_tree
    from hdr_finisher.batch_export import BatchExports
    from hdr_finisher.export_presets import ExportPreset

    source = Path((out / "source.txt").read_text(encoding="utf-8").strip())
    grade = json.loads((out / f"profile-{profile}-grade.json").read_text(encoding="utf-8"))
    preset = ExportPreset.model_validate(json.loads((out / f"profile-{profile}-preset.json").read_text(encoding="utf-8")))
    destination = out / f"{label}-{profile}"
    destination.mkdir(parents=True, exist_ok=True)
    for stale in destination.iterdir():
        stale.unlink()
    photo = {"path": str(source), "source_path": str(source), "name": source.name, "grade": grade}
    peak = {"bytes": 0, "at": 0.0, "processes": []}
    stop = threading.Event()
    started = time.monotonic()

    def sample():
        while not stop.is_set():
            try:
                rows = process_tree(os.getpid())
            except Exception:
                rows = []
            total = sum(int(row.get("chargedBytes") or row.get("workingSetBytes") or 0) for row in rows)
            if total > peak["bytes"]:
                peak.update(bytes=total, at=round(time.monotonic() - started, 2),
                            processes=[{"name": row.get("name", ""), "bytes": row.get("chargedBytes")} for row in rows])
            stop.wait(.25)

    timing_records = []

    class _Tee:
        # The queue forwards the worker's structured records to stderr.
        def __init__(self, stream):
            self.stream = stream

        def write(self, text):
            if '"event":"export_timing"' in text:
                timing_records.append(json.loads(text))
            return self.stream.write(text)

        def flush(self):
            self.stream.flush()

    sys.stderr = _Tee(sys.stderr)
    sampler = threading.Thread(target=sample, daemon=True)
    queue = BatchExports(lambda path: dict(photo), record_path=out / f"{label}-records.json")
    sampler.start()
    job = queue.start([str(source)], preset, str(destination))
    progress = []
    last = None
    while True:
        status = queue.status(job["id"])
        now = round(time.monotonic() - started, 3)
        key = (status.get("progress"), status.get("stage"), status.get("completed"))
        if key != last:
            progress.append({"t": now, "progress": status.get("progress"), "stage": status.get("stage"),
                             "completed": status.get("completed"), "eta": status.get("estimated_seconds")})
            last = key
        if status["state"] in {"finished", "cancelled", "failed"}:
            break
        time.sleep(.1)
    elapsed = time.monotonic() - started
    stop.set()
    sampler.join()
    queue.close()
    results = status["results"]
    outputs = [Path(row["output_path"]) for row in results if row.get("output_path")]
    report = {
        "profile": profile, "label": label, "source": source.name, "wall_s": round(elapsed, 2),
        "peak_gb": round(peak["bytes"] / 1e9, 3), "peak_at_s": peak["at"], "peak_processes": peak["processes"],
        "results": results, "sha256": {path.name: _sha256(path) for path in outputs},
        "progress": progress, "timing": timing_records,
    }
    (out / f"{label}-{profile}-run.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    print(json.dumps({k: report[k] for k in ("profile", "label", "wall_s", "peak_gb", "sha256")}))
    for row in results:
        if row["outcome"] not in {"exported", "renamed"}:
            print("export did not finish:", row, file=sys.stderr)
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    make = commands.add_parser("build")
    make.add_argument("--source", type=Path, required=True)
    make.add_argument("--out", type=Path, required=True)
    timed = commands.add_parser("run")
    timed.add_argument("--profile", choices=("A", "B"), required=True)
    timed.add_argument("--out", type=Path, required=True)
    timed.add_argument("--label", default="run")
    args = parser.parse_args()
    if args.command == "build":
        build(args.source, args.out)
    else:
        run(args.profile, args.out, args.label)


if __name__ == "__main__":
    main()
