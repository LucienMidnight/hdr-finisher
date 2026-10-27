"""Compare current HSL selection with an exploratory Local-hue candidate.

Run with .venv/Scripts/python.exe tools/hsl_smoothing_probe.py. This is a
CPU-only diagnostic, not an integrated Global HSL implementation or a test
of the preview and delivery paths.
"""
from pathlib import Path
import json
import sys

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from hdr_finisher.color import linear_srgb_to_acescg
from hdr_finisher.hsl import HSLRange, from_lab, selection
from hdr_finisher.hue_mask import select_hue
from hdr_finisher.models import MaskLeaf


def main():
    height, width = 96, 192
    rng = np.random.default_rng(9)
    lab = np.zeros((height, width, 3), np.float32)
    lab[..., 0] = .6
    angles = np.radians(109 + rng.normal(0, 12, (height, 96)))
    lab[:, :96, 1] = .065 * np.cos(angles)
    lab[:, :96, 2] = .065 * np.sin(angles)
    lab[:, 97, 0] = 1.5
    lab[:, 97, 1] = .14 * np.cos(np.radians(109))
    lab[:, 97, 2] = .14 * np.sin(np.radians(109))
    rgb = from_lab(lab).astype(np.float32)
    current = selection(rgb, [HSLRange(center=109, width=15, feather=21)])[0]
    candidate = select_hue(
        MaskLeaf(type="hue_range", hue_center=109, hue_width=15,
                 hue_smoothness=21, saturation_floor=.02),
        linear_srgb_to_acescg(rgb),
    )
    def metrics(values):
        patch = values[8:-8, 8:88]
        return {"patch_mean": float(patch.mean()), "patch_std": float(patch.std()),
                "neutral_max": float(values[:, 100:].max()),
                "fringe_mean": float(values[:, 97].mean())}
    print(json.dumps({"current": metrics(current), "candidate": metrics(candidate)}, indent=2))


if __name__ == "__main__":
    main()
