"""Read-only photographic review; all outputs remain inside output/."""
from pathlib import Path
import sys,json
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend'))
from hdr_finisher.models import AdjustmentState,PreviewKind,LocalAdjustment,MaskExpression,MaskLeaf,MaskPoint
from hdr_finisher.local_adjustments import sample_hue_range
from hdr_finisher.adjustments import apply_adjustments
from hdr_finisher.preview import encode_processed_preview_bytes,downsample_image
SOURCE=Path(r'D:/Photos/2026/20261017 badminton/DSC07147.ARW')
scene=np.load(ROOT/'output/sharpen-review/DSC07147-scene.npy',mmap_mode='r')
mode=sys.argv[1]
out=ROOT/'output'/mode;out.mkdir(parents=True,exist_ok=True)
# This cached float scene was developed read-only by sharpen_review.py from SOURCE.
fit=downsample_image(np.asarray(scene),1200)
x,y=4180,2570
native=np.array(scene[y:y+512,x:x+512],copy=True)
rows=[]
for size,image in [('fit',fit),('100-percent',native)]:
 for lane in ['hdr','sdr']:
  kind=PreviewKind(lane)
  variants=['before','after'] if mode=='hue-mask' else ['off','moderate','strong']
  for variant in variants:
   state=AdjustmentState();state.hdr.highlight_section_enabled=True
   locals=[]
   if mode=='hue-mask':
    sample=sample_hue_range(fit,[MaskPoint(x=.72,y=.5)])
    leaf=MaskLeaf(type='hue_range',hue_center=sample['center'],hue_width=sample['width'])
    local=LocalAdjustment(mask=MaskExpression(operator='leaf',leaf=leaf))
    local.hdr_grade.exposure=.7;local.sdr_grade.exposure=.7
    if variant=='after':locals=[local]
   else:
    branch=getattr(state,lane)
    amount={'off':0,'moderate':.4,'strong':1}[variant]
    branch.highlight_desaturation=amount;branch.shadow_desaturation=amount
   rendered=apply_adjustments(image,state,kind,local_adjustments=locals)
   for hdr_display in ([False,True] if lane=='hdr' else [False]):
    data,_=encode_processed_preview_bytes(rendered,kind,hdr_display=hdr_display)
    ext='avif' if hdr_display else 'png'
    name=f'{lane}-{size}-{variant}.{ext}';(out/name).write_bytes(data)
    rows.append((lane,size,variant,name))
   print(lane,size,variant,flush=True)
html='<!doctype html><meta charset="utf-8"><title>'+mode+'</title><style>body{background:#222;color:#eee;font:16px system-ui}section{display:flex;gap:12px;flex-wrap:wrap}figure{margin:8px}img{max-width:100%}figure.native img{width:512px;max-width:none}</style><h1>'+mode+'</h1><p>DSC07147 badminton RAW, read-only cached development. Both lanes are independently rendered. AVIF retains HDR; PNG is the SDR display view. Native crops show 512 original pixels; Fit shows the whole photo.</p>'
for lane in ['hdr','sdr']:
 for size in ['fit','100-percent']:
  html+=f'<h2>{lane.upper()} {size}</h2><section>'
  for l,s,v,n in rows:
   if l==lane and s==size:html+=f'<figure class="{("native" if size=="100-percent" else "fit")}"><figcaption>{v} ({n.split(".")[-1]})</figcaption><img src="{n}"></figure>'
  html+='</section>'
(out/'index.html').write_text(html,encoding='utf8')
(out/'recipe.json').write_text(json.dumps({'source':str(SOURCE),'cached_scene':'output/sharpen-review/DSC07147-scene.npy','native_crop':[x,y,512,512],'fit_long_edge':1200,'mode':mode},indent=2))
