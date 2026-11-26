"""Bounded colour-cleanup experiment; every heavy phase needs machine lock/guard."""
from __future__ import annotations
import os
for key in ('OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS','VECLIB_MAXIMUM_THREADS','HDR_CPU_THREADS'): os.environ[key]='1'
import argparse
from dataclasses import replace
import gc
import hashlib
from html import escape
import itertools
import json
from pathlib import Path
import time
import cv2
import numpy as np
from PIL import Image, ImageDraw
import rawpy
from tools.denoise_eval.candidates import early_outlier_measure as base
from tools.denoise_eval.candidates import chroma_cleanup as trial
from tools.denoise_eval.candidates.demosaic_measure import measure_sample
from tools.denoise_eval.candidates.signed_measure import comparison, fixed_shadow_tail
from tools.denoise_eval.candidates.signed_shadows import develop_signed
from tools.denoise_eval.datasets.summarize import summarize
ROOT=base.ROOT
OUTPUT=ROOT/'output/denoise-v1/chroma-cleanup'
SWEEP=('green','median1','median3','median1_y',*(f'gm{k}_a{a}' for k in (2,3,4) for a in (1,9,25)),'green_gm','gm_ob',*(f'post{k}_a{a}' for k in (2,3,4) for a in (1,9,25)),*(f'local{k}_a{a}' for k in (2,3,4) for a in (1,9,25)),*(f'wide_{stage}{k}{suffix}' for stage in ('pre','post') for k in (2,3) for suffix in ('','_a81')),'wide_unguarded')
LEADERS=('green','median1','median3','median1_y','gm2_a25','green_gm','gm_ob','local2_a25','wide_pre2','wide_post2','wide_unguarded')
REVIEW=('off','denoise','taming','green','median1','median1_y','gm2_a25','wide_pre2','wide_post2','wide_unguarded')


def stamp(args):
    result=base.provenance(args.inventory)
    for path in (Path(__file__),Path(trial.__file__),Path(base.trial.__file__),Path(base.__file__)):
        result['code_sha256'][str(path.relative_to(ROOT))]=hashlib.sha256(path.read_bytes()).hexdigest()
    result['variants']={name:getattr(trial,name)().description() for name in ('taming',*SWEEP)}
    return result


def methods(sweep=False):
    return dict(off=base.Off(),denoise=base.calibrated(),taming=trial.taming(),**{name:getattr(trial,name)() for name in (SWEEP if sweep else LEADERS)})


def islands(mask):
    mask=mask.copy();mask[:6]=mask[-6:]=False;mask[:,:6]=mask[:,-6:]=False
    _,_,stats,_=cv2.connectedComponentsWithStats(mask.astype('uint8'),8)
    sizes=stats[1:,cv2.CC_STAT_AREA]
    return dict(islands=int(np.count_nonzero((sizes>=1)&(sizes<=25))),pixels=int(mask.sum()))


def gm_count(image):
    shown=base.metrics.display(image).astype('float32')
    gm=(shown@trial.GM).astype('float32');ob=(shown@trial.OB).astype('float32')
    residual=gm-cv2.medianBlur(gm,5);other=ob-cv2.medianBlur(ob,5)
    mask=(abs(residual)>.08)&(abs(residual)>.75*abs(other))
    return dict(combined=islands(mask),green=islands(mask&(residual>0)),magenta=islands(mask&(residual<0)),
        residual_p999=float(np.percentile(abs(residual[6:-6,6:-6]),99.9)))


def save(image,path,size=224):
    picture=Image.fromarray(base.decision_crops.pixels(image))
    if max(picture.size)>size: picture.thumbnail((size,size),Image.Resampling.LANCZOS)
    picture.save(path,optimize=True)


def render_row(sample,selected,folder,offset,lift,zoom=None):
    left,top=offset;region=np.s_[top:top+288,left:left+288]
    records={};folder.mkdir(parents=True,exist_ok=True)
    for name,adapter in selected.items():
        source=sample.bayer if adapter.input_kind=='bayer' else sample.rgb
        tick=time.perf_counter();state=adapter.prepare(source,sample.metadata)
        result=adapter.process(source,sample.metadata,state);shown=result*np.float32(2**lift)
        records[name]=dict(seconds=time.perf_counter()-tick,specks=base.count_specks(shown[region]),green_magenta=gm_count(shown[region]),
            tail=fixed_shadow_tail(result[region],sample.rgb[region],stops=sample.metadata.get('exposure_stops',0)),
            diagnostics=state[2] if isinstance(adapter,trial.ChromaCleanup) else None)
        if name in REVIEW:
            save(shown[region],folder/(name+'.png'))
            if zoom is not None:
                zx,zy=zoom
                pixels=base.decision_crops.pixels(shown[top+zy-24:top+zy+24,left+zx-24:left+zx+24])
                Image.fromarray(pixels).resize((288,288),Image.Resampling.NEAREST).save(folder/(name+'-zoom.png'),optimize=True)
        del state,result,shown;gc.collect()
    return records


def gallery(args):
    original=base.OUTPUT,base.methods,base.render_row,base.stamp,base.review
    base.OUTPUT=OUTPUT/'review';base.methods=lambda _:methods(True)
    base.render_row,base.stamp,base.review=render_row,stamp,lambda *a,**k:None
    args.no_ai=True
    previous=None
    if args.phase in ('gallery-post','gallery-wide'):
        previous=json.loads((OUTPUT/'review/gallery/manifest.json').read_text())
        base.methods=lambda _: {name:getattr(trial,name)() for name in SWEEP if name.startswith('wide' if args.phase=='gallery-wide' else 'local')}
    try: base.gallery(args)
    finally: base.OUTPUT,base.methods,base.render_row,base.stamp,base.review=original
    if previous is not None:
        current=json.loads((OUTPUT/'review/gallery/manifest.json').read_text())
        for row in current['cases']:
            old=next(value for value in previous['cases'] if value['id']==row['id'])
            row['methods']={**old['methods'],**row['methods']}
        current['pre_stage_provenance']={key:value for key,value in previous.items() if key!='cases'}
        base.write(OUTPUT/'review/gallery/manifest.json',current)


def quality(args,entries):
    samples=(s for s in base.inputs.paired_samples(ROOT/'output/denoise-v1/datasets/rawnind/pairs') if bool(s.metadata['held_out'])==(args.phase=='heldout')) if args.phase in ('heldout','seen') else itertools.chain(base.inputs.synthetic_samples(entries,args.phase=='quick'),base.inputs.real_samples(entries,args.phase=='quick'))
    result=dict(cases=[],**stamp(args));start=time.perf_counter()
    for sample in samples:
        result['cases'].append(measure_sample(base.signed_sample(sample),methods()))
        base.write(OUTPUT/(args.phase+'.json'),result);print(args.phase,sample.name,flush=True);gc.collect()
    if args.phase in ('heldout','seen'): result['summary']=summarize(result)
    result.update(elapsed_seconds=time.perf_counter()-start,peak_rss_bytes=base.peak_rss())
    base.write(OUTPUT/(args.phase+'.json'),result)


def clean_targets():
    size=288;y,x=np.indices((size,size),dtype=float)
    palette=np.array([[.02,.45,.03],[.5,.02,.4],[.5,.15,.01],[.03,.12,.5]])
    stars=np.full((size,size,3),.003,np.float32)
    for row,sigma in enumerate((.8,1.2,1.8)):
        for column,color in enumerate(palette):
            cy,cx=50+row*90+.33,40+column*68+.67
            stars+=np.exp(-((x-cx)**2+(y-cy)**2)/(2*sigma*sigma))[...,None]*color
    yield 'coloured-stars','Noise-free lights, Gaussian widths 1.88/2.83/4.24px',stars
    mask=Image.new('L',(size,size),0);draw=ImageDraw.Draw(mask)
    for i in range(12,size-12,24): draw.text((12,i),'HDR green MAGENTA 12345',fill=255)
    alpha=np.asarray(mask)/255;colors=palette[((y//24).astype(int)%4)]
    yield 'coloured-text','Noise-free coloured fine lettering',(.04+alpha[...,None]*colors).astype('float32')
    weave=.5+.5*np.sin(2*np.pi*x/4.7)*np.sin(2*np.pi*y/6.3)
    yield 'coloured-fabric','Noise-free fine multicolour weave',(np.full((size,size,3),.08)+weave[...,None]*palette[((x//48+y//48).astype(int)%4)]*.6).astype('float32')
    flowers=np.full((size,size,3),.025)
    for cy,cx,color in ((70,70,0),(70,200,1),(190,90,2),(200,220,3)):
        r=np.hypot(x-cx,y-cy);angle=np.arctan2(y-cy,x-cx)
        flowers+=((r<8+4*np.cos(5*angle)))[...,None]*palette[color]
    yield 'small-flowers','Noise-free small coloured petals',flowers.astype('float32')


def clean(args,entries):
    prototype=next(base.inputs.synthetic_samples(entries,True));info=dict(prototype.metadata,exposure_stops=0)
    info['noise_parameters']=[dict(a=p['a']/16,b=p['b']/256) for p in info['noise_parameters']];info['iso']=100
    samples=[]
    for name,title,aces in clean_targets():
        camera=aces@np.linalg.inv(np.asarray(info['camera_to_acescg'])).T/np.asarray(info['white_balance'])
        sensor=base.inputs.remosaic(np.clip(camera,0,1),info['cfa']);reference=develop_signed(sensor,info)
        samples.append((name,title,base.inputs.Sample(name,reference,sensor,info,reference,base.inputs.masks_for(reference))))
    scenes=set()
    for sample in base.inputs.paired_samples(ROOT/'output/denoise-v1/datasets/rawnind/pairs'):
        scene=sample.metadata['scene_id']
        if scene in scenes or sample.metadata.get('crop_kind') != 'texture' or not any(word in scene.lower() for word in ('vaxt','pen','blom','fabric')): continue
        scenes.add(scene);md=dict(sample.metadata)
        manifest=json.loads((ROOT/'tools/denoise_eval/datasets/rawnind-manifest.json').read_text())['files']
        clean_iso=next(row['iso'] for row in manifest if row['file']==md['clean_source']);ratio=float(clean_iso)/md['iso']
        md['noise_parameters']=[dict(a=a*ratio,b=b*ratio*ratio) for a,b in trial.noise_positions(md)];md['iso']=clean_iso
        md['clean_noise_model_qualification']='No reference fit in prepared bundle; ISO-scaled provisional sensor fit'
        rgb=develop_signed(sample.clean_bayer,md)
        samples.append(('lowiso-'+scene,'Real low-ISO reference: '+scene,replace(sample,rgb=rgb,bayer=sample.clean_bayer,clean=rgb,metadata=md)))
    result=dict(cases=[],**stamp(args))
    for name,title,sample in samples:
        folder=OUTPUT/'review/clean'/name;folder.mkdir(parents=True,exist_ok=True)
        baseline=None;record=dict(id=name,title=title,metadata=sample.metadata,methods={})
        reference=sample.rgb;feature=np.ptp(base.metrics.display(reference),axis=-1)>.1
        if 'valid' in sample.masks: feature&=sample.masks['valid']
        for method,adapter in methods(True).items():
            src=sample.bayer if adapter.input_kind=='bayer' else sample.rgb
            state=adapter.prepare(src,sample.metadata);output=adapter.process(src,sample.metadata,state)
            if method=='taming': baseline=output.copy()
            if method in REVIEW: save(output,folder/(method+'.png'),288)
            retention=None
            if baseline is not None and feature.any():
                q=base.metrics.display(output)@trial.GM;ref=base.metrics.display(baseline)@trial.GM
                retention=base.metrics.ratio(float(np.sum(abs(q[feature]))),float(np.sum(abs(ref[feature]))))
            record['methods'][method]=dict(error=comparison(output,reference,sample.masks.get('valid')),
                feature_error=comparison(output,reference,feature) if feature.any() else None,
                feature_gm_retention_vs_taming=retention,
                incremental_vs_taming=comparison(output,baseline,sample.masks.get('valid')) if baseline is not None else None,
                diagnostics=state[2] if isinstance(adapter,trial.ChromaCleanup) else None)
            del state,output
        save(reference,folder/'clean.png',288);record['feature_pixels']=int(feature.sum())
        result['cases'].append(record);base.write(OUTPUT/'review/clean/manifest.json',result);print('clean',name,flush=True)


def diagnostic(args):
    rows=json.loads((OUTPUT/'review/gallery/manifest.json').read_text())['cases']
    result=dict(cases=[],**stamp(args))
    for row in rows:
        if row['id'] not in ('IMG_0790-1','IMG_0790-2','7D-1_ISO12800-1'): continue
        with rawpy.imread(row['source_path']) as raw:
            left,top=row['sensor_xy'];sensor=base.inputs.normalise_crop(raw,top,left,512)
        info=row['metadata'];reference,_=trial.develop(sensor,info);adapter=base.calibrated()
        model=adapter.prepare(reference,info)
        record=dict(id=row['id'],methods={})
        for name in ('taming','median1','median3','median1_y'):
            rgb,_=trial.develop(sensor,info,getattr(trial,name)().controls)
            fresh=adapter.prepare(rgb,info)
            for route,state in (('fresh',fresh),('frozen',model)):
                out=adapter.process(rgb,info,state)[112:400,112:400]
                record['methods'][name+'_'+route]=dict(specks=base.count_specks(out),green_magenta=gm_count(out),
                    band_sigmas=[list(values) for values in state[0].band_sigmas])
        result['cases'].append(record)
    base.write(OUTPUT/'median-model-diagnostic.json',result)


def native(args,entries):
    entry=next(row for row in entries if row['file']==args.photo);records=[];tick=time.perf_counter()
    with rawpy.imread(str(base.photo_root()/args.photo)) as raw:
        opened=time.perf_counter()-tick;info=base.inputs.metadata_from_raw(raw,entry);height,width=raw.raw_image_visible.shape
        for name in ('denoise','taming',*LEADERS):
            clocks=dict(sensor_seconds=0.,development_seconds=0.,post_seconds=0.)
            control=getattr(trial,name)().controls if name!='denoise' else None
            def reader(top,left,bottom,right):
                fy,fx=max(0,(top-64)//2*2),max(0,(left-64)//2*2)
                ly,lx=min(height,(bottom+65)//2*2),min(width,(right+65)//2*2)
                tick=time.perf_counter();sensor=base.read_sensor(raw,fy,fx,ly,lx);clocks['sensor_seconds']+=time.perf_counter()-tick
                tick=time.perf_counter();rgb=trial.develop(sensor,info,control)[0] if control is not None else develop_signed(sensor,info)
                clocks['development_seconds']+=time.perf_counter()-tick
                return rgb[top-fy:bottom-fy,left-fx:right-fx].copy()
            adapter=base.calibrated();start=time.perf_counter()
            state=adapter.prepare(base.adaptive._WindowSource(height,width,reader),info);prepare=time.perf_counter()-start;filter_seconds=0.;checksum=np.zeros(3)
            for core,bounds in base.windows(height,width,tile=768,margin=66):
                top,bottom,left,right=core;fy,ly,fx,lx=bounds;rgb=reader(fy,fx,ly,lx)
                edge=base.adaptive._Edges(fy==0,ly==height,fx==0,lx==width,height,width)
                tick=time.perf_counter();out=base.adaptive._filter_region(rgb,state[0],adapter.controls,edge);filter_seconds+=time.perf_counter()-tick
                if control is not None and control.post:
                    tick=time.perf_counter()
                    matrix=np.asarray(info['camera_to_acescg'])*np.asarray(info['white_balance'])[None,:]
                    camera=(rgb/np.float32(2**info.get('exposure_stops',0)))@np.linalg.inv(matrix).T
                    sigma=(np.full(out.shape[:2],1e-7*2**info.get('exposure_stops',0),np.float32) if control.local_noise else trial.component_sigma(camera,info,trial.GM)*.2)
                    if control.threshold == 0:
                        plane=(out@trial.GM).astype('float32')
                        out=out+(control.strength*(trial.spatial_median(plane,control.radius)-plane))[...,None]*trial.GM_DIRECTION
                    else:
                        out,_=trial.repair_component(out,sigma,
                            threshold=control.threshold,max_area=control.max_area,strength=control.strength,radius=control.radius)
                    clocks['post_seconds']+=time.perf_counter()-tick
                if not np.isfinite(out).all(): raise ValueError('Nonfinite native result')
                checksum+=out[top-fy:bottom-fy,left-fx:right-fx].sum(axis=(0,1),dtype=float);del rgb,out
            records.append(dict(method=name,shape=[height,width],open_seconds=opened,prepare_seconds=prepare,filter_seconds=filter_seconds,
                whole_seconds=opened+time.perf_counter()-start,checksum=checksum.tolist(),peak_rss_bytes=base.peak_rss(),**clocks))
            print('native',args.photo,name,records[-1]['whole_seconds'],flush=True)
            base.write(OUTPUT/('native-'+Path(args.photo).stem+'.json'),dict(cases=records,**stamp(args)))


def review(args):
    sections=[]
    for kind in ('gallery','clean'):
        path=OUTPUT/'review'/kind/'manifest.json'
        if not path.exists(): continue
        rows=[];columns=(*REVIEW,*(['clean'] if kind=='clean' else []))
        for case in json.loads(path.read_text())['cases']:
            cells=[]
            for method in columns:
                prefix=f'{kind}/{case["id"]}/{method}';picture=OUTPUT/'review'/(prefix+'.png')
                cell=f'<img loading="lazy" width="224" src="{prefix}.png">' if picture.exists() else 'Unavailable'
                if (OUTPUT/'review'/(prefix+'-zoom.png')).exists(): cell+=f'<img loading="lazy" width="288" src="{prefix}-zoom.png">'
                cells.append('<td>'+cell+'</td>')
            detail=f' · sensor {case["sensor_xy"]} · +{case["lift"]} stops' if kind=='gallery' else ''
            rows.append('<tr><th>'+escape(case['title']+detail)+'</th>'+''.join(cells)+'</tr>')
        sections.append('<h2>'+kind.title()+'</h2><table><thead><tr><th>Fixed subject</th>'+''.join('<th>'+escape(n)+'</th>' for n in columns)+'</tr></thead><tbody>'+''.join(rows)+'</tbody></table>')
    token=os.path.relpath(ROOT/'frontend/visual-tokens.css',OUTPUT/'review')
    html='<!doctype html><meta charset="utf-8"><title>Chroma cleanup research</title><link rel="stylesheet" href="'+token+'"><style>body{background:var(--app);color:var(--body);font-family:var(--font-body);font-size:var(--font-size-md);font-weight:var(--font-weight-regular);line-height:var(--line-height-normal)}h1{font-size:var(--font-size-3xl);font-weight:var(--font-weight-semibold)}h2{font-size:var(--font-size-2xl);font-weight:var(--font-weight-semibold)}th{font-weight:var(--font-weight-semibold)}th,td{text-align:left;vertical-align:top;padding:var(--group-disclosure-gap)}img{display:block}td img+img{image-rendering:pixelated}thead{position:sticky;top:0;background:var(--app)}</style><h1>Green/magenta cleanup — research only</h1><p>off = signed noisy; denoise = current defaults without taming; taming = approved 2.5σ / envelope1.5 / strength.75 / area≤5 / neighbour support. Other columns add colour cleanup to the same Denoise, with the post-Denoise diagnostics labelled below. green: local CFA matching; median1/3: G-hold colour-difference passes; median1_y: one pass preserving Y; gm2_a25: targeted 2σ, ≤25px; green_gm: both; gm_ob: also orange/blue. wide_pre2/wide_post2: 9×9 green–magenta repair before/AFTER Denoise; post uses local residual MAD. Extra placement/scale diagnostic. Tops: downscaled 288px crops. Below: exact inherited 48×48 spots at 6×, no reselection. Private RAWs have no truth. Clean subjects expose real-colour damage. Read the research report before interpreting a lower count as a win.</p>'+''.join(sections)
    (OUTPUT/'review').mkdir(parents=True,exist_ok=True);(OUTPUT/'review/index.html').write_text(html)
    for path in (OUTPUT/'review').rglob('*.png'):
        if path.stem.removesuffix('-zoom') not in (*REVIEW,'clean'): path.unlink()
    size=sum(p.stat().st_size for p in (OUTPUT/'review').rglob('*') if p.is_file())
    if size>20_000_000: raise ValueError('Review exceeds inherited 20 MB budget')
    print('review_bytes',size,flush=True)


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--inventory',type=Path,required=True);parser.add_argument('--gallery',type=Path)
    parser.add_argument('--phase',choices=('gallery','gallery-post','gallery-wide','quick','full','heldout','seen','clean','diagnostic','native','review'),required=True);parser.add_argument('--photo',default='IMG_0790.CR2')
    args=parser.parse_args();cv2.setNumThreads(1);OUTPUT.mkdir(parents=True,exist_ok=True);entries=json.loads(args.inventory.read_text())['inventory']
    if args.phase in ('gallery','gallery-post','gallery-wide'): gallery(args)
    elif args.phase in ('quick','full','heldout','seen'): quality(args,entries)
    elif args.phase=='clean': clean(args,entries)
    elif args.phase=='native': native(args,entries)
    elif args.phase=='diagnostic': diagnostic(args)
    review(args)

if __name__=='__main__': main()
