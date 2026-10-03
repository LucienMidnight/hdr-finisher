"""Hold GPU-generated soft verdicts to native CPU-mask accuracy, without changing the trial."""
import base64,json,sys
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path('backend').resolve()))
from hdr_finisher.models import MaskExpression,GeometryAdjustments
from hdr_finisher.local_adjustments import compile_geometry_fixed_mask
from hdr_finisher.mask_softness import bitmap_frame_rect, gpu_bitmap_soft_verdict
from soft_mask_survey import sample_bilinear
path=Path(sys.argv[1])
report=json.loads(path.read_text())
accepted=[]
for i,item in enumerate(report['results']):
 fixture=item['qualification']
 expression=MaskExpression.model_validate(fixture['expression'])
 geometry=GeometryAdjustments.model_validate(fixture['geometry'])
 width,height=item['width'],item['height']
 frame_width,frame_height=fixture.get('frameWidth') or width,fixture.get('frameHeight') or height
 source_width,source_height=(frame_height,frame_width) if geometry.rotation%180 else (frame_width,frame_height)
 rect=bitmap_frame_rect(source_width*3,source_height*3,source_width,source_height,geometry)
 data=fixture['bitmap']
 bitmap=(np.frombuffer(base64.b64decode(data),np.uint8) if isinstance(data,str) else np.asarray(data,np.uint8)).reshape(height,width)
 verdict=gpu_bitmap_soft_verdict(expression,bitmap,source_width,source_height,rect=rect)
 if not verdict.soft or max(source_width,source_height)>512:continue
 exact=compile_geometry_fixed_mask(np.zeros((source_height*3,source_width*3,3),np.float32),expression,geometry,spatial_only=True)
 native_height,native_width=exact.shape
 y,x=np.mgrid[:native_height,:native_width].astype(np.float32)
 ox,oy,extent_x,extent_y=rect or (0,0,1,1)
 actual=(np.frombuffer(base64.b64decode(fixture['textureHalf']),dtype='<f2').astype(np.float32).reshape(height,width)*255
         if fixture.get('textureHalf') else bitmap.astype(np.float32))
 sampled=sample_bilinear(actual,((x+.5)/native_width-ox)/extent_x*width-.5,((y+.5)/native_height-oy)/extent_y*height-.5)
 delta=np.abs(sampled-exact)
 accepted.append(dict(case=i,maxLevels=float(delta.max()),pixelsOverTwo=int((delta>2).sum()),estimate=verdict.estimate))
report['qualification']={'nativeScale':3,'sampling':'actual GPU R16 coverage where captured; otherwise classifier R8 bitmap','tested':sum(max(item.get('width',0),item.get('height',0))<=512 for item in report['results']),'accepted':len(accepted),'results':accepted,'maxLevels':max((item['maxLevels'] for item in accepted),default=0)}
path.write_text(json.dumps(report,indent=2)+'\n')
over_two=[item for item in accepted if item['maxLevels']>2]
failures=[item for item in accepted if item['maxLevels']>3]
report['qualification']['overApprovedTwo']=len(over_two)
report['qualification']['overWorkingThree']=len(failures)
path.write_text(json.dumps(report,indent=2)+'\n')
print(f"GPU soft qualification: {len(accepted)} admitted of {report['qualification']['tested']}; {len(over_two)} exceed approved two levels; {len(failures)} exceed trial three, maximum {report['qualification']['maxLevels']:.6f}.")
if failures:sys.exit(1)
