"""Compare cached GPU RAW screen/native pictures with full Grade development."""
import json, sys
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'backend'))
from hdr_finisher.sessions import SessionStore
from hdr_finisher.library_pictures import reduce_picture, default_document_key
from hdr_finisher.models import RawImportSettings, AdjustmentState, LocalAdjustment, LocalGrade, MaskExpression, MaskLeaf, MaskPoint, PreviewKind
from hdr_finisher.adjustments import apply_adjustments
from hdr_finisher.delivery_colour import compare_finished_pixels
from hdr_finisher.color_context import RenderColorContext

def finish(image,grade):
    grade=AdjustmentState.model_validate(grade)
    grade.hdr.film_look.grain_amount=25; grade.sdr.film_look.grain_amount=25
    local=LocalAdjustment(mask=MaskExpression(leaf=MaskLeaf(type='linear_gradient',start=MaskPoint(x=0,y=.5),end=MaskPoint(x=1,y=.5))),hdr_grade=LocalGrade(exposure=.2),sdr_grade=LocalGrade(exposure=.2))
    return {lane:apply_adjustments(image,grade,PreviewKind(lane),local_adjustments=[local],color_context=RenderColorContext(203)) for lane in ('hdr','sdr')}

def load(root,meta):
    for name in ('library-pictures','library-full-pictures'):
        file=root/name/(meta['key']+'.npz')
        if file.is_file():
            with np.load(file,allow_pickle=False) as stored:return stored['pixels'].astype(np.float32)
    raise FileNotFoundError(meta['key'])

def main(file):
    data=json.loads(Path(file).read_text());root=Path(data['location']);rows=[]
    for row in data['rows']:
        path=Path(row['path']);doc=json.loads((root/'library-pictures'/(default_document_key(path)+'.json')).read_text())
        source=SessionStore().prepare_session(path,raw_import_settings=RawImportSettings.model_validate(doc['source']['raw_import_settings']))
        cpu=source.image; checks=[]
        a=finish(reduce_picture(cpu,2560),source.starting_adjustments().model_dump(mode='json'))
        b=finish(load(root,row['screen']),row['screen']['adjustments'])
        for edge in (2560,1280):
            for lane in ('hdr','sdr'):
                d=compare_finished_pixels(reduce_picture(a[lane],edge),reduce_picture(b[lane],edge),lane)
                checks.append(dict(view='screen',edge=edge,lane=lane,mean=d.mean,p999=d.p999,passed=d.passed))
        m=row['native'];x,y,w,h=(m[k] for k in ('crop_x','crop_y','width','height'))
        a=finish(cpu[y:y+h,x:x+w],source.starting_adjustments().model_dump(mode='json'));b=finish(load(root,m),m['adjustments'])
        for lane in ('hdr','sdr'):
            d=compare_finished_pixels(a[lane],b[lane],lane)
            checks.append(dict(view='native-crop',lane=lane,mean=d.mean,p999=d.p999,passed=d.passed))
        rows.append(dict(photo=path.name,lens_corrected=row['screen']['lens_correction_applied'],comparisons=checks))
    print(json.dumps(dict(photos=rows)))
if __name__=='__main__':main(sys.argv[1])
