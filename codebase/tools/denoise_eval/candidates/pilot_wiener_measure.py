"""Serial CPU quality/control/native experiments; run under shared lock and guard."""
import os
for variable in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS', 'VECLIB_MAXIMUM_THREADS', 'HDR_CPU_THREADS'):
    os.environ[variable] = '1'

import argparse
from dataclasses import asdict
import gc
import json
from pathlib import Path
import signal
import tempfile
import time
from types import SimpleNamespace

import numpy as np
import rawpy

from hdr_finisher.denoise_adaptive import AdaptiveControls, AdaptiveNoiseModel, _Edges, _filter_region, estimate_adaptive_model
from hdr_finisher.raw_import import _camera_rgb_to_acescg_float32
from tools.denoise_eval import metrics
from tools.denoise_eval.candidates.pilot_wiener import Cache, PilotWiener, make_cache, resolve
from tools.denoise_eval.candidates.rawnind import RawNIND
from tools.denoise_eval.inputs import crop_choices, develop, inventory, metadata_from_raw, synthetic_samples
from tools.denoise_eval.run import peak_rss, save_image
from tools.lib.test_photos import photo_root

ROOT = Path(__file__).resolve().parents[3]
OUTPUT = ROOT / 'output/denoise-v1/pilot-wiener'


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + '\n')


def windows(height, width, tile=512, shift=0, margin=66):
    for top in range(-shift, height, tile):
        for left in range(-shift, width, tile):
            end_y, end_x = min(height, top+tile), min(width, left+tile)
            first_y, first_x = max(0, top), max(0, left)
            start_y, start_x = max(0, first_y-margin), max(0, first_x-margin)
            stop_y, stop_x = min(height, end_y+margin), min(width, end_x+margin)
            yield (first_y, end_y, first_x, end_x), (start_y, stop_y, start_x, stop_x)


def trim_cache(cache, core, bounds):
    top, end_y, left, end_x = core
    start_y, _, start_x, _ = bounds
    region = np.s_[top-start_y:end_y-start_y, left-start_x:end_x-start_x]
    return Cache(cache.original[region].copy(), cache.bands[:, region[0], region[1]].copy(),
                 cache.gains[:, region[0], region[1]].copy(),
                 cache.pilot_chroma[:, region[0], region[1]].copy(), {})


def controls():
    entries = inventory()
    rows = []
    for sample in synthetic_samples(entries, False):
        if not ('fabric' in sample.name or 'slanted-edge' in sample.name):
            continue
        for pilot in ('self', 'tuned', 'bayer'):
            adapter = PilotWiener(pilot)
            source = sample.bayer if pilot == 'bayer' else sample.rgb
            cache = adapter.prepare(source, sample.metadata)
            for direct in (False, True):
                for control in ('amount', 'color_noise'):
                    for value in (0., .5, 1.):
                        live = AdaptiveControls(**{control: value})
                        start = time.perf_counter()
                        output = resolve(cache, live, direct_chroma=direct)
                        seconds = time.perf_counter()-start
                        measured = metrics.evaluate(output, sample.rgb, sample.clean, sample.masks,
                                                    'slanted-edge' in sample.name)
                        rows.append(dict(case=sample.name, iso=sample.metadata['iso'], pilot=pilot,
                                         direct_chroma=direct, control=control, value=value,
                                         resolve_seconds=seconds, metrics=measured))
            del cache
            gc.collect()
    write_json(OUTPUT/'controls.json', rows)


def probes():
    entries = inventory()
    sample = next(value for value in synthetic_samples(entries, False)
                  if 'fabric' in value.name and value.metadata['iso'] == 6400)
    records = []
    developed = np.empty_like(sample.rgb)
    height, width = sample.rgb.shape[:2]
    for core, bounds in windows(height, width, tile=128, margin=16):
        top, end_y, left, end_x = core
        start_y, stop_y, start_x, stop_x = bounds
        value = develop(sample.bayer[start_y:stop_y, start_x:stop_x], sample.metadata)
        developed[top:end_y, left:end_x] = value[top-start_y:end_y-start_y, left-start_x:end_x-start_x]
    records.append(dict(kind='ahd-development-grid',
                        sdr=metrics.summary(metrics.colour_error(developed, sample.rgb)),
                        hdr=metrics.summary(metrics.colour_error(developed, sample.rgb, 'hdr'))))
    for pilot_name in ('self', 'tuned', 'bayer'):
        adapter = PilotWiener(pilot_name)
        model = estimate_adaptive_model(sample.rgb, workers=1)
        if pilot_name == 'bayer':
            network = adapter.network
            state = network.prepare(sample.bayer, sample.metadata)
            network.tile_shift = 128
            shifted = network.prepare(sample.bayer, sample.metadata)
            pilot, shifted_pilot = state.denoised, shifted.denoised
        else:
            from hdr_finisher.denoise_adaptive import resolve_adaptive
            pilot = resolve_adaptive(sample.rgb, model, adapter.pilot_controls(sample.metadata))
            shifted_pilot = pilot
        height, width = sample.rgb.shape[:2]
        whole_cache = make_cache(sample.rgb, pilot, model)
        references = {direct: resolve(whole_cache, direct_chroma=direct) for direct in (False, True)}
        del whole_cache
        for shift in (0, 83):
            outputs = {direct: np.empty_like(sample.rgb) for direct in (False, True)}
            for core, bounds in windows(height, width, tile=137, shift=shift):
                start_y, stop_y, start_x, stop_x = bounds
                region = np.s_[start_y:stop_y, start_x:stop_x]
                edges = _Edges(start_y == 0, stop_y == height, start_x == 0, stop_x == width, height, width)
                cache = trim_cache(make_cache(sample.rgb[region], shifted_pilot[region], model, edges=edges), core, bounds)
                top, end_y, left, end_x = core
                for direct in (False, True):
                    outputs[direct][top:end_y, left:end_x] = resolve(cache, direct_chroma=direct)
            for direct, output in outputs.items():
                records.append(dict(kind='independent-grid', pilot=pilot_name, direct_chroma=direct, shift=shift,
                                    sdr=metrics.summary(metrics.colour_error(output, references[direct])),
                                    hdr=metrics.summary(metrics.colour_error(output, references[direct], 'hdr'))))
        for direct in (False, True):
            reference = resolve(make_cache(sample.rgb, pilot, model), direct_chroma=direct)
            for stops in range(-6, 7):
                scale = 2.**stops
                scaled_model = AdaptiveNoiseModel(model.a*scale, model.b*scale**2, model.c, model.band_sigmas)
                output = resolve(make_cache(sample.rgb*scale, pilot*scale, scaled_model), direct_chroma=direct) / scale
                records.append(dict(kind='developed-exposure', pilot=pilot_name, direct_chroma=direct, stops=stops,
                                    sdr=metrics.summary(metrics.colour_error(output, reference)),
                                    hdr=metrics.summary(metrics.colour_error(output, reference, 'hdr'))))
    write_json(OUTPUT/'independent-grids.json', records)


def inspection():
    rows = []
    for sample in synthetic_samples(inventory(), False):
        if sample.metadata['iso'] not in (6400, 25600) or not any(
                name in sample.name for name in ('fabric', 'fine-text', 'star-field')):
            continue
        values = [('Noisy', sample.rgb), ('Clean', sample.clean)]
        for pilot_name in ('self', 'tuned', 'bayer'):
            adapter = PilotWiener(pilot_name)
            model = estimate_adaptive_model(sample.rgb, workers=1)
            if pilot_name == 'bayer':
                pilot = adapter.network.prepare(sample.bayer, sample.metadata).denoised
            else:
                from hdr_finisher.denoise_adaptive import resolve_adaptive
                pilot = resolve_adaptive(sample.rgb, model, adapter.pilot_controls(sample.metadata))
            values.append((pilot_name+' pilot', pilot))
            cache = make_cache(sample.rgb, pilot, model)
            for direct in (False, True):
                values.append((pilot_name+(' luma' if direct else ' both'), resolve(cache, direct_chroma=direct)))
            del cache
        images = []
        for index, (label, value) in enumerate(values):
            name = f'inspect-{sample.name}-{index}.png'
            height, width = value.shape[:2]
            top, left = (height-256)//2, (width-256)//2
            save_image(value[top:top+256, left:left+256], OUTPUT/'review'/name)
            images.append([label, name])
        rows.append(dict(name=sample.name+' / 1:1 central crop', metadata='256px source crop, no image resize', images=images))
    write_json(OUTPUT/'inspection.json', rows)


def native(photo, pilot_name, direct_chroma=False):
    def interrupted(signum, frame):
        raise SystemExit(128+signum)
    signal.signal(signal.SIGTERM, interrupted)
    start = time.perf_counter()
    entry = dict(file=photo, camera='native metadata', iso=3200 if photo == 'IMG_0790.CR2' else 4000,
                 noise_fit_positions=[])
    adapter = PilotWiener(pilot_name, direct_chroma)
    variant = pilot_name + ('_luma' if direct_chroma else '_both')
    with tempfile.TemporaryDirectory(prefix='pilot-native-', dir=OUTPUT) as folder:
        folder = Path(folder)
        with rawpy.imread(str(photo_root()/photo)) as raw:
            md = metadata_from_raw(raw, entry)
            height, width = raw.raw_image_visible.shape
            crops = crop_choices(raw, 256)
            mosaic = np.memmap(folder/'mosaic.bin', dtype=np.float32, mode='w+', shape=(height, width))
            whites = raw.camera_white_level_per_channel or [raw.white_level]*4
            for top in range(0, height, 128):
                strip = raw.raw_image_visible[top:top+128].astype(np.float32)
                for row in range(2):
                    for column in range(2):
                        channel = int(raw.raw_pattern[row, column])
                        black = raw.black_level_per_channel[channel]
                        strip[row::2, column::2] -= black
                        strip[row::2, column::2] /= (whites[channel] or raw.white_level)-black
                mosaic[top:top+len(strip)] = strip
            mosaic.flush()
        source = np.memmap(folder/'source.bin', dtype=np.float32, mode='w+', shape=(height, width, 3))
        unity_md = {**md, 'white_balance': [1, 1, 1], 'camera_to_acescg': np.eye(3).tolist(), 'exposure_stops': 0}
        colour_md = SimpleNamespace(as_shot_wb=np.asarray(md['white_balance']),
                                    camera_to_acescg=np.asarray(md['camera_to_acescg']))
        camera_sum = 0.
        for core, bounds in windows(height, width, tile=768, margin=16):
            top, end_y, left, end_x = core
            start_y, stop_y, start_x, stop_x = bounds
            camera = develop(mosaic[start_y:stop_y, start_x:stop_x], unity_md)
            inner = camera[top-start_y:end_y-start_y, left-start_x:end_x-start_x].copy()
            camera_sum += float(np.sum(inner, dtype=np.float64))
            source[top:end_y, left:end_x] = _camera_rgb_to_acescg_float32(inner, colour_md)
        source.flush()
        del source, mosaic, camera, inner
        gc.collect()
        source = np.memmap(folder/'source.bin', dtype=np.float32, mode='r', shape=(height, width, 3))
        decode_seconds = time.perf_counter()-start
        then = time.perf_counter()
        model = estimate_adaptive_model(source, workers=1)
        model_seconds = time.perf_counter()-then
        then = time.perf_counter()
        comparison_crops = {}
        for role, crop in crops.items():
            top, left = max(0, crop['y']-66), max(0, crop['x']-66)
            end_y, end_x = min(height, crop['y']+322), min(width, crop['x']+322)
            edges = _Edges(top == 0, end_y == height, left == 0, end_x == width, height, width)
            comparison_crops[role] = {}
            for label, live in (('current-default', AdaptiveControls()),
                                ('current-tuned', PilotWiener('tuned').pilot_controls(md))):
                filtered = _filter_region(source[top:end_y, left:end_x], model, live, edges)
                comparison_crops[role][label] = filtered[crop['y']-top:crop['y']-top+256,
                                                        crop['x']-left:crop['x']-left+256].copy()
        comparison_seconds = time.perf_counter()-then
        then = time.perf_counter()
        pilot = np.memmap(folder/'pilot.bin', dtype=np.float32, mode='w+', shape=source.shape)
        if pilot_name == 'bayer':
            mosaic = np.memmap(folder/'mosaic.bin', dtype=np.float32, mode='r', shape=(height, width))
            state = adapter.network.prepare(mosaic, md, destination=pilot,
                                            camera_anchor_mean=camera_sum/(height*width*3))
            network_timing = state.timing
            del state, mosaic
            adapter.network.session = None
        else:
            network_timing = None
            live = adapter.pilot_controls(md)
            for core, bounds in windows(height, width):
                top, end_y, left, end_x = core
                start_y, stop_y, start_x, stop_x = bounds
                edges = _Edges(start_y == 0, stop_y == height, start_x == 0, stop_x == width, height, width)
                value = _filter_region(source[start_y:stop_y, start_x:stop_x], model, live, edges)
                pilot[top:end_y, left:end_x] = value[top-start_y:end_y-start_y, left-start_x:end_x-start_x]
        pilot.flush()
        del pilot, source
        gc.collect()
        pilot_seconds = time.perf_counter()-then
        then = time.perf_counter()
        chunks = []
        for index, (core, bounds) in enumerate(windows(height, width)):
            top, end_y, left, end_x = core
            start_y, stop_y, start_x, stop_x = bounds
            region = np.s_[start_y:stop_y, start_x:stop_x]
            source = np.memmap(folder/'source.bin', dtype=np.float32, mode='r', shape=(height, width, 3))
            pilot = np.memmap(folder/'pilot.bin', dtype=np.float32, mode='r', shape=source.shape)
            edges = _Edges(start_y == 0, stop_y == height, start_x == 0, stop_x == width, height, width)
            cache = trim_cache(make_cache(source[region], pilot[region], model, edges=edges), core, bounds)
            path = folder/f'cache-{index}.npz'
            np.savez(path, original=cache.original, bands=cache.bands, gains=cache.gains,
                     pilot_chroma=cache.pilot_chroma)
            chunks.append((core, path))
            del cache, source, pilot
        decomposition_seconds = time.perf_counter()-then
        cache_bytes = sum(path.stat().st_size for _, path in chunks)
        original_crops, output_crops = {}, {}
        then = time.perf_counter()
        for core, path in chunks:
            with np.load(path) as arrays:
                cache = Cache(arrays['original'], arrays['bands'], arrays['gains'], arrays['pilot_chroma'], {})
            output = resolve(cache, direct_chroma=direct_chroma)
            top, end_y, left, end_x = core
            for role, crop in crops.items():
                y0, x0 = max(top, crop['y']), max(left, crop['x'])
                y1, x1 = min(end_y, crop['y']+256), min(end_x, crop['x']+256)
                if y1 <= y0 or x1 <= x0:
                    continue
                for collected, value in ((original_crops, cache.original), (output_crops, output)):
                    if role not in collected:
                        collected[role] = np.empty((256, 256, 3), np.float32)
                    collected[role][y0-crop['y']:y1-crop['y'], x0-crop['x']:x1-crop['x']] = value[y0-top:y1-top, x0-left:x1-left]
            path.unlink()
            del cache, output
        resolve_seconds = time.perf_counter()-then
        total = time.perf_counter()-start
        review_rows = []
        for role, crop in crops.items():
            baseline = original_crops[role]
            lift = float(np.clip(np.log2(.18/max(float(np.median(np.maximum(baseline, 0))), 1e-6)), 0, 6))
            images = []
            for label, value in [('off', baseline), *comparison_crops[role].items(), (variant, output_crops[role])]:
                name = f'native-{Path(photo).stem}-{variant}-{role}-{label}.png'
                save_image(value*np.float32(2**lift), OUTPUT/'review'/name)
                images.append([label, name])
            review_rows.append(dict(name=f'{photo} / {variant} / {role}',
                                    metadata=str(dict(crop=crop, viewing_lift_stops=lift)), images=images))
        record = dict(photo=photo, pilot=pilot_name, variant=variant, shape=[height, width], decode_ahd_seconds=decode_seconds,
                      model_seconds=model_seconds, pilot_seconds=pilot_seconds, decomposition_gains_seconds=decomposition_seconds,
                      resolve_seconds=resolve_seconds, total_seconds=total, peak_rss_bytes=peak_rss(),
                      comparison_crop_seconds=comparison_seconds,
                      cache_bytes=cache_bytes, network_timing=network_timing, model=asdict(model), review_rows=review_rows,
                      conditions='MacBook Neo A18 Pro 8 GB; CPU one thread; 512 core/66 halo; disk cache included; no UI')
        write_json(OUTPUT/f'native-{Path(photo).stem}-{variant}.json', record)
        print(json.dumps(record, indent=2), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=('controls', 'probes', 'inspection', 'native'))
    parser.add_argument('--photo', choices=('IMG_0790.CR2', '2025_0730_1331_3.arw'))
    parser.add_argument('--pilot', choices=('self', 'tuned', 'bayer'), default='bayer')
    parser.add_argument('--direct-chroma', action='store_true')
    args = parser.parse_args()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT/'review').mkdir(exist_ok=True)
    if args.mode == 'controls':
        controls()
    elif args.mode == 'probes':
        probes()
    elif args.mode == 'inspection':
        inspection()
    else:
        if not args.photo:
            parser.error('native requires --photo')
        native(args.photo, args.pilot, args.direct_chroma)


if __name__ == '__main__':
    main()
