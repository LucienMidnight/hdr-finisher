"""Reproducible read-only Sharpen review. Writes only under output/sharpen-review."""
from pathlib import Path
import json, sys
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend'))
from hdr_finisher.loader import load_image
from hdr_finisher.models import AdjustmentState, PreviewKind
from hdr_finisher.adjustments import apply_adjustments
from hdr_finisher.preview import encode_processed_preview_bytes, downsample_image
OUT=ROOT/'output/sharpen-review'
OUT.mkdir(parents=True,exist_ok=True)
SOURCES=[Path(r'D:\Photos\2026\20261017 badminton')/name for name in ('DSC07147.ARW','DSC07178.ARW')]
VARIANTS={'off':(0,.8,10),'default':(0,.8,10),'working':(80,.8,10),'strong':(200,3,0)}
BOXES={'DSC07147':(4180,2570),'DSC07178':(1500,1740)}

def prepare():
 import OpenEXR, Imath
 for source in SOURCES:
  cached=OUT/(source.stem+'-scene.npy')
  if not cached.exists():
   image,*_=load_image(source)
   np.save(cached,image)
  image=np.load(cached,mmap_mode='r')
  x,y=BOXES[source.stem]; margin=32; size=512
  crop=np.array(image[y-margin:y+size+margin,x-margin:x+size+margin],copy=True)
  h,w=crop.shape[:2]; header=OpenEXR.Header(w,h)
  header['channels']={c:Imath.Channel(Imath.PixelType(Imath.PixelType.FLOAT)) for c in 'RGB'}
  header['chromaticities']=Imath.Chromaticities(Imath.V2f(.713,.293),Imath.V2f(.165,.830),Imath.V2f(.128,.044),Imath.V2f(.32168,.33767))
  output=OpenEXR.OutputFile(str(OUT/(source.stem+'-crop.exr')),header)
  output.writePixels({c:crop[:,:,i].astype(np.float32).tobytes() for i,c in enumerate('RGB')});output.close()
  for variant,(amount,radius,threshold) in VARIANTS.items():
   state=AdjustmentState();state.hdr.highlight_section_enabled=True
   for lane in ('hdr','sdr'):
    detail=getattr(state,lane).detail
    detail.sharpen_amount=amount;detail.sharpen_radius_px=radius;detail.sharpen_threshold=threshold
    kind=PreviewKind(lane)
    rendered=apply_adjustments(crop,state,kind,source_pixel_scale=1)[margin:-margin,margin:-margin]
    np.save(OUT/f'{source.stem}-{lane}-{variant}.npy',rendered)
    for hdr_display in ([False,True] if lane=='hdr' else [False]):
     data,mime=encode_processed_preview_bytes(rendered,kind,hdr_display=hdr_display)
     suffix='avif' if hdr_display else 'png'
     (OUT/f'{source.stem}-{lane}-{variant}.{suffix}').write_bytes(data)
   print(source.stem,variant,flush=True)
 (OUT/'recipe.json').write_text(json.dumps({'sources':[str(s) for s in SOURCES],'crop_xy':BOXES,'size':512,'margin':32,'variants':VARIANTS,'source_pixel_scale':1,'highlight_target':1000,'raw':'loader defaults; no saved grade; Texture/Clarity zero'},indent=2))

def compare():
 from hdr_finisher.delivery_colour import compare_finished_pixels
 from hdr_finisher.hdr_delivery import check_decoded_hdr_ceiling
 results=[]
 for source in SOURCES:
  for variant in ('off','working','strong'):
   first=load_image(OUT/f'{source.stem}-{variant}-gpu.jpg')
   second=load_image(OUT/f'{source.stem}-{variant}-cpu.jpg')
   record={'source':source.name,'variant':variant}
   for lane,index in [('hdr',0),('sdr',4)]:
    metric=compare_finished_pixels(first[index],second[index],lane)
    record[lane]={'mean':metric.mean,'p999':metric.p999,'passed':metric.passed}
   record['gpu_ceiling']=check_decoded_hdr_ceiling(OUT/f'{source.stem}-{variant}-gpu.jpg','jpeg_ultrahdr',1000)
   record['cpu_ceiling']=check_decoded_hdr_ceiling(OUT/f'{source.stem}-{variant}-cpu.jpg','jpeg_ultrahdr',1000)
   results.append(record);print(json.dumps(record),flush=True)
 (OUT/'export-agreement.json').write_text(json.dumps(results,indent=2))

if __name__=='__main__':
 if len(sys.argv)>1 and sys.argv[1]=='compare':compare()
 else:prepare()
