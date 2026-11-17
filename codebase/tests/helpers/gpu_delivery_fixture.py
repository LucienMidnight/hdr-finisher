"""Small fixture; finished renderer gate with report-only encoding diagnostics."""
import json
from pathlib import Path
import sys

import numpy as np

from delivery_comparison import compare_delivery
from hdr_finisher.hdr_delivery import check_decoded_hdr_ceiling

if sys.argv[1] == "make":
    import tifffile
    denoise = len(sys.argv) > 3 and sys.argv[3] == "denoise"
    height, width = (128, 192) if denoise else (64, 96)
    rows, columns = np.mgrid[:height, :width].astype(np.float32)
    values = .015 + .55 * (columns / (width - 1)) ** 2 + .04 * np.sin(rows / 5) ** 2
    image = np.stack([values, values * .87, values * .65], axis=-1)
    if denoise:
        image += np.random.default_rng(904).normal(0, .005, image.shape).astype(np.float32)
        image[:, :48] = 1.25
    tifffile.imwrite(sys.argv[2], image, photometric="rgb")
else:
    root = Path(sys.argv[2])
    result = compare_delivery(root / "gpu.jpg", root / "cpu.jpg")
    for lane, agreement in result["renderer_agreement"].items():
        result[lane] = dict(agreement, denoise_passed=agreement["passed"] and agreement["p99"] < 3)
    result["peak_nits"] = max(check_decoded_hdr_ceiling(root / f"{renderer}.jpg", "jpeg_ultrahdr", 1000)
                              for renderer in ("gpu", "cpu"))
    print(json.dumps(result))
