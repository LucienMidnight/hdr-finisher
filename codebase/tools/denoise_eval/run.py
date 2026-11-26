"""python -m tools.denoise_eval.run --adapters off,denoise_v2 --set quick"""
from __future__ import annotations
# The shared 8 GB research machine permits one heavy process, one native thread.
# Set before importing numpy/LibRaw; this tooling limit does not affect the app.
import os
for key in ('OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS','VECLIB_MAXIMUM_THREADS','HDR_CPU_THREADS'):
    os.environ[key]='1'
import argparse
import gc
import html
import itertools
import json
from pathlib import Path
import platform
import subprocess
import sys
import time
import cv2
import numpy as np
from PIL import Image
from . import metrics
from .adapters import load_adapter, tiled
from .inputs import inventory, synthetic_samples, real_samples, paired_samples, SEED
from tools.lib.machine_settings import settings

cv2.setNumThreads(1)
ROOT=Path(__file__).resolve().parents[2]
OUTPUT=ROOT/'output/denoise-v1'


def peak_rss():
    if sys.platform=='win32':
        import ctypes
        from ctypes import wintypes
        class Counters(ctypes.Structure):
            _fields_=[('cb',wintypes.DWORD),('PageFaultCount',wintypes.DWORD)]+[(n,ctypes.c_size_t) for n in
                ('PeakWorkingSetSize','WorkingSetSize','QuotaPeakPagedPoolUsage','QuotaPagedPoolUsage',
                 'QuotaPeakNonPagedPoolUsage','QuotaNonPagedPoolUsage','PagefileUsage','PeakPagefileUsage')]
        c=Counters(); c.cb=ctypes.sizeof(c)
        kernel=ctypes.WinDLL('kernel32',use_last_error=True)
        psapi=ctypes.WinDLL('psapi',use_last_error=True)
        kernel.GetCurrentProcess.restype=wintypes.HANDLE
        psapi.GetProcessMemoryInfo.argtypes=[wintypes.HANDLE,ctypes.POINTER(Counters),wintypes.DWORD]
        psapi.GetProcessMemoryInfo.restype=wintypes.BOOL
        if not psapi.GetProcessMemoryInfo(kernel.GetCurrentProcess(),ctypes.byref(c),c.cb):
            raise ctypes.WinError(ctypes.get_last_error())
        return c.PeakWorkingSetSize
    import resource
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*(1 if sys.platform=='darwin' else 1024)


def safety(adapter):
    """Constant finite negative / HDR sentinel: no clamp, exact alpha and bypass."""
    if adapter.input_kind=='bayer':
        return {'status':'not_applicable','reason':'RGB HDR/alpha sentinel is downstream of Bayer development; requires RGB adapter'}
    image=np.empty((96,96,4),'float32')
    image[...,:3]=[-.125,1.5,8.]
    image[...,3]=np.linspace(0,1,96)[None,:]
    state=adapter.prepare(image,{})
    output=adapter.process(image,{},state)
    checks=dict(finite=bool(np.isfinite(output).all()),negatives_kept=bool(np.all(output[...,0]<0)),
                above_white_kept=bool(np.all(output[...,1:3]>1)),
                alpha_exact=bool(np.array_equal(image[...,3],output[...,3])) if adapter.supports_alpha else None,
                bypass_exact=bool(np.array_equal(image,adapter.process(image,{},state,bypass=True))) if adapter.supports_bypass else None)
    # Output ceiling is a downstream transform. Verify unclipped input before the transform as above.
    checks['finished_hdr_ceiling_exact']=bool(np.max(metrics.display(output,'hdr'))<=metrics.pq(1000))
    checks['status']='pass' if all(v for v in checks.values() if v is not None) else 'fail'
    checks['constant_hdr_max_abs_drift']=float(np.max(np.abs(image[...,:3]-output[...,:3])))
    return checks


def diagnostics(adapter,sample):
    source=(sample.rgb if adapter.input_kind=='rgb' else sample.bayer)[:256,:256].copy()
    md=sample.metadata
    state=adapter.prepare(source,md)
    normal=tiled(adapter,source,md,state,shift=0)
    shifted=tiled(adapter,source,md,state,shift=64)
    direct=adapter.process(source,md,state)
    result={'probe_shape':list(source.shape),'source':sample.name,
            'tile_grid':{'tile':128,'shift':64,'margin':adapter.margin,
                         'shifted_sdr':metrics.summary(metrics.colour_error(normal,shifted)),
                         'shifted_hdr':metrics.summary(metrics.colour_error(normal,shifted,'hdr')),
                         'unshifted_vs_whole_sdr':metrics.summary(metrics.colour_error(normal,direct))},
            'exposure':[]}
    for stops in range(-6,7):
        scale=2.**stops
        scaled=source.copy()
        if adapter.input_kind=='rgb':
            scaled[...,:3]*=scale
        else:
            scaled*=scale
        smd={**md,'noise_parameters':[{'a':p['a']*scale,'b':p['b']*scale**2} for p in md.get('noise_parameters',[])]}
        st=adapter.prepare(scaled,smd)
        output=adapter.process(scaled,smd,st)
        output=output.copy(); output[...,:3]/=scale
        result['exposure'].append(dict(stops=stops,sdr=metrics.summary(metrics.colour_error(output,direct)),
                                      hdr=metrics.summary(metrics.colour_error(output,direct,'hdr'))))
    return result


def save_image(image,path,size=256):
    rgb=np.uint8(np.rint(np.clip(metrics.display(image),0,1)*255))
    im=Image.fromarray(rgb)
    im.thumbnail((size,size),Image.Resampling.LANCZOS)
    im.save(path,optimize=True)


def review_page(rows,folder,results):
    title=f"Denoise baseline: {results['set']}"
    pair_set = results['set'] == 'pairs'
    truth_label = 'real low-ISO camera references' if pair_set else 'synthetic truth'
    context = ('Real noisy/clean RAW pairs; low-ISO references retain sensor noise. Clipping, registration and clean resampling exclusions are recorded in JSON.'
               if pair_set else 'These are noise simulations, not clean real pairs.')
    token_stylesheet=Path(os.path.relpath(ROOT/'frontend/visual-tokens.css',folder)).as_posix()
    style='''body {background:var(--bg);color:var(--text);font-family:var(--font-body);font-size:var(--font-size-lg);line-height:var(--line-height-normal)}
    h1{font-size:var(--font-size-3xl);font-weight:var(--font-weight-semibold)}
    h2{font-size:var(--font-size-xl);font-weight:var(--font-weight-medium)}
    a{color:var(--text)} .row{display:flex;flex-wrap:wrap}figure{flex:0 0 auto}img{max-width:100%;image-rendering:auto}
    figcaption{font-size:var(--font-size-sm)}'''
    sections=[]
    headline_rows=[]
    for name,levels in results['headline'].items():
        for iso,values in levels.items():
            headline_rows.append('<tr>'+''.join(f'<td>{html.escape(str(value))}</td>' for value in (name,iso,round(values['sdr_psnr_db'],2) if values['sdr_psnr_db'] is not None else '∞',round(values['sdr_ssim'],3),round(values['hdr_psnr_db'],2) if values['hdr_psnr_db'] is not None else '∞',round(values['hdr_ssim'],3)))+'</tr>')
    headline_table=f'<table><caption>Mean per-crop fidelity against {truth_label}; exact ISO groups</caption><thead><tr><th>Adapter</th><th>ISO</th><th>SDR PSNR dB</th><th>SDR SSIM</th><th>HDR PSNR dB</th><th>HDR SSIM</th></tr></thead><tbody>'+''.join(headline_rows)+'</tbody></table>'
    for row in rows:
        figures=''.join(f'<figure><img loading="lazy" src="{html.escape(file)}"><figcaption>{html.escape(label)}</figcaption></figure>' for label,file in row['images'])
        sections.append(f"<section><h2>{html.escape(row['name'])}</h2><p>{html.escape(row['metadata'])}</p><div class='row'>{figures}</div></section>")
    page=f'''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>{title}</title>
    <link rel="stylesheet" href="{token_stylesheet}"><style>{style}</style></head><body>
    <h1>{title}</h1><p>CPU only • {results['machine']} • fixed seed {SEED}. SDR: ACEScg → linear sRGB, clip 0–1, sRGB encoding.
    Every image uses the same transform. Downscaled previews; original crop size is recorded in JSON. {context}</p>
    <p><a href="results.json">Complete measurements, calibration, crop coordinates and limitations</a></p>
    <p>Run: {results['elapsed_seconds']:.1f} s; peak process memory {results['peak_rss_bytes']/1e9:.2f} GB. No GPU/CPU comparison was run. Synthetic source clipping and single-frame calibration can bias conclusions.</p>
    {headline_table}
    {''.join(sections)}</body></html>'''
    (folder/'index.html').write_text(page)


def headlines(cases,names):
    result={}
    for name in names:
        result[name]={}
        for iso in (1600,6400,25600):
            selected=[c['adapters'][name] for c in cases if c['clean'] and c['metadata'].get('iso')==iso and name in c['adapters'] and 'sdr' in c['adapters'][name]]
            if selected:
                result[name][str(iso)]={}
                for key in ('sdr_psnr_db','sdr_ssim','hdr_psnr_db','hdr_ssim'):
                    values=[r[key.split('_')[0]][key.split('_',1)[1]] for r in selected]
                    result[name][str(iso)][key]=None if any(v is None for v in values) else float(np.mean(values))
    return result


def main(argv=None):
    global OUTPUT
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--adapters',default='off,denoise_v2')
    parser.add_argument('--set',choices=('quick','full','pairs'),default='quick')
    parser.add_argument('--controls',default='{}',help='JSON controls for denoise_v2_custom')
    parser.add_argument('--pairs',type=Path,help='Optional approved folder with pairs.json, no downloads')
    parser.add_argument('--pair-split', choices=('all', 'heldout', 'seen'), default='all', help='Keep training contamination explicit')
    parser.add_argument('--banding',type=float,default=0.,help='Added row and column sigma in normalised sensor units')
    parser.add_argument('--output-dir',type=Path,help='Separate research results/review destination')
    parser.add_argument('--review-size',type=int,choices=(128,256),default=256,help='Bound review size when comparing many adapters')
    args=parser.parse_args(argv)
    if args.set == 'pairs' and args.pairs is None:
        parser.error('--set pairs requires --pairs; no downloads run automatically')
    if args.output_dir is not None:
        OUTPUT=args.output_dir
    OUTPUT.mkdir(parents=True,exist_ok=True)
    # Cross-worktree CPU lock: stale locks are never silently stolen.
    lock=Path(settings()['lockFolder'])/'denoise-eval-cpu.lock'
    try:
        fd=os.open(lock,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
    except FileExistsError:
        raise SystemExit(f'Another denoise evaluator owns {lock}; if it crashed, verify its PID before removing the lock.')
    os.write(fd,str(os.getpid()).encode()); os.close(fd)
    try:
        execute(args)
    finally:
        lock.unlink(missing_ok=True)


def execute(args):
    start=time.perf_counter(); names=args.adapters.split(',')
    adapters={name:load_adapter(name,json.loads(args.controls)) for name in names}
    folder=OUTPUT/'review'; folder.mkdir(exist_ok=True)
    # Only our own files in this fixed review directory are replaced.
    for pattern in ('crop-*.png','index.html','results.json'):
        for file in folder.glob(pattern):
            file.unlink()
    inv=[] if args.set == 'pairs' else inventory()
    inventory_seconds=time.perf_counter()-start
    print(f'Inventory/calibration: {inventory_seconds:.2f} s',flush=True)
    results=dict(schema_version=1,set=args.set,seed=SEED,machine=f'{platform.system()} {platform.machine()} / {platform.processor()}',
                 git_head=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),
                 transforms=dict(sdr='ACEScg CAT02 to sRGB; clip 0..1; sRGB OETF',hdr='ACEScg CAT02 to BT2020; 203 nit reference white; clip 0..1000 nit; ST2084 PQ',
                                 hdr_colour='BT.2124 Delta E ITP: 720*sqrt(dI^2+(.5*dCt)^2+dCp^2)'),
                 inventory=inv,inventory_seconds=inventory_seconds,mask_generation='sigma2 Laplacian; flat bottom quartile, texture top 40%; 12px border; slanted chart left-quarter flat override',adapters={k:v.description() for k,v in adapters.items()},cases=[],diagnostics={},
                 limitations=['Single-frame flat-patch sensor fits are provisional, not laboratory profiles; optical-black areas are diagnostic only.',
                              'ISO extrapolation assumes shot a scales with ISO and read b with ISO squared; dual-gain transitions are unknown.',
                              'Synthetic sensor readout is clipped to 0..1 before 16-bit AHD; clipped fraction is recorded. RGB HDR checks are separate.',
                              'Low-ISO binned RAW truth retains residual noise. CFA-plane 2x2 averaging halves uncorrelated noise sigma.',
                              'Geometry, lens correction and highlight reconstruction are excluded consistently for all candidates.',
                              'CPU/GPU agreement is not applicable: CPU-only harness. Highlight cap is the fixed display transform, not production delivery validation.',
                              'Real pair folders are opt-in and require already aligned ACEScg crops; no external dataset was downloaded.'])
    if args.set == 'pairs':
        results['mask_generation'] = 'Prepared pair valid support (clipping plus 40px halo); clean-only flat/texture/edge masks'
        results['limitations'] = [
            'Real low-ISO camera frames are low-noise references, not mathematically noiseless truth.',
            'One translation and one RGB gain per capture pair; clean-only CFA-plane interpolation changes its fine-frequency response.',
            'Misregistered/moving crops and clipped/filter-support regions are excluded; see preparation.json for rejections.',
            'Held-out and seen-by-RawNIND scenes are separately labelled; no RawNIND model is evaluated in this baseline.',
            'Fixed SDR/PQ display transforms and crop-local preparation are research measurements, not production HDR or whole-photo qualification.',
        ]
        samples = (sample for sample in paired_samples(args.pairs)
                   if args.pair_split == 'all' or bool(sample.metadata['held_out']) == (args.pair_split == 'heldout'))
        results['pair_split'] = args.pair_split
    else:
        samples=itertools.chain(synthetic_samples(inv,args.set=='quick',args.banding),real_samples(inv,args.set=='quick'),paired_samples(args.pairs) if args.pairs else [])
    rows=[]
    for index,sample in enumerate(samples):
        print(f'{index+1}: {sample.name}',flush=True)
        case=dict(name=sample.name,metadata=sample.metadata,shape=list(sample.rgb.shape),clean=sample.clean is not None,adapters={},
                  masks={key:dict(pixels=int(mask.sum()),bounds=[int(v) for v in (np.where(mask)[0].min(),np.where(mask)[1].min(),np.where(mask)[0].max()+1,np.where(mask)[1].max()+1)] if mask.any() else None) for key,mask in sample.masks.items()})
        row={'name':sample.name,'metadata':f"{sample.rgb.shape[1]}×{sample.rgb.shape[0]}; ISO {sample.metadata.get('iso','?')}; exposure +{sample.metadata.get('exposure_stops',0):.2f} stops",'images':[]}
        for label,image in [('Noisy',sample.rgb),('Clean truth',sample.clean)]:
            if image is not None:
                filename=f'crop-{index:03d}-{len(row["images"])}.png';save_image(image,folder/filename,args.review_size);row['images'].append((label,filename))
        for name,adapter in adapters.items():
            source=sample.rgb if adapter.input_kind=='rgb' else sample.bayer
            if source is None:
                case['adapters'][name]={'skipped':'No Bayer input for developed RGB pair'};continue
            then=time.perf_counter()
            try:
                state=adapter.prepare(source,sample.metadata)
                output=adapter.process(source,sample.metadata,state)
                seconds=time.perf_counter()-then
                if output.shape[:2]!=sample.rgb.shape[:2] or output.ndim!=3 or output.shape[-1] not in (3,4):
                    raise ValueError('Adapter must return full-size ACEScg RGB(A)')
                if not np.isfinite(output).all():
                    raise ValueError('Nonfinite adapter output')
                measured=metrics.evaluate(output,sample.rgb,sample.clean,sample.masks,'slanted-edge' in sample.name, exposure_stops=sample.metadata.get('exposure_stops', 0))
                measured.update(seconds=seconds,finite=True,negative_values=int(np.sum(output[...,:3]<0)),above_white_values=int(np.sum(output[...,:3]>1)))
                if hasattr(adapter,'state_description'):
                    measured['adapter_state']=adapter.state_description(state)
                case['adapters'][name]=measured
                label=name+(f" · SDR {measured['sdr']['psnr_db']:.2f} dB / SSIM {measured['sdr']['ssim']:.3f}" if 'sdr' in measured and measured['sdr']['psnr_db'] is not None else '')
                if measured.get('adapter_state',{}).get('fallback'):
                    label+=' · AHD fallback: '+measured['adapter_state']['fallback']
                filename=f'crop-{index:03d}-{len(row["images"])}.png';save_image(output,folder/filename,args.review_size);row['images'].append((label,filename))
                if name not in results['diagnostics'] and 'fabric' in sample.name and sample.metadata.get('iso')==6400:
                    results['diagnostics'][name]=diagnostics(adapter,sample)
                    results['diagnostics'][name]['safety']=safety(adapter)
                del state,output
            except Exception as error:
                case['adapters'][name]={'error':f'{type(error).__name__}: {error}'}
                print(f'  {name}: {error}',flush=True)
        results['cases'].append(case);rows.append(row)
        gc.collect()
    results['headline']=headlines(results['cases'],names)
    results['elapsed_seconds']=time.perf_counter()-start
    results['peak_rss_bytes']=peak_rss()
    results['adapter_errors']=sum('error' in r for c in results['cases'] for r in c['adapters'].values())
    result_path=OUTPUT/f'results-{args.set}.json'
    for path in (result_path,folder/'results.json'):
        path.write_text(json.dumps(results,indent=2,allow_nan=False)+'\n')
    review_page(rows,folder,results)
    size=sum(p.stat().st_size for p in folder.iterdir() if p.is_file())
    if size>20_000_000:
        raise RuntimeError(f'Review exceeds 20 MB: {size}')
    print(json.dumps(dict(seconds=results['elapsed_seconds'],peak_rss_mb=results['peak_rss_bytes']/1e6,review_mb=size/1e6,
                         adapter_errors=results['adapter_errors'],headline=results['headline']),indent=2))
    if results['peak_rss_bytes']>2_500_000_000 or results['adapter_errors']:
        raise SystemExit(1)


if __name__=='__main__':
    main()
