"""Small deterministic edge scene and CPU reference for the Electron driver."""
import json
from pathlib import Path
import sys

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from test_highlight_edge_colour import scene
from hdr_finisher.highlight_edge_colour import reconstruct_edge_colour
from hdr_finisher.color import _ACESCG_TO_LINEAR_BT2020, _LINEAR_BT2020_TO_ACESCG

folder = Path(sys.argv[1])
if len(sys.argv) == 2:
    image, ratio, _, _ = scene()
    np.concatenate([image.transpose(2, 0, 1), ratio[None]], axis=0).astype("<f4").tofile(folder / "input.bin")
    for expand in (0, .5, 3):
        reference, _ = reconstruct_edge_colour(image, ratio, expand)
        reference.astype("<f4").tofile(folder / f"reference-{expand:g}.bin")
    print(json.dumps({"width": image.shape[1], "height": image.shape[0],
        "toBT": _ACESCG_TO_LINEAR_BT2020.T.tolist(), "fromBT": _LINEAR_BT2020_TO_ACESCG.T.tolist()}))
else:
    expand = float(sys.argv[3])
    reference = np.fromfile(folder / f"reference-{expand:g}.bin", "<f4").reshape(400, 400, 3)
    result = np.fromfile(folder / f"gpu-{expand:g}.bin", "<f4").reshape(3, 400, 400).transpose(1, 2, 0)
    difference = np.abs(reference - result)
    assert np.isfinite(result).all()
    assert np.quantile(difference, .999) < .001, float(difference.max())
    print(json.dumps({"mean_absolute_scene_difference": float(difference.mean()), "p999": float(np.quantile(difference, .999))}))
