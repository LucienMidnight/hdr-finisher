"""Serial Pixel cleanup research. Run under the machine lock and RSS guard."""
from __future__ import annotations
import os
for variable in ('OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','VECLIB_MAXIMUM_THREADS','HDR_CPU_THREADS'):
    os.environ[variable] = '1'

import argparse
import gc
import hashlib
import itertools
import json
from pathlib import Path
import time

import cv2
import numpy as np
import rawpy

from tools.denoise_eval import metrics
from tools.denoise_eval.inputs import (synthetic_samples, real_samples, paired_samples, metadata_from_raw,
                                      targets, remosaic, add_noise, develop, masks_for)
from tools.denoise_eval.candidates.pixel_cleanup import (candidate_samples, confirm_calibration,
                                                       repair_sensor, alone, with_denoise)
from tools.denoise_eval.candidates.denoise_v2_appdefault import AppDefault
from tools.denoise_eval.run import peak_rss
from tools.lib.test_photos import photo_root

ROOT = Path(__file__).resolve().parents[3]
OUTPUT = ROOT/'output/denoise-v1/raw-pixel-cleanup'
CURRENT = 'tools.denoise_eval.candidates.denoise_v2_appdefault:factory'
RAWNIND = 'tools.denoise_eval.candidates.rawnind:bayer'


def write(path,value):
    path.write_text(json.dumps(value,indent=2,allow_nan=False)+'\n')


def read_sensor(raw,top,left,bottom,right):
    result = raw.raw_image_visible[top:bottom,left:right].astype('float32')
    whites = raw.camera_white_level_per_channel or [raw.white_level]*4
    for row in range(2):
        for column in range(2):
            channel = int(raw.raw_pattern[(top+row)%2,(left+column)%2])
            black = raw.black_level_per_channel[channel]
            result[row::2,column::2] -= black
            result[row::2,column::2] /= (whites[channel] or raw.white_level)-black
    return result


def quality(phase,baseline):
    started = time.perf_counter()
    original_bytes = baseline.read_bytes()
    original = json.loads(original_bytes)
    entries = original['inventory']
    if phase in ('heldout','seen'):
        samples = (sample for sample in paired_samples(ROOT/'output/denoise-v1/datasets/rawnind/pairs')
                   if bool(sample.metadata['held_out']) == (phase=='heldout'))
    else:
        samples = itertools.chain(synthetic_samples(entries,phase=='quick'),real_samples(entries,phase=='quick'))
    baseline_cases = {case['name']:case for case in original['cases']}
    records = []
    for sample in samples:
        print(phase,sample.name,flush=True)
        if sample.bayer is None:
            raise ValueError('Expected Bayer research input')
        inherited = baseline_cases[sample.name]
        if sample.metadata != inherited['metadata']:
            raise ValueError('Baseline metadata mismatch; do not silently reuse results')
        adapters = {label:inherited['adapters'][name] for label,name in
                    (('off','off'),('current_denoise',CURRENT),('rawnind_bayer',RAWNIND))}
        md = dict(sample.metadata)
        suspects = candidate_samples(sample.bayer,md)
        reference_adapter = AppDefault()
        reference = reference_adapter.process(sample.rgb,md,reference_adapter.prepare(sample.rgb,md))
        equal = {}
        for label,adapter,comparison in (('Pixel cleanup',alone(),sample.rgb),
                                        ('Pixel cleanup + Denoise',with_denoise(),reference)):
            tick = time.perf_counter()
            state = adapter.prepare(sample.bayer,md)
            output = adapter.process(sample.bayer,md,state)
            elapsed = time.perf_counter()-tick
            measured = metrics.evaluate(output,sample.rgb,sample.clean,sample.masks,
                                        'slanted-edge' in sample.name,
                                        exposure_stops=md.get('exposure_stops',0))
            measured.update(seconds=elapsed,adapter_state=state.diagnostics)
            adapters[label] = measured
            equal[label] = dict(exact=bool(np.array_equal(output,comparison)),
                                linear_max_abs=float(np.max(np.abs(output-comparison))))
            del output,state
        records.append(dict(name=sample.name,metadata=md,clean=sample.clean is not None,
                            adapters=adapters,no_map_equality=equal,sensor_diagnostic=suspects))
        del reference,sample
        gc.collect()
    result = dict(phase=phase,cases=records,inventory=entries,
                  elapsed_seconds=time.perf_counter()-started,peak_rss_bytes=peak_rss(),
                  machine='MacBook Neo A18 Pro 8 GB, one CPU thread',
                  baseline=dict(path=str(baseline),sha256=hashlib.sha256(original_bytes).hexdigest(),
                                policy='Off/current/RawNIND scores reused unchanged; both new adapters freshly evaluated; current pixels independently recalculated for exact equality'),
                  defects_confirmed=0,defect_map='none; no dark/flat calibration captures in supplied corpus')
    write(OUTPUT/(phase+'.json'),result)


def native(photo,entries):
    started = time.perf_counter()
    entry = next(item for item in entries if item['file']==photo)
    tick = time.perf_counter()
    with rawpy.imread(str(photo_root()/photo)) as raw:
        unpack_seconds = time.perf_counter()-tick
        md = metadata_from_raw(raw,entry)
        height,width = raw.raw_image_visible.shape
        normalize_seconds,scan_seconds,repair_seconds = 0.,0.,0.
        candidates,planes = [],np.zeros((4,3),dtype=np.int64)
        checksum = 0.
        for top in range(0,height,256):
            bottom = min(top+256,height)
            sy,ey = max(0,top-4),min(height,bottom+4)
            tick = time.perf_counter()
            mosaic = read_sensor(raw,sy,0,ey,width)
            normalize_seconds += time.perf_counter()-tick
            tick = time.perf_counter()
            diagnostic = candidate_samples(mosaic,{**md,'tile_origin':[sy,0]})
            scan_seconds += time.perf_counter()-tick
            candidates.extend(item for item in diagnostic['candidates'] if top <= item['y'] < bottom)
            for phase in range(4):
                values = raw.raw_image_visible[top+phase//2:bottom:2,phase%2::2]
                channel = int(raw.raw_pattern[phase//2,phase%2])
                white = (raw.camera_white_level_per_channel or [raw.white_level]*4)[channel] or raw.white_level
                planes[phase] += [values.size,np.count_nonzero(values <= raw.black_level_per_channel[channel]),
                                  np.count_nonzero(values >= white)]
            tick = time.perf_counter()
            repaired,_ = repair_sensor(mosaic,md)
            repair_seconds += time.perf_counter()-tick
            if not np.array_equal(mosaic,repaired):
                raise AssertionError('No-map Pixel cleanup changed actual sensor input')
            checksum += float(np.sum(repaired[top-sy:bottom-sy],dtype=np.float64))
            del mosaic,repaired
    write(OUTPUT/('native-'+Path(photo).stem+'.json'),dict(
        photo=photo,shape=[height,width],pixels=height*width,candidates=candidates,
        candidates_per_phase=[sum(item['phase']==phase for item in candidates) for phase in range(4)],
        confirmed_defects=0,planes=[dict(phase=phase,samples=int(row[0]),
                                      at_or_below_black=int(row[1]),at_or_above_white=int(row[2]))
                                   for phase,row in enumerate(planes)],
        unpack_seconds=unpack_seconds,normalization_seconds=normalize_seconds,
        diagnostic_scan_seconds=scan_seconds,empty_map_repair_seconds=repair_seconds,
        elapsed_seconds=time.perf_counter()-started,peak_rss_bytes=peak_rss(),checksum=checksum,
        camera=entry['camera'],iso=entry['iso'],noise_fit_positions=entry['noise_fit_positions'],
        machine='MacBook Neo A18 Pro 8 GB, one CPU thread; native RAW scan in 256-row strips',
        limitation='Whole wait ends at audited/repaired sensor, not AHD/Denoise/UI. No calibration map supplied. Diagnostic scan is not a shipping mandatory pass.'))


def injected(entries):
    from tools.denoise_eval.decision_crops import pixels, save_png
    started = time.perf_counter()
    entry = next(item for item in entries if item['file']=='IMG_0790.CR2')
    with rawpy.imread(str(photo_root()/entry['file'])) as raw:
        md = metadata_from_raw(raw,entry)
    parameters = [dict(a=.00003,b=.0000003)]*4
    md.update(noise_parameters=parameters,exposure_stops=0,generated='independent-defect-fixture')
    locations = [(34+kind*36+phase//2,36+phase*30+phase%2,value)
                 for kind,value in enumerate((1.,0.,.7)) for phase in range(4)]
    calibration = []
    for seed in range(5):
        frame = add_noise(np.full((192,192),.4,'float32'),parameters,90000+seed)
        for row,column,value in locations:
            frame[row,column] = value
        calibration.append(frame)
    mapping = confirm_calibration(calibration,md,kind='flat',capture_ids=[f'flat-{seed}' for seed in range(5)])
    expected = {(row,column) for row,column,_ in locations}
    if {(item['y'],item['x']) for item in mapping} != expected:
        raise AssertionError('Independent calibration did not recover exactly the injected map')
    del calibration
    records = []
    for index,(name,target) in enumerate(targets(192)):
        camera = target@np.linalg.inv(np.asarray(md['camera_to_acescg'])).T/np.asarray(md['white_balance'])
        clean_mosaic = remosaic(np.clip(camera,0,1),md['cfa'])
        noisy = np.clip(add_noise(clean_mosaic,parameters,91000+index),0,1).astype('float32')
        corrupt = noisy.copy()
        for row,column,value in locations:
            corrupt[row,column] = value
        repaired,diagnostic = repair_sensor(corrupt,md,mapping)
        changed = repaired != corrupt
        allowed = np.zeros(changed.shape,bool)
        for item in mapping:
            allowed[item['y'],item['x']] = True
        if np.any(changed & ~allowed):
            raise AssertionError('Unmapped point detail changed at sensor stage')
        clean = develop(clean_mosaic,md)
        reference = develop(noisy,md)
        corrupted = develop(corrupt,md)
        masks = masks_for(clean)
        outputs = {'Off':corrupted}
        current = AppDefault()
        outputs['current_denoise'] = current.process(corrupted,md,current.prepare(corrupted,md))
        mapped_md = dict(md,pixel_cleanup_defects=mapping)
        for label,adapter in (('Pixel cleanup',alone()),('Pixel cleanup + Denoise',with_denoise())):
            state = adapter.prepare(corrupt,mapped_md)
            outputs[label] = adapter.process(corrupt,mapped_md,state)
        folder = OUTPUT/'injected-crops'/name
        folder.mkdir(parents=True,exist_ok=True)
        for label,value in {**outputs,'clean':clean,'no_defects':reference}.items():
            save_png(pixels(value),folder/(label.replace(' ','_').replace('+','and')+'.png'))
        scores = {label:metrics.evaluate(value,corrupted,clean,masks,name=='slanted-edge')
                  for label,value in outputs.items()}
        scores['no_defects_no_denoise'] = metrics.evaluate(reference,reference,clean,masks,name=='slanted-edge')
        records.append(dict(name=name,adapters=scores,repairs=diagnostic,
                            sensor_unmapped_exact=True,
                            sensor_error_before=float(np.mean((corrupt-noisy)**2)),
                            sensor_error_after=float(np.mean((repaired-noisy)**2))))
        del outputs,state
        gc.collect()
    write(OUTPUT/'injected.json',dict(cases=records,calibration_map=mapping,noise_parameters=parameters,
          protocol='12 fixed persistent faults (hot saturation/dead/stuck; all four CFA phases), five independent noisy flats, seven unchanged harness charts; no runtime clean truth in map',
          elapsed_seconds=time.perf_counter()-started,peak_rss_bytes=peak_rss()))


def traces(entries):
    from tools.denoise_eval.decision_crops import cases
    audit = json.loads((OUTPUT/'native-IMG_0790.json').read_text())
    records = []
    with rawpy.imread(str(photo_root()/'IMG_0790.CR2')) as raw:
        values = [int(raw.raw_image_visible[item['y'],item['x']]) for item in audit['candidates']]
        black = raw.black_level_per_channel
        white = raw.camera_white_level_per_channel or [raw.white_level]*4
    for case_id,title,sample,offset,lift,licence in cases(entries):
        if case_id not in ('canon-dark-shadow','canon-flame-edge-lifted'):
            continue
        top,left,_,_ = sample.metadata['crop']
        region_y,region_x = top+offset[1],left+offset[0]
        selected = [item for item in audit['candidates']
                    if region_y <= item['y'] < region_y+288 and region_x <= item['x'] < region_x+288]
        rgb = sample.rgb*np.float32(2**lift)
        adapter = AppDefault()
        output = adapter.process(rgb,sample.metadata,adapter.prepare(rgb,sample.metadata))
        region = np.s_[offset[1]:offset[1]+288,offset[0]:offset[0]+288]
        before,actual = rgb[region],output[region]
        linear_y = before@np.array([.2722287,.6740818,.0536895])/2**lift
        boundary = min(.02,float(np.percentile(linear_y,50)))
        support = cv2.erode((linear_y<=boundary).astype('uint8'),np.ones((5,5),'uint8')).astype(bool)
        luma = metrics.display(actual)@metrics.LUMA
        error = luma-cv2.medianBlur(luma.astype('float32'),5)
        binary = ((abs(error)>.05)&support).astype('uint8')
        count,labels,stats,_ = cv2.connectedComponentsWithStats(binary,connectivity=8)
        small = [label for label in range(1,count) if 1 <= stats[label,cv2.CC_STAT_AREA] <= 25]
        near = np.zeros(binary.shape,'uint8')
        for item in selected:
            near[item['y']-region_y,item['x']-region_x] = 1
        near = cv2.dilate(near,np.ones((9,9),'uint8')).astype(bool)
        overlap = [label for label in small if np.any((labels==label)&near)]
        records.append(dict(case=case_id,rectangle_xywh=[region_x,region_y,288,288],
                            single_frame_suspects=selected,small_contrast_islands=len(small),
                            islands_within_4_sensor_pixels_of_suspect=len(overlap),
                            dark_tail_pixels=int(np.sum(binary&(error<0))),
                            light_tail_pixels=int(np.sum(binary&(error>0))),
                            confirmed_sensor_defects=0,confirmed_random_noise=0,
                            unresolved_contrast_islands=len(small),
                            limitation='Proximity is not causation; local median can count detail. No calibration/temporal ground truth. All below-black samples, extreme or not, become zero in harness AHD transport.'))
    write(OUTPUT/'sensor-traces.json',dict(cases=records,raw_dn_range=[min(values),max(values)],
          raw_absolute_zero_samples=sum(value==0 for value in values),black_levels=black,white_levels=white,
          note='Original unpacked RAW before black subtraction; scene suspects not a defect map.'))


def pipeline(photo,entries):
    from hdr_finisher.denoise_adaptive import estimate_adaptive_model_from_windows, _Edges, _filter_region
    from tools.denoise_eval.candidates.pilot_wiener_measure import windows
    started = time.perf_counter()
    entry = next(item for item in entries if item['file']==photo)
    clocks = dict(unpack=0.,normalise=0.,empty_map=0.,sparse_map=0.,ahd=0.,denoise=0.)
    tick = time.perf_counter()
    with rawpy.imread(str(photo_root()/photo)) as raw:
        clocks['unpack'] = time.perf_counter()-tick
        md = metadata_from_raw(raw,entry)
        height,width = raw.raw_image_visible.shape
        mapping = [dict(y=row,x=column,evidence='timing-only coordinate; not a real defect finding')
                   for row in range(128,height-8,256) for column in range(128,width-8,256)]
        def read(top,left,bottom,right):
            sy,sx = max(0,(top-16)//2*2),max(0,(left-16)//2*2)
            ey,ex = min(height,(bottom+17)//2*2),min(width,(right+17)//2*2)
            tick = time.perf_counter()
            mosaic = read_sensor(raw,sy,sx,ey,ex)
            clocks['normalise'] += time.perf_counter()-tick
            tick = time.perf_counter()
            repaired,_ = repair_sensor(mosaic,dict(md,tile_origin=[sy,sx]))
            clocks['empty_map'] += time.perf_counter()-tick
            tick = time.perf_counter()
            sparse,_ = repair_sensor(mosaic,dict(md,tile_origin=[sy,sx]),mapping)
            clocks['sparse_map'] += time.perf_counter()-tick
            del sparse
            tick = time.perf_counter()
            rgb = develop(repaired,dict(md,exposure_stops=0.))
            clocks['ahd'] += time.perf_counter()-tick
            return rgb[top-sy:bottom-sy,left-sx:right-sx].copy()
        tick = time.perf_counter()
        model = estimate_adaptive_model_from_windows(height,width,read,workers=1)
        analysis = time.perf_counter()-tick
        checksum = np.zeros(3,'float64')
        for core,bounds in windows(height,width,tile=768,margin=86):
            top,bottom,left,right = core
            sy,ey,sx,ex = bounds
            rgb = read(sy,sx,ey,ex)
            edges = _Edges(sy==0,ey==height,sx==0,ex==width,height,width)
            tick = time.perf_counter()
            output = _filter_region(rgb,model,AppDefault().controls,edges)
            clocks['denoise'] += time.perf_counter()-tick
            checksum += output[top-sy:bottom-sy,left-sx:right-sx].sum((0,1),dtype=np.float64)
            del rgb,output
    write(OUTPUT/('pipeline-'+Path(photo).stem+'.json'),dict(photo=photo,pixels=height*width,
          seconds=clocks,analysis_seconds=analysis,elapsed_seconds=time.perf_counter()-started,
          peak_rss_bytes=peak_rss(),checksum=checksum.tolist(),timing_map_size=len(mapping),
          machine='MacBook Neo A18 Pro 8 GB; one CPU thread; bounded 768px native tiles, 86px Denoise plus 16px AHD context',
          limitation='One normal AHD/global-model/shipping-default Denoise sweep, no UI/export/I/O cache. Empty-map copy and hypothetical sparse-map costs timed separately in the same read; elapsed includes both. Not whole-frame AHD/GPU parity proof.'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command',choices=('quick','heldout','full','seen','audit','injected','native','traces'))
    parser.add_argument('--photo',choices=('IMG_0790.CR2','2025_0730_1331_3.arw'))
    parser.add_argument('--baseline-root',type=Path,required=True)
    args = parser.parse_args()
    cv2.setNumThreads(1)
    OUTPUT.mkdir(parents=True,exist_ok=True)
    if args.command in ('injected','native','traces'):
        entries = json.loads((args.baseline_root/'full/results-full.json').read_text())['inventory']
        if args.command == 'injected':
            injected(entries)
        elif args.command == 'traces':
            traces(entries)
        elif args.photo:
            pipeline(args.photo,entries)
        else:
            parser.error('native requires --photo')
        return
    if args.command == 'audit':
        entries = json.loads((args.baseline_root/'full/results-full.json').read_text())['inventory']
        for entry in entries:
            if (entry.get('camera_linear_supported') and entry.get('cfa')
                    and len(entry['cfa'])==2 and (entry.get('iso') or 0) >= 1600):
                print('Auditing',entry['file'],flush=True)
                native(entry['file'],entries)
        return
    phase = args.command
    name = phase if phase in ('quick','full') else 'pairs'
    quality(phase,args.baseline_root/phase/('results-'+name+'.json'))


if __name__ == '__main__':
    main()
