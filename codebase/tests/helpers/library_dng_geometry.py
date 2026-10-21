"""Small high-frequency geometry probes: off-centre, per-channel, tangential and borders."""
import base64,json,sys
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"backend"))
from hdr_finisher.dng_opcodes import WarpRectilinearParameters,apply_warp_rectilinear,GainMapParameters,AreaSpec,apply_gain_map
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
# Ordered, nonuniform maps with different plane counts, partial areas and pitches.
original=list(cases)
for case in original:
 meta=dict(case["meta"]);maps=[];corrected=image
 for channels,area in [(3,AreaSpec(0,0,h,w,0,3,1,1)),(1,AreaSpec(2,3,h-2,w-3,1,2,2,3))]:
  gains=np.linspace(.65,1.45,3*4*channels,dtype=np.float32).reshape(3,4,channels)
  g=GainMapParameters(area,3,4,.34,.25,-.04,.03,channels,gains)
  corrected=apply_gain_map(corrected,g)
  maps.append(dict(area=list(vars(area).values()),points=[3,4,channels],spacing=[.34,.25],origin=[-.04,.03],gains=gains.reshape(-1).tolist()))
 meta["dng_gain_maps"]=maps
 d=meta["dng_warp"];warp=WarpRectilinearParameters(np.array(d["coefficients"]),.38,.61)
 ax,ay=d["affine_x"],d["affine_y"];yy,xx=np.mgrid[:meta["height"],:meta["width"]]
 expected=apply_warp_rectilinear(corrected,warp)[ay[0]*xx+ay[1]*yy+ay[2],ax[0]*xx+ax[1]*yy+ax[2]]
 cases.append(dict(meta=meta,input=case["input"],expected=[expected[...,c].reshape(-1).tolist() for c in range(3)]))
# Highlight reconstruction, crop and all existing orientations.
from types import SimpleNamespace
from hdr_finisher.dng_color import transform_normalized_to_acescg_in_place,_build_clipped_highlight_support
highlight=image.copy();highlight[10:16,20:26,0]=1.0
neutral=np.array([.8,1,.6],np.float32);matrix=np.array([[.9,.1,0],[.1,.8,.1],[0,.2,.8]],np.float32)
converted=transform_normalized_to_acescg_in_place(highlight.copy(),SimpleNamespace(camera_to_acescg=matrix,camera_neutral=neutral),highlight_recovery_limit=1)
support,block=_build_clipped_highlight_support(highlight,1)
for orientation in range(1,9):
 metadata=dict(active_area=[1,2,h-1,w-2],default_crop_origin=[1,2],default_crop_size=[w-6,h-6],orientation=orientation)
 ow,oh,ax,ay=geometry(metadata,w,h);meta=dict(original[0]["meta"])
 meta.pop("dng_warp");meta.update(width=ow,height=oh,rgb_to_acescg=matrix.tolist(),dng_linear=dict(width=w,height=h,affine_x=ax,affine_y=ay,neutral=neutral.tolist(),response_limit=1,support=dict(block=block,width=support.shape[1],height=support.shape[0])),dng_support=support.reshape(-1).tolist())
 expected=crop_and_orient(converted,metadata)
 cases.append(dict(meta=meta,input=base64.b64encode(highlight.tobytes()).decode(),expected=[expected[...,c].reshape(-1).tolist() for c in range(3)]))
print(json.dumps(cases))
