"""Profile batch export with a real or synthetic test photo.

Usage, from ``codebase`` with the venv Python:

    python tools/export_speed_profile.py synthetic --size 61mp
    python tools/export_speed_profile.py build --source <photo> --out <dir>
    python tools/export_speed_profile.py run --profile A --out <dir>
    python tools/export_speed_profile.py run --profile Max --out <dir> --batch-count 2 --parallel 1

``build`` writes four saved grades and presets in ``--out``:

* Profile A transplants the Santorini recipe in
  ``tests/fixtures/export-speed/santorini-2026-0068-grade.json`` onto the
  source and uses the ``play_raw``
  preset: AVIF gain map, 1920 px long edge, frame on.
* Profile B is the source's own default grade with only Clean Grain Small
  in HDR and SDR, exported as a native-size AVIF gain map without a frame.
  It covers the bounded strip path.
* Profile A-native uses the Profile A grade at native size without a frame.
* Profile Max activates the creative and finishing stages at native size.

``run`` exports through ``BatchExports`` with the real isolated worker, as the
app does, and samples the physical footprint (macOS) or charged bytes of this
process tree four times a second. It writes ``<profile>-run.json`` with the
wall time, process and stage memory peaks, progress samples, worker timing
records and the SHA-256 of each export. The source photo is only read.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager, redirect_stderr
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import re
import sys
from tempfile import TemporaryDirectory
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
FIXTURES = ROOT / "tests" / "fixtures" / "export-speed"
PROFILES = ("A", "B", "A-native", "Max")
SYNTHETIC_SIZES = {"61mp": (9600, 6354), "100mp": (12000, 8334)}
ENCODERS = {
    "avifgainmaputil", "avifenc", "avifdec", "ultrahdr_app", "cjxl", "djxl",
    "hdrf-avif-decode", "hdrf-jxl-info", "cjpeg", "cjpegli", "djpeg", "djpegli",
}


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def synthetic(size: str = "61mp", out: Path | None = None, *, force: bool = False) -> Path:
    """Write a tagged, scene-linear float32 EXR in bounded scanline bands."""
    size = size.lower()
    if size in SYNTHETIC_SIZES:
        width, height = SYNTHETIC_SIZES[size]
    elif match := re.fullmatch(r"([1-9]\d*)x([1-9]\d*)", size):
        width, height = map(int, match.groups())
    else:
        raise ValueError("size must be 61mp, 100mp or WIDTHxHEIGHT")
    out = out or ROOT / "output" / "test-photos" / f"synthetic-{size}.exr"
    if out.suffix.lower() != ".exr":
        raise ValueError("synthetic output must use the .exr extension")
    if out.is_file() and not force:
        print(f"Reusing {out}")
        return out

    import Imath
    import numpy as np
    import OpenEXR

    out.parent.mkdir(parents=True, exist_ok=True)
    header = OpenEXR.Header(width, height)
    float_type = Imath.PixelType(Imath.PixelType.FLOAT)
    channels = ("R", "G", "B")
    header["channels"] = {name: Imath.Channel(float_type) for name in channels}
    header["colorInteropID"] = b"lin_ap1_scene"
    rng = np.random.default_rng(7970)
    x = (np.arange(width, dtype=np.float32)[None, :] + 0.5) / width
    band_rows = max(1, min(64, 1_000_000 // width))

    # OutputFile's scanline API writes each band directly to disk.
    with TemporaryDirectory(prefix=".synthetic-", dir=out.parent) as temporary:
        staged = Path(temporary) / out.name
        writer = OpenEXR.OutputFile(str(staged), header)
        try:
            for top in range(0, height, band_rows):
                bottom = min(top + band_rows, height)
                y = (np.arange(top, bottom, dtype=np.float32)[:, None] + 0.5) / height
                shade = 0.012 + 0.24 * (0.3 * x + 0.7 * y) ** 2
                shade += 0.035 * np.sin(19 * x + 13 * y) ** 2
                warm = (x > 0.15) & (x < 0.39) & (y > 0.20) & (y < 0.72)
                cool = (x > 0.52) & (x < 0.84) & (y > 0.32) & (y < 0.83)
                glint = 6.0 * np.exp(-((x - 0.64) / 0.028) ** 2 - ((y - 0.42) / 0.026) ** 2)
                glint += 1.7 * ((abs(x - 0.31) < 0.024) & (abs(y - 0.57) < 0.09))
                pixels = {}
                for name, warm_gain, cool_gain in zip(channels, (0.65, 0.08, 0.015), (0.01, 0.21, 0.55)):
                    signal = (shade + warm_gain * warm + cool_gain * cool + glint).astype(np.float32)
                    # Independent read noise and signal-dependent shot noise.
                    noise = rng.standard_normal(signal.shape, dtype=np.float32)
                    signal += noise * np.sqrt(0.000025 + 0.0008 * signal)
                    np.maximum(signal, 0.0, out=signal)
                    pixels[name] = signal.tobytes()
                writer.writePixels(pixels, bottom - top)
        finally:
            writer.close()
        if force or not out.is_file():
            staged.replace(out)
    print(f"Ready: {out} ({width}x{height})")
    return out


def _native_preset(preset: dict, name: str, *, frame: bool) -> dict:
    preset = deepcopy(preset)
    preset["name"] = name
    settings = preset["versions"][0]["settings"]
    settings["export_with_frame"] = frame
    settings["output_finishing"].update(resize_mode="original", long_edge=None)
    return preset


def _max_grade(grade: dict, source_name: str) -> dict:
    grade = deepcopy(grade)
    adjustments = grade["global_adjustments"]
    if source_name.casefold() != "_dsc7970.arw":
        adjustments["shared"]["geometry"].update(
            straighten_angle=0.6, perspective_vertical=0.0, perspective_rotate=0.0,
            crop={"x": 0.02, "y": 0.02, "width": 0.96, "height": 0.96}, ratio_mode="free",
        )
    for lane in ("hdr", "sdr"):
        branch = adjustments[lane]
        for name in branch:
            if name.endswith("_section_enabled"):
                branch[name] = True
        branch.update(
            exposure=0.15, white_balance_kelvin=6800, shadows=8.0, midtones=5.0,
            highlights=-6.0, highlight_compression_mode="peak_fit",
        )
        if lane == "sdr":
            branch["luma_curve"][2][1] = 0.53
        branch["color_grading"]["midtones"].update(hue=38.0, saturation=12.0)
        branch["hsl"]["channels"][0]["recipe"].update(saturation=14.0, luminance=0.2)
        branch["black_and_white"].update(reds=22.0, greens=10.0, blues=-16.0)
        branch["detail"]["sharpen_amount"] = 30.0
        branch["film_look"].update(look_strength=1.0, lens_filter="black_pro_mist", scan_sharpening=35.0)
        for key in ("look_strength", "lens_filter"):
            if key not in branch["film_look"]["stock_overrides"]:
                branch["film_look"]["stock_overrides"].append(key)
    # The fixture already has enabled local grades and soft brush strokes.
    grade["local_adjustments"][0]["mask"]["leaf"]["mask_feather"] = 0.006
    return grade


def build(source: Path, out: Path) -> None:
    from hdr_finisher.export_presets import ExportPreset
    from hdr_finisher.models import EditDocument
    from hdr_finisher.projects import validate_saved_document
    from hdr_finisher.sessions import SessionStore

    out.mkdir(parents=True, exist_ok=True)
    recipe = json.loads((FIXTURES / "santorini-2026-0068-grade.json").read_text(encoding="utf-8"))["grade"]
    store = SessionStore(grade_import_parallel=True)
    try:
        session = store.prepare_session(source, eager_peak_candidates=False)
        own = session.edit_document().model_dump(mode="json")
        is_raw = bool(session.metadata.get("raw_input"))
        del session
    finally:
        store.clear()
    # Preserve the recipe's RAW development on camera files and the source's
    # own interpretation and defaults on other files.
    grade_a = dict(recipe)
    grade_a["source"] = dict(own["source"], durable_path=None)
    if is_raw:
        grade_a["source"]["raw_import_settings"] = recipe["source"]["raw_import_settings"]
    else:
        grade_a["interpretation_override"] = own["interpretation_override"]
    # Profile B: the photo's own grade plus the recipe's Clean Grain Small.
    grade_b = dict(own)
    grade_b["source"] = dict(own["source"], durable_path=None)
    grade_b["denoise"] = recipe["denoise"]
    preset_a = json.loads((FIXTURES / "play-raw-export-preset.json").read_text(encoding="utf-8"))
    preset_b = _native_preset(preset_a, "native_clean_grain", frame=False)
    preset_native = _native_preset(preset_a, "santorini_native", frame=False)
    preset_max = _native_preset(preset_a, "max_native", frame=True)
    settings = preset_max["versions"][0]["settings"]
    settings["output_finishing"]["sharpening"] = "standard"
    settings["watermark"] = {"mode": "text", "text": "HDR Finisher export test"}
    grade_max = _max_grade(grade_a, source.name)
    EditDocument.model_validate(grade_max)
    profiles = (
        ("A", grade_a, preset_a), ("B", grade_b, preset_b),
        ("A-native", grade_a, preset_native), ("Max", grade_max, preset_max),
    )
    for name, grade, preset in profiles:
        validate_saved_document(grade)
        ExportPreset.model_validate(preset)
        (out / f"profile-{name}-grade.json").write_text(json.dumps(grade, indent=1), encoding="utf-8")
        (out / f"profile-{name}-preset.json").write_text(json.dumps(preset, indent=1), encoding="utf-8")
    (out / "source.txt").write_text(str(source.resolve()), encoding="utf-8")
    print(f"Wrote profiles {', '.join(PROFILES)} for {source.name} to {out}")


def process_rows(root_pid: int) -> list[dict]:
    from hdr_finisher.app_memory import process_tree

    rows = process_tree(root_pid)
    if sys.platform.startswith("linux"):
        # The Linux memory census supplies PIDs and byte counts; read the
        # executable names while those processes are still around.
        for row in rows:
            process = Path("/proc") / str(row["pid"])
            try:
                row["name"] = os.readlink(process / "exe")
            except OSError:
                try:
                    row["name"] = (process / "comm").read_text().strip()
                except OSError:
                    pass
    return rows


def process_category(row: dict, root_pid: int) -> str:
    if row["pid"] == root_pid:
        return "driver"
    executable = row.get("name", "").replace("\\", "/").rsplit("/", 1)[-1].lower().removesuffix(".exe")
    if executable in ENCODERS:
        return "encoder"
    if executable.startswith("python") or executable == "hdr finisher backend":
        return "python_worker"
    return "other"


def _gb(byte_count: int) -> float:
    return round(byte_count / 1e9, 3)


def attribute_stage_peaks(samples: list[dict], timing_records: list[dict]) -> list[dict]:
    """Report process-tree peaks for each traced span, even in overlapping exports."""
    peaks = []
    for timing_index, record in enumerate(timing_records):
        for lane, stage, start, end in record.get("stage_trace", []):
            matched = [sample for sample in samples if start - 0.15 <= sample["t_epoch"] <= end + 0.15]
            row = {
                "timing_index": timing_index, "lane": lane, "stage": stage,
                "duration_ms": round((end - start) * 1000, 1), "sample_count": len(matched),
            }
            for peak_name, sample_key in (("total", "total"), ("worker", "python_worker"), ("encoder", "encoder")):
                row[f"peak_{peak_name}_gb"] = _gb(max(sample[sample_key] for sample in matched)) if matched else None
            peaks.append(row)
    return peaks


@contextmanager
def _run_environment(parallel: int | None, trace_file: Path | None = None):
    overrides = {"HDR_FINISHER_EXPORT_STAGE_TRACE": "1"}
    if trace_file is not None:
        overrides["HDR_FINISHER_EXPORT_STAGE_TRACE_FILE"] = str(trace_file)
    if parallel is not None:
        overrides["HDR_FINISHER_BATCH_PARALLEL"] = str(parallel)
    previous = {key: os.environ.get(key) for key in overrides}
    os.environ.update(overrides)
    try:
        yield
    finally:
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def run(
    profile: str, out: Path, label: str, *, format: str | None = None,
    batch_count: int = 1, parallel: int | None = None,
) -> dict:
    from hdr_finisher.batch_export import BatchExports
    from hdr_finisher.export_presets import ExportPreset, SUFFIXES

    if batch_count < 1 or (parallel is not None and parallel < 1):
        raise ValueError("batch_count and parallel must be positive")
    if format is not None and format not in SUFFIXES:
        raise ValueError(f"Unsupported export format: {format}")
    source = Path((out / "source.txt").read_text(encoding="utf-8").strip())
    grade = json.loads((out / f"profile-{profile}-grade.json").read_text(encoding="utf-8"))
    preset_data = json.loads((out / f"profile-{profile}-preset.json").read_text(encoding="utf-8"))
    if format is not None:
        preset_data["versions"][0]["settings"]["format"] = format
    if batch_count > 1:
        for version in preset_data["versions"]:
            version["pattern"] += "_{sequence}"
    preset = ExportPreset.model_validate(preset_data)
    destination = out / f"{label}-{profile}"
    destination.mkdir(parents=True, exist_ok=True)
    for stale in destination.iterdir():
        stale.unlink()
    paths = [str(source)] if batch_count == 1 else [f"{source}#copy{i}" for i in range(1, batch_count + 1)]

    def snapshot(path: str) -> dict:
        return {"path": path, "source_path": str(source), "name": source.name, "grade": grade}

    root_pid = os.getpid()
    peak = {"bytes": 0, "at": 0.0, "processes": []}
    memory_samples = []
    process_peaks = {}
    stop = threading.Event()
    started = time.monotonic()

    def sample():
        while not stop.is_set():
            sample_started = time.monotonic()
            try:
                rows = process_rows(root_pid)
            except Exception:
                rows = []
            if rows:
                totals = dict.fromkeys(("driver", "python_worker", "encoder", "other"), 0)
                processes = []
                for row in rows:
                    pid, name = row["pid"], row.get("name", "")
                    category = process_category(row, root_pid)
                    byte_count = int(row.get("chargedBytes") or row.get("workingSetBytes") or 0)
                    totals[category] += byte_count
                    processes.append({"pid": pid, "name": name, "category": category, "bytes": byte_count})
                    previous = process_peaks.get(pid)
                    if previous is None or byte_count > previous["bytes"]:
                        process_peaks[pid] = processes[-1]
                total = sum(totals.values())
                t_rel = round(time.monotonic() - started, 3)
                memory_samples.append({"t_epoch": time.time(), "t_rel": t_rel, "total": total, **totals})
                if total > peak["bytes"]:
                    peak.update(bytes=total, at=round(t_rel, 2), processes=processes)
            stop.wait(max(0, 0.25 - (time.monotonic() - sample_started)))

    timing_records = []

    class _Tee:
        # The queue forwards the worker's structured records to stderr.
        def __init__(self, stream):
            self.stream = stream

        def write(self, text):
            if '"event":"export_timing"' in text:
                try:
                    timing_records.append(json.loads(text))
                except ValueError:
                    pass
            return self.stream.write(text)

        def flush(self):
            self.stream.flush()

    sampler = threading.Thread(target=sample, daemon=True)
    trace_records = []
    with TemporaryDirectory(prefix=".stage-trace-", dir=out) as trace_dir:
        trace_file = Path(trace_dir) / "trace.jsonl"
        with _run_environment(parallel, trace_file), redirect_stderr(_Tee(sys.stderr)):
            queue = BatchExports(snapshot, record_path=out / f"{label}-records.json")
            sampler.start()
            try:
                job = queue.start(paths, preset, str(destination))
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
            finally:
                try:
                    stop.set()
                    sampler.join()
                finally:
                    queue.close()
        if trace_file.is_file():
            for line in trace_file.read_text(encoding="utf-8").splitlines():
                if line.strip():
                    try:
                        trace_records.append(json.loads(line))
                    except ValueError:
                        pass

    results = status["results"]
    outputs = [Path(row["output_path"]) for row in results if row.get("output_path")]
    stage_peaks = attribute_stage_peaks(memory_samples, trace_records or timing_records)
    report = {
        "profile": profile, "label": label, "source": source.name, "wall_s": round(elapsed, 2),
        "peak_gb": _gb(peak["bytes"]), "peak_at_s": peak["at"], "peak_processes": peak["processes"],
        "results": results, "sha256": {path.name: _sha256(path) for path in outputs},
        "progress": progress, "timing": timing_records,
        "format": preset.versions[0].settings.format, "batch_count": batch_count, "parallel": parallel,
        "memory_samples": memory_samples, "stage_peaks": stage_peaks,
        "per_process_peak_gb": {
            pid: {"name": row["name"], "category": row["category"], "peak_gb": _gb(row["bytes"])}
            for pid, row in sorted(process_peaks.items())
        },
    }
    report["progress_check"] = progress_check(progress, elapsed)
    (out / f"{label}-{profile}-run.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    measured = [row for row in stage_peaks if row["sample_count"]]
    if measured:
        largest = sorted(measured, key=lambda row: row["peak_total_gb"], reverse=True)[:5]
        summary = ", ".join(
            f'{row["lane"]}/{row["stage"]} {row["peak_total_gb"]:.3f}/{row["peak_worker_gb"]:.3f}/{row["peak_encoder_gb"]:.3f}'
            for row in largest
        )
        print(f"Stage peaks in GB (total/worker/encoder, {len(measured)}/{len(stage_peaks)} spans sampled): {summary}")
    else:
        print("Stage peaks: no samples matched the worker stage trace")
    print(json.dumps({k: report[k] for k in ("profile", "label", "wall_s", "peak_gb", "sha256", "progress_check")}))
    for row in results:
        if row["outcome"] not in {"exported", "renamed"}:
            print("export did not finish:", row, file=sys.stderr)
    return report


def progress_check(samples: list[dict], wall: float) -> dict:
    """The progress bar acceptance: never backwards, gaps, and the first 5%.

    Gaps are measured between changes of the reported fraction, leaving out
    time inside the external encoder (stage "Encoding").
    """
    moving = [row for row in samples if row.get("progress") is not None]
    backwards = any(b["progress"] < a["progress"] for a, b in zip(moving, moving[1:]))
    gaps, worst_at = [], None
    for a, b in zip(moving, moving[1:]):
        if b["progress"] != a["progress"] and a.get("stage") != "Encoding":
            gaps.append(b["t"] - a["t"])
    worst = max(gaps, default=None)
    first_5 = next((row["t"] for row in moving if row["progress"] >= .05), None)
    return {"backwards": backwards, "updates": len(moving), "max_gap_s": round(worst, 2) if worst else None,
            "first_5_percent_s": first_5, "first_5_percent_share": round(first_5 / wall, 3) if first_5 else None,
            "stages": sorted({row["stage"] for row in moving if row.get("stage")})}


def main() -> None:
    from hdr_finisher.export_presets import SUFFIXES

    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    make = commands.add_parser("build")
    make.add_argument("--source", type=Path, required=True)
    make.add_argument("--out", type=Path, required=True)
    timed = commands.add_parser("run")
    timed.add_argument("--profile", choices=PROFILES, required=True)
    timed.add_argument("--out", type=Path, required=True)
    timed.add_argument("--label", default="run")
    timed.add_argument("--format", choices=SUFFIXES)
    timed.add_argument("--batch-count", type=int, default=1)
    timed.add_argument("--parallel", type=int)
    generate = commands.add_parser("synthetic")
    generate.add_argument("--size", default="61mp")
    generate.add_argument("--out", type=Path)
    generate.add_argument("--force", action="store_true")
    args = parser.parse_args()
    if args.command == "build":
        build(args.source, args.out)
    elif args.command == "synthetic":
        try:
            synthetic(args.size, args.out, force=args.force)
        except ValueError as error:
            generate.error(str(error))
    else:
        if args.batch_count < 1 or (args.parallel is not None and args.parallel < 1):
            timed.error("--batch-count and --parallel must be positive")
        run(args.profile, args.out, args.label, format=args.format, batch_count=args.batch_count, parallel=args.parallel)


if __name__ == "__main__":
    main()
