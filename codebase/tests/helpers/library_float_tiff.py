"""Bounded floating TIFF derivative of the approved photographic TIFF."""
import sys
from pathlib import Path

import numpy as np
import tifffile

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools"))
from lib.test_photos import photo_root


def make_float_tiff(target):
    source = photo_root() / "DSC04375_DxO_clipped_target.tif"
    with tifffile.TiffFile(source) as document:
        page = document.pages[0]
        profile = page.tags[34675].value
        pixels = page.asarray()[:640, :640, :3].astype(np.float32) / 65535
    tifffile.imwrite(target, pixels, photometric="rgb", iccprofile=profile)


if __name__ == "__main__":
    make_float_tiff(sys.argv[1])
