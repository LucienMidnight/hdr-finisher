"""Focused 24/42 MP photographic hue-mask timings; output only in output/."""
from pathlib import Path
import sys, time, json, runpy
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend'))
from hdr_finisher.local_adjustments import compile_geometry_fixed_mask, hue_range_mask
from hdr_finisher.models import MaskLeaf,MaskExpression,GeometryAdjustments
source=np.load(ROOT/'output/hue-mask-smooth/scene.npy',mmap_mode='r')
leaf=MaskLeaf(type='hue_range',hue_center=109,hue_width=24,hue_smoothness=41)
expression=MaskExpression(operator='leaf',leaf=leaf)
results={}
for h,w in [(4000,6000),(5292,7938)]:
 image=np.tile(source,(2,3,1))[:h,:w].copy();image.setflags(write=False)
 started=time.perf_counter();compile_geometry_fixed_mask(image,expression,GeometryAdjustments());cold=time.perf_counter()-started
 warm=[]
 for hue in [108,109,110]:
  leaf.hue_center=hue;started=time.perf_counter()
  compile_geometry_fixed_mask(image,expression,GeometryAdjustments());warm.append(time.perf_counter()-started)
 results[str(h*w)]={'cold_compile_seconds':cold,'warm_compile_seconds':warm,'prepared_bytes':h*w*4}
 print(h*w,results[str(h*w)],flush=True)
(ROOT/'output/hue-mask-smooth/compile-timing.json').write_text(json.dumps(results,indent=2),encoding='utf8')
m=runpy.run_path(str(ROOT/'tests/test_hue_mask.py'))
leaf.hue_center=109;leaf.hue_width=12;leaf.hue_smoothness=20
mask=hue_range_mask(leaf,m['noisy_patch']())
metrics={'patch_mean':float(mask[8:-8,8:88].mean()),'patch_std':float(mask[8:-8,8:88].std()),'neutral_max':float(mask[:,104:].max()),'fringe_mean':float(mask[:,97].mean())}
(ROOT/'output/hue-mask-smooth/synthetic.json').write_text(json.dumps(metrics,indent=2),encoding='utf8');print(metrics)
