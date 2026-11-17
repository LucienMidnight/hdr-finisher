"""Serial CPU research commands; launch through gpu-run-lock and guard."""
import os
for variable in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS', 'VECLIB_MAXIMUM_THREADS', 'HDR_CPU_THREADS'):
    os.environ[variable] = '1'

import argparse
import gc
import json
from pathlib import Path
import signal
import subprocess
import time

import cv2
import numpy as np
import rawpy

from hdr_finisher import denoise_adaptive as adaptive
from tools.denoise_eval.candidates.noise_model_specks import prepare_model, repair_sensor
from tools.denoise_eval.candidates.pilot_wiener_measure import windows
from tools.denoise_eval.inputs import develop, metadata_from_raw, inventory, optical_black
from tools.denoise_eval.run import main as quality_main, peak_rss
from tools.lib.test_photos import photo_root

ROOT = Path(__file__).resolve().parents[3]
OUTPUT = ROOT / 'output/denoise-v1/noise-model-raw-specks'
PREFIX = 'tools.denoise_eval.candidates.'
ADAPTERS = ['off', PREFIX+'denoise_v2_appdefault:factory', PREFIX+'noise_model_specks:factory',
            PREFIX+'noise_model_specks:poisson_gaussian',
            PREFIX+'noise_model_specks:raw', PREFIX+'noise_model_specks:raw_corrected',
            PREFIX+'speck_cleanup:factory', PREFIX+'rawnind:bayer']


def metadata(raw, entry):
    return metadata_from_raw(raw, entry)


def read_sensor(raw, top, left, bottom, right):
    if top % 2 or left % 2:
        raise ValueError('Native RAW reader must keep CFA phase')
    mosaic = raw.raw_image_visible[top:bottom, left:right].astype('float32')
    whites = raw.camera_white_level_per_channel or [raw.white_level]*4
    for row in range(2):
        for column in range(2):
            channel = int(raw.raw_pattern[row, column])
            black = raw.black_level_per_channel[channel]
            mosaic[row::2, column::2] -= black
            mosaic[row::2, column::2] /= (whites[channel] or raw.white_level) - black
    return mosaic


def rgb_reader(raw, info, *, parameters=None, clocks=None):
    height, width = raw.raw_image_visible.shape
    def read(top, left, bottom, right):
        start = time.perf_counter()
        sy, sx = max(0, (top-24)//2*2), max(0, (left-24)//2*2)
        ey, ex = min(height, (bottom+25)//2*2), min(width, (right+25)//2*2)
        mosaic = read_sensor(raw, sy, sx, ey, ex)
        if clocks is not None:
            clocks['sensor_seconds'] += time.perf_counter()-start
        if parameters is not None:
            start = time.perf_counter()
            mosaic, count = repair_sensor(mosaic, parameters)
            if clocks is not None:
                clocks['repair_seconds'] += time.perf_counter()-start
                clocks['halo_inclusive_repaired_pixels'] += count
        start = time.perf_counter()
        image = develop(mosaic, info)
        if clocks is not None:
            clocks['ahd_seconds'] += time.perf_counter()-start
        return image[top-sy:bottom-sy, left-sx:right-sx].copy()
    return read


def audit():
    entries = inventory()
    records = []
    for entry in entries:
        print(entry['file'], flush=True)
        if not entry.get('camera_linear_supported') or not entry.get('noise_fit_positions'):
            records.append(dict(file=entry['file'], skipped=entry.get('camera_linear_reason', 'not supported Bayer')))
            continue
        with rawpy.imread(str(photo_root()/entry['file'])) as raw:
            height, width = raw.raw_image_visible.shape
            info = metadata(raw, entry)
            source = adaptive._WindowSource(height, width, rgb_reader(raw, info))
            start = time.perf_counter()
            before = adaptive._estimate(source)
            after, details = prepare_model(source)
            masked = []
            sizes = raw.sizes
            regions = []
            if sizes.top_margin >= 8:
                regions.append(raw.raw_image[:min(sizes.top_margin,64), :min(raw.raw_image.shape[1],2048)])
            if sizes.left_margin >= 8:
                regions.append(raw.raw_image[:min(raw.raw_image.shape[0],2048), :min(sizes.left_margin,64)])
            for index, region in enumerate(regions):
                values = region.astype(float).ravel()
                masked.append(dict(region=index, samples=len(values), zeros=float(np.mean(values==0)),
                                   percentiles=np.percentile(values, [0, 1, 25, 50, 75, 99, 100]).tolist()))
            records.append(dict(file=entry['file'], iso=entry['iso'], shape=[height,width],
                                black=info['black_levels'], white=info['white_levels'],
                                current=before.as_dict(), corrected=after.as_dict(), **details,
                                optical_black=optical_black(raw), masked_regions=masked,
                                seconds=time.perf_counter()-start))
            del source
        gc.collect()
    receipt = dict(inventory=entries, records=records, git_head=head(), peak_rss_bytes=peak_rss(),
                   machine='MacBook Neo A18 Pro 8 GB; CPU one thread')
    (OUTPUT/'audit.json').write_text(json.dumps(receipt, indent=2)+'\n')


def head():
    return subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()


def native(photo, method):
    start = time.perf_counter()
    entries = json.loads((OUTPUT/'audit.json').read_text())['inventory']
    entry = next(row for row in entries if row['file']==photo)
    clocks = dict(sensor_seconds=0., repair_seconds=0., ahd_seconds=0., resolve_seconds=0., halo_inclusive_repaired_pixels=0)
    with rawpy.imread(str(photo_root()/photo)) as raw:
        height, width = raw.raw_image_visible.shape
        info = metadata(raw, entry)
        parameters = entry['noise_fit_positions'] if method=='raw' else None
        read = rgb_reader(raw, info, parameters=parameters, clocks=clocks)
        source = adaptive._WindowSource(height, width, read)
        then = time.perf_counter()
        if method=='corrected':
            model, details = prepare_model(source)
        else:
            model, details = adaptive._estimate(source), {}
        analysis = time.perf_counter()-then
        del source
        checksum = np.zeros(3, float)
        for core, bounds in windows(height, width, tile=768, margin=66):
            top, bottom, left, right = core
            sy, ey, sx, ex = bounds
            image = read(sy, sx, ey, ex)
            then = time.perf_counter()
            edges = adaptive._Edges(sy==0, ey==height, sx==0, ex==width, height, width)
            output = adaptive._filter_region(image, model, adaptive.AdaptiveControls(), edges)
            clocks['resolve_seconds'] += time.perf_counter()-then
            checksum += output[top-sy:bottom-sy, left-sx:right-sx].sum(axis=(0,1), dtype=float)
            del image, output
        result = dict(photo=photo, method=method, shape=[height,width], model=model.as_dict(), details=details,
                      analysis_seconds=analysis, **clocks, elapsed_seconds=time.perf_counter()-start,
                      peak_rss_bytes=peak_rss(), checksum=checksum.tolist(), git_head=head(),
                      machine='MacBook Neo A18 Pro 8 GB; CPU one thread',
                      limitations='Whole native coverage; analysis includes some AHD/repair; halo counts duplicate samples; no cache persistence/UI/GPU; timing descriptive ±10%')
        (OUTPUT/f'native-{method}-{Path(photo).stem}.json').write_text(json.dumps(result, indent=2)+'\n')
        print(json.dumps(result), flush=True)


def main():
    signal.signal(signal.SIGTERM, lambda signum, frame: (_ for _ in ()).throw(SystemExit(128+signum)))
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=('audit','quick','full','heldout','seen','native'))
    parser.add_argument('--photo', default='IMG_0790.CR2')
    parser.add_argument('--method', choices=('current','corrected','raw'), default='corrected')
    args = parser.parse_args()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    cv2.setNumThreads(1)
    if args.command=='audit':
        audit()
    elif args.command=='native':
        native(args.photo, args.method)
    else:
        options = ['--adapters', ','.join(ADAPTERS), '--set', args.command if args.command in ('quick','full') else 'pairs',
                   '--output-dir', str(OUTPUT/args.command), '--review-size', '128']
        if args.command in ('heldout','seen'):
            options += ['--pairs', str(ROOT/'output/denoise-v1/datasets/rawnind/pairs'), '--pair-split', args.command]
        quality_main(options)


if __name__=='__main__':
    main()
