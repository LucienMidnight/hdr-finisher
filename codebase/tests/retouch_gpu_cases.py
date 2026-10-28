"""Small deterministic packets and CPU comparisons for the GPU behavior driver."""
import base64
import json
from pathlib import Path
import sys
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from hdr_finisher.retouch_recipe import InpaintRecipe,RepairPoint,DonorExclusion,prepare_repair,stroke_mask
from hdr_finisher.retouch import CpuInpaint
from hdr_finisher.retouch_methods import finish_repair
from hdr_finisher.retouch_transfer import transfer_repair
from hdr_finisher.retouch_gpu import packet


def cases():
    rng=np.random.default_rng(20261028)
    y,x=np.mgrid[:96,:128]
    image=np.stack((.15+x*.001,.3+y*.001,.2+x*.0008+y*.0004),axis=-1)
    image+=rng.normal(0,.008,image.shape)
    image=image.astype(np.float32)
    image[44:50,60:66]*=.25
    rows=[]
    specs=[('inpaint',method,False) for method in ('standard','edge-feather','original-detail','donor-detail')]
    specs += [('clone','standard',False),('heal','standard',False),('inpaint','original-detail',True)]
    for mode,method,native in specs:
        base=np.repeat(np.repeat(image,3,axis=0),3,axis=1) if native else image
        h,w=base.shape[:2]
        recipe=InpaintRecipe(source_size=(w,h),search_rect=(w//8,h//12,w-w//8,h-h//12),mode=mode,method=method,
            points=(RepairPoint(x=.5,y=.5),),source_point=RepairPoint(x=.25,y=.25) if mode!='inpaint' else None,
            radius_px=12 if native else 6,edge_feather=.71,
            donor_exclusions=(DonorExclusion(points=(RepairPoint(x=.65,y=.6),),radius_px=4,hardness=1),))
        (meta,data),targets=packet(recipe,base)
        if mode=='inpaint':
            request=prepare_repair(recipe,lambda t,l,b,r:base[t:b,l:r])
            cpu=finish_repair(recipe,request,CpuInpaint().solve(request,recipe.settings),stroke_mask(recipe))
        else:
            cpu,_=transfer_repair(recipe,base)
        # Upload the entire frozen native photo for the reference run. Every
        # native/source tap resolves in that full frame rather than a crop.
        reference=dict(meta,reference_offset=len(data),reference_width=w)
        windows=[]
        def window(name,width,height,left,top):
            windows.append(dict(offset=meta['input'][name],width=width,height=height,left=left,top=top))
        if mode=='inpaint':
            window('native',meta['nw'],meta['nh'],recipe.search_rect[0],recipe.search_rect[1])
        else:
            left,top=meta['origin']
            window('original',meta['w'],meta['h'],left,top)
            dx=(recipe.source_point.x-recipe.points[0].x)*w
            dy=(recipe.source_point.y-recipe.points[0].y)*h
            window('donor',meta['sw'],meta['sh'],round(left+dx-meta['sx']),round(top+dy-meta['sy']))
        reference['reference_windows']=windows
        full=np.concatenate((data,(base.astype(np.float64)/meta['scale']).astype(np.float32).reshape(-1)))
        reference['input_count']=len(full)
        rows.append(dict(reference=reference,whole=base64.b64encode(full.tobytes()).decode(),name=f'{mode}-{method}'+('-native' if native else ''),meta=meta,
            body=base64.b64encode(data.tobytes()).decode(),cpu=base64.b64encode(cpu.pixels.tobytes()).decode(),
            donors=cpu.source_centres.tolist()))
    return rows

if __name__=='__main__':
    Path(sys.argv[1]).write_text(json.dumps(cases()),encoding='utf-8')
