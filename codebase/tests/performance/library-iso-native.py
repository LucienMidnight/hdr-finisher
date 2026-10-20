"""Isolated native-codec feasibility comparison; does not qualify a Library route.

Usage: python tests/performance/library-iso-native.py --probe EXE --source AVIF
Choose matched sources and repeat count before collecting comparisons.
"""
import argparse
import hashlib
import importlib
import json
import shutil
import statistics
import subprocess
import sys
import tempfile
from pathlib import Path
from time import perf_counter

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))
import numpy as np
import imagecodecs
from hdr_finisher import gainmap_decoders as gain
from hdr_finisher.binaries import resolve_binary


def measure(probe, original, repeats):
    baseline = importlib.import_module("library-source-baseline")
    sidecar = original.with_name(original.name + ".hdrf")
    def identity():
        return [hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None
                for p in (original, sidecar)]
    before = identity()
    rows = []
    with tempfile.TemporaryDirectory(prefix="hdr-iso-native-") as folder:
        folder = Path(folder)
        source = folder / "source.avif"
        shutil.copyfile(original, source)
        info = gain.inspect_avif(source)
        expected = baseline.parse_iso_metadata_probe(gain._run([
            str(resolve_binary("avifgainmaputil")), "printmetadata", str(source)]).stdout)
        # Existing encoded HDR is an exact precision-boundary comparison.
        reference = folder / "reference.png"
        headroom = max(info["gain_map"]["base_headroom"], info["gain_map"]["alternate_headroom"])
        gain._run([str(resolve_binary("avifgainmaputil")), "tonemap", str(source), str(reference),
                   "--headroom", gain._format_float(headroom), "--cicp-output", "9/16/9", "-d", "10"])
        reference = imagecodecs.png_decode(reference.read_bytes())
        for repeat in range(repeats):
            for mode in (["cpu", "native_probe"] if repeat % 2 == 0 else ["native_probe", "cpu"]):
                start = perf_counter()
                if mode == "cpu":
                    hdr, sdr, meta = gain.decode_avif(source)
                    rows.append({"mode": mode, "repeat": repeat, "total_ms": (perf_counter()-start)*1000,
                                 "stages_ms": meta["decode_timings_ms"]})
                    del hdr, sdr
                    continue
                completed = subprocess.run([str(probe), str(source), str(folder), gain._format_float(headroom)], capture_output=True, text=True)
                if completed.returncode:
                    raise RuntimeError(completed.stderr)
                total = (perf_counter()-start)*1000
                meta = json.loads((folder / "metadata.json").read_text())
                mismatches = []
                for key, value in expected.items():
                    printed = (value["fractions"][0] if key.endswith("headroom")
                               else value if isinstance(value, bool) else value["fractions"])
                    if meta[key] != printed:
                        mismatches.append({"field": key, "native": meta[key], "printed": printed})
                h, w = meta["base"]["height"], meta["base"]["width"]
                hdr = np.fromfile(folder / "hdr.rgb16", dtype="<u2").reshape(h, w, 3)
                difference = np.abs(hdr.astype(np.int32)-reference.astype(np.int32))
                dtype = np.uint8 if meta["base"]["depth"] == 8 else np.dtype("<u2")
                base = np.fromfile(folder / "base.rgba", dtype=dtype).reshape(h, w, 4)[..., :3]
                primary = imagecodecs.avif_decode(source.read_bytes())
                assert base.shape == primary.shape
                rows.append({"mode": mode, "repeat": repeat, "total_ms": total,
                             "native": meta, "hdr_rgb16_exact": bool(np.array_equal(hdr, reference)),
                             "printed_metadata_mismatches": mismatches,
                             "hdr_rgb16_mean_abs": float(difference.mean()),
                             "hdr_rgb16_max_abs": int(difference.max()),
                             "primary_exact": bool(np.array_equal(base, primary)),
                             "primary_max_abs": int(np.abs(base.astype(np.int32)-primary.astype(np.int32)).max())})
    assert before == identity(), "Original or sidecar changed"
    return {"source": str(original), "identity": before, "repeats": repeats, "timing_noise_percent": 5,
            "runs": rows, "medians_ms": {mode: statistics.median(r["total_ms"] for r in rows if r["mode"] == mode)
                                        for mode in ("cpu", "native_probe")},
            "qualified_library_gpu_route": False,
            "boundary": "CPU includes both lanes and working-colour conversion. Native prototype includes decode, raw base/map extraction, full-map YUV scaling, CPU HDR reconstruction and RGB/YUV output conversions plus raw writes and process launch. It excludes SDR reconstruction, working-colour conversion, analysis, scene reduction, queue, GPU transfer and rendering. Medians are NOT a speedup comparison. Generic AOM build is not tuned. No p90, first paint or peak memory measured."}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--probe", type=Path, required=True)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--repeats", type=int, default=3)
    args = parser.parse_args()
    if args.repeats < 1:
        parser.error("repeats must be positive")
    print(json.dumps(measure(args.probe.resolve(strict=True), args.source.resolve(strict=True), args.repeats)))
