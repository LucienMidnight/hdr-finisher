"""Renderer gates and report-only codec fidelity, using actual export inputs."""
from dataclasses import asdict
from hashlib import sha256
import json
import os
from pathlib import Path
import sys

import numpy as np
import colour

from hdr_finisher.color import acescg_to_linear_srgb, acescg_to_linear_bt2020
from hdr_finisher.color_context import scene_linear_to_nits
from hdr_finisher.delivery_colour import compare_finished_pixels
from hdr_finisher.hdr_ceiling import channel_nits
from hdr_finisher.loader import load_image


def finished_capture(path):
    root = Path(os.environ["HDR_FINISHER_TEST_CAPTURE_DIR"])
    path = Path(path).resolve()
    folder = root / sha256(str(path).encode()).hexdigest()
    digest = sha256(path.read_bytes()).hexdigest()
    if not folder.exists():
        matches = [item.parent for item in root.glob("*/metadata.json")
                   if json.loads(item.read_text())["sha256"] == digest]
        if not matches:
            raise AssertionError(f"Missing pre-encode capture for {path}; use run-in-electron.js")
        folder = matches[-1]
    metadata = json.loads((folder / "metadata.json").read_text())
    assert metadata["sha256"] == digest, f"Stale capture for {path}"
    return folder, metadata


def metric(first, second, lane, white=203):
    value = compare_finished_pixels(first, second, lane, reference_white_nits=white)
    return dict(asdict(value), passed=value.passed)


def percentile99(first, second, lane, white):
    errors = np.empty(first.shape[:2], np.float64)
    for row in range(0, first.shape[0], 128):
        pair = [image[row:row + 128, :, :3] for image in (first, second)]
        if lane == "sdr":
            converted = [colour.XYZ_to_Lab(colour.RGB_to_XYZ(np.clip(image, 0, 1),
                         colour.RGB_COLOURSPACES["sRGB"])) for image in pair]
            errors[row:row + 128] = colour.difference.delta_E_CIE2000(*converted)
        else:
            converted = [colour.RGB_to_ICtCp(np.maximum(scene_linear_to_nits(
                         acescg_to_linear_bt2020(image), white), 0),
                         method="ITU-R BT.2100-2 PQ") for image in pair]
            errors[row:row + 128] = colour.difference.delta_E_ITP(*converted)
    return float(np.percentile(errors, 99))


def decoded_lanes(path, format_name, white):
    loaded = load_image(Path(path), analyze_hdr=False)
    if format_name.startswith("sdr_"):
        return {"sdr": acescg_to_linear_srgb(loaded[0])}
    result = {"hdr": loaded[0] * np.float32(203 / white)}
    if loaded[4] is not None:
        result["sdr"] = loaded[4]
    return result


def streamed_jxl_fidelity(path, finished, lane, white):
    """All-pixel own-source gate with scanline decode and an exact upper tail."""
    from hdr_finisher.jpegxl_stream import decode
    from hdr_finisher.jpegxl import inspect_jpegxl
    from hdr_finisher.color import normalize_to_acescg
    info = inspect_jpegxl(Path(path))
    bits = info["bits_per_sample"]
    if info.get("exponent_bits_per_sample"):
        return metric(finished, decoded_lanes(path, "jpegxl_hdr", white)[lane], lane, white)
    total = finished.shape[0] * finished.shape[1]
    index = .999 * (total - 1)
    retain = total - int(np.floor(index)) + 2
    tail = np.empty(0, np.float64)
    summed, observed = 0., 0
    def visit(x, y, pixels):
        nonlocal tail, summed, observed
        actual = pixels[None].astype(np.float32)
        actual *= np.float32(1.0 / ((1 << bits) - 1))
        expected = finished[y:y + 1, x:x + len(pixels)]
        if lane == "hdr":
            actual = normalize_to_acescg(actual, "BT.2020", "PQ") * np.float32(203 / white)
            converted = [colour.RGB_to_ICtCp(np.maximum(scene_linear_to_nits(
                acescg_to_linear_bt2020(v), white), 0), method="ITU-R BT.2100-2 PQ")
                for v in (expected, actual)]
            errors = colour.difference.delta_E_ITP(*converted).ravel()
        else:
            actual = acescg_to_linear_srgb(normalize_to_acescg(actual, "sRGB", "sRGB"))
            converted = [colour.XYZ_to_Lab(colour.RGB_to_XYZ(np.clip(v, 0, 1),
                colour.RGB_COLOURSPACES["sRGB"])) for v in (expected, actual)]
            errors = colour.difference.delta_E_CIE2000(*converted).ravel()
        assert np.isfinite(errors).all()
        summed += float(errors.sum())
        observed += errors.size
        tail = np.concatenate((tail, errors))
        if tail.size > retain * 2:
            tail = np.partition(tail, tail.size - retain)[-retain:]
    decode(Path(path).read_bytes(), visit, expected_shape=finished.shape[:2], bits=bits)
    assert observed == total
    tail.sort()
    lower, upper = int(np.floor(index)), int(np.ceil(index))
    start = total - tail.size
    p999 = float(tail[lower - start] + (tail[upper - start] - tail[lower - start]) * (index - lower))
    mean = summed / total
    from hdr_finisher.delivery_colour import DELIVERY_MEAN_LIMIT, DELIVERY_P999_LIMIT
    return dict(metric="Delta E ITP" if lane == "hdr" else "Delta E 2000",
                mean=mean, p999=p999, passed=mean < DELIVERY_MEAN_LIMIT and p999 <= DELIVERY_P999_LIMIT)


def own_fidelity(path):
    folder, metadata = finished_capture(path)
    white = metadata["reference_white_nits"]
    high = metadata.get("jpegxl_high_fidelity", False) and metadata["format"] in {"jpegxl_hdr", "sdr_jpegxl"}
    streaming = metadata["format"] in {"jpegxl_hdr", "sdr_jpegxl"}
    if streaming:
        lane = "sdr" if metadata["format"] == "sdr_jpegxl" else "hdr"
        decoded = {lane: None}
    else:
        decoded = decoded_lanes(path, metadata["format"], white)
    fidelity = {}
    for lane, pixels in decoded.items():
        finished = np.load(folder / f"{lane}.npy", mmap_mode="r")
        fidelity[lane] = streamed_jxl_fidelity(path, finished, lane, white) if streaming else metric(finished, pixels, lane, white)
        if lane == "hdr" and metadata["ceiling_nits"] is not None:
            peak = max(float(channel_nits(finished[row:row + 128], white).max())
                       for row in range(0, finished.shape[0], 128))
            assert peak <= metadata["ceiling_nits"], ("Exact finished ceiling", peak, metadata)
    required = metadata.get("jpegxl_high_fidelity", False) and metadata["format"] in {"jpegxl_hdr", "sdr_jpegxl"}
    if required:
        assert all(value["passed"] for value in fidelity.values()), ("High-fidelity JPEG XL own-source fidelity", fidelity)
    return {"format": metadata["format"], "renderer": metadata["renderer"], "required": required,
            "target": "mean < 1.0, P99.9 <= 3.0; " + ("required" if required else "report only"), "lanes": fidelity}


def report_summary(result):
    def lanes(values):
        return "; ".join(f"{lane.upper()} {value['mean']:.4f} / {value['p999']:.4f} "
                         f"({'within target' if value['passed'] else 'outside target'})"
                         for lane, value in values.items())
    passed = all(value["passed"] for value in result["renderer_agreement"].values())
    rows = [f"Finished renderer agreement — {'PASS' if passed else 'FAIL'}: {lanes(result['renderer_agreement'])}"]
    for value in result["encoding_fidelity"].values():
        verdict = "PASS" if value.get("required") else "REPORT ONLY"
        rows.append(f"Encoding fidelity — {verdict} — {value['format']} / {value['renderer']}: {lanes(value['lanes'])}")
    rows.append(f"Decoded file pair — DIAGNOSTIC ONLY: {lanes(result['decoded_pair_diagnostic'])}")
    return "\n".join(rows)


def compare_delivery(first_path, second_path):
    first_folder, first = finished_capture(first_path)
    second_folder, second = finished_capture(second_path)
    assert first["format"] == second["format"]
    assert first["reference_white_nits"] == second["reference_white_nits"]
    white = first["reference_white_nits"]
    result = {"renderer_agreement": {}, "encoding_fidelity": {}, "decoded_pair_diagnostic": {}}
    for lane in ("hdr", "sdr"):
        if not (first_folder / f"{lane}.npy").exists():
            continue
        actual = np.load(first_folder / f"{lane}.npy", mmap_mode="r")
        expected = np.load(second_folder / f"{lane}.npy", mmap_mode="r")
        result["renderer_agreement"][lane] = metric(actual, expected, lane, white)
        result["renderer_agreement"][lane]["p99"] = percentile99(actual, expected, lane, white)
    for label, path in (("first", first_path), ("second", second_path)):
        result["encoding_fidelity"][label] = own_fidelity(path)
    decoded_first = decoded_lanes(first_path, first["format"], white)
    decoded_second = decoded_lanes(second_path, second["format"], white)
    for lane in decoded_first:
        result["decoded_pair_diagnostic"][lane] = metric(decoded_first[lane], decoded_second[lane], lane, white)
    print(report_summary(result), file=sys.stderr)
    return result
