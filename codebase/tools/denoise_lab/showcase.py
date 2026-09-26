"""Render side-by-side comparisons for review.

    .venv/Scripts/python.exe -m tools.denoise_lab.showcase

For each showcase case this writes, per method at its one-click default, the
denoised picture and its Show noise view (mid gray plus what was removed, the
same transform and gain the app uses), next to the clean and noisy inputs.
"""

from __future__ import annotations

import json

import numpy as np
from PIL import Image

from . import corpus, metrics
from .methods import AtrousWiener, CurrentHaar, NlmReference
from .run import SWEEPS

OUT = corpus.ROOT / "output" / "denoise_lab" / "showcase"
SHOWCASE = (("taipei-signs", "processed-strong"), ("beach-sky-tree", "raw-high-iso"), ("taipei-street", "processed-mild"))
# The real, un-synthesised crop from the Show noise mockup (DSC06898 at 1:1),
# at the mockup's +1.5 EV view and the shipping controls at Amount 100%.
REAL_CROP = ("Affinity_DSC06898_DisplayP3_Linear_32f.exr", 4080, 2400, 800, 1200)
REAL_EXPOSURE = 2 ** 1.5
REAL_CURRENT_KNOBS = {"amount": 1.0}
NOISE_VIEW_GAIN = 6.0
CROP = 320  # a 1:1 window from the middle of each case


def save(image: np.ndarray, path) -> None:
    Image.fromarray((np.clip(image, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8)).save(path, quality=95)


def window(values: np.ndarray) -> np.ndarray:
    y0 = (values.shape[0] - CROP) // 2
    x0 = (values.shape[1] - CROP) // 2
    return values[y0:y0 + CROP, x0:x0 + CROP]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = []
    wanted = set(SHOWCASE)
    for reference, case, clean, noisy in corpus.cases():
        if (reference, case.name) not in wanted:
            continue
        exposure = metrics.exposure_for(clean)
        stem = f"{reference}_{case.name}"
        encoded_noisy = metrics.encode(noisy, exposure)
        save(window(metrics.encode(clean, exposure)), OUT / f"{stem}_clean.jpg")
        save(window(encoded_noisy), OUT / f"{stem}_noisy.jpg")
        entry = {"reference": reference, "case": case.name, "methods": {}}
        for method in (CurrentHaar(), AtrousWiener(), NlmReference()):
            knobs = SWEEPS[method.name]["default"]
            state = method.prepare(noisy)
            denoised = method.apply(noisy, state, **knobs)
            encoded = metrics.encode(denoised, exposure)
            save(window(encoded), OUT / f"{stem}_{method.name}.jpg")
            save(window(0.5 + NOISE_VIEW_GAIN * (encoded_noisy - encoded)), OUT / f"{stem}_{method.name}_noise.jpg")
            entry["methods"][method.name] = metrics.score(clean, noisy, denoised, method.apply(clean, state, **knobs))
        manifest.append(entry)
        print(stem, {name: round(score["error"], 4) for name, score in entry["methods"].items()})
    real(manifest)
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1))


def real(manifest: list) -> None:
    """The mockup's real crop: no clean reference, so pictures only."""
    filename, y0, x0, height, width = REAL_CROP
    path = corpus.CACHE / "real-happy-sign.npy"
    if not path.exists():
        source = corpus._load_source(filename)
        np.save(path, source[y0:y0 + height, x0:x0 + width].astype(np.float32))
    noisy = np.load(path)
    encoded_noisy = metrics.encode(noisy, REAL_EXPOSURE)
    stem = "real-happy-sign"
    save(encoded_noisy, OUT / f"{stem}_noisy.jpg")
    for method, knobs in ((CurrentHaar(), REAL_CURRENT_KNOBS), (AtrousWiener(), SWEEPS["atrous-wiener"]["default"])):
        denoised = method.apply(noisy, method.prepare(noisy), **knobs)
        encoded = metrics.encode(denoised, REAL_EXPOSURE)
        save(encoded, OUT / f"{stem}_{method.name}.jpg")
        save(0.5 + NOISE_VIEW_GAIN * (encoded_noisy - encoded), OUT / f"{stem}_{method.name}_noise.jpg")
    manifest.append({"reference": stem, "case": "real", "methods": {}})
    print(stem, "written")


if __name__ == "__main__":
    main()
