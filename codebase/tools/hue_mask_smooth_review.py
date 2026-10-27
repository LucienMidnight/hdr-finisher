"""Read-only Balanced Rock review and reproducible source-pixel crops."""
from pathlib import Path
import sys, json, time
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend'))
from hdr_finisher.loader import load_image
from hdr_finisher.preview import downsample_image, encode_processed_preview_bytes
from hdr_finisher.models import RawImportSettings
out=ROOT/'output/hue-mask-smooth';out.mkdir(parents=True,exist_ok=True)
source=Path(r'D:/Photos/Play_Raw/Balanced Rock in Arches Nat Park - LaurentFromSF/IMG_0114.CR2')
cache=out/'scene.npy'
if not cache.exists():
 scene,*_=load_image(source,raw_import_settings=RawImportSettings())
 np.save(cache,scene)
scene=np.load(cache,mmap_mode='r')
print(scene.shape,flush=True)
fit=downsample_image(scene,1200)
from hdr_finisher.models import AdjustmentState,PreviewKind
from hdr_finisher.adjustments import apply_adjustments
saved=json.loads(Path(str(source)+'.hdrf').read_text())['grade']
review_global=json.loads(json.dumps(saved['global_adjustments']))
# Normalize an inactive threshold only in the review copy, never the sidecar.
if review_global['sdr']['highlight_desaturation']==0:
 review_global['sdr']['highlight_desaturation_start']=min(.99,review_global['sdr']['highlight_desaturation_start'])
state=AdjustmentState.model_validate(review_global)
state.hdr.highlight_section_enabled=True
state.hdr.highlight_compression_mode='peak_fit'
state.hdr.highlight_compression_target_nits=1000
rendered=apply_adjustments(fit,state,PreviewKind.SDR)
data,_=encode_processed_preview_bytes(rendered,PreviewKind.SDR)
(out/'overview.png').write_bytes(data)

from hdr_finisher.local_adjustments import hue_range_mask,compile_preview_mask
from hdr_finisher.models import MaskLeaf,MaskExpression,GeometryAdjustments,LocalAdjustment
from hdr_finisher.color import acescg_to_linear_srgb
from hdr_finisher.hsl import to_lab,_smooth,_delta
leaf=MaskLeaf(type='hue_range',hue_center=109,hue_width=24,hue_smoothness=41,saturation_floor=.04)
def old_mask(image):
 lab=to_lab(acescg_to_linear_srgb(image))
 hue=np.degrees(np.arctan2(lab[...,2],lab[...,1]))%360
 rel=np.hypot(lab[...,1],lab[...,2])/np.maximum(np.abs(lab[...,0]),1e-6)
 return ((1-_smooth(24,65,np.abs(_delta(hue,109))))*_smooth(.04,.08,rel)).astype(np.float32)
regions={'bush':(280,2800,512,512),'flowers':(1950,2870,512,512)}
rows=[]
for region,(x,y,w,h) in regions.items():
 # Refine with its complete native neighbourhood, then extract matched pixels.
 pad=16
 source_crop=np.array(scene[y-pad:y+h+pad,x-pad:x+w+pad])
 masks={'old':old_mask(source_crop),'new':hue_range_mask(leaf,source_crop)}
 for lane in ['hdr','sdr']:
  kind=PreviewKind(lane)
  base=apply_adjustments(source_crop,state,kind)
  local=LocalAdjustment(mask=MaskExpression(operator='leaf',leaf=leaf))
  local.hdr_grade.exposure=1.05;local.sdr_grade.exposure=1.05
  images={'original':base}
  for version,mask in masks.items():
   compiled={local.id:np.rint(mask*255).astype(np.uint8)}
   images[version+'-adjusted']=apply_adjustments(source_crop,state,kind,local_adjustments=[local],compiled_local_masks=compiled)
   # Overlay is composited in encoded display space for clear comparison.
   data,_=encode_processed_preview_bytes(base,kind)
   import io
   encoded=np.array(Image.open(io.BytesIO(data)).convert('RGB'),dtype=np.float32)/255
   alpha=mask[...,None]*.5
   overlay=encoded*(1-alpha)+np.array([1,0,0])*alpha
   Image.fromarray(np.uint8(np.clip(overlay[pad:pad+h,pad:pad+w],0,1)*255)).save(out/f'{lane}-{region}-{version}-overlay.png')
   Image.fromarray(np.uint8(mask[pad:pad+h,pad:pad+w]*255)).save(out/f'{lane}-{region}-{version}-mask.png')
  for label,pixels in images.items():
   pixels=pixels[pad:pad+h,pad:pad+w]
   for hdr in ([False,True] if lane=='hdr' else [False]):
    data,_=encode_processed_preview_bytes(pixels,kind,hdr_display=hdr)
    ext='avif' if hdr else 'png';(out/f'{lane}-{region}-{label}.{ext}').write_bytes(data)
    detail=pixels[150:250,200:300].repeat(5,0).repeat(5,1)
    data,_=encode_processed_preview_bytes(detail,kind,hdr_display=hdr)
    (out/f'{lane}-{region}-{label}-500.{ext}').write_bytes(data)
  print(region,lane,flush=True)
# Global Green channel, both a conspicuous hue shift and a luminance change.
for region,(x,y,w,h) in regions.items():
 source_crop=np.array(scene[y-16:y+h+16,x-16:x+w+16])
 for control,value in [('hue',35),('luminance',1.05)]:
  st=state.model_copy(deep=True);recipe=next(c.recipe for c in st.sdr.hsl.channels if c.id=='green')
  setattr(recipe,control,value)
  pixels=apply_adjustments(source_crop,st,PreviewKind.SDR)[16:16+h,16:16+w]
  data,_=encode_processed_preview_bytes(pixels,PreviewKind.SDR)
  (out/f'hsl-green-{control}-{region}.png').write_bytes(data)
html="""<!doctype html><meta charset='utf-8'><title>Balanced Rock â€” hue selection</title>
<style>body{background:#242424;color:#eee;font:16px system-ui;margin:24px}a{color:#acf}section{display:flex;gap:16px;overflow:auto}figure{margin:0}img{display:block;max-width:none;image-rendering:pixelated}button{margin:8px;padding:8px}figcaption{margin:6px 0} .crop{width:512px}body.zoom .crop{width:2560px}</style>
<h1>Balanced Rock â€” smooth hue selection</h1><p>Read-only RAW development. Hue 109Â°, range Â±24Â°, Smoothness 41Â°, Exclude neutrals 4%, Local Exposure +1.05 EV. Old/new use identical source pixels and grades. HDR AVIF preserves HDR; PNG is its SDR display view. Masks are shared across lanes.</p><button onclick="document.body.classList.toggle('zoom')">Toggle 100% / 500% (nearest source pixels)</button><p>At 500%, scroll each comparison horizontally. Browser zoom should be 100%.</p>"""
for lane in ['hdr','sdr']:
 for region in regions:
  html+=f'<h2>{lane.upper()} â€” {region}</h2>'
  for kind in ['adjusted','overlay','mask']:
   html+=f'<h3>{kind}</h3><section>'
   for version in ['old','new']:
    name=f'{lane}-{region}-{version}-{kind}.png'
    html+=f'<figure><figcaption>{version}</figcaption><img class="crop" src="{name}" loading="lazy"></figure>'
    if lane=='hdr' and kind=='adjusted':html+=f'<figure><figcaption>{version} HDR AVIF</figcaption><img class="crop" src="{name[:-3]}avif" loading="lazy"></figure>'
   html+='</section>'
html+='<h2>Saved 500% details</h2><p>Each detail is 100 native source pixels enlarged exactly five times.</p>'
for lane in ['hdr','sdr']:
 for region in regions:
  html+=f'<h3>{lane} {region}</h3><section>'+''.join(f'<figure><figcaption>{version}</figcaption><img src="{lane}-{region}-{version}-adjusted-500.png"></figure>' for version in ['old','new'])+'</section>'
html+='<h2>Global HSL Green diagnostic (SDR)</h2><p>Unchanged engine; +35Â° Hue and +1.05 EV Luminance.</p>'
for region in regions:
 html+='<section>'+''.join(f'<figure><figcaption>{region} {c}</figcaption><img class="crop" src="hsl-green-{c}-{region}.png"></figure>' for c in ['hue','luminance'])+'</section>'
html+='<h2>Whole photo</h2><img style="width:600px" src="overview.png">'
(out/'index.html').write_text(html,encoding='utf8')
(out/'recipe.json').write_text(json.dumps({'source':str(source),'regions':regions,'hue':109,'range':24,'smoothness':41,'exclude_neutrals':.04,'local_exposure':1.05,'native_shape':list(scene.shape)},indent=2))

# Persist exact five-times overlay/mask details too.
for file in list(out.glob('*-overlay.png'))+list(out.glob('*-mask.png')):
 im=Image.open(file).crop((200,150,300,250)).resize((500,500),Image.Resampling.NEAREST)
 im.save(file.with_stem(file.stem+'-500'))
# Whole-photo comparison uses native selections reduced to the same Fit grid.
masks={'old':old_mask(scene),'new':hue_range_mask(leaf,scene)}
for lane in ['hdr','sdr']:
 kind=PreviewKind(lane)
 local=LocalAdjustment(mask=MaskExpression(operator='leaf',leaf=leaf))
 local.hdr_grade.exposure=1.05;local.sdr_grade.exposure=1.05
 base=apply_adjustments(fit,state,kind)
 for version,mask in masks.items():
  reduced=np.rint(np.clip(downsample_image(mask,1200),0,1)*255).astype(np.uint8)
  rendered=apply_adjustments(fit,state,kind,local_adjustments=[local],compiled_local_masks={local.id:reduced})
  data,_=encode_processed_preview_bytes(rendered,kind);(out/f'{lane}-fit-{version}.png').write_bytes(data)
  if lane=='hdr':
   data,_=encode_processed_preview_bytes(rendered,kind,hdr_display=True);(out/f'{lane}-fit-{version}.avif').write_bytes(data)
  data,_=encode_processed_preview_bytes(base,kind)
  import io
  rgb=np.array(Image.open(io.BytesIO(data)).convert('RGB'),np.float32)/255
  a=reduced[...,None]/510
  Image.fromarray(np.uint8(np.clip(rgb*(1-a)+np.array([1,0,0])*a,0,1)*255)).save(out/f'{lane}-fit-{version}-overlay.png')
 html+=f'<h2>{lane.upper()} Fit — native selection reduced for display</h2><section>'+''.join(f'<figure><figcaption>{v}</figcaption><img style="width:600px" src="{lane}-fit-{v}.png"></figure>' for v in ['old','new'])+'</section>'
 html+='<section>'+''.join(f'<figure><figcaption>{v} overlay</figcaption><img style="width:600px" src="{lane}-fit-{v}-overlay.png"></figure>' for v in ['old','new'])+'</section>'
(out/'index.html').write_text(html,encoding='utf8')
(out/'saved-grade.json').write_text(json.dumps(saved,indent=2))

# Synthetic selection view beside the real-photo comparisons.
import runpy
synthetic=runpy.run_path(str(ROOT/'tests/test_hue_mask.py'))['noisy_patch']()
spec=leaf.model_copy(update={'hue_width':12,'hue_smoothness':20})
lab=to_lab(acescg_to_linear_srgb(synthetic))
hue=np.degrees(np.arctan2(lab[...,2],lab[...,1]))%360
relative=np.hypot(lab[...,1],lab[...,2])/np.maximum(np.abs(lab[...,0]),1e-6)
old=(1-_smooth(12,32,np.abs(_delta(hue,109))))*_smooth(.04,.08,relative)
new=hue_range_mask(spec,synthetic)
for version,mask in [('old',old),('new',new)]:
 Image.fromarray(np.uint8(mask*255)).resize((768,384),Image.Resampling.NEAREST).save(out/f'synthetic-{version}-mask.png')
html+='<h2>Synthetic noisy colour / neutral boundary / bright fringe</h2><p>Stress selection 109°, ±12°, Smoothness 20°, Exclude neutrals 4%. The narrow bright line on the neutral side should be left out. Source pixels are enlarged 4×.</p><section>'+''.join(f'<figure><figcaption>{v}</figcaption><img src="synthetic-{v}-mask.png"></figure>' for v in ['old','new'])+'</section>'
if (out/'synthetic.json').exists():html+='<pre>'+ (out/'synthetic.json').read_text(encoding='utf8')+'</pre>'
if (out/'gpu-delivery.json').exists():html+='<h3>Encoded GPU/CPU AVIF agreement and exact ceiling</h3><pre>'+ (out/'gpu-delivery.json').read_text(encoding='utf8')+'</pre>'
html+='<p>Fixed defaults: bilateral colour radius 3 source pixels; coverage radius 2; positive fine-detail protection begins at +0.20 EV and reaches full suppression at +0.90 EV. These protect edges but can reduce the lift on fine petals and twigs. Broad bright colour is not automatically excluded.</p>'
(out/'index.html').write_text(html,encoding='utf8')
