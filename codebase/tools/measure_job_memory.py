"""Measure peak memory and time of each Library backend job, per file type.

Phase 0 of docs/technical/archive/briefs/library-resource-scheduler-design-2026-10-30.md.
Each job runs in its own fresh Python process, so one job's memory never
hides another's. Windows only (reads the process's own peak counters).

  .venv/Scripts/python.exe tools/measure_job_memory.py FILE [FILE ...] [--out results.jsonl]

Reported per job:
  peak_commit_mb  extra private memory the job committed at its peak
                  (PeakPagefileUsage minus the value just before the job)
  peak_ws_mb      extra resident memory at its peak, including pages of a
                  memory-mapped file (PeakWorkingSetSize minus before)
  output_mb       bytes the job hands on (sensor data, pixels, preview)
Only reads the given files. Use copies, never D:\\Photos originals.
"""
import argparse, json, os, subprocess, sys
from pathlib import Path

RAW = {".arw", ".cr2", ".cr3", ".nef", ".nrw", ".raf", ".rw2", ".orf", ".ori", ".pef", ".srw"}
RGB = {".jpg", ".jpeg", ".png", ".exr", ".hdr", ".pfm", ".tif", ".tiff", ".jxl", ".avif", ".heic", ".heif"}


def jobs_for(path):
    suffix = Path(path).suffix.lower()
    if suffix in RAW:
        return ["camera_preview", "raw_sensor"]
    if suffix == ".dng":
        return ["camera_preview", "dng_source_640", "dng_source_2560"]
    if suffix in {".jpg", ".jpeg", ".png"}:
        return ["original_preview", "rgb_source"]
    if suffix in RGB:
        return ["rgb_source"]
    return []


CHILD = r'''
import ctypes, gc, json, sys, time
from ctypes import wintypes
class PMC(ctypes.Structure):
    _fields_ = [("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD),
        ("PeakWorkingSetSize", ctypes.c_size_t), ("WorkingSetSize", ctypes.c_size_t),
        ("QuotaPeakPagedPoolUsage", ctypes.c_size_t), ("QuotaPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t), ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
        ("PagefileUsage", ctypes.c_size_t), ("PeakPagefileUsage", ctypes.c_size_t)]
_k32 = ctypes.WinDLL("kernel32")
_k32.GetCurrentProcess.restype = wintypes.HANDLE
_k32.K32GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(PMC), wintypes.DWORD]
_k32.K32GetProcessMemoryInfo.restype = wintypes.BOOL
def counters():
    pmc = PMC(); pmc.cb = ctypes.sizeof(PMC)
    if not _k32.K32GetProcessMemoryInfo(_k32.GetCurrentProcess(), ctypes.byref(pmc), pmc.cb):
        raise OSError(ctypes.get_last_error())
    return pmc
job, path = sys.argv[1], sys.argv[2]
sys.path.insert(0, "backend")
from pathlib import Path
from hdr_finisher import library_gpu_raw, library_rgb, library_dng, library_pictures
from hdr_finisher.library_live import recipe
from hdr_finisher.models import RawImportSettings
import numpy as np
inputs = recipe(None)
def size(parts):
    total = 0
    for part in parts:
        total += part.nbytes if hasattr(part, "nbytes") else len(part)
    return total
def run():
    if job == "camera_preview":
        result = library_pictures._extract_camera_preview(Path(path), 640)
        return {"width": result["width"], "height": result["height"]}, len(result["url"])
    if job == "original_preview":
        result = library_pictures.original_preview(Path(path), 640)
        return {"width": result["width"], "height": result["height"]}, len(result["url"])
    if job == "raw_sensor":
        header, parts = library_gpu_raw.sensor(Path(path), RawImportSettings())
        return {"width": header.get("width"), "height": header.get("height")}, size(parts)
    if job == "rgb_source":
        header, parts = library_rgb.decoded(Path(path), inputs)
        return {"width": header.get("width"), "height": header.get("height")}, size(parts)
    if job.startswith("cpu_develop_"):
        # The CPU route used when the GPU route is not eligible (X-Trans,
        # unresolved colour, linear DNGs too large for one GPU buffer).
        from hdr_finisher.library_live import develop_cpu
        import shutil, tempfile
        edge = int(job.rsplit("_", 1)[1])
        root = tempfile.mkdtemp(prefix="hdrf-phase0-")
        try:
            result = develop_cpu(Path(root), Path(path), None, edge)
            meta = result if isinstance(result, dict) else {}
            return {"width": meta.get("width"), "height": meta.get("height")}, 0
        finally:
            shutil.rmtree(root, ignore_errors=True)
    if job.startswith("dng_source_"):
        edge = int(job.rsplit("_", 1)[1])
        header, parts = library_dng.decoded(Path(path), inputs, edge=edge, max_storage_bytes=2**31)
        return {"width": header.get("width"), "height": header.get("height")}, size(parts)
    raise SystemExit("unknown job")
# Windows cannot reset its own peak counters, and imports peak first. Sample
# the current values every millisecond during the job instead.
import threading
# Warm-up run: the backend is long-running, so first-use imports and codec
# set-up are not part of a job's steady cost. Measure the second run.
first_started = time.perf_counter()
try:
    run()
except Exception:
    pass
first_ms = round((time.perf_counter() - first_started) * 1000)
gc.collect()
before = counters()
peak = {"commit": before.PagefileUsage, "ws": before.WorkingSetSize}
stop = threading.Event()
def sample():
    while not stop.is_set():
        now = counters()
        peak["commit"] = max(peak["commit"], now.PagefileUsage)
        peak["ws"] = max(peak["ws"], now.WorkingSetSize)
        time.sleep(0.001)
sampler = threading.Thread(target=sample, daemon=True); sampler.start()
started = time.perf_counter()
row = {"job": job, "path": path}
try:
    info, output = run()
    row.update(info, output_mb=round(output / 1e6, 1))
except Exception as error:
    row["error"] = f"{type(error).__name__}: {str(error).splitlines()[0][:200] if str(error) else ''}"
row["ms"] = round((time.perf_counter() - started) * 1000)
row["first_ms"] = first_ms
stop.set(); sampler.join()
row["peak_commit_mb"] = round((peak["commit"] - before.PagefileUsage) / 1e6, 1)
row["peak_ws_mb"] = round((peak["ws"] - before.WorkingSetSize) / 1e6, 1)
print(json.dumps(row))
'''


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("files", nargs="+")
    parser.add_argument("--out")
    parser.add_argument("--repeat", type=int, default=1)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    rows = []
    for file in args.files:
        for job in jobs_for(file):
            for _ in range(args.repeat):
                done = subprocess.run([sys.executable, "-c", CHILD, job, str(Path(file).resolve())],
                    cwd=root, capture_output=True, text=True, encoding="utf-8", errors="replace")
                line = (done.stdout.strip().splitlines() or [""])[-1]
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    row = {"job": job, "path": file, "error": "child failed: " + (done.stderr.strip().splitlines() or ["?"])[-1][:200]}
                rows.append(row)
                print(json.dumps(row), flush=True)
    # Windows can keep CPU-route cache files open past the child's own clean-up.
    import glob, shutil, tempfile
    for folder in glob.glob(os.path.join(tempfile.gettempdir(), "hdrf-phase0-*")):
        shutil.rmtree(folder, ignore_errors=True)
    if args.out:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        with open(args.out, "a", encoding="utf-8") as handle:
            for row in rows:
                handle.write(json.dumps(row) + "\n")


if __name__ == "__main__":
    main()
