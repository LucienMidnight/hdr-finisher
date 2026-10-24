"""Decoded framed deliverables: geometry, perceptual GPU/CPU agreement and HDR ceiling."""
from pathlib import Path
import json, sys
import numpy as np
from PIL import Image
from hdr_finisher.loader import load_image
from hdr_finisher.delivery_colour import compare_finished_pixels
from hdr_finisher.hdr_delivery import check_decoded_hdr_ceiling
root=Path(sys.argv[1]);failures=[]
for fmt,ext in {'jpeg_ultrahdr':'jpg','avif_gain_map':'avif','jpegxl_hdr':'jxl','sdr_jpeg':'jpg','sdr_png':'png','sdr_jpegxl':'jxl'}.items():
    first=load_image(root/f'{fmt}-gpu.{ext}')
    second=load_image(root/f'{fmt}-cpu.{ext}')
    assert first[0].shape[:2] == (66,90), (fmt,first[0].shape)
    for lane,index in [('hdr',0),('sdr',4)]:
        if fmt.startswith('sdr_') and lane=='hdr': continue
        a,b=first[index],second[index]
        if a is None:
            from hdr_finisher.color import acescg_to_linear_srgb
            a,b=acescg_to_linear_srgb(first[0]),acescg_to_linear_srgb(second[0])
        metric=compare_finished_pixels(a,b,lane)
        print(fmt,lane,metric.mean,metric.p999,flush=True)
        if not metric.passed: failures.append((fmt,lane,metric))
    if not fmt.startswith('sdr_'):
        peak=check_decoded_hdr_ceiling(root/f'{fmt}-gpu.{ext}',fmt,1000)
        print('ceiling',peak,flush=True)
# Lossless SDR flat mats retain their display colour exactly.
pixels=np.asarray(Image.open(root/'sdr_png-gpu.png'))
np.testing.assert_array_equal(pixels[0,0,:3],[32,32,32])
np.testing.assert_array_equal(pixels[4,4,:3],[255,255,255])

assert not failures, failures
