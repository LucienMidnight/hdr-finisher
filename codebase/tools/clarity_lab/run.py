"""Before/after pictures and numbers for the clarity radius review.

    .venv/Scripts/python.exe -m tools.clarity_lab.run

For each radius, clarity is applied at +100 with each base blur. Every result
is compared with clarity built on a true Gaussian: the "error" views show that
difference at a fixed gain around mid gray, the same way Show noise shows what
denoise removed. A line profile across one hard edge is written for the chart.
"""

from __future__ import annotations

import json

import numpy as np
from PIL import Image

from . import methods as m
from .source import OUT, load

RADII = (0.75, 3.0)
AMOUNT = 100.0
ERROR_GAIN = 12.0  # mid gray +/- 1 at 1/12 EV
# (name, y0, x0, size) in the half-size frame; chosen for hard edges on sky.
CROPS = (("roof-sky", 1250, 750, 640), ("mirror-sky", 900, 1075, 640), ("hill-sky", 1650, 0, 640))
PROFILE = ("hill-sky", 160)  # crop, column within the crop (a vertical line down through the hill)
METHODS = ("gpu_current", "cpu_current", "pyramid")


def encode(image: np.ndarray, exposure: float) -> np.ndarray:
    exposed = np.maximum(image * exposure, 0.0)
    return (exposed / (1.0 + exposed)) ** (1.0 / 2.2)


def save(values: np.ndarray, path) -> None:
    Image.fromarray((np.clip(values, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8)).save(path, quality=94)


def main() -> None:
    image = load()
    OUT.mkdir(parents=True, exist_ok=True)
    linear = m.linear_luma(image)
    log = np.log2(linear)
    exposure = 0.18 / float(np.median(linear))
    manifest = {"amount": AMOUNT, "error_gain": ERROR_GAIN, "shape": list(image.shape[:2]), "radii": {}}
    for name, y0, x0, size in CROPS:
        save(encode(image[y0:y0 + size, x0:x0 + size], exposure), OUT / f"{name}_original.jpg")
    for radius in RADII:
        sigma = m.clarity_sigma(image.shape[:2], radius)
        truth_base = m.true_gaussian(log, sigma)
        truth = m.clarity(image, log, truth_base, AMOUNT)
        truth_log = np.log2(np.maximum(truth @ m.LUMA, m.FLOOR))
        bases = {
            "gpu_current": m.gpu_current(linear, sigma),
            "cpu_current": m.cpu_current(log, sigma),
            "pyramid": m.shipped(log, sigma),
        }
        entry = {"sigma_px": sigma, "sigma_at_24mp": 7211.1 * radius / 100, "methods": {}}
        tag = f"r{radius:.2f}".replace(".", "p")
        for crop, y0, x0, size in CROPS:
            window = (slice(y0, y0 + size), slice(x0, x0 + size))
            save(encode(truth[window], exposure), OUT / f"{crop}_{tag}_true.jpg")
        for method, base in bases.items():
            result = m.clarity(image, log, base, AMOUNT)
            error = np.log2(np.maximum(result @ m.LUMA, m.FLOOR)) - truth_log
            interior = error[64:-64, 64:-64]
            entry["methods"][method] = {
                "base_max_ev": float(np.abs(base - truth_base)[64:-64, 64:-64].max()),
                "result_rms_ev": float(np.sqrt(np.mean(interior ** 2))),
                "result_p999_ev": float(np.percentile(np.abs(interior), 99.9)),
            }
            for crop, y0, x0, size in CROPS:
                window = (slice(y0, y0 + size), slice(x0, x0 + size))
                save(encode(result[window], exposure), OUT / f"{crop}_{tag}_{method}.jpg")
                save(0.5 + ERROR_GAIN * error[window], OUT / f"{crop}_{tag}_{method}_error.jpg")
        crop, column = PROFILE
        _, y0, x0, size = next(c for c in CROPS if c[0] == crop)
        line = (slice(y0, y0 + size), x0 + column)
        entry["profile"] = {
            "log_luma": log[line].round(4).tolist(),
            "true": truth_base[line].round(4).tolist(),
            **{method: bases[method][line].round(4).tolist() for method in METHODS},
        }
        manifest["radii"][str(radius)] = entry
        print(radius, round(sigma, 1), {k: {kk: round(vv, 4) for kk, vv in v.items()} for k, v in entry["methods"].items()})
    (OUT / "manifest.json").write_text(json.dumps(manifest))


if __name__ == "__main__":
    main()
