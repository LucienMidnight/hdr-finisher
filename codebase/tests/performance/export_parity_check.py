"""File-side half of the export/reference parity run (PRD 4.8, 15.27).

The run answers two separate questions and keeps them separate:

  1. Export correctness. The delivered file decodes at real precision, and its
     decoded values and metadata agree with the settings it was declared with.
  2. Preview-agrees-with-export. The decoded file, mapped through the preview's
     own display transform, matches the retained presentation target's float
     readback in one named encoding.

The named encoding is the *preview presentation encoding*: display-referred,
transfer-encoded values in the extended canvas convention (1.0 = 203 nits on
an HDR surface), or the SDR fallback path otherwise. The transform mirrors
``displayHdr``/``displayEncode`` in ``frontend/webgpu-preview.js`` and uses the
shader's own matrix constants, so the export side is mapped through exactly the
transform the preview applied. Inverting the preview back to scene-linear was
the alternative and is deliberately not used: the inverse transfer function
amplifies half-float quantization on the preview side.

Both sides are reduced to the canvas CSS box with the same separable Lanczos-3
filter the item 6 comparator uses, ported here so one implementation produces
both sides. Deltas are reported in encoding levels (1/255 of the encoding
unit), the unit the sprint's tolerance language uses.

This module is invoked by ``tests/performance/export-parity.js`` and is also
imported by ``tests/test_export_parity.py`` for its unit tests.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path
from typing import Any

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from hdr_finisher.avif_info import inspect_avif  # noqa: E402
from hdr_finisher.color import acescg_to_linear_bt2020  # noqa: E402
from hdr_finisher.color_context import (  # noqa: E402
    AUTHORING_ANCHOR,
    CHROMIUM_CANVAS_REFERENCE_WHITE_NITS,
    scene_linear_to_nits,
    validate_reference_white,
)
from hdr_finisher.gainmap_decoders import (  # noqa: E402
    decode_avif,
    decode_ultrahdr_jpeg,
    is_ultrahdr_jpeg,
)

# The shader's own matrix constants, copied verbatim from webgpu-preview.js
# (acescgToBt2020 / bt2020ToP3 / acescgToSrgb) so the export side is mapped
# through exactly the transform the preview applied, not a re-derivation.
SHADER_ACESCG_TO_BT2020 = np.array(
    [
        [1.0260187082, -0.0221655448, -0.0038531634],
        [-0.0017230808, 1.0023190716, -0.0005959908],
        [-0.0051099278, -0.0216355504, 1.0267454781],
    ],
    dtype=np.float64,
)
SHADER_BT2020_TO_P3 = np.array(
    [
        [1.3435782526, -0.2821796705, -0.0613985821],
        [-0.0652974528, 1.0757879158, -0.0104904631],
        [0.0028217873, -0.0195984945, 1.0167767073],
    ],
    dtype=np.float64,
)
SHADER_ACESCG_TO_SRGB = np.array(
    [
        [1.7048873310, -0.6241572745, -0.0808867739],
        [-0.1295209353, 1.1383993260, -0.0087792418],
        [-0.0241270599, -0.1246206123, 1.1488221099],
    ],
    dtype=np.float64,
)
TRANSPORT_CEILING_NITS = 10000.0
ENCODING_LEVELS = 255.0


def display_encode(values: np.ndarray) -> np.ndarray:
    """The preview's displayEncodeChannel: sRGB curve, sign-preserving."""
    magnitude = np.abs(values)
    linear = magnitude * 12.92
    nonlinear = 1.055 * np.power(np.maximum(magnitude, 1e-12), 1.0 / 2.4) - 0.055
    encoded = np.where(magnitude <= 0.0031308, linear, nonlinear)
    return np.sign(values) * encoded


def presentation_encode(
    acescg: np.ndarray,
    *,
    hdr_surface: bool,
    reference_white_nits: int,
    transport_ceiling_nits: float = TRANSPORT_CEILING_NITS,
) -> np.ndarray:
    """Map decoded scene-linear ACEScg into the preview presentation encoding."""
    rgb = np.asarray(acescg, dtype=np.float64)[..., :3]
    reference_white = float(validate_reference_white(reference_white_nits))
    if hdr_surface:
        bt2020 = rgb @ SHADER_ACESCG_TO_BT2020.T
        ceiling = transport_ceiling_nits * AUTHORING_ANCHOR / reference_white
        bt2020 = np.clip(bt2020, 0.0, ceiling)
        p3 = bt2020 @ SHADER_BT2020_TO_P3.T
        display = p3 / AUTHORING_ANCHOR * (reference_white / CHROMIUM_CANVAS_REFERENCE_WHITE_NITS)
    else:
        srgb = rgb @ SHADER_ACESCG_TO_SRGB.T
        display = np.maximum(srgb, 0.0)
        display = display / (1.0 + display)
    return display_encode(display)


def decoder_scale_to_project(image: np.ndarray, reference_white_nits: int) -> np.ndarray:
    """Decoders normalize to 203 nits (0.18 == 203); rescale to the project."""
    reference_white = float(validate_reference_white(reference_white_nits))
    return np.asarray(image, dtype=np.float32) * np.float32(
        CHROMIUM_CANVAS_REFERENCE_WHITE_NITS / reference_white
    )


def peak_nits(image: np.ndarray, reference_white_nits: int) -> float:
    """The proof store's own peak definition: BT.2020 luma in nits."""
    bt2020 = np.clip(acescg_to_linear_bt2020(np.asarray(image, dtype=np.float32)[..., :3]), 0.0, None)
    luma = 0.2627 * bt2020[..., 0] + 0.6780 * bt2020[..., 1] + 0.0593 * bt2020[..., 2]
    return float(np.max(scene_linear_to_nits(luma, reference_white_nits), initial=0.0))


def decode_delivered(path: Path, format_name: str) -> tuple[np.ndarray, np.ndarray | None, dict[str, Any]]:
    if format_name == "jpeg_ultrahdr":
        return decode_ultrahdr_jpeg(path)
    if format_name == "avif_gain_map":
        return decode_avif(path)
    raise ValueError(f"Unsupported delivered format for export parity: {format_name}")


def _check(name: str, ok: bool, detail: Any) -> dict[str, Any]:
    return {"name": name, "ok": bool(ok), "detail": detail}


def export_correctness(
    path: Path,
    format_name: str,
    settings: dict[str, Any],
    hdr: np.ndarray,
    sdr: np.ndarray | None,
    metadata: dict[str, Any],
    reference_white_nits: int,
) -> dict[str, Any]:
    """Assertion 1: decoded values and metadata versus declared settings."""
    checks: list[dict[str, Any]] = []
    checks.append(_check("file_exists", path.is_file(), {"path": str(path), "bytes": path.stat().st_size if path.is_file() else 0}))
    declared_sha = settings.get("sha256")
    actual_sha = hashlib.sha256(path.read_bytes()).hexdigest()
    if declared_sha:
        checks.append(_check("sha256_matches_declared", actual_sha == declared_sha, {"declared": declared_sha, "actual": actual_sha}))
    checks.append(_check("hdr_decoded", hdr is not None and hdr.size > 0, {"shape": list(hdr.shape), "dtype": str(hdr.dtype)}))
    checks.append(_check("sdr_base_present", sdr is not None and sdr.size > 0, {"shape": None if sdr is None else list(sdr.shape)}))
    checks.append(
        _check(
            "decoder_reference_white",
            float(metadata.get("decoder_reference_white_nits") or 0.0) == 203.0,
            {"decoder_reference_white_nits": metadata.get("decoder_reference_white_nits")},
        )
    )

    expected_width = settings.get("expected_width")
    expected_height = settings.get("expected_height")
    if expected_width and expected_height:
        checks.append(
            _check(
                "decoded_dimensions",
                int(hdr.shape[1]) == int(expected_width) and int(hdr.shape[0]) == int(expected_height),
                {"decoded": [int(hdr.shape[1]), int(hdr.shape[0])], "declared": [int(expected_width), int(expected_height)]},
            )
        )

    decoded_peak = peak_nits(hdr, reference_white_nits)
    ceiling = settings.get("ceiling_nits")
    ceiling_active = bool(settings.get("ceiling_active"))
    encode_scale = str(settings.get("encode_scale") or "delivery")
    ceiling_evidence: dict[str, Any] = {"active": bool(ceiling_active), "nits": ceiling, "encode_scale": encode_scale}
    if ceiling_active and ceiling:
        allowed = float(ceiling) * 1.01 + 1.0
        bt2020 = np.clip(acescg_to_linear_bt2020(np.asarray(hdr, dtype=np.float32)[..., :3]), 0.0, None)
        luma = 0.2627 * bt2020[..., 0] + 0.6780 * bt2020[..., 1] + 0.0593 * bt2020[..., 2]
        nits = scene_linear_to_nits(luma, reference_white_nits)
        exceed = nits > allowed
        exceed_count = int(np.count_nonzero(exceed))
        ceiling_evidence.update(
            {
                "peak_nits": round(decoded_peak, 3),
                "allowed_nits": round(allowed, 3),
                "p9999_nits": round(float(np.percentile(nits, 99.99)), 3) if nits.size else 0.0,
                "p999_nits": round(float(np.percentile(nits, 99.9)), 3) if nits.size else 0.0,
                "exceed_count": exceed_count,
                "exceed_fraction": round(exceed_count / max(1, int(nits.size)), 8),
            }
        )
        # A delivery-scale encode must respect the delivery spec. A proof-sized
        # encode can overshoot it at sub-Nyquist speculars, where the smoothed
        # gain map crosses a sharp base edge; that is recorded rather than
        # asserted, and the delivery-scale run carries the strict rule.
        if encode_scale == "delivery":
            ceiling_evidence["rule"] = "strict"
            ceiling_evidence["strict_ok"] = decoded_peak <= allowed
            checks.append(_check("peak_within_ceiling", decoded_peak <= allowed, dict(ceiling_evidence)))
        else:
            ceiling_evidence["rule"] = "recorded (proof-scale encode)"

    if format_name == "jpeg_ultrahdr":
        checks.append(_check("gain_map_container", is_ultrahdr_jpeg(path), {"is_ultrahdr_jpeg": True}))
        gain = metadata.get("gain_map_metadata") or {}
        capacity_max = float(gain.get("hdr_capacity_max") or 0.0)
        capacity_min = float(gain.get("hdr_capacity_min") or 0.0)
        checks.append(
            _check(
                "gain_map_capacity",
                capacity_max > 1.0 and capacity_min <= capacity_max,
                {"hdr_capacity_min": capacity_min, "hdr_capacity_max": capacity_max},
            )
        )
        expected_headroom = settings.get("expected_encoded_headroom")
        if expected_headroom is not None:
            decoded_headroom = math.log2(max(1.0, capacity_max))
            checks.append(
                _check(
                    "headroom_matches_declared",
                    abs(decoded_headroom - float(expected_headroom)) <= 1e-3,
                    {"decoded_stops": round(decoded_headroom, 6), "declared_stops": round(float(expected_headroom), 6)},
                )
            )
    else:
        info = metadata.get("avif_info") or {}
        gain = info.get("gain_map") or {}
        checks.append(
            _check(
                "gain_map_container",
                bool(info.get("gain_map_present")) and bool(gain),
                {"gain_map_present": info.get("gain_map_present"), "gain_map": gain},
            )
        )
        declared_bit_depth = settings.get("avif_bit_depth")
        if declared_bit_depth:
            checks.append(
                _check(
                    "primary_bit_depth",
                    int(info.get("bit_depth") or 0) == int(declared_bit_depth),
                    {"decoded": info.get("bit_depth"), "declared": declared_bit_depth},
                )
            )
        expected_headroom = settings.get("expected_encoded_headroom")
        if expected_headroom is not None and gain.get("alternate_headroom") is not None:
            checks.append(
                _check(
                    "headroom_matches_declared",
                    abs(float(gain["alternate_headroom"]) - float(expected_headroom)) <= 1e-3,
                    {"decoded_stops": float(gain["alternate_headroom"]), "declared_stops": float(expected_headroom)},
                )
            )

    if sdr is not None:
        finite = bool(np.isfinite(sdr).all())
        in_range = bool(np.all(sdr >= -1e-6) and np.all(sdr <= 1.0 + 1e-3))
        checks.append(_check("sdr_base_linear_range", finite and in_range, {"finite": finite, "max": float(np.max(sdr)) if finite else None}))

    return {
        "ok": all(entry["ok"] for entry in checks),
        "checks": checks,
        "ceiling": ceiling_evidence,
        "decodedPeakNits": round(decoded_peak, 3),
        "decodedHeadroomStops": metadata.get("hdr_capacity_stops"),
        "sha256": actual_sha,
    }


def build_taps(count: int, scale: float, support: float, source_size: int, lobes: int = 3):
    """Same tap construction as the JS Lanczos-3 resampler."""
    taps = []
    for index in range(count):
        center = (index + 0.5) * scale - 0.5
        first = math.ceil(center - support)
        last = math.floor(center + support)
        entries: list[tuple[int, float]] = []
        total = 0.0
        for sample in range(first, last + 1):
            x = abs((sample - center) / scale)
            if x == 0.0:
                weight = 1.0
            elif x >= lobes:
                continue
            else:
                pix = math.pi * x
                weight = (math.sin(pix) / pix) * (math.sin(pix / lobes) / (pix / lobes))
            if weight == 0.0:
                continue
            entries.append((min(source_size - 1, max(0, sample)), weight))
            total += weight
        norm = total or 1.0
        taps.append([(index, weight / norm) for index, weight in entries])
    return taps


def lanczos_resample(image: np.ndarray, target_width: int, target_height: int, lobes: int = 3) -> np.ndarray:
    """Separable Lanczos-3 resample of an HxWxC float image."""
    source_height, source_width = image.shape[:2]
    width = max(1, int(round(target_width)))
    height = max(1, int(round(target_height)))
    scale_x = source_width / width
    scale_y = source_height / height
    taps_x = build_taps(width, scale_x, lobes * scale_x, source_width, lobes)
    taps_y = build_taps(height, scale_y, lobes * scale_y, source_height, lobes)
    channels = image.shape[2]
    horizontal = np.zeros((source_height, width, channels), dtype=np.float64)
    for x, entries in enumerate(taps_x):
        accumulator = np.zeros((source_height, channels), dtype=np.float64)
        for sample, weight in entries:
            accumulator += image[:, sample, :] * weight
        horizontal[:, x, :] = accumulator
    result = np.zeros((height, width, channels), dtype=np.float64)
    for y, entries in enumerate(taps_y):
        accumulator = np.zeros((width, channels), dtype=np.float64)
        for sample, weight in entries:
            accumulator += horizontal[sample, :, :] * weight
        result[y, :, :] = accumulator
    return result


def compare_pair(a: np.ndarray, b: np.ndarray) -> dict[str, Any]:
    """Display-unit statistics over a pair of equal-size float images.

    The preview readback carries RGBA and the encoded delivered frame RGB; the
    comparison is over the three color channels of each, and the geometry must
    match.
    """
    rgb_a = np.asarray(a, dtype=np.float64)[..., :3]
    rgb_b = np.asarray(b, dtype=np.float64)[..., :3]
    if rgb_a.shape != rgb_b.shape:
        raise ValueError(f"images differ in size: {rgb_a.shape} vs {rgb_b.shape}")
    delta = np.abs(rgb_a - rgb_b) * ENCODING_LEVELS
    worst = np.max(delta, axis=-1)
    luma_weights = np.array([0.2126, 0.7152, 0.0722], dtype=np.float64)
    luma_a = rgb_a @ luma_weights * ENCODING_LEVELS
    luma_b = rgb_b @ luma_weights * ENCODING_LEVELS
    total = worst.size
    if total == 0:
        return {
            "comparedPixels": 0,
            "maxAbs": 0.0,
            "meanAbs": 0.0,
            "p95Abs": 0.0,
            "p99Abs": 0.0,
            "differingAbove1": 0,
            "differingAbove2": 0,
            "differingAbove1Fraction": 0.0,
            "meanLumaDelta": 0.0,
            "extendedRangePixels": 0,
        }
    return {
        "comparedPixels": int(total),
        "maxAbs": round(float(worst.max(initial=0.0)), 6),
        "meanAbs": round(float(worst.mean()), 6),
        "p95Abs": round(float(np.percentile(worst, 95)), 6),
        "p99Abs": round(float(np.percentile(worst, 99)), 6),
        "differingAbove1": int(np.count_nonzero(worst > 1.0)),
        "differingAbove2": int(np.count_nonzero(worst > 2.0)),
        "differingAbove1Fraction": round(float(np.count_nonzero(worst > 1.0) / max(1, total)), 8),
        "meanLumaDelta": round(float(np.mean(np.abs(luma_a - luma_b))), 6),
        "extendedRangePixels": int(np.count_nonzero(np.max(np.maximum(rgb_a, rgb_b), axis=-1) > 1.0)),
    }


def halve_image(image: np.ndarray) -> np.ndarray:
    if image.shape[0] < 2 or image.shape[1] < 2:
        return np.array(image, dtype=np.float64, copy=True)
    height = image.shape[0] // 2
    width = image.shape[1] // 2
    trimmed = image[: height * 2, : width * 2, :]
    return trimmed.reshape(height, 2, width, 2, image.shape[2]).mean(axis=(1, 3))


def luma_energy(image: np.ndarray) -> float:
    if image.shape[1] < 2:
        return 0.0
    luma = image[..., :3] @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float64) * ENCODING_LEVELS
    return float(np.mean(np.abs(np.diff(luma, axis=1))))


def band_metrics(delivered: np.ndarray, preview: np.ndarray, bands: list[dict[str, Any]], fixture_height: int) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for band in bands:
        y0 = int(round(float(band["y"]) * delivered.shape[0] / fixture_height))
        y1 = int(round((float(band["y"]) + float(band["height"])) * delivered.shape[0] / fixture_height))
        y0 = max(0, min(delivered.shape[0] - 1, y0))
        y1 = max(y0 + 1, min(delivered.shape[0], y1))
        left = delivered[y0:y1, :, :]
        right = preview[y0:y1, :, :]
        result[band["id"]] = {
            "y0": y0,
            "y1": y1,
            **compare_pair(left, right),
            "energy": {"delivered": round(luma_energy(left), 4), "preview": round(luma_energy(right), 4)},
        }
    return result


def _to_png_bytes(image: np.ndarray) -> bytes:
    from PIL import Image

    clipped = np.clip(np.asarray(image, dtype=np.float64)[..., :3], 0.0, 1.0)
    rgba = np.empty(clipped.shape[:2] + (4,), dtype=np.uint8)
    rgba[..., :3] = np.round(clipped * 255.0).astype(np.uint8)
    rgba[..., 3] = 255
    import io

    buffer = io.BytesIO()
    Image.fromarray(rgba).save(buffer, format="PNG")
    return buffer.getvalue()


def write_comparison_images(
    directory: Path,
    stem: str,
    delivered: np.ndarray,
    preview: np.ndarray,
) -> dict[str, str]:
    directory.mkdir(parents=True, exist_ok=True)
    delivered_path = directory / f"{stem}-delivered-at-box.png"
    preview_path = directory / f"{stem}-preview-at-box.png"
    difference_path = directory / f"{stem}-difference-at-box.png"
    delivered_path.write_bytes(_to_png_bytes(delivered))
    preview_path.write_bytes(_to_png_bytes(preview))
    delta = np.abs(delivered[..., :3] - preview[..., :3]) * 4.0
    difference_path.write_bytes(_to_png_bytes(delta))
    return {
        "deliveredAtBox": str(delivered_path),
        "previewAtBox": str(preview_path),
        "differenceAtBox": str(difference_path),
    }


def load_preview_frame(preview_json_path: Path, binary_path: Path) -> tuple[np.ndarray, dict[str, Any]]:
    payload = json.loads(preview_json_path.read_text(encoding="utf-8"))
    width = int(payload["target"]["width"])
    height = int(payload["target"]["height"])
    raw = np.fromfile(binary_path, dtype="<f4")
    expected = width * height * 4
    if raw.size != expected:
        raise ValueError(f"preview readback has {raw.size} float values; expected {expected}")
    return raw.reshape(height, width, 4).astype(np.float64), payload


def run(
    delivered_path: Path,
    format_name: str,
    preview_json_path: Path,
    preview_binary_path: Path,
    settings: dict[str, Any],
    review_directory: Path,
    output_path: Path,
) -> dict[str, Any]:
    preview_frame, preview_payload = load_preview_frame(preview_json_path, preview_binary_path)
    reference_white = int(preview_payload.get("referenceWhiteNits") or 203)
    hdr_surface = bool(preview_payload.get("hdrSurface"))
    box_width = int(preview_payload["box"]["width"])
    box_height = int(preview_payload["box"]["height"])
    bands = preview_payload.get("bands") or []
    fixture_height = int(preview_payload.get("fixture", {}).get("height") or preview_frame.shape[0])

    hdr, sdr, metadata = decode_delivered(delivered_path, format_name)
    hdr_project = decoder_scale_to_project(hdr, reference_white)
    correctness = export_correctness(
        delivered_path, format_name, settings, hdr_project, sdr, metadata, reference_white
    )

    encoding_name = (
        f"preview-presentation-p3-extended-{reference_white}"
        if hdr_surface
        else "preview-presentation-srgb-sdr-fallback"
    )
    delivered_encoded = presentation_encode(
        hdr_project, hdr_surface=hdr_surface, reference_white_nits=reference_white
    )
    delivered_box = lanczos_resample(delivered_encoded, box_width, box_height)
    preview_box = lanczos_resample(preview_frame, box_width, box_height)
    whole = compare_pair(delivered_box, preview_box)
    half = compare_pair(halve_image(delivered_box), halve_image(preview_box))
    per_band = band_metrics(delivered_box, preview_box, bands, fixture_height)

    stem = preview_payload.get("scenario") or "scenario"
    files = write_comparison_images(review_directory, stem, delivered_box, preview_box)

    result = {
        "scenario": stem,
        "format": format_name,
        "delivered": {
            "path": str(delivered_path),
            "bytes": delivered_path.stat().st_size,
            "sha256": correctness["sha256"],
            "width": int(hdr.shape[1]),
            "height": int(hdr.shape[0]),
        },
        "exportCorrectness": correctness,
        "encoding": {
            "name": encoding_name,
            "hdrSurface": hdr_surface,
            "referenceWhiteNits": reference_white,
            "canvasReferenceWhiteNits": CHROMIUM_CANVAS_REFERENCE_WHITE_NITS,
            "ceilingNits": preview_payload.get("ceilingNits"),
            "transform": "webgpu-preview.js displayHdr/displayEncode, shader matrix constants",
        },
        "precision": {
            "previewTargetFormat": preview_payload.get("target", {}).get("format"),
            "previewRealPrecision": bool(preview_payload.get("target", {}).get("realPrecision")),
            "decodeRealPrecision": "16f" if format_name == "jpeg_ultrahdr" else str(metadata.get("bit_depth")),
        },
        "comparison": {"whole": whole, "half": half, "bands": per_band},
        "files": files,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Export/reference parity file-side check")
    parser.add_argument("--delivered", required=True)
    parser.add_argument("--format", required=True, choices=["jpeg_ultrahdr", "avif_gain_map"])
    parser.add_argument("--preview-json", required=True)
    parser.add_argument("--preview-bin", required=True)
    parser.add_argument("--settings", required=True)
    parser.add_argument("--review-dir", required=True)
    parser.add_argument("--out", required=True)
    arguments = parser.parse_args()

    settings = json.loads(Path(arguments.settings).read_text(encoding="utf-8"))
    result = run(
        Path(arguments.delivered),
        arguments.format,
        Path(arguments.preview_json),
        Path(arguments.preview_bin),
        settings,
        Path(arguments.review_dir),
        Path(arguments.out),
    )
    correctness = result["exportCorrectness"]
    whole = result["comparison"]["whole"]
    print(
        f"{result['scenario']:<11} export {'OK' if correctness['ok'] else 'FAIL'}"
        f" | peak {correctness['decodedPeakNits']} nits"
        f" | {result['encoding']['name']}"
        f" | max {whole['maxAbs']:.1f} p99 {whole['p99Abs']:.1f} mean {whole['meanAbs']:.2f} levels"
    )
    return 0 if correctness["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
