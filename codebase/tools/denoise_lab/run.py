"""Run the denoise benchmark.

    .venv/Scripts/python.exe -m tools.denoise_lab.run [--quick] [--methods current,vst-atrous]

For every corpus case and every method this sweeps the method's knobs and
reports two numbers per method:

``default``  the one fixed setting a one-click user would get, applied to
             every case unchanged -- what "works by default" means;
``best``     the best setting for that case, chosen with the clean reference
             in hand -- the ceiling a careful user could reach.

Results land in output/denoise_lab/results.json and a summary table on stdout.
"""

from __future__ import annotations

import argparse
import itertools
import json
import time

import numpy as np

from . import corpus, metrics
from .methods import Adaptive, AtrousWiener, CurrentHaar, NlmReference

SWEEPS = {
    "current": {
        "default": {},
        "grid": {
            "levels": [2, 3],
            "relative_sigma": [0.05, 0.1, 0.2, 0.4],
            "amount": [0.5, 1.0],
            "luminance": [1.0],
            "color": [1.0],
        },
    },
    "atrous-wiener": {
        "default": {"strength": 1.0, "chroma": 1.0},
        "grid": {"strength": [0.4, 0.6, 0.8, 1.0, 1.3], "chroma": [1.0, 1.5, 2.5]},
    },
    "adaptive": {
        "default": {"strength": 1.0, "chroma": 1.0},
        "grid": {"strength": [0.6, 0.8, 1.0, 1.3], "chroma": [1.0, 1.5]},
    },
    "nlm": {
        "default": {"strength": 1.0},
        "grid": {"strength": [0.6, 1.0, 1.5, 2.2]},
    },
}

METHODS = {cls.name: cls for cls in (CurrentHaar, AtrousWiener, Adaptive, NlmReference)}


def grid(spec: dict):
    keys = list(spec)
    for values in itertools.product(*(spec[key] for key in keys)):
        yield dict(zip(keys, values))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--methods", default=",".join(METHODS))
    parser.add_argument("--quick", action="store_true", help="defaults only, no sweep")
    args = parser.parse_args()
    names = args.methods.split(",")
    rows = []
    for reference, case, clean, noisy in corpus.cases():
        for name in names:
            method = METHODS[name]()
            started = time.perf_counter()
            state = method.prepare(noisy)
            settings = [("default", SWEEPS[name]["default"])]
            if not args.quick:
                settings += [("sweep", knobs) for knobs in grid(SWEEPS[name]["grid"])]
            scored = []
            for label, knobs in settings:
                denoised = method.apply(noisy, state, **knobs)
                clean_denoised = method.apply(clean, state, **knobs)
                scored.append((label, knobs, metrics.score(clean, noisy, denoised, clean_denoised)))
            default = scored[0]
            best = min(scored, key=lambda item: item[2]["error"])
            rows.append({
                "reference": reference, "case": case.name, "method": name,
                "default": {"knobs": default[1], **default[2]},
                "best": {"knobs": best[1], **best[2]},
                "seconds": time.perf_counter() - started,
            })
            print(f"{reference:15s} {case.name:17s} {name:11s} "
                  f"noisy {default[2]['noisy_error']:.4f}  default {default[2]['error']:.4f} "
                  f"(detail {default[2]['detail_loss']:.4f})  best {best[2]['error']:.4f} "
                  f"(detail {best[2]['detail_loss']:.4f}) {best[1]}", flush=True)
    out = corpus.ROOT / "output" / "denoise_lab" / "results.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(rows, indent=1))
    summarise(rows)


def summarise(rows: list[dict]) -> None:
    print("\nMean over the corpus (display-encoded RMS; lower is better)")
    print(f"{'method':11s} {'setting':8s} {'error':>7s} {'shadows':>8s} {'mid':>7s} {'high':>7s} "
          f"{'detail':>7s} {'lattice':>8s} {'removed':>8s}")
    for name in dict.fromkeys(row["method"] for row in rows):
        for setting in ("default", "best"):
            chosen = [row[setting] for row in rows if row["method"] == name]
            mean = lambda key: float(np.nanmean([item[key] for item in chosen]))  # noqa: E731
            removed = 1.0 - mean("error") / mean("noisy_error")
            print(f"{name:11s} {setting:8s} {mean('error'):7.4f} {mean('error_shadows'):8.4f} "
                  f"{mean('error_midtones'):7.4f} {mean('error_highlights'):7.4f} "
                  f"{mean('detail_loss'):7.4f} {mean('lattice'):8.4f} {removed:8.1%}")


if __name__ == "__main__":
    main()
