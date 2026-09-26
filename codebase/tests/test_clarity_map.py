"""Clarity's blurred base: a smooth pyramid, not a staircase.

The WebGPU preview used to sample Clarity's blur with 17 taps spaced a quarter
sigma apart. On a hard edge that draws the blurred base as flat steps, which
Clarity then shows as contour bands beside the edge. `clarity_base` is the
export's version of the brightness map the preview now shares with it.
"""

from __future__ import annotations

import json
import math
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest

from backend.hdr_finisher.detail import CLARITY_MAP_MIN_TEXELS, clarity_base, clarity_map_plan

FRONTEND = Path(__file__).resolve().parents[1] / "frontend"
# Clarity's sigma on a 24 MP frame at the slider's minimum, default and maximum.
SIGMAS = (14.4, 54.1, 216.3)
STEP_EV = 4.0


def _step(width: int = 2600) -> tuple[np.ndarray, int]:
    edge = width // 2
    row = np.where(np.arange(width) < edge, -3.0, -3.0 + STEP_EV).astype(np.float32)
    return np.repeat(row[None, :], 8, axis=0), edge


def _dense_gaussian(row: np.ndarray, sigma: float) -> np.ndarray:
    radius = int(math.ceil(4 * sigma))
    x = np.arange(-radius, radius + 1, dtype=np.float64)
    kernel = np.exp(-0.5 * (x / sigma) ** 2)
    kernel /= kernel.sum()
    padded = np.pad(row.astype(np.float64), radius, mode="edge")
    return np.convolve(padded, kernel, mode="valid")


def _sparse_taps(row: np.ndarray, sigma: float) -> np.ndarray:
    """The old preview's horizontal pass: 17 bilinear taps over +/-2 sigma."""
    size = row.size
    total = np.zeros(size)
    weights = 0.0
    for index in range(-8, 9):
        distance = index / 4.0
        weight = math.exp(-0.5 * distance * distance)
        position = np.clip(np.arange(size) + distance * sigma, 0, size - 1)
        low = np.floor(position).astype(int)
        high = np.minimum(low + 1, size - 1)
        fraction = position - low
        total += (row[low] * (1 - fraction) + row[high] * fraction) * weight
        weights += weight
    return total / weights


def _flattest_step(blurred: np.ndarray, reference: np.ndarray, edge: int, sigma: float) -> float:
    """The smallest rise per pixel across the edge's core, relative to a true
    Gaussian's rise at the same pixel. A staircase has flat treads: zero."""
    core = slice(edge - int(sigma), edge + int(sigma))
    return float(np.min(np.diff(blurred)[core] / np.diff(reference)[core]))


@pytest.mark.parametrize("sigma", SIGMAS)
def test_clarity_base_is_a_smooth_gaussian_without_steps(sigma: float) -> None:
    image, edge = _step()
    reference = _dense_gaussian(image[4], sigma)
    base = clarity_base(image, sigma)[4]
    interior = slice(int(5 * sigma), image.shape[1] - int(5 * sigma))
    # Within 1% of the edge's height of a true Gaussian everywhere ...
    assert np.max(np.abs(base - reference)[interior]) < 0.01 * STEP_EV
    # ... and rising at every pixel of the transition, never on a flat tread.
    assert _flattest_step(base, reference, edge, sigma) > 0.5


@pytest.mark.parametrize("sigma", SIGMAS)
def test_the_staircase_check_rejects_the_old_sparse_sampling(sigma: float) -> None:
    image, edge = _step()
    reference = _dense_gaussian(image[4], sigma)
    old = _sparse_taps(image[4], sigma)
    assert _flattest_step(old, reference, edge, sigma) < 0.1


def test_clarity_base_is_exact_on_flat_fields() -> None:
    flat = np.full((300, 500), -2.5, dtype=np.float32)
    for sigma in SIGMAS:
        assert np.max(np.abs(clarity_base(flat, sigma) - flat)) < 1e-5


def test_clarity_map_level_keeps_the_blur_a_few_texels_wide() -> None:
    for sigma in (0.5, 5.9, 6.0, *SIGMAS, 400.0):
        plan = clarity_map_plan(sigma)
        if plan["level"] == 0:
            assert sigma < 2 * CLARITY_MAP_MIN_TEXELS
            continue
        texels = sigma / plan["scale"]
        assert CLARITY_MAP_MIN_TEXELS <= texels < 2 * CLARITY_MAP_MIN_TEXELS


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_clarity_map_plan_matches_the_preview_contract() -> None:
    """The preview is handed these numbers from graph-scale.js; the export
    derives them here. Both must choose the same level and kernel."""
    sigmas = [0.5, 2.0, 5.99, 6.0, 11.99, 12.0, *SIGMAS, 400.0]
    script = (
        f"const {{ HDRGraphScale }} = require({json.dumps(str(FRONTEND / 'graph-scale.js'))});"
        f"console.log(JSON.stringify({json.dumps(sigmas)}.map((s) => HDRGraphScale.clarityMapPlan(s))));"
    )
    preview = json.loads(subprocess.run(["node", "-e", script], capture_output=True, text=True, check=True).stdout)
    for sigma, expected in zip(sigmas, preview):
        plan = clarity_map_plan(sigma)
        assert plan["level"] == expected["level"], sigma
        assert plan["scale"] == expected["scale"], sigma
        assert plan["taps"] == expected["taps"], sigma
        assert plan["reach"] == expected["reach"], sigma
        assert plan["dense_sigma"] == pytest.approx(expected["denseSigma"], abs=1e-12), sigma
