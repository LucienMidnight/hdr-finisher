#!/usr/bin/env python3
"""Opt-in qualification for the private camera-linear RAW bridge corpus.

Set HDR_FINISHER_RAW_TEST_SUITE to the read-only corpus directory, or pass
--root. Outputs are written only beneath --output (normally codebase/output).
Each legacy/bridge render runs in a fresh process so runtime and peak RSS are
comparable, and comparisons use bounded strips plus a deterministic sample.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
from typing import Any

import numpy as np


CODEBASE_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = CODEBASE_ROOT / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


RAW_MANIFEST = {
    "2L1B8631.CR2": "0099C675DE295C68D1292B95100AC076FEF7D365B3A0CD93E4A17EA5B382D62F",
    "DSC00264.ARW": "E646D44A86CEF88FF73AF27ED60A683BF8CE2F7F62110EA042F84FEDC56A4E00",
    "DSC04375.ARW": "1604AD3C0645B8C26ED8167DAB23452A97ED784E577ED8C6B90F99312ABD3CF3",
    "Fujifilm_X-E2S_DSCF6495.RAF": "6F30BA88DA509926B1FC0C3F57686F7D687CE113C4D6CE1DF04B8EE94F945128",
    "Nikon_D7500_DSC_3931.NEF": "3A1BC9E4E07005E05105DC03E86CA15D68448E7ED81CF4252D6F59A705F54253",
    "noisy_canon_IMG_0790.CR2": "E63A0F80FC60EB9BE4CC7504982B9653414B39B0C21ED623966A4500E8D8DED5",
}
HEIC_NAME = "iphone_16_pro_IMG_3324.HEIC"
HEIC_HASH = "56402D9D9399CCD8DC2E866C278A53D8DD1355F6ED07CA809F385208A21D2000"
LINEAR_DNG_NAME = "line_scan_2018-05-26-11-35-40_NECTA0000_fbcb8f8f1d37db8bf93c0d46fb748355c01b7f8b.dng"
LINEAR_DNG_HASH = "700B6705CD6B5F5BE82538A1CD32863DD7A68652D2EB5781CB4FDC8203CC8673"
PERFORMANCE_FILES = {
    "2L1B8631.CR2",
    "DSC00264.ARW",
    "Fujifilm_X-E2S_DSCF6495.RAF",
}


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(8 * 1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest().upper()


class _PeakRssSampler:
    def __init__(self) -> None:
        self._stop = threading.Event()
        self.peak = _current_rss_bytes()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def _run(self) -> None:
        while not self._stop.wait(0.01):
            self.peak = max(self.peak, _current_rss_bytes())

    def __enter__(self) -> _PeakRssSampler:
        self._thread.start()
        return self

    def __exit__(self, *_args: object) -> None:
        self.peak = max(self.peak, _current_rss_bytes())
        self._stop.set()
        self._thread.join()


def _current_rss_bytes() -> int:
    if os.name == "nt":
        import ctypes
        from ctypes import wintypes

        class ProcessMemoryCountersEx(ctypes.Structure):
            _fields_ = [
                ("cb", wintypes.DWORD),
                ("PageFaultCount", wintypes.DWORD),
                ("PeakWorkingSetSize", ctypes.c_size_t),
                ("WorkingSetSize", ctypes.c_size_t),
                ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                ("PagefileUsage", ctypes.c_size_t),
                ("PeakPagefileUsage", ctypes.c_size_t),
                ("PrivateUsage", ctypes.c_size_t),
            ]

        counters = ProcessMemoryCountersEx()
        counters.cb = ctypes.sizeof(counters)
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        psapi = ctypes.WinDLL("psapi", use_last_error=True)
        kernel32.GetCurrentProcess.argtypes = []
        kernel32.GetCurrentProcess.restype = wintypes.HANDLE
        psapi.GetProcessMemoryInfo.argtypes = [
            wintypes.HANDLE,
            ctypes.POINTER(ProcessMemoryCountersEx),
            wintypes.DWORD,
        ]
        psapi.GetProcessMemoryInfo.restype = wintypes.BOOL
        process = kernel32.GetCurrentProcess()
        if psapi.GetProcessMemoryInfo(process, ctypes.byref(counters), counters.cb):
            return int(counters.WorkingSetSize)
        return 0
    import resource

    maximum = int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
    return maximum if sys.platform == "darwin" else maximum * 1024


def _array_stats(image: np.ndarray) -> dict[str, Any]:
    minimum = np.full(3, np.inf, dtype=np.float64)
    maximum = np.full(3, -np.inf, dtype=np.float64)
    finite_count = 0
    negative_count = np.zeros(3, dtype=np.int64)
    above_one_count = np.zeros(3, dtype=np.int64)
    exact_one_count = np.zeros(3, dtype=np.int64)
    for start in range(0, image.shape[0], 128):
        strip = np.asarray(image[start : start + 128])
        minimum = np.minimum(minimum, np.min(strip, axis=(0, 1)))
        maximum = np.maximum(maximum, np.max(strip, axis=(0, 1)))
        finite_count += int(np.count_nonzero(np.isfinite(strip)))
        negative_count += np.count_nonzero(strip < 0.0, axis=(0, 1))
        above_one_count += np.count_nonzero(strip > 1.0, axis=(0, 1))
        exact_one_count += np.count_nonzero(strip == 1.0, axis=(0, 1))
    return {
        "shape": list(image.shape),
        "dtype": str(image.dtype),
        "contiguous": bool(image.flags.c_contiguous),
        "channel_minimum": minimum.astype(float).tolist(),
        "channel_maximum": maximum.astype(float).tolist(),
        "non_finite_count": int(np.size(image) - finite_count),
        "negative_count": negative_count.astype(int).tolist(),
        "above_one_count": above_one_count.astype(int).tolist(),
        "exact_one_count": exact_one_count.astype(int).tolist(),
    }


def _array_sha256(image: np.ndarray) -> str:
    digest = hashlib.sha256()
    for start in range(0, image.shape[0], 128):
        strip = np.ascontiguousarray(image[start : start + 128]).view(np.uint8)
        digest.update(strip)
    return digest.hexdigest().upper()


def _legacy_render(path: Path) -> tuple[np.ndarray, dict[str, Any]]:
    import rawpy

    from hdr_finisher.color import aces2065_to_acescg, transform_float32_bounded

    with rawpy.imread(str(path)) as raw:
        developed = raw.postprocess(
            demosaic_algorithm=rawpy.DemosaicAlgorithm.AHD,
            use_camera_wb=True,
            no_auto_bright=True,
            output_color=rawpy.ColorSpace.ACES,
            gamma=(1.0, 1.0),
            output_bps=16,
            highlight_mode=rawpy.HighlightMode.Clip,
        )
    channel_maximum = np.zeros(3, dtype=np.uint16)
    exact_ceiling_count = np.zeros(3, dtype=np.int64)
    for start in range(0, developed.shape[0], 128):
        strip = developed[start : start + 128]
        channel_maximum = np.maximum(channel_maximum, np.max(strip, axis=(0, 1)))
        exact_ceiling_count += np.count_nonzero(strip == 65535, axis=(0, 1))
    transport = {
        "channel_maximum": channel_maximum.astype(int).tolist(),
        "exact_65535_count": exact_ceiling_count.astype(int).tolist(),
    }
    aces2065 = developed.astype(np.float32)
    aces2065 *= np.float32(1.0 / 65535.0)
    return transform_float32_bounded(aces2065, aces2065_to_acescg), transport


def _bridge_render(path: Path, *, reconstruct_highlights: bool) -> tuple[np.ndarray, dict[str, Any]]:
    from hdr_finisher.models import (
        LensCorrectionSettings,
        RawHighlightReconstructionSettings,
        RawImportSettings,
    )
    from hdr_finisher.raw_import import decode_raw

    image, metadata = decode_raw(
        path,
        RawImportSettings(
            lens=LensCorrectionSettings(mode="off"),
            highlight_reconstruction=RawHighlightReconstructionSettings(
                enabled=reconstruct_highlights
            ),
        ),
    )
    development = metadata["raw_development"]
    return image, {
        "pipeline": development.get("pipeline"),
        "fallback_reason": development.get("fallback_reason"),
        "channel_maximum": development.get("transport_channel_maximum", []),
        "exact_65535_count": development.get("transport_exact_65535_count", []),
        "metadata": development,
    }


def _worker(mode: str, source: Path, image_output: Path, json_output: Path) -> int:
    started = time.perf_counter()
    with _PeakRssSampler() as memory:
        if mode == "legacy":
            image, transport = _legacy_render(source)
        else:
            image, transport = _bridge_render(
                source,
                reconstruct_highlights=mode == "bridge",
            )
    elapsed = time.perf_counter() - started
    result = {
        "mode": mode,
        "elapsed_seconds": elapsed,
        "peak_rss_bytes": memory.peak,
        "pixels": _array_stats(image),
        "transport": transport,
    }
    np.save(image_output, image, allow_pickle=False)
    json_output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    return 0


def _run_worker(mode: str, source: Path, directory: Path, sequence: int) -> tuple[Path, dict[str, Any]]:
    image_output = directory / f"{source.stem}-{mode}-{sequence}.npy"
    json_output = directory / f"{source.stem}-{mode}-{sequence}.json"
    command = [
        sys.executable,
        str(Path(__file__).resolve()),
        "--worker",
        mode,
        "--source",
        str(source),
        "--image-output",
        str(image_output),
        "--json-output",
        str(json_output),
    ]
    subprocess.run(command, check=True)
    return image_output, json.loads(json_output.read_text(encoding="utf-8"))


def _comparison(legacy_path: Path, bridge_path: Path, sample_limit: int = 1_000_000) -> dict[str, Any]:
    legacy = np.load(legacy_path, mmap_mode="r")
    bridge = np.load(bridge_path, mmap_mode="r")
    if legacy.shape != bridge.shape:
        return {"shape_match": False, "legacy_shape": list(legacy.shape), "bridge_shape": list(bridge.shape)}
    step = max(1, int(np.ceil((legacy.shape[0] * legacy.shape[1]) / sample_limit)))
    rgb_errors: list[np.ndarray] = []
    ev_errors: list[np.ndarray] = []
    xy_errors: list[np.ndarray] = []
    rgb_to_xyz = np.asarray(
        [
            [0.6624541811, 0.1340042065, 0.1561876870],
            [0.2722287168, 0.6740817658, 0.0536895174],
            [-0.0055746495, 0.0040607335, 1.0103391003],
        ],
        dtype=np.float32,
    )
    safe_count = 0
    for start in range(0, legacy.shape[0], 128):
        old = np.asarray(legacy[start : start + 128], dtype=np.float32)
        new = np.asarray(bridge[start : start + 128], dtype=np.float32)
        safe = (
            np.all(np.isfinite(old), axis=2)
            & np.all(np.isfinite(new), axis=2)
            & (np.min(old, axis=2) > 0.001)
            & (np.max(old, axis=2) < 0.8)
        )
        safe_count += int(np.count_nonzero(safe))
        flat_indices = np.flatnonzero(safe)
        if not flat_indices.size:
            continue
        global_indices = flat_indices + start * legacy.shape[1]
        chosen = flat_indices[global_indices % step == 0]
        if not chosen.size:
            continue
        old_sample = old.reshape(-1, 3)[chosen]
        new_sample = new.reshape(-1, 3)[chosen]
        rgb_errors.append(np.max(np.abs(new_sample - old_sample), axis=1))
        old_xyz = old_sample @ rgb_to_xyz.T
        new_xyz = new_sample @ rgb_to_xyz.T
        old_y = np.maximum(old_xyz[:, 1], 1e-8)
        new_y = np.maximum(new_xyz[:, 1], 1e-8)
        ev_errors.append(np.log2(new_y / old_y))
        old_xy = old_xyz[:, :2] / np.maximum(np.sum(old_xyz, axis=1, keepdims=True), 1e-8)
        new_xy = new_xyz[:, :2] / np.maximum(np.sum(new_xyz, axis=1, keepdims=True), 1e-8)
        xy_errors.append(np.linalg.norm(new_xy - old_xy, axis=1))
    if not rgb_errors:
        return {"shape_match": True, "safely_subclipped_pixel_count": safe_count, "sample_count": 0}
    rgb = np.concatenate(rgb_errors)
    ev = np.concatenate(ev_errors)
    xy = np.concatenate(xy_errors)
    return {
        "shape_match": True,
        "safely_subclipped_pixel_count": safe_count,
        "sample_count": int(rgb.size),
        "sample_step": step,
        "linear_rgb_max_abs_error_median": float(np.median(rgb)),
        "linear_rgb_max_abs_error_p99": float(np.quantile(rgb, 0.99)),
        "luminance_ev_difference_median": float(np.median(ev)),
        "luminance_ev_absolute_difference_p99": float(np.quantile(np.abs(ev), 0.99)),
        "chromaticity_delta_xy_median": float(np.median(xy)),
        "chromaticity_delta_xy_p99": float(np.quantile(xy, 0.99)),
    }


def _sensor_saturation(path: Path) -> dict[str, Any]:
    import rawpy

    with rawpy.imread(str(path)) as raw:
        mosaic = raw.raw_image_visible
        pattern = np.asarray(raw.raw_pattern)
        desc = raw.color_desc.decode("ascii").rstrip("\x00")
        black = [int(item) for item in raw.black_level_per_channel]
        global_white = int(raw.white_level)
        camera_white = raw.camera_white_level_per_channel
        camera_white = [int(item) for item in camera_white] if camera_white else None
        global_counts = [0, 0, 0, 0]
        camera_counts = [0, 0, 0, 0]
        for start in range(0, mosaic.shape[0], 256):
            end = min(mosaic.shape[0], start + 256)
            strip = np.asarray(mosaic[start:end])
            rows = np.arange(start, end)[:, None] % pattern.shape[0]
            columns = np.arange(mosaic.shape[1])[None, :] % pattern.shape[1]
            colors = pattern[rows, columns]
            for channel in np.unique(pattern):
                values = strip[colors == channel]
                global_counts[int(channel)] += int(np.count_nonzero(values >= global_white))
                if camera_white:
                    camera_counts[int(channel)] += int(
                        np.count_nonzero(values >= camera_white[int(channel)])
                    )
        return {
            "visible_mosaic_shape": list(mosaic.shape),
            "cfa_shape": list(pattern.shape),
            "color_description": desc,
            "black_level_per_channel": black,
            "libraw_global_white": global_white,
            "camera_white_level_per_channel": camera_white,
            "at_or_above_libraw_global_white_count": global_counts,
            "at_or_above_camera_white_count": camera_counts if camera_white else None,
        }


def qualify(root: Path, output: Path, repeats: int) -> dict[str, Any]:
    import rawpy

    from hdr_finisher.linear_dng import inspect_dng
    from hdr_finisher.loader import load_image

    expected = {**RAW_MANIFEST, HEIC_NAME: HEIC_HASH, LINEAR_DNG_NAME: LINEAR_DNG_HASH}
    hashes: dict[str, dict[str, Any]] = {}
    for name, digest in expected.items():
        source = root / name
        actual = _sha256(source) if source.is_file() else "MISSING"
        hashes[name] = {"expected": digest, "actual": actual, "match": actual == digest}
    if not all(item["match"] for item in hashes.values()):
        raise RuntimeError("Corpus hash verification failed; no source was decoded.")

    output.parent.mkdir(parents=True, exist_ok=True)
    files: dict[str, Any] = {}
    with tempfile.TemporaryDirectory(prefix="hdr-finisher-raw-bridge-", dir=output.parent) as temp_name:
        temporary = Path(temp_name)
        for name in RAW_MANIFEST:
            source = root / name
            unreconstructed_path, unreconstructed_result = _run_worker(
                "bridge_unreconstructed", source, temporary, 0
            )
            run_count = repeats if name in PERFORMANCE_FILES else 1
            legacy_times: list[float] = []
            bridge_times: list[float] = []
            legacy_memory: list[int] = []
            bridge_memory: list[int] = []
            legacy_image: Path | None = None
            bridge_image: Path | None = None
            first_legacy: dict[str, Any] | None = None
            first_bridge: dict[str, Any] | None = None
            for sequence in range(run_count):
                legacy_path, legacy_result = _run_worker("legacy", source, temporary, sequence)
                bridge_path, bridge_result = _run_worker("bridge", source, temporary, sequence)
                legacy_times.append(float(legacy_result["elapsed_seconds"]))
                bridge_times.append(float(bridge_result["elapsed_seconds"]))
                legacy_memory.append(int(legacy_result["peak_rss_bytes"]))
                bridge_memory.append(int(bridge_result["peak_rss_bytes"]))
                if sequence == 0:
                    legacy_image, bridge_image = legacy_path, bridge_path
                    first_legacy, first_bridge = legacy_result, bridge_result
                else:
                    legacy_path.unlink()
                    bridge_path.unlink()
            assert legacy_image and bridge_image and first_legacy and first_bridge
            comparison = _comparison(legacy_image, bridge_image)
            highlight_comparison = _comparison(unreconstructed_path, bridge_image)
            legacy_image.unlink()
            bridge_image.unlink()
            unreconstructed_path.unlink()
            legacy_median = float(np.median(legacy_times))
            bridge_median = float(np.median(bridge_times))
            files[name] = {
                "sensor": _sensor_saturation(source),
                "legacy": first_legacy,
                "bridge_without_reconstruction": unreconstructed_result,
                "bridge": first_bridge,
                "comparison": comparison,
                "highlight_reconstruction_comparison": highlight_comparison,
                "performance": {
                    "repeats": run_count,
                    "legacy_seconds": legacy_times,
                    "bridge_seconds": bridge_times,
                    "legacy_median_seconds": legacy_median,
                    "bridge_median_seconds": bridge_median,
                    "slowdown_percent": (bridge_median / legacy_median - 1.0) * 100.0,
                    "legacy_peak_rss_bytes": legacy_memory,
                    "bridge_peak_rss_bytes": bridge_memory,
                    "peak_rss_growth_bytes": int(np.median(bridge_memory) - np.median(legacy_memory)),
                },
            }

    heic_image, heic_descriptor, heic_metadata, _heic_analysis, heic_sdr_reference = load_image(
        root / HEIC_NAME
    )
    linear_inspection = inspect_dng(root / LINEAR_DNG_NAME)
    result = {
        "schema": "camera-linear-raw-bridge-qualification-v2",
        "generated_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "corpus_root": str(root),
        "hashes": hashes,
        "versions": {
            "python": sys.version,
            "numpy": np.__version__,
            "rawpy": rawpy.__version__,
            "libraw": ".".join(map(str, rawpy.libraw_version)),
        },
        "files": files,
        "route_isolation": {
            HEIC_NAME: {
                "route": "HEIC/HEIF loader branch",
                "full_decode": True,
                "descriptor": heic_descriptor.model_dump(mode="json"),
                "pixels": _array_stats(heic_image),
                "canonical_sha256": _array_sha256(heic_image),
                "gain_map_applied": bool(heic_metadata.get("apple_hdr_gainmap_applied")),
                "sdr_reference_present": heic_sdr_reference is not None,
            },
            LINEAR_DNG_NAME: {
                "route": linear_inspection.route.value,
                "width": linear_inspection.width,
                "height": linear_inspection.height,
                "full_decode": False,
                "resource_estimate": (
                    linear_inspection.resource_estimate.__dict__
                    if linear_inspection.resource_estimate is not None
                    else None
                ),
            },
        },
    }
    output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=os.environ.get("HDR_FINISHER_RAW_TEST_SUITE"))
    parser.add_argument("--output", type=Path, default=Path("output/camera-linear-raw-qualification.json"))
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--worker", choices=("legacy", "bridge_unreconstructed", "bridge"))
    parser.add_argument("--source", type=Path)
    parser.add_argument("--image-output", type=Path)
    parser.add_argument("--json-output", type=Path)
    args = parser.parse_args()
    if args.worker:
        if not args.source or not args.image_output or not args.json_output:
            parser.error("worker mode requires --source, --image-output, and --json-output")
        return _worker(args.worker, args.source, args.image_output, args.json_output)
    if args.root is None:
        parser.error("set HDR_FINISHER_RAW_TEST_SUITE or pass --root")
    result = qualify(args.root.resolve(), args.output.resolve(), max(1, args.repeats))
    print(json.dumps({"output": str(args.output.resolve()), "files": list(result["files"])}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
