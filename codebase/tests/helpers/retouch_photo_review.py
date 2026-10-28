"""DSC04375 review: one shared native decode, small retained crops only."""
import base64,json,sys,os
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'backend'))
from hdr_finisher.loader import load_image
from hdr_finisher.models import RawImportSettings,AdjustmentState,PreviewKind
from hdr_finisher.retouch_recipe import InpaintRecipe,RepairPoint,prepare_repair,stroke_mask
from hdr_finisher.retouch import CpuInpaint
from hdr_finisher.retouch_methods import finish_repair
from hdr_finisher.retouch_transfer import transfer_repair
from hdr_finisher.retouch_gpu import packet
from hdr_finisher.adjustments import apply_adjustments
from hdr_finisher.preview import _encode_png_sdr,downsample_image
from hdr_finisher.delivery_colour import compare_finished_pixels
from PIL import Image
from io import BytesIO
folder=Path(sys.argv[2]);folder.mkdir(parents=True,exist_ok=True)
photo=Path('output/test-photos/DSC04375.ARW')
saved=json.loads(photo.with_name(photo.name+'.hdrf').read_text())['grade']
if sys.argv[1]=='prepare':
    base,*_=load_image(photo,raw_import_settings=RawImportSettings.model_validate(saved['source']['raw_import_settings']))
    np.save(folder/'native.npy',base)
    original=InpaintRecipe.model_validate(saved['repairs'][0]['recipe'])
    rows=[]
    for mode in ('inpaint','clone','heal'):
        recipe=original.model_copy(update=dict(mode=mode,source_point=None if mode=='inpaint' else RepairPoint(x=original.points[0].x-.02,y=original.points[0].y)))
        (meta,values),_=packet(recipe,base)
        if mode=='inpaint':
            request=prepare_repair(recipe,lambda t,l,b,r:base[t:b,l:r])
            cpu=finish_repair(recipe,request,CpuInpaint().solve(request,recipe.settings),stroke_mask(recipe))
        else:cpu,_=transfer_repair(recipe,base)
        np.save(folder/(mode+'-cpu.npy'),cpu.pixels)
        rows.append(dict(name=mode,recipe=recipe.model_dump(mode='json'),meta=meta,body=base64.b64encode(values.tobytes()).decode(),origin=cpu.origin))
    (folder/'packets.json').write_text(json.dumps(rows))
else:
    base=np.load(folder/'native.npy',mmap_mode='r')
    rows=json.loads((folder/'packets.json').read_text());results=json.loads((folder/'gpu.json').read_text())
    from hdr_finisher.projects import _validate_ignoring_unknown_fields
    grade=_validate_ignoring_unknown_fields(saved).global_adjustments
    report=[]
    for row,result in zip(rows,results):
        mode=row['name'];m=row['meta'];recipe=InpaintRecipe.model_validate(row['recipe'])
        x,y=m['origin'];ph,pw=m['ph'],m['pw']
        alpha=stroke_mask(recipe);ax=x-recipe.search_rect[0];ay=y-recipe.search_rect[1]
        mask=alpha[ay:ay+ph,ax:ax+pw]>0
        gpu=np.frombuffer(base64.b64decode(result),dtype='<f4')[:ph*pw*3].reshape(ph,pw,3)
        cpu=np.load(folder/(mode+'-cpu.npy'))
        px=int(recipe.points[0].x*base.shape[1]);py=int(recipe.points[0].y*base.shape[0])
        l=max(0,px-180);t=max(0,py-160);r=min(base.shape[1],l+360);b=min(base.shape[0],t+320)
        finished={}
        for route,patch in [('cpu',cpu),('gpu',gpu)]:
            image=np.array(base)
            window=image[y:y+ph,x:x+pw];np.copyto(window,patch,where=mask[...,None])
            processed=apply_adjustments(image,grade,PreviewKind.SDR)
            del image
            finished[route]=processed[y:y+ph,x:x+pw].copy()
            (folder/f'{mode}-{route}-native.png').write_bytes(_encode_png_sdr(processed[t:b,l:r]))
            (folder/f'{mode}-{route}-fit.png').write_bytes(_encode_png_sdr(downsample_image(processed,900)))
            del processed
        delta=compare_finished_pixels(finished['cpu'][mask][None],finished['gpu'][mask][None],'sdr')
        report.append(dict(mode=mode,metric=delta.metric,mean=delta.mean,p999=delta.p999,gate=False,inside_pixels=int(mask.sum())))
        print(json.dumps(report[-1]),flush=True)
        (folder/(mode+'-cpu.npy')).unlink()
    (folder/'difference.json').write_text(json.dumps(report,indent=2))
    cards=''.join(f"<section><h2>{row['mode'].title()}</h2><p>Inside repair: mean Î”E 2000 {row['mean']:.7g}, p99.9 {row['p999']:.7g}. Information only.</p>"+''.join(f"<figure><figcaption>{route.upper()} Â· {view}</figcaption><img src='{row['mode']}-{route}-{view}.png'></figure>" for view in ['native','fit'] for route in ['gpu','cpu'])+'</section>' for row in report)
    (folder/'index.html').write_text("<!doctype html><meta charset='utf-8'><title>DSC04375 Â· GPU and CPU repairs</title><style>body{background:#171c20;color:#eee;font:16px system-ui;margin:24px}section{display:flex;flex-wrap:wrap;gap:16px;border-top:1px solid #48525b;padding:20px 0}h2,p{width:100%;margin:0}figure{margin:0}figcaption{padding:8px 0}img{display:block;max-width:100%}</style><h1>DSC04375 Â· GPU and CPU repair comparison</h1><p>Disposable copy. Saved grade, one original 30 px radius spot; other saved repairs omitted. Clone and Heal use a source 2% of photo width to the left. Native crops show one image pixel per screen pixel at browser 100%; Fit shows the whole photo at 900 px. Heal remains a prototype. Inside differences are information for your by-eye judgement.</p>"+cards)
    del base
    for name in ['native.npy','packets.json','gpu.json']:(folder/name).unlink(missing_ok=True)
