from __future__ import annotations

import base64
import json
from pathlib import Path
import sys

import numpy as np

sys.path[:0] = [str(Path(__file__).resolve().parents[2]), str(Path(__file__).resolve().parents[2] / "backend")]
from hdr_finisher.signed_raw import demosaic, orient
from hdr_finisher.color import _ACESCG_TO_LINEAR_BT2020
from tools.denoise_eval.metrics import colour_error


def fixtures():
    patterns = [[[0, 1], [3, 2]], [[1, 0], [2, 3]], [[3, 2], [0, 1]], [[2, 3], [1, 0]]]
    cases = []
    for index, pattern in enumerate(patterns):
        raw_pattern = np.asarray(pattern)
        rgb_pattern = np.asarray([0, 1, 2, 1])[raw_pattern]
        black = np.asarray([1000, 1020, 1040, 1060])
        mosaic = np.random.default_rng(90 + index).integers(500, 3000, (40, 48), dtype=np.uint16)
        camera = demosaic(mosaic, rgb_pattern, black[raw_pattern], np.eye(3))
        image = camera / np.float32(4095 - 1030)
        for flip in [0, 3, 5, 6]:
            meta = dict(width=48, height=40, flip=flip, cfa_raw=raw_pattern.ravel().tolist(),
                cfa_rgb=rgb_pattern.ravel().tolist(), raw_black=black.tolist(), raw_white=[4095] * 4,
                rgb_black=[1030] * 3, rgb_white=[4095] * 3, wb=[1] * 3, threshold=.999,
                camera_to_acescg=np.eye(3).tolist(), xyz_cam=np.eye(3).tolist(),
                acescg_to_bt2020=np.asarray(_ACESCG_TO_LINEAR_BT2020).T.tolist(),
                calibration_gain=1, sample_stride=1, raw_import_settings={"highlight_reconstruction": {"enabled": False}})
            cases.append(dict(meta=meta, mosaic=base64.b64encode(mosaic.tobytes()).decode(),
                expected=base64.b64encode(image.astype("<f4").tobytes()).decode()))
    return cases


def compare(cases, results):
    checks = 0
    worst = {lane: dict(mean=0., p99=0.) for lane in ("sdr", "hdr")}
    for case, result in zip(cases, results, strict=True):
        height, width = case["meta"]["height"], case["meta"]["width"]
        expected = np.frombuffer(base64.b64decode(case["expected"]), "<f4").reshape(height, width, 3)
        actual = np.stack([np.frombuffer(base64.b64decode(plane), "<f4").reshape(height, width)
                           for plane in result["planes"]], axis=-1)
        assert np.isfinite(actual).all() and np.min(actual) < 0
        expected, actual = [orient(image, case["meta"]["flip"]) for image in [expected, actual]]
        for exposure in [-6, 0, 6]:
            for lane in ["sdr", "hdr"]:
                delta = colour_error(actual * 2.**exposure, expected * 2.**exposure, lane)
                mean, percentile = float(np.mean(delta)), float(np.quantile(delta, .99))
                assert mean < 1 and percentile < 3, (case["meta"], exposure, lane, mean, percentile)
                worst[lane]["mean"] = max(worst[lane]["mean"], mean)
                worst[lane]["p99"] = max(worst[lane]["p99"], percentile)
                checks += 1
    return dict(cases=len(cases), finished_comparisons=checks, worst=worst, passed=True)


if __name__ == "__main__":
    if len(sys.argv) == 1:
        print(json.dumps(fixtures()))
    else:
        receipt = json.loads(Path(sys.argv[1]).read_text())
        print(json.dumps(compare(receipt["cases"], receipt["results"])))
