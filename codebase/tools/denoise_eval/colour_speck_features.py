"""Check named features in the native-size review JPEGs, using baseline masks."""
import argparse
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

from tools.denoise_eval import colour_speck_marks as marks
from tools.denoise_eval.marking_page import json_text

# Crop-local xyxy boxes selected on the baseline, independent of candidate output.
FEATURES = (
    ("Red logo", "DSC00512.ARW", "D1", (180, 201, 313, 314)),
    ("Red T*", "DSC00786.ARW", "D1", (69, 88, 452, 394)),
    ("Blue S", "DSC00786.ARW", "D3", (130, 158, 405, 321)),
    ("Red leaves", "PA310516.ORF", "D1", (36, 76, 212, 279)),
    ("Green leaves", "PA310516.ORF", "D1", (163, 119, 341, 319)),
    ("Pleiades", "DSC08360.ARW", "D1", (224, 208, 315, 319)),
    ("Isolated star A", "DSC08360.ARW", "D2", (26, 208, 67, 249)),
    ("Isolated star B", "DSC08360.ARW", "D2", (250, 207, 290, 248)),
    ("Isolated star C", "DSC08360.ARW", "D2", (333, 363, 374, 406)),
    ("Orange light", "P7310465.ORF", "D1", (220, 211, 293, 282)),
    ("Canon lips", "IMG_0790.CR2", "D1", (185, 290, 281, 345)),
    ("Canon eyes", "IMG_0790.CR2", "D1", (150, 160, 327, 223)),
    ("Side eyelashes and iris", "_DSC7970.ARW", "D1", (70, 165, 408, 380)),
    ("Close eyelashes and iris", "DSC05622.ARW", "D1", (56, 51, 441, 395)),
    ("Dog eye and fur", "PC131157.ORF", "D1", (0, 0, 512, 512)),
)
SLOTS = ("baseline", "a_after", "a_before", "b")


def gradients(field):
    return np.stack([cv2.Sobel(field, -1, 1, 0, scale=.125),
                     cv2.Sobel(field, -1, 0, 1, scale=.125)], axis=-1)


def signals(pixels):
    axes = (pixels.astype(np.float32) / 255) @ marks.DISPLAY_AXES.T
    smooth = cv2.GaussianBlur(axes, (7, 7), .95)
    local = smooth - cv2.GaussianBlur(smooth, (0, 0), 9.0)
    g = gradients(smooth)
    return local[..., 1:], g[..., 1:, :], g[..., 0, :]


def compare(reference, sample):
    # Freeze a mask around the strongest baseline structure for each measurement.
    # Measure projected strength so shifting hue or moving an edge cannot score as preservation.
    basis = reference.reshape(*reference.shape[:2], -1)
    other = sample.reshape(*sample.shape[:2], -1)
    strength = np.linalg.norm(basis, axis=-1)
    wanted = strength >= np.quantile(strength, .8)
    total = np.sum(strength[wanted] ** 2)
    return float(np.sum(basis[wanted] * other[wanted]) / total) if total > 0 else None


def measure(folder):
    rows = []
    for feature, name, area, rect in FEATURES:
        left, top, right, bottom = rect
        samples = {}
        for slot in SLOTS:
            path = folder / "images" / f"{name}-{area}-{slot}.jpg"
            with Image.open(path) as image:
                # Filter with the surrounding crop present, then select the feature box.
                samples[slot] = [item[top:bottom, left:right] for item in signals(np.asarray(image))]
        scores = {}
        keys = ("local_colour", "colour_edge", "display_brightness_edge")
        for slot in SLOTS[1:]:
            scores[slot] = {key: compare(reference, other) for key, reference, other
                            in zip(keys, samples["baseline"], samples[slot])}
        rows.append(dict(feature=feature, file=name, area=area, crop_xyxy=rect, scores=scores))
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--review", type=Path, default=marks.OUTPUT)
    args = parser.parse_args()
    cv2.setNumThreads(1)
    path = args.review / "features.json"
    path.write_text(json_text(measure(args.review)), encoding="utf-8")
    print(path)


if __name__ == "__main__":
    main()
