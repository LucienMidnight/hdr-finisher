"""Compare finished Grade captures from the Fine Grain real-app driver."""

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


def compare_pan(root, photo):
    first, earlier = capture(root, f"{photo}-hdr-post-drag-gpu")
    second, later = capture(root, f"{photo}-hdr-pan-gpu")
    first_rect, second_rect = first["region"], second["region"]
    left = max(first_rect["x"], second_rect["x"])
    top = max(first_rect["y"], second_rect["y"])
    right = min(rect["x"] + rect["width"] for rect in (first_rect, second_rect))
    bottom = min(rect["y"] + rect["height"] for rect in (first_rect, second_rect))
    assert right > left and bottom > top, "The pan captures must overlap."

    def overlap(pixels, rect):
        return pixels[top - rect["y"]:bottom - rect["y"], left - rect["x"]:right - rect["x"]]

    return compare(overlap(earlier, first_rect), overlap(later, second_rect), True, first["format"])


def main(root, photos):
    failed = []
    for photo in photos:
        results = []
        for lane in ("hdr", "sdr"):
            for zoom in ("110%", "Fit"):
                stem = f"{photo}-{lane}-{zoom}"
                first, cpu = capture(root, f"{stem}-cpu")
                second, gpu = capture(root, f"{stem}-gpu")
                assert first == second, f"Capture geometry or format differs: {stem}, {first}, {second}"
                results.append((stem, compare(cpu, gpu, lane == "hdr", first["format"])))
        results.append((f"{photo}-hdr-pan-overlap", compare_pan(root, photo)))
        for case, values in results:
            passed = values["mean"] < 1 and values["p99"] < 3
            print(json.dumps({"case": case, **values, "passed": passed}), flush=True)
            if not passed:
                failed.append(case)
    assert not failed, f"Finished colour outside tolerance: {', '.join(failed)}"


if __name__ == "__main__":
    main(Path(sys.argv[1]), sys.argv[2:] or ["IMG_0790.CR2", "_DSC7970.ARW"])
