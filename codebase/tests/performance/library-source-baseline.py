"""Read-only non-RAW Library baseline through the real picture helper lanes.

From codebase: .venv/Scripts/python tests/performance/library-source-baseline.py
    --manifest tests/performance/library-source-samples.json --synthetic --repeats 3
Run alone, without other tests or photo work. Stages summed across concurrent
preparations are work totals, NOT an additive wall-time breakdown.
Manifest: [{"name":"jpeg","path":"absolute/file.jpg","document":null}, ...].
Optional document is a complete EditDocument, used in memory only. Sources are
copied without sidecars into a disposable folder. Never writes beside originals.
Three cold application-cache sequential/paired rounds and two cached opens per round;
Windows file cache is NOT flushed. No first-paint or p90 claim.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from contextlib import ExitStack
from functools import wraps
import hashlib
import json
import os
from pathlib import Path
import shutil
import statistics
import sys
import tempfile
from threading import local
from time import perf_counter
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
# Keep this module import light: native libraries load inside the helper after
# its existing half-logical-processor environment has been established.
from hdr_finisher import library_worker

ORIGINAL_WORKER = library_worker._worker_main


def instrumented_worker(connection, root, parent_pid, paused):
    os.environ["HDR_FINISHER_APP_DATA_DIR"] = root
    os.environ["HDR_FINISHER_SOURCE_CACHE_DIR"] = str(Path(root) / "source-mips")
    for key in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMEXPR_NUM_THREADS"):
        os.environ[key] = str(max(1, (os.cpu_count() or 2) // 2))
    from hdr_finisher import loader, sessions, gainmap_decoders as gain, jpegxl, library_live as live
    from hdr_finisher.library_diagnostics import log
    state = local()

    def wrap(function, stage):
        @wraps(function)
        def timed(*args, **kwargs):
            stack = getattr(state, "stack", None)
            if stack is None:
                stack = state.stack = []
            frame = [perf_counter(), 0.0]
            stack.append(frame)
            try:
                result = function(*args, **kwargs)
                if stage == "prepare_session":
                    facts = {key: result.metadata.get(key) for key in (
                        "import_timings_ms", "decode_timings_ms", "color_space", "transfer_function",
                        "user_override", "project_normalization", "sdr_file_rendition",
                        "bit_depth", "needs_color_override", "decoder_normalized_to_acescg",
                        "decoder_reference_white_nits", "icc_converted_to_srgb",
                        "avif_direct_hdr", "avif_gain_map", "jpeg_ultrahdr",
                        "apple_hdr_gainmap_applied", "apple_hdr_gainmap_error",
                        "selected_rgb_channels", "source_cicp", "orientation")}
                    log("baseline_source", dimensions=list(result.image.shape),
                        has_reference=result.sdr_reference_image is not None, facts=facts)
                return result
            finally:
                elapsed = perf_counter() - frame[0]
                stack.pop()
                if stack:
                    stack[-1][1] += elapsed
                log("baseline_stage", stage=stage, inclusive_ms=elapsed * 1000,
                    exclusive_ms=(elapsed - frame[1]) * 1000)
        return timed

    # Exclusive time excludes nested instrumented boundaries in the SAME thread.
    # Hash runs concurrently and is reported separately, never summed into wall time.
    boundaries = [
        (sessions.SessionStore, "prepare_session", "prepare_session"),
        (sessions, "_sha256_file", "hash_parallel"),
        (live, "reduce_picture", "reduction"),
        (loader, "_load_with_pillow", "codec_combined"),
        (loader, "_load_tiff", "codec_combined"),
        (loader, "_load_exr", "codec_combined"),
        (loader, "_load_hdr_like", "codec_combined"),
        (loader, "_load_heif", "codec_combined"),
        (loader, "decode_avif", "codec_combined"),
        (loader, "decode_ultrahdr_jpeg", "codec_combined"),
        (loader, "decode_jpegxl", "codec_combined"),
        (loader, "is_ultrahdr_jpeg", "metadata"),
        (gain, "inspect_avif", "metadata"),
        (gain, "inspect_jpeg_gain_map", "metadata"),
        (loader, "normalize_to_acescg_bounded", "colour_range"),
        (loader, "map_import_negative", "colour_range"),
        (loader, "sdr_file_renditions", "colour_range"),
        (loader, "classify_hdr", "analysis"),
        (gain, "normalize_to_acescg_bounded", "colour_range"),
        (gain, "transform_float32_bounded", "colour_range"),
        (gain, "_normalize_to_acescg_in_strips", "colour_range"),
        (gain, "_normalize_sdr_reference_in_strips", "colour_range"),
        (jpegxl, "normalize_to_acescg_bounded", "colour_range"),
        (loader, "transform_float32_bounded", "colour_range"),
        (loader, "_apply_apple_hdr_gainmap_linear_in_place", "gain_reconstruction"),
    ]
    original_run = gain._run

    def timed_run(command, *args, **kwargs):
        # External tools combine codec work, process launch and intermediary I/O.
        stage = "metadata" if "printmetadata" in command or "-P" in command else "gain_tool_combined" if "tonemap" in command or "-j" in command else "codec_tool_combined"
        return wrap(original_run, stage)(command, *args, **kwargs)

    with ExitStack() as stack:
        for owner, name, stage in boundaries:
            stack.enter_context(patch.object(owner, name, wrap(getattr(owner, name), stage)))
        stack.enter_context(patch.object(gain, "_run", timed_run))
        ORIGINAL_WORKER(connection, root, parent_pid, paused)


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def summarize(events):
    stages, inclusive, counts = defaultdict(float), defaultdict(float), defaultdict(int)
    for event in events:
        if event["event"] == "baseline_stage":
            stages[event["stage"]] += event["exclusive_ms"]
            inclusive[event["stage"]] += event["inclusive_ms"]
            counts[event["stage"]] += 1
    return {
        "exclusive_ms": {key: round(value, 3) for key, value in stages.items()},
        "inclusive_ms": {key: round(value, 3) for key, value in inclusive.items()},
        "calls": dict(counts),
        "queue_ms": [e["queue_ms"] for e in events if e["event"] == "helper_job_started"],
        "storage_ms": sum(e["duration_ms"] for e in events if e["event"] == "picture_stored"),
        "sources": [e for e in events if e["event"] == "baseline_source"],
    }


def measure(sample, repeats):
    original = Path(sample["path"]).resolve()
    if not original.is_file():
        return {"name": sample["name"], "gap": "missing sample", "path": str(original)}
    fingerprint = digest(original)
    records = []
    with tempfile.TemporaryDirectory(prefix="hdr-test-rgb-source-") as directory:
        folder = Path(directory)
        photo = folder / original.name
        shutil.copyfile(original, photo)
        for repeat, mode in ((r, m) for r in range(repeats) for m in ("sequential", "paired")):
            events = []

            def receive(event, **fields):
                events.append({"event": event, **fields})

            worker = library_worker.LibraryWorker(folder / f"profile-{repeat}-{mode}")
            with patch.object(library_worker, "_worker_main", instrumented_worker), patch.object(library_worker, "log", receive):
                try:
                    worker.start()  # Startup excluded; the real below-normal helper is used.
                    first = len(events)
                    started = perf_counter()
                    results, futures = [], []
                    for edge in (640, 2560):
                        future = worker.submit_library("live-scene", path=str(photo),
                            document=sample.get("document"), edge=edge)[1]
                        if mode == "sequential":
                            results.append(future.result(timeout=180))
                        else:
                            futures.append(future)
                    if futures:
                        results = [future.result(timeout=180) for future in futures]
                    cold_ms = (perf_counter() - started) * 1000
                    cold = summarize(events[first:])
                    first = len(events)
                    started = perf_counter()
                    opened = [worker.submit_library("live-scene", path=str(photo),
                              document=sample.get("document"), edge=edge)[1].result(timeout=180)
                              for edge in (640, 2560)]
                    cached_ms = (perf_counter() - started) * 1000
                    warm = summarize(events[first:])
                    preparations = cold["calls"].get("prepare_session", 0)
                    assert preparations == 1, cold
                    if mode == "sequential":
                        assert preparations == 1, cold
                    assert warm["calls"].get("prepare_session", 0) == 0, warm
                    assert [r["edge"] for r in results] == [640, 2560]
                    assert results[0]["source_fingerprint_sha256"] == fingerprint
                    assert all(r["cache_hit"] for r in opened)
                    assert [r["key"] for r in results] == [r["key"] for r in opened]
                    records.append({"mode": mode, "request_pair_ms": round(cold_ms, 3),
                                    "preparations": preparations,
                                    "cached_pair_ms": round(cached_ms, 3), **cold})
                finally:
                    worker.close()
        assert digest(photo) == fingerprint
        assert not list(folder.glob("*.hdrf"))
    assert digest(original) == fingerprint
    return {"name": sample["name"], "path": str(original), "sha256": fingerprint,
            "summary": {mode: {
                "median_ms": round(statistics.median(r["request_pair_ms"] for r in records if r["mode"] == mode), 3),
                "range_ms": [min(r["request_pair_ms"] for r in records if r["mode"] == mode),
                             max(r["request_pair_ms"] for r in records if r["mode"] == mode)],
                "preparations": [r["preparations"] for r in records if r["mode"] == mode]}
                for mode in ("sequential", "paired")}, "runs": records}



def synthetic_samples(folder):
    """Controlled coverage, not photographic speed acceptance; no source fixtures changed."""
    import numpy as np
    import tifffile
    from PIL import Image, ImageCms
    from hdr_finisher.jpegxl import encode_hdr_jpegxl, encode_sdr_jpegxl
    from hdr_finisher.library_thumbnail_codec import encode
    width, height = 1536, 1024
    x = np.linspace(0, 1, width, dtype=np.float32)[None, :]
    rgb = np.broadcast_to(np.stack([x, x * .7, x * .4], axis=-1), (height, width, 3)).copy()
    icc = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
    bitmap = Image.fromarray(np.round(rgb * 255).astype(np.uint8))
    exif = Image.Exif()
    exif[274] = 6
    bitmap.save(folder / "oriented-icc.jpg", exif=exif, icc_profile=icc)
    bitmap.save(folder / "ordinary.png", icc_profile=icc)
    tifffile.imwrite(folder / "profiled16.tiff", np.round(rgb * 65535).astype(np.uint16),
                     extratags=[(34675, "B", len(icc), icc, False)])
    import subprocess
    subprocess.run([str(ROOT / "bin" / "avifenc.exe"), "--cicp", "9/16/9", "-d", "10",
                    "-s", "10", str(folder / "ordinary.png"), str(folder / "direct-pq.avif")],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    scene = rgb * 8
    (folder / "hdr.jxl").write_bytes(encode_hdr_jpegxl(scene, 95, reference_white_nits=100))
    (folder / "sdr.jxl").write_bytes(encode_sdr_jpegxl(rgb, 95))
    (folder / "ultrahdr.jpg").write_bytes(encode(scene, rgb))
    with (folder / "linear.pfm").open("wb") as handle:
        handle.write(f"PF\n{width} {height}\n-1.0\n".encode())
        handle.write(scene[::-1].astype("<f4").tobytes())
    document = {"schema_version": 4, "hdr_reference_white_nits": 100,
                "source": {"filename": "hdr.jxl", "luminance": {
                    "luminance_semantics": "absolute", "transfer_function": "PQ"}},
                "global_adjustments": {"hdr": {"exposure": .5}}}
    return [{"name": "synthetic-" + name, "path": str(folder / name),
             **({"document": document} if name == "hdr.jxl" else {})}
            for name in ("oriented-icc.jpg", "ordinary.png", "profiled16.tiff",
                         "hdr.jxl", "sdr.jxl", "ultrahdr.jpg", "linear.pfm", "direct-pq.avif")]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--synthetic", action="store_true", help="Add eight controlled codec/interpretation cases")
    parser.add_argument("--repeats", type=int, default=3)
    args = parser.parse_args()
    if args.repeats < 1:
        parser.error("--repeats must be positive")
    scratch = tempfile.TemporaryDirectory(prefix="hdr-test-rgb-samples-")
    samples = json.loads(args.manifest.read_text(encoding="utf-8-sig"))
    if args.synthetic:
        samples.extend(synthetic_samples(Path(scratch.name)))
    print(json.dumps({"protocol": {"samples": len(samples), "repeats": args.repeats, "modes": ["sequential", "paired"],
          "timing_noise_percent": 5, "cache": "empty application cache per repeat; OS cache uncontrolled",
          "unmeasured": ["HTTP/frontend queue", "GPU upload", "first draw", "p90",
                         "codec-only inside external tools", "metadata inside combined decoder boundaries"]}}), flush=True)
    failed = False
    for sample in samples:
        try:
            result = measure(sample, args.repeats)
            failed |= "gap" in result
        except Exception as error:
            failed = True
            result = {"name": sample["name"], "gap": repr(error)}
        print(json.dumps(result), flush=True)
    scratch.cleanup()
    return int(failed)


if __name__ == "__main__":
    raise SystemExit(main())
