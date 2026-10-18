"""Small delivery fixture and decoded perceptual check; no owner photos."""
import json
from pathlib import Path
import sys
import numpy as np
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
        results[lane]={"mean":metric.mean,"p999":metric.p999,"passed":metric.passed}
    results["peak_nits"]=check_decoded_hdr_ceiling(root/"gpu.jpg","jpeg_ultrahdr",1000)
    print(json.dumps(results))
