"""Framed geometry/ceiling checks, finished renderer gate and codec diagnostics."""
from pathlib import Path
import json, sys
import numpy as np
from PIL import Image
from hdr_finisher.loader import load_image
from delivery_comparison import compare_delivery
from hdr_finisher.hdr_delivery import check_decoded_hdr_ceiling
root=Path(sys.argv[1]);failures=[]
for fmt,ext in {'jpeg_ultrahdr':'jpg','avif_gain_map':'avif','jpegxl_hdr':'jxl','sdr_jpeg':'jpg','sdr_png':'png','sdr_jpegxl':'jxl'}.items():
    first=load_image(root/f'{fmt}-gpu.{ext}')
    second=load_image(root/f'{fmt}-cpu.{ext}')
    assert first[0].shape[:2] == (66,90), (fmt,first[0].shape)
    comparison=compare_delivery(root/f'{fmt}-gpu.{ext}',root/f'{fmt}-cpu.{ext}')
    print(fmt,json.dumps(comparison),flush=True)
    for lane,metric in comparison['renderer_agreement'].items():
        if not metric['passed']: failures.append((fmt,lane,metric))
    if not fmt.startswith('sdr_'):
        for renderer in ('gpu','cpu'):
            peak=check_decoded_hdr_ceiling(root/f'{fmt}-{renderer}.{ext}',fmt,1000)
            print('ceiling',renderer,peak,flush=True)
# Lossless SDR flat mats retain their display colour exactly.
pixels=np.asarray(Image.open(root/'sdr_png-gpu.png'))
np.testing.assert_array_equal(pixels[0,0,:3],[32,32,32])
np.testing.assert_array_equal(pixels[4,4,:3],[255,255,255])

assert not failures, failures
