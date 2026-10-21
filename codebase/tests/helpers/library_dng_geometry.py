"""Small high-frequency geometry probes: off-centre, per-channel, tangential and borders."""
import base64,json,sys
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"backend"))
from hdr_finisher.dng_opcodes import WarpRectilinearParameters,apply_warp_rectilinear
from hdr_finisher.library_dng import geometry
from hdr_finisher.linear_dng import crop_and_orient
h,w=36,48;y,x=np.mgrid[:h,:w]
image=np.stack([.1+.7*(x%7)/6,.1+.7*(y%5)/4,.1+.7*((x+y)%9)/8],axis=-1).astype("<f4")
cases=[]
for planes in (1,3):
 coefficients=np.array([[1.1,.06,-.02,.003,.012,-.009],[.97,.03,-.01,0,-.01,.008],[1.04,-.02,.01,0,.009,.01]][:planes],np.float64)
 warp=WarpRectilinearParameters(coefficients,.38,.61)
 warped=apply_warp_rectilinear(image,warp)
 for orientation in (1,2,3,4,5,6,7,8):
  metadata=dict(active_area=[1,2,h-1,w-2],default_crop_origin=[1,2],default_crop_size=[w-6,h-6],orientation=orientation,xmp_merge_crop=[.1,.1,.9,.9])
  ow,oh,ax,ay=geometry(metadata,w,h);cx=.38*w;cy=.61*h
  expected=crop_and_orient(warped,metadata)
  meta=dict(path="synthetic.dng",rgb=True,width=ow,height=oh,flip=0,mosaic_bytes=image.nbytes,sample_stride=1,
   layout=dict(dtype="float32"),colour=dict(transfer="LINEAR",reference_white_nits=203,authored_sdr=False,scale=1),
   rgb_to_acescg=np.eye(3).tolist(),acescg_to_srgb=np.eye(3).tolist(),acescg_to_bt2020=np.eye(3).tolist(),
   dng_warp=dict(width=w,height=h,coefficients=coefficients.tolist(),center=[cx,cy],radius=float(np.hypot(max(cx,w-cx),max(cy,h-cy))),affine_x=ax,affine_y=ay))
  cases.append(dict(meta=meta,input=base64.b64encode(image.tobytes()).decode(),expected=[expected[...,c].reshape(-1).tolist() for c in range(3)]))
print(json.dumps(cases))
