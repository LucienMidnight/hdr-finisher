"""Compare native thumbnail renditions with the unchanged GPU composite."""
import base64
import json
import sys
from pathlib import Path
import numpy as np
import colour
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
from hdr_finisher.library_kept import jpeg_renditions
from hdr_finisher.color import acescg_to_linear_srgb
file = Path(sys.argv[1])
data = json.loads(file.read_text())
image = file.with_suffix('.jpg'); image.write_bytes(base64.b64decode(data['base64']))
metrics = {}
for result in data['results']:
    a = np.asarray(result['values'], dtype=np.float32).reshape(result['height'], result['width'], 4)[..., :3]
    if result['format'].startswith('bgra'): a = a[..., ::-1]
    magnitude = np.abs(a)
    a = np.sign(a) * np.where(magnitude <= .04045, magnitude / 12.92, ((magnitude + .055) / 1.055) ** 2.4)
    if result['hdr']:
        assert result['format'] == 'rgba16float', 'HDR check needs the extended HDR display surface'
        a = colour.RGB_to_RGB(a, colour.RGB_COLOURSPACES['Display P3'], colour.RGB_COLOURSPACES['sRGB'])
        b = acescg_to_linear_srgb(jpeg_renditions(image, True)) / .18
        metrics['hdr_peak_error'] = abs(float(b.max()) / float(a.max()) - 1)
        metrics['hdr_white_error'] = abs(float(b[4:16,4:36].mean()) / float(a[4:16,4:36].mean()) - 1)
        assert metrics['hdr_peak_error'] <= .02 and metrics['hdr_white_error'] <= .02, metrics
    else:
        b = jpeg_renditions(image)
        lab = lambda values: colour.XYZ_to_Lab(colour.RGB_to_XYZ(values, colour.RGB_COLOURSPACES['sRGB']))
        difference = colour.delta_E(lab(a), lab(b), method='CIE 2000')
        metrics['sdr_mean'] = float(difference.mean()); metrics['sdr_p99'] = float(np.percentile(difference,99))
        assert metrics['sdr_mean'] <= 1 and metrics['sdr_p99'] <= 3, metrics
print(json.dumps(metrics))
