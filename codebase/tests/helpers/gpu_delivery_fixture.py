"""Small delivery fixture and decoded perceptual check; no owner photos."""
import json
from pathlib import Path
import sys
import numpy as np
import colour
from hdr_finisher.color import acescg_to_linear_bt2020
from hdr_finisher.color_context import scene_linear_to_nits
from hdr_finisher.delivery_colour import compare_finished_pixels
from hdr_finisher.hdr_delivery import check_decoded_hdr_ceiling
from hdr_finisher.loader import load_image
if sys.argv[1] == "make":
    import tifffile
    y,x=np.mgrid[:64,:96].astype(np.float32)
    v=.015+.55*(x/95)**2+.04*np.sin(y/5)**2
    image=np.stack([v,v*.87,v*.65],axis=-1)
    tifffile.imwrite(sys.argv[2],image,photometric="rgb")
else:
    root=Path(sys.argv[2])
    first=load_image(root/"gpu.jpg")
    second=load_image(root/"cpu.jpg")
    results={}
    for lane,index in (("hdr",0),("sdr",4)):
        metric=compare_finished_pixels(first[index],second[index],lane)
        pair=[first[index],second[index]]
        if lane=="sdr":
            converted=[colour.XYZ_to_Lab(colour.RGB_to_XYZ(np.clip(v,0,1),colour.RGB_COLOURSPACES["sRGB"])) for v in pair]
            delta=colour.difference.delta_E_CIE2000(*converted)
        else:
            converted=[colour.RGB_to_ICtCp(np.maximum(scene_linear_to_nits(acescg_to_linear_bt2020(v),203),0),method="ITU-R BT.2100-2 PQ") for v in pair]
            delta=colour.difference.delta_E_ITP(*converted)
        p99=float(np.percentile(delta,99))
        results[lane]={"mean":metric.mean,"p999":metric.p999,"passed":metric.passed,
            "p99":p99,"denoise_passed":metric.mean<1 and p99<3}
    results["peak_nits"]=check_decoded_hdr_ceiling(root/"gpu.jpg","jpeg_ultrahdr",1000)
    print(json.dumps(results))
