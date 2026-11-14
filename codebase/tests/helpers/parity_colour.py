"""Compare complete finished captures using the application's perceptual tools.

The film/lens drivers force standard-range presentation in BOTH editing lanes.
Their RGBA bytes are sRGB, never scene-linear HDR; use Delta E 2000, not ITP.
The stream keeps colour-science imports warm and reuses just two scratch files.
"""
from dataclasses import asdict
import json
from pathlib import Path
import sys

import numpy as np
from hdr_finisher.delivery_colour import compare_finished_pixels


def compare_rgba(directory, width, height):
    images = []
    for kind in ('gpu', 'cpu'):
        data = np.fromfile(Path(directory) / f'{kind}.rgba', dtype=np.uint8)
        rgba = data.reshape(height, width, 4)
        if not np.all(rgba[:, :, 3] == 255):
            raise ValueError('Parity capture must be opaque, with complete pixel coverage')
        encoded = rgba[:, :, :3].astype(np.float32) / 255
        images.append(np.where(encoded <= .04045, encoded / 12.92,
                               ((encoded + .055) / 1.055) ** 2.4))
    return asdict(compare_finished_pixels(*images, 'sdr'))


def main():
    for line in sys.stdin:
        try:
            request = json.loads(line)
            result = compare_rgba(request['directory'], request['width'], request['height'])
        except Exception as error:
            result = {'error': str(error)}
        print(json.dumps(result), flush=True)


if __name__ == '__main__':
    main()
