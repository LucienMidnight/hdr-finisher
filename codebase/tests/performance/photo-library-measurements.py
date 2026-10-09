"""Read-only M1/M4/R1 corpus probe; no grading or preview-pipeline changes.

python tests/performance/photo-library-measurements.py --source <camera folder>
    [--exiftool <exe>] [--samples 2] [--output output/library-measurements/corpus.json]

M1 is a LibRaw AHD camera-RGB baseline, not a finished color-managed preview.
Each decode uses a fresh process. First/second reads are OS-cache-uncontrolled;
these are not cold-disk guarantees. ExifTool is optional and is never bundled.
"""
from __future__ import annotations

import argparse
import ctypes
from contextlib import redirect_stdout
import hashlib
from io import BytesIO
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
RAW = {".arw", ".cr2", ".cr3", ".nef", ".nrw", ".raf", ".rw2", ".orf", ".pef", ".dng"}


def peak_bytes():
    if os.name != "nt":
        return None
    class Counters(ctypes.Structure):
        _fields_ = [("cb", ctypes.c_ulong), ("faults", ctypes.c_ulong)] + [
            (name, ctypes.c_size_t) for name in ("peak", "working", "quota_peak_paged", "quota_paged",
                "quota_peak_nonpaged", "quota_nonpaged", "pagefile", "peak_pagefile")]
    counters = Counters()
    counters.cb = ctypes.sizeof(counters)
    kernel = ctypes.WinDLL("kernel32")
    kernel.GetCurrentProcess.restype = ctypes.c_void_p
    psapi = ctypes.WinDLL("psapi")
    psapi.GetProcessMemoryInfo.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_ulong]
    if not psapi.GetProcessMemoryInfo(kernel.GetCurrentProcess(), ctypes.byref(counters), counters.cb):
        raise ctypes.WinError()
    return counters.peak


def timed(call):
    start = time.perf_counter()
    value = call()
    return value, round((time.perf_counter() - start) * 1000, 3)


def child_probe(args):
    # Mirror the single-thread library helper, not the grading process's policy.
    for key in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMEXPR_NUM_THREADS"):
        os.environ[key] = "1"
    import rawpy
    from hdr_finisher.raw_import import _read_raw_exif, _read_libraw_metadata
    from PIL import Image
    import exifread
    path = Path(args.child)
    result = {"path": str(path), "rawpy": rawpy.__version__, "libraw": list(rawpy.libraw_version), "exifread": exifread.__version__}
    try:
        if args.mode == "metadata":
            (quick, warning), elapsed = timed(lambda: _read_raw_exif(path))
            result["current_exif"] = {"values": quick, "warning": warning, "ms": elapsed}
            def detailed():
                with path.open("rb") as handle:
                    return exifread.process_file(handle, details=True, extract_thumbnail=False)
            tags, elapsed = timed(detailed)
            result["detailed_exif"] = {"ms": elapsed, "maker_note_count": sum(key.startswith("MakerNote") for key in tags),
                "identity": {key: str(value) for key, value in tags.items() if any(part in key for part in
                    ("Make", "Model", "Lens", "Compression", "Software", "DateTimeOriginal", "Orientation"))}}
            if args.exiftool:
                command = [args.exiftool, "-j", "-G1", "-s", "-charset", "filename=UTF8", "-ExifToolVersion", "-Make", "-Model", "-Lens*",
                    "-FocalLength", "-FNumber", "-ISO", "-ExposureTime", "-Compression", "-PhotometricInterpretation", "-Software", str(path)]
                proc, elapsed = timed(lambda: subprocess.run(command, capture_output=True, timeout=30, env={**os.environ, "LC_ALL": "C", "LC_CTYPE": "C", "LANG": "C"}))
                result["exiftool"] = {"ms_with_process_start": elapsed, "returncode": proc.returncode,
                    "values": json.loads(proc.stdout.decode("utf-8")), "stderr": proc.stderr.decode("utf-8", errors="replace")}
            with rawpy.RawPy() as raw:
                _, elapsed = timed(lambda: raw.open_file(str(path)))
                result["raw_header_ms"] = elapsed
                result["libraw_metadata"] = _read_libraw_metadata(raw)
                result["sensor_size"] = [raw.sizes.width, raw.sizes.height]
                result["mosaiced"] = raw.raw_pattern is not None
                if raw.sizes.width * raw.sizes.height > args.max_megapixels * 1_000_000:
                    result["excluded"] = "pixel limit"
                    return result
                try:
                    thumb, elapsed = timed(raw.extract_thumb)
                    if thumb.format == rawpy.ThumbFormat.JPEG:
                        with Image.open(BytesIO(thumb.data)) as image:
                            size = list(image.size)
                        count = len(thumb.data)
                        format_name = "JPEG"
                    else:
                        size = [thumb.data.shape[1], thumb.data.shape[0]]
                        count = int(thumb.data.nbytes)
                        format_name = "bitmap"
                    result["embedded_preview"] = {"size": size, "bytes": count, "format": format_name, "extract_ms": elapsed,
                        "header_plus_extract_ms": round(result["raw_header_ms"] + elapsed, 3),
                        "fits_long_edge": {str(edge): max(size) >= edge for edge in (1920, 2560, 3840)}}
                except Exception as exc:
                    result["embedded_preview"] = {"error": str(exc)}
        else:
            with rawpy.RawPy() as raw:
                _, header = timed(lambda: raw.open_file(str(path)))
                if raw.sizes.width * raw.sizes.height > args.max_megapixels * 1_000_000:
                    return {**result, "excluded": "pixel limit"}
            raw, opened = timed(lambda: rawpy.imread(str(path)))
            with raw:
                pixels, develop = timed(lambda: raw.postprocess(demosaic_algorithm=rawpy.DemosaicAlgorithm.AHD,
                    half_size=args.mode == "half", use_camera_wb=False, use_auto_wb=False, user_wb=[1.0]*4,
                    no_auto_bright=True, no_auto_scale=True, output_color=rawpy.ColorSpace.raw,
                    gamma=(1.0, 1.0), output_bps=16, highlight_mode=rawpy.HighlightMode.Clip))
                result.update(mode=args.mode, open_ms=opened, develop_ms=develop, total_ms=round(opened+develop, 3),
                    output_size=[pixels.shape[1], pixels.shape[0]], output_bytes=int(pixels.nbytes))
    except Exception as exc:
        result["error"] = f"{type(exc).__name__}: {exc}"
    result["peak_process_bytes"] = peak_bytes()
    return result


def probe(args, path, mode):
    command = [sys.executable, str(Path(__file__).resolve()), "--child", str(path), "--mode", mode,
        "--max-megapixels", str(args.max_megapixels)]
    if args.exiftool:
        command += ["--exiftool", args.exiftool]
    try:
        proc = subprocess.run(command, capture_output=True, timeout=120)
        if proc.returncode:
            return {"path": str(path), "error": proc.stderr.decode("utf-8", errors="replace")[-1500:]}
        result = json.loads(proc.stdout.decode("utf-8"))
        if proc.stderr:
            result["probe_stderr"] = proc.stderr.decode("utf-8", errors="replace")[-1500:]
        return result
    except subprocess.TimeoutExpired:
        return {"path": str(path), "error": "probe exceeded 120 seconds"}


def main(args):
    if args.child:
        with redirect_stdout(sys.stderr):
            result = child_probe(args)
        print(json.dumps(result, ensure_ascii=True))
        return
    source = Path(args.source).resolve()
    output = Path(args.output).resolve()
    if not source.is_dir():
        raise ValueError("Source must be a camera-image directory.")
    if source == output or source in output.parents:
        raise ValueError("Output must be outside the original photo folder.")
    candidates = sorted(p for p in source.rglob("*") if p.is_file() and p.suffix.lower() in RAW)
    rows, seen, excluded, duplicates = [], {}, [], []
    for path in candidates:
        if path.stat().st_size > args.max_file_mb * 1024**2:
            excluded.append({"path": str(path), "bytes": path.stat().st_size, "reason": "file-size limit"})
            continue
        with path.open("rb") as handle:
            digest = hashlib.file_digest(handle, "sha256").hexdigest()
        if digest in seen:
            duplicates.append({"path": str(path), "same_as": seen[digest]})
            continue
        seen[digest] = str(path)
        print(f"metadata {len(rows)+1}: {path.name}", flush=True)
        row = probe(args, path, "metadata")
        row.update(sha256=digest, file_bytes=path.stat().st_size)
        rows.append(row)
    # Choose one per body/format/compression/pixel bucket: retain converted linear
    # DNG as a separate case. No need to decode every near-identical Sony shot.
    groups = {}
    for row in rows:
        if row.get("error") or row.get("excluded"):
            continue
        values = row.get("current_exif", {}).get("values", {})
        et = (row.get("exiftool", {}).get("values") or [{}])[0]
        key = (values.get("camera_maker"), values.get("camera_model"), Path(row["path"]).suffix.lower(), row.get("mosaiced"),
            tuple(sorted((name, str(value)) for name, value in et.items() if name.endswith(":Compression")))
                or row.get("detailed_exif", {}).get("identity", {}).get("Image Compression"),
            int(row["file_bytes"] // (30*1024**2)), tuple(row.get("sensor_size", [])))
        groups.setdefault(key, row)
    for row in groups.values():
        print(f"decode: {Path(row['path']).name}", flush=True)
        row["plain_decode"] = {mode: [probe(args, row["path"], mode) for _ in range(args.samples)] for mode in ("half", "full")}
    result = {"source": str(source), "samples": args.samples, "file_limit_mb": args.max_file_mb, "pixel_limit_mp": args.max_megapixels,
        "cpu": os.environ.get("PROCESSOR_IDENTIFIER"), "threads": 1, "cold_disk": False, "exiftool_path": args.exiftool,
        "exiftool_exe_sha256": hashlib.sha256(Path(args.exiftool).read_bytes()).hexdigest() if args.exiftool else None,
        "timer_excludes": "process/module startup, pixel-limit preflight and metadata comparison; OS cache not controlled",
        "method": "fresh-process LibRaw AHD unity-WB linear camera RGB16; no grade, profile, lens, highlight reconstruction or cache; half-size is LibRaw's algorithm, not guaranteed equivalent to full",
        "candidates": len(candidates), "duplicates": duplicates, "excluded": excluded, "rows": rows}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(f"saved {len(rows)} unique files / {len(groups)} decode cases to {output}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source")
    parser.add_argument("--output", default="output/library-measurements/corpus.json")
    parser.add_argument("--exiftool")
    parser.add_argument("--samples", type=int, default=2)
    parser.add_argument("--max-file-mb", type=int, default=256)
    parser.add_argument("--max-megapixels", type=int, default=100)
    parser.add_argument("--child")
    parser.add_argument("--mode", choices=("metadata", "half", "full"), default="metadata")
    args = parser.parse_args()
    if not args.child and not args.source:
        parser.error("--source is required")
    if min(args.samples, args.max_file_mb, args.max_megapixels) < 1:
        parser.error("sample count and file/pixel limits must be positive")
    main(args)
