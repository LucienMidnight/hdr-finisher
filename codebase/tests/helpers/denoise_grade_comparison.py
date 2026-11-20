"""Compare finished Grade captures from the Grain real-app driver."""

import json
from pathlib import Path
import sys

import colour
import numpy as np


def capture(root, stem):
    metadata = json.loads((root / f"{stem}.json").read_text())
    dtype = "<f2" if metadata["format"] == "rgba16float" else "u1"
    dimensions = metadata["height"], metadata["width"], 4
    pixels = np.memmap(root / f"{stem}.rgba", shape=dimensions, dtype=dtype, mode="r")
    return metadata, pixels


def convert(pixels, hdr, format_name):
    rgb = pixels[..., :3].astype(np.float32)
    if hdr:
        linear = np.sign(rgb) * colour.models.eotf_sRGB(np.abs(rgb))
        nits = colour.RGB_to_RGB(linear, "Display P3", "ITU-R BT.2020") * 203
        return colour.RGB_to_ICtCp(np.maximum(nits, 0), method="ITU-R BT.2100-2 PQ")
    if format_name.startswith("bgra"):
        rgb = rgb[..., ::-1]
    linear = colour.models.eotf_sRGB(rgb / 255)
    return colour.XYZ_to_Lab(colour.RGB_to_XYZ(linear, "sRGB"))


def compare(first, second, hdr, format_name):
    metric = colour.difference.delta_E_ITP if hdr else colour.difference.delta_E_CIE2000
    result = np.empty(first.shape[:2], dtype=np.float64)
    for row in range(0, first.shape[0], 96):
        pair = [convert(pixels[row:row + 96], hdr, format_name) for pixels in (first, second)]
        result[row:row + 96] = metric(*pair)
    return {"mean": float(result.mean()), "p99": float(np.quantile(result, .99)),
            "width": first.shape[1], "height": first.shape[0]}


def shared_pixels(first, earlier, second, later):
    assert first["format"] == second["format"]
    first_rect, second_rect = first["region"], second["region"]
    if first_rect is None or second_rect is None:
        assert first == second, "Full-frame captures must have identical geometry."
        return earlier, later
    assert all(first_rect[key] == second_rect[key] for key in ("frameWidth", "frameHeight"))
    left = max(first_rect["x"], second_rect["x"])
    top = max(first_rect["y"], second_rect["y"])
    right = min(rect["x"] + rect["width"] for rect in (first_rect, second_rect))
    bottom = min(rect["y"] + rect["height"] for rect in (first_rect, second_rect))
    assert right > left and bottom > top, "Regional captures must overlap."

    def overlap(pixels, rect):
        return pixels[top - rect["y"]:bottom - rect["y"], left - rect["x"]:right - rect["x"]]

    return overlap(earlier, first_rect), overlap(later, second_rect)


def compare_pan(root, photo, pan):
    first, earlier = capture(root, f"{photo}-hdr-post-drag-gpu")
    second, later = capture(root, f"{photo}-hdr-{pan}-gpu")
    earlier, later = shared_pixels(first, earlier, second, later)
    assert np.array_equal(earlier, later), "Overlapping HDR pan pixels changed."
    return compare(earlier, later, True, first["format"])


def compare_joins(first, cpu, second, gpu, native, hdr):
    """Check two pixels on each side of the GPU tile and Fit strip joins."""
    tile = 512
    if second["region"]:
        a, b = first["region"], second["region"]
        x, y = max(a["x"], b["x"]), max(a["y"], b["y"])
        columns = [position - x for position in range(tile, native["frameWidth"], tile)]
        rows = [position - y for position in range(tile, native["frameHeight"], tile)]
    else:
        ratio_x = native["frameWidth"] / second["width"]
        ratio_y = native["frameHeight"] / second["height"]
        columns = [round(position / ratio_x) for position in range(tile, native["frameWidth"], tile)]
        rows = range(max(1, int(tile / ratio_y)), second["height"], max(1, int(tile / ratio_y)))

    def strips(pixels):
        return np.concatenate(
            [pixels[:, i - 2:i + 2].reshape(-1, 4) for i in columns if 2 <= i <= pixels.shape[1] - 2]
            + [pixels[i - 2:i + 2].reshape(-1, 4) for i in rows if 2 <= i <= pixels.shape[0] - 2]
        )[None, ...]

    return compare(strips(cpu), strips(gpu), hdr, first["format"])


def check_ceiling(root, photos, target=600):
    failed = []
    for photo in photos:
        for zoom in ("110%", "Fit"):
            case = f"{photo}-hdr-{zoom}-ceiling"
            metadata, pixels = capture(root, case)
            assert metadata["format"] == "rgba16float"
            peak = 0.0
            count = 0
            for row in range(0, metadata["height"], 96):
                band = pixels[row:row + 96]
                assert np.all(band[..., 3] == 1), f"Missing finished pixels: {case}"
                rgb = band[..., :3].astype(np.uint32)
                nits = (rgb[..., 0] | (rgb[..., 1] << 11) | (rgb[..., 2] << 22)).view(np.float32)
                assert np.isfinite(nits).all(), f"Nonfinite finished pixels: {case}"
                peak = max(peak, float(nits.max()))
                count += int(np.count_nonzero(nits > target))
            print(json.dumps({"case": case, "target_nits": target, "peak_nits": peak,
                              "pixels": metadata["width"] * metadata["height"], "above_target": count}), flush=True)
            if count or peak < target * .99:
                failed.append(case)
    assert not failed, f"Ceiling failed or was not reached: {', '.join(failed)}"


def main(root, photos, check_joins=False):
    failed = []
    for photo in photos:
        results = []
        native = capture(root, f"{photo}-hdr-110%-gpu")[0]["region"] if check_joins else None
        for lane in ("hdr", "sdr"):
            for zoom in ("110%", "Fit"):
                stem = f"{photo}-{lane}-{zoom}"
                first, cpu = capture(root, f"{stem}-cpu")
                second, gpu = capture(root, f"{stem}-gpu")
                cpu, gpu = shared_pixels(first, cpu, second, gpu)
                results.append((stem, compare(cpu, gpu, lane == "hdr", first["format"])))
                if check_joins:
                    results.append((f"{stem}-tile-joins", compare_joins(first, cpu, second, gpu, native, lane == "hdr")))
                if (root / f"{stem}-fallback.json").exists():
                    meta, fallback = capture(root, f"{stem}-fallback")
                    reference_meta, reference = capture(root, f"{stem}-cpu")
                    reference, fallback = shared_pixels(reference_meta, reference, meta, fallback)
                    identical = np.array_equal(reference, fallback)
                    print(json.dumps({"case": f"{stem}-fallback", "cpu_pixels_identical": identical}), flush=True)
                    if not identical:
                        failed.append(f"{stem}-fallback")
        results.append((f"{photo}-hdr-pan-overlap", compare_pan(root, photo, "pan")))
        if (root / f"{photo}-hdr-pan-wide-gpu.json").exists():
            results.append((f"{photo}-hdr-pan-wide-overlap", compare_pan(root, photo, "pan-wide")))
        for case, values in results:
            passed = values["mean"] < 1 and values["p99"] < 3
            print(json.dumps({"case": case, **values, "passed": passed}), flush=True)
            if not passed:
                failed.append(case)
    assert not failed, f"Finished colour or fallback comparison failed: {', '.join(failed)}"


if __name__ == "__main__":
    arguments = sys.argv[2:]
    root = Path(sys.argv[1])
    photos = [arg for arg in arguments if not arg.startswith("--")] or ["IMG_0790.CR2", "_DSC7970.ARW"]
    if "--ceiling" in arguments:
        check_ceiling(root, photos)
    else:
        main(root, photos, check_joins="--seams" in arguments)
