"""Serial bounded experiment commands. Launch through shared lock + guard."""
import os
for key in ('OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS','VECLIB_MAXIMUM_THREADS','HDR_CPU_THREADS'):
    os.environ[key] = '1'

import argparse
from dataclasses import asdict
import gc
import json
from pathlib import Path
import signal
import tempfile
import time

import cv2
import numpy as np
import rawpy
from hdr_finisher.denoise_adaptive import estimate_adaptive_model_from_windows, _Edges
from tools.denoise_eval.candidates.speck_cleanup import make_cache, resolve, MARGIN
from tools.denoise_eval.candidates.pilot_wiener_measure import windows
from tools.denoise_eval.inputs import develop, metadata_from_raw, normalise_crop
from tools.denoise_eval.run import main as quality_main, peak_rss
from tools.lib.test_photos import photo_root

ROOT = Path(__file__).resolve().parents[3]
OUTPUT = ROOT/'output/denoise-v1/speck-cleanup'
PREFIX = 'tools.denoise_eval.candidates.'
ADAPTERS = ['off', PREFIX+'denoise_v2_appdefault:factory', PREFIX+'speck_cleanup:median',
            PREFIX+'speck_cleanup:guarded', PREFIX+'speck_cleanup:factory', PREFIX+'rawnind:bayer']


def native(photo):
    """No whole-frame float allocations; actual native-size development/filter.

    Cache spooling is deliberately measured separately, not a shipping design.
    Source RAW is opened once; bounded AHD developed windows are re-read from it.
    """
    signal.signal(signal.SIGTERM, lambda signum, frame: (_ for _ in ()).throw(SystemExit(128+signum)))
    cv2.setNumThreads(1)
    start = time.perf_counter()
    with rawpy.imread(str(photo_root()/photo)) as raw:
        md = metadata_from_raw(raw, dict(file=photo, camera='native metadata', noise_fit_positions=[], iso=3200 if photo=='IMG_0790.CR2' else 4000))
        height, width = raw.raw_image_visible.shape
        def read(y0, x0, y1, x1):
            # Even sensor phase, with AHD support retained around the request.
            sy, sx = max(0,(y0-16)//2*2), max(0,(x0-16)//2*2)
            ey, ex = min(height,(y1+17)//2*2), min(width,(x1+17)//2*2)
            mosaic = raw.raw_image_visible[sy:ey, sx:ex].astype('float32')
            whites = raw.camera_white_level_per_channel or [raw.white_level]*4
            for row in range(2):
                for col in range(2):
                    channel = int(raw.raw_pattern[row, col])
                    black = raw.black_level_per_channel[channel]
                    mosaic[row::2,col::2] -= black
                    mosaic[row::2,col::2] /= (whites[channel] or raw.white_level)-black
            rgb = develop(mosaic, md)
            return rgb[y0-sy:y1-sy,x0-sx:x1-sx].copy()
        then = time.perf_counter()
        model = estimate_adaptive_model_from_windows(height,width,read,workers=1)
        analysis = time.perf_counter()-then
        clocks = dict(develop=0., prepare=0., resolve=0., cache_io=0.)
        checksum = np.zeros(3, 'float64')
        # Bounded one-tile cache; spool/load so time includes full-frame cache I/O.
        with tempfile.TemporaryDirectory(prefix='speck-native-', dir=OUTPUT) as temp:
            temp = Path(temp)
            for core,bounds in windows(height,width,tile=768,margin=MARGIN):
                top,ey,left,ex=core; sy,by,sx,bx=bounds
                then=time.perf_counter(); image=read(sy,sx,by,bx)
                clocks['develop']+=time.perf_counter()-then
                edges=_Edges(sy==0,by==height,sx==0,bx==width,height,width)
                then=time.perf_counter(); cache=make_cache(image,model,edges=edges)
                clocks['prepare']+=time.perf_counter()-then
                region=np.s_[top-sy:ey-sy,left-sx:ex-sx]
                cache.original=cache.original[region].copy()
                cache.bands=cache.bands[:,region[0],region[1]].copy()
                cache.noise_to_energy=cache.noise_to_energy[:,region[0],region[1]].copy()
                cache.corrections=cache.corrections[:,region[0],region[1]].copy()
                then=time.perf_counter()
                for key in ('original','bands','noise_to_energy','corrections'):
                    path=temp/(key+'.npy');np.save(path,getattr(cache,key));setattr(cache,key,np.load(path));path.unlink()
                clocks['cache_io']+=time.perf_counter()-then
                then=time.perf_counter(); value=resolve(cache)
                clocks['resolve']+=time.perf_counter()-then
                checksum+=np.sum(value,axis=(0,1),dtype='float64')
                del cache,value,image
                gc.collect()
        result=dict(photo=photo,shape=[height,width],pixels=height*width,machine='MacBook Neo A18 Pro 8 GB; one CPU thread',
                    model=model.as_dict(),analysis_seconds=analysis,**{key+'_seconds':value for key,value in clocks.items()},
                    elapsed_seconds=time.perf_counter()-start,peak_rss_bytes=peak_rss(),checksum=checksum.tolist(),
                    limitations='CPU standalone whole-frame bounded research; cache disk roundtrip included; no UI/GPU timing; ±10% descriptive timing allowance')
        (OUTPUT/('native-'+Path(photo).stem+'.json')).write_text(json.dumps(result,indent=2)+'\n')
        print(json.dumps(result,indent=2),flush=True)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('command', choices=('quick','full','heldout','seen','native'))
    parser.add_argument('--photo',default='IMG_0790.CR2')
    args=parser.parse_args()
    OUTPUT.mkdir(exist_ok=True,parents=True)
    if args.command=='native':
        native(args.photo)
        return
    options=['--adapters',','.join(ADAPTERS),'--set',args.command if args.command in ('quick','full') else 'pairs',
             '--output-dir',str(OUTPUT/args.command),'--review-size','128']
    if args.command in ('heldout','seen'):
        options+=['--pairs',str(ROOT/'output/denoise-v1/datasets/rawnind/pairs'),'--pair-split',args.command]
    quality_main(options)


if __name__=='__main__':
    main()
