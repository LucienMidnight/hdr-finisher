import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(_ToolPath(__file__).resolve().parents[1] / 'tools'))
from lib.machine_settings import photos_path
from pathlib import Path
import sys, time, json
import numpy as np
import cv2
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend'))
from hdr_finisher.loader import load_image
from hdr_finisher.models import AdjustmentState, PreviewKind, MaskLeaf, MaskExpression, LocalAdjustment
from hdr_finisher.adjustments import apply_adjustments
from hdr_finisher.preview import encode_processed_preview_bytes
from hdr_finisher.color import acescg_to_linear_srgb
from hdr_finisher import hsl
from hdr_finisher.hue_mask import select_hue

OUT=ROOT/'output/hsl-smoothing-choice'; OUT.mkdir(parents=True,exist_ok=True)
SOURCE=Path(photos_path(r'D:\Photos\Play_Raw\Balanced Rock in Arches Nat Park - LaurentFromSF\IMG_0114.CR2'))
STRENGTHS={'light':4,'medium':8,'strong':16}
LABELS={'off':'HSL off (reference)','now':'Now in the app','light':'Light','medium':'Medium','strong':'Strong'}
original_selection=hsl.selection

def smooth_weight(rgb, ranges, step, floor):
    # Average only the Oklab colour channels; keep original luminance as guide.
    lab=hsl.to_lab(rgb).astype(np.float32)
    light=np.maximum(np.abs(lab[...,0]),1e-6)
    ab=lab[...,1:3]/light[...,None]
    height,width=light.shape
    small=(max(1,width//step),max(1,height//step))
    coarse=cv2.resize(ab,small,interpolation=cv2.INTER_AREA)
    coarse=cv2.GaussianBlur(coarse,(0,0),1.0)
    hue=np.degrees(np.arctan2(coarse[...,1],coarse[...,0]))
    chroma=np.hypot(coarse[...,0],coarse[...,1])
    r=ranges[0]
    low=(1-hsl._smooth(r.width,r.width+r.feather,np.abs(hsl._delta(hue,r.center))))*hsl._smooth(floor,floor+.04,chroma)
    p=cv2.resize(low.astype(np.float32),(width,height),interpolation=cv2.INTER_LINEAR)
    guide=np.log2(np.maximum(light,1e-4)).astype(np.float32)
    # Guided filter, a small full-resolution refinement against luminance edges.
    box=lambda v:cv2.boxFilter(v,-1,(9,9),borderType=cv2.BORDER_REFLECT)
    mi,mp=box(guide),box(p)
    a=(box(guide*p)-mi*mp)/(box(guide*guide)-mi*mi+.03)
    p=box(a)*guide+box(mp-a*mi)
    surround=cv2.boxFilter(guide,-1,(5,5),borderType=cv2.BORDER_REFLECT)
    bright=hsl._smooth(.07,.30,guide-surround)
    avg=cv2.resize(coarse,(width,height),interpolation=cv2.INTER_LINEAR)
    mismatch=hsl._smooth(.04,.16,np.linalg.norm(ab-avg,axis=-1))
    protection=(1-bright)*(1-mismatch*hsl._smooth(.025,.12,np.abs(guide-surround)))
    return np.clip(p*protection,0,1).astype(np.float32)

def save(pixels, kind, stem):
    # 188 original pixels span approximately 512 at 272%; nearest-neighbour is explicit.
    details={'100':pixels,'272':cv2.resize(pixels[162:350,162:350],(511,511),interpolation=cv2.INTER_NEAREST)}
    for zoom, image in details.items():
        for hdr in ([False,True] if kind==PreviewKind.HDR else [False]):
            data,_=encode_processed_preview_bytes(image,kind,hdr_display=hdr)
            (OUT/f'{stem}-{zoom}.{"avif" if hdr else "png"}').write_bytes(data)

scene,*_=load_image(SOURCE)
height,width=scene.shape[:2]
regions={'bush':(.15,.60),'flowers':(.62,.57)}
leaf=MaskLeaf(type='hue_range',hue_center=109,hue_width=24,hue_smoothness=41,saturation_floor=.04)
local=LocalAdjustment(mask=MaskExpression(operator='leaf',leaf=leaf)); local.hdr_grade.exposure=1.05
ranges=[hsl.HSLRange(center=109,width=24,feather=41)]
timings={k:[] for k in STRENGTHS}
for region,(fx,fy) in regions.items():
    cx,cy=round(width*fx),round(height*fy); pad=80; size=512
    x,y=cx-size//2,cy-size//2
    crop=np.array(scene[y-pad:y+size+pad,x-pad:x+size+pad],copy=True)
    for lane in ('global','local'):
        kind=PreviewKind.SDR if lane=='global' else PreviewKind.HDR
        state=AdjustmentState()
        state.hdr.highlight_section_enabled=True
        recipe=next(c.recipe for c in state.sdr.hsl.channels if c.id=='yellow')
        recipe.ranges[0].width=15; recipe.ranges[0].feather=21; recipe.luminance=.8
        for variant in LABELS:
            st=state.model_copy(deep=True)
            if variant=='off': st.sdr.hsl_section_enabled=False
            hsl.selection=original_selection
            masks=None; locals_=[]
            if lane=='local' and variant!='off':
                if variant=='now': mask=select_hue(leaf,crop)
                else:
                    start=time.perf_counter(); mask=smooth_weight(acescg_to_linear_srgb(crop),ranges,STRENGTHS[variant],.04); timings[variant].append(time.perf_counter()-start)
                locals_=[local]; masks={local.id:np.rint(mask*255).astype(np.uint8)}
            if lane=='global' and variant in STRENGTHS:
                def selected(rgb,rs,variant=variant):
                    result=list(original_selection(rgb,rs))
                    start=time.perf_counter(); result[0]=smooth_weight(rgb,rs,STRENGTHS[variant],.02); timings[variant].append(time.perf_counter()-start)
                    return tuple(result)
                hsl.selection=selected
            try:
                image=apply_adjustments(crop,st,kind,local_adjustments=locals_,compiled_local_masks=masks,source_pixel_scale=1)
            finally: hsl.selection=original_selection
            save(image[pad:pad+size,pad:pad+size],kind,f'{lane}-{region}-{variant}')
            print(lane,region,variant,flush=True)
# Measured crop-only CPU cost, scaled by pixel count: a provisional estimate, not an app benchmark.
estimates={k:round(float(np.median(v))*24000000/(crop.shape[0]*crop.shape[1]),1) for k,v in timings.items()}
body=[]
for lane in ('global','local'):
 for region in regions:
  for zoom in ('100','272'):
   body.append(f'<h2>{"Global HSL (SDR)" if lane=="global" else "Local hue mask (HDR)"} — {region} — {zoom}%</h2><div class="row">')
   for variant,label in LABELS.items():
    stem=f'{lane}-{region}-{variant}-{zoom}'; ext='avif' if lane=='local' else 'png'
    explanation='' if variant not in STRENGTHS else f'<small>Colour averaged over about {STRENGTHS[variant]*2} pixels.<br>Prototype CPU estimate for 24 MP: {estimates[variant]} s; dragging: not measured.</small>'
    body.append(f'<figure><figcaption>{label}{explanation}</figcaption><a href="{stem}.{ext}"><img {"class=hdr" if lane=="local" else ""} src="{stem}.{ext}" alt="{label}, {region}, {zoom}%"></a></figure>')
   body.append('</div>')
html='''<!doctype html><html lang="en"><meta charset="utf-8"><title>Choose colour selection smoothing</title><style>body{background:#202124;color:#eee;font:16px/1.45 system-ui;margin:24px}p{max-width:1100px}button{font:inherit;padding:8px}.row{display:flex;gap:12px;overflow:auto}figure{flex:0 0 512px;margin:0}figcaption{height:100px;font-weight:bold}small{display:block;font-weight:normal}img{width:512px;height:512px;image-rendering:pixelated;display:block}a{color:#9cf}h2{margin-top:30px}</style><h1>Choose colour selection smoothing</h1><p>Choose how evenly the bush and flowers brighten. Look for fewer speckles, crisp bush edges, no glow or smearing onto rock and sand, and sharp texture. “HSL off” is the reference.</p><p>Use browser zoom 100%. Local rows show true HDR PQ AVIF on an HDR display; the button switches to the labelled SDR fallback. The timing figures are rough CPU estimates scaled from these crops; preparation and dragging times in the app are not yet known. Chrome review is still pending.</p><button id="fallback">Show SDR fallback for Local rows</button>''' + ''.join(body)+'''<script>let fallback=false;document.querySelector('#fallback').onclick=()=>{fallback=!fallback;document.querySelectorAll('img.hdr').forEach(i=>{i.src=i.src.replace(/\.(avif|png)$/,fallback?'.png':'.avif');i.parentElement.href=i.src});document.querySelector('#fallback').textContent=fallback?'Showing SDR fallback — switch to HDR':'Show SDR fallback for Local rows'}</script></html>'''
(OUT/'index.html').write_text(html,encoding='utf-8')
(OUT/'recipe.json').write_text(json.dumps({'source':str(SOURCE),'centers':regions,'strengths':STRENGTHS,'cpu_extrapolated_seconds':estimates,'crop':512,'margin':80},indent=2))
