"""Fit one compact, energy-conserving RGB PSF per filter to the original Mist.

Run with the project venv. Prints the fitted coefficients and worst old-to-new
point-spread differences in percentage points of emitted light. Strength changes
the sharp/scatter mix, not the radii. This models a centered impulse on each
convolution grid, not the preview's source reduction, display, or tile edges.
"""
from functools import lru_cache
import json
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
NAMES = ("glimmerglass", "black_pro_mist", "pro_mist", "cinebloom")
GAINS = (.65, .75, 1.05, 1.)
STRENGTH = (.125, .25, .5, 1., 2.)
SCATTER = (.10, .20, .35, .55, .75)
RADII = np.array([0, 1, 1.42, 2, 2.83, 4, 5.66, 8, 11.32, 16, 22.63, 32,
                  45.26, 64, 90.51, 128, 181.1, 256, 362.04])
# width, height, native width, grid, gate width/height (mm)
CANON_FIT = (1283, 856, 6024, 1, 36, 24)
SONY_FIT = (1283, 855, 8660, 1, 36, 24)
SONY_GPU = (8660, 5773, 8660, 4, 36, 24)
SONY_CPU = (8660, 5773, 8660, 1, 36, 24)
TRAIN = [(*raster, size) for raster in (CANON_FIT, SONY_FIT, SONY_GPU, SONY_CPU)
         for size in (.25, .5, 1., 2., 4.)]
HELD = [
    (1283, 856, 6024, 1, 24.89, 18.66, .75),
    (1283, 855, 8660, 1, 12.52, 7.41, 1.5),
    (6024, 4020, 6024, 4, 36, 24, 3.),
    (1520, 1013, 2400, 1, 5.79, 4.01, .25),
    (2400, 1600, 2400, 2, 5.79, 4.01, 4.),
]


@lru_cache(maxsize=None)
def radius_ids(reach):
    offsets = np.arange(-reach, reach + 1)
    distances = np.hypot(offsets[:, None], offsets[None, :])
    return np.searchsorted(RADII, distances, side="left").ravel()


def cdf(sigma, cap):
    reach = min(int(3 * sigma + .5), cap)
    axis = np.exp(-.5 * (np.arange(-reach, reach + 1) / max(sigma, 1e-6)) ** 2)
    axis /= axis.sum()
    rings = np.bincount(radius_ids(reach), weights=np.outer(axis, axis).ravel(), minlength=len(RADII))
    return np.cumsum(rings)[:len(RADII)]


def conditions(raster):
    w, h, source_w, grid, gate_w, gate_h, size = raster
    return max(w / gate_w, h / gate_h) * size / (1000 * grid), int(256 * w / (source_w * grid))


def design(rasters, sigmas):
    return np.vstack([np.column_stack([cdf(sigma * scale, cap) for sigma in sigmas])
                      for scale, cap in map(conditions, rasters)])


def fit(design_matrix, target, indices):
    basis = design_matrix[:, indices]
    weights = np.zeros((len(indices), 3))
    for c in range(3):
        active = list(range(len(indices)))
        while True:
            values = np.linalg.lstsq(basis[:, active], target[:, c], rcond=None)[0]
            if min(values) >= 0:
                weights[active, c] = values / values.sum()
                break
            active.pop(int(np.argmin(values)))
    return np.mean((basis @ weights - target) ** 2), weights


def compact(sigmas, old_weights, lobe_count=8):
    candidates = np.unique(np.r_[0, sigmas, np.geomspace(min(sigmas) * .8, max(sigmas), 36)])
    a = design(TRAIN, candidates)
    target = design(TRAIN, sigmas) @ old_weights
    def error(inds):
        return fit(a, target, inds)[0]
    indices = []
    for _ in range(lobe_count):
        indices = min((indices + [j] for j in range(len(candidates)) if j not in indices), key=error)
    for _ in range(3):
        for i in range(lobe_count):
            indices = min((indices[:i] + [j] + indices[i + 1:] for j in range(len(candidates))
                           if j not in indices or j == indices[i]), key=error)
    indices.sort()
    return candidates[indices], fit(a, target, indices)[1]


def report(name, gain, sigmas, old_weights, compact_sigmas, compact_weights):
    def max_error(rasters):
        old = design(rasters, sigmas) @ old_weights
        new = design(rasters, compact_sigmas) @ compact_weights
        return 100 * np.max(np.abs(new - old))
    train = max_error(TRAIN)
    held = max_error(HELD)
    print(f"{name}, pure-scatter worst: fit {train:.3f} pp / held out {held:.3f} pp")
    for strength, fraction in zip(STRENGTH, SCATTER):
        print(f"  {strength:g}: old 0.000 / new {max(train, held) * gain * fraction:.3f} pp")


def main():
    original = json.loads((HERE / "sol-lens-components.json").read_text(encoding="utf-8"))
    fitted = {}
    for name, gain, parts in zip(NAMES, GAINS, original[1:]):
        sigmas = np.array([r for r, _ in parts])
        weights = np.array([w for _, w in parts])
        new_sigmas, new_weights = compact(sigmas, weights)
        fitted[name] = [[float(s), w.tolist()] for s, w in zip(new_sigmas, new_weights)]
        report(name, gain, sigmas, weights, new_sigmas, new_weights)
    print(json.dumps(fitted, indent=2))


if __name__ == "__main__":
    main()
