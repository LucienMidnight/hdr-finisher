"""Locked, bounded single-photo hot-pixel research; never writes source photos."""
from __future__ import annotations

import os
for variable in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS',
                 'VECLIB_MAXIMUM_THREADS', 'HDR_CPU_THREADS'):
    os.environ[variable] = '1'

import argparse
import gc
import hashlib
import itertools
import json
from pathlib import Path
import subprocess
import time

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
import rawpy

from hdr_finisher.denoise_adaptive import estimate_adaptive_model_from_windows, _Edges, _filter_region
from tools.denoise_eval import metrics
from tools.denoise_eval.candidates.denoise_v2_appdefault import AppDefault
from tools.denoise_eval.candidates.hot_pixel import filter_sensor
from tools.denoise_eval.candidates.pilot_wiener_measure import windows
from tools.denoise_eval.candidates.pixel_cleanup_measure import read_sensor
from tools.denoise_eval.decision_crops import pixels, save_png
from tools.denoise_eval.inputs import (add_noise, develop, masks_for, metadata_from_raw,
                                     paired_samples, real_samples, remosaic, synthetic_samples)
from tools.denoise_eval.run import peak_rss
from tools.lib.test_photos import photo_root

ROOT = Path(__file__).resolve().parents[3]
OUTPUT = ROOT / 'output/denoise-v1/hot-pixel'
LABELS = ('off', 'current_denoise', 'hot_pixel', 'hot_pixel_denoise')


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, allow_nan=False) + '\n')


def render_outputs(mosaic, metadata, rgb=None):
    source = develop(mosaic, metadata) if rgb is None else rgb
    repaired, diagnostic = filter_sensor(mosaic, metadata)
    cleaned = develop(repaired, metadata)
    adapter = AppDefault()
    current = adapter.process(source, metadata, adapter.prepare(source, metadata))
    filtered = adapter.process(cleaned, metadata, adapter.prepare(cleaned, metadata))
    return dict(zip(LABELS, (source, current, cleaned, filtered))), diagnostic


def evaluate(outputs, clean, masks, metadata):
    return {label: metrics.evaluate(value, outputs['off'], clean, masks,
                                   exposure_stops=metadata.get('exposure_stops', 0))
            for label, value in outputs.items()}


def quality(entries, phase):
    if phase in ('heldout', 'seen'):
        samples = (sample for sample in paired_samples(ROOT / 'output/denoise-v1/datasets/rawnind/pairs')
                   if bool(sample.metadata['held_out']) == (phase == 'heldout'))
    else:
        samples = itertools.chain(synthetic_samples(entries, phase == 'quick'),
                                  real_samples(entries, phase == 'quick'))
    records = []
    for sample in samples:
        print(phase, sample.name, flush=True)
        outputs, diagnostic = render_outputs(sample.bayer, sample.metadata, sample.rgb)
        records.append(dict(name=sample.name, metadata=sample.metadata,
                            repairs=diagnostic, clean=sample.clean is not None,
                            adapters=evaluate(outputs, sample.clean, sample.masks, sample.metadata),
                            exact_vs_off=bool(np.array_equal(outputs['off'], outputs['hot_pixel'])),
                            exact_vs_current=bool(np.array_equal(outputs['current_denoise'], outputs['hot_pixel_denoise']))))
        del outputs, sample
        gc.collect()
    return dict(cases=records)


def point_psf(kind, width, offset):
    """Pixel-area integration, 32x oversampling; FFT circular pupil for Airy."""
    oversample, size = 32, 32
    coordinates = (np.arange(size * oversample) + .5) / oversample - size / 2
    vertical, horizontal = np.meshgrid(coordinates - offset[0], coordinates - offset[1], indexing='ij')
    if kind == 'gaussian':
        values = np.exp(-(vertical ** 2 + horizontal ** 2) / (2 * width ** 2))
    else:
        dimension = size * oversample
        pupil_coordinates = np.arange(dimension) - dimension // 2
        pupil = (pupil_coordinates[:, None] ** 2 + pupil_coordinates[None, :] ** 2
                 <= (.609835 * size / width) ** 2)
        intensity = np.abs(np.fft.fftshift(np.fft.fft2(pupil))) ** 2
        source_coordinates = np.arange(dimension, dtype=np.float32)
        map_horizontal, map_vertical = np.meshgrid(
            source_coordinates - offset[1] * oversample,
            source_coordinates - offset[0] * oversample)
        values = cv2.remap(intensity.astype('float32'), map_horizontal, map_vertical,
                           cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
    integrated = values.reshape(size, oversample, size, oversample).sum((1, 3))
    return (integrated / integrated.max()).astype('float32')


def generated(entries):
    entry = next(item for item in entries if item['file'] == 'IMG_0790.CR2')
    with rawpy.imread(str(photo_root() / entry['file'])) as raw:
        metadata = metadata_from_raw(raw, entry)
    parameters = [dict(a=.00003, b=.0000003)] * 4
    metadata.update(noise_parameters=parameters, exposure_stops=0)
    records, previews = [], []
    colours = dict(white=(1., 1., 1.), warm_spark=(1., .3, .05),
                   narrow_red=(1., .01, .002), narrow_blue=(.003, .02, 1.))
    profiles = (('gaussian', .8), ('airy', 1.2), ('airy', .65))
    for profile_index, (kind, width) in enumerate(profiles):
        for colour_name, response in colours.items():
            for offset_index, offset in enumerate(itertools.product((-.4, 0., .4), repeat=2)):
                for phase in range(4):
                    point = point_psf(kind, width, offset)
                    camera = np.full((64, 64, 3), .002, np.float32)
                    top, left = 16 + phase // 2, 16 + phase % 2
                    camera[top:top+32, left:left+32] += point[..., None] * np.asarray(response) * .6
                    clean = remosaic(camera, metadata['cfa'])
                    for noisy in (False, True):
                        seed = 1711000 + profile_index * 10000 + offset_index * 20 + phase
                        source = add_noise(clean, parameters, seed) if noisy else clean
                        repaired, diagnostic = filter_sensor(source, metadata)
                        changed = repaired != source
                        light_mask = np.max(camera - .002, axis=-1) > .0001
                        record = dict(psf=kind, width=width,
                                      width_definition='Gaussian sigma or Airy first-zero radius in sensor pixels',
                                      colour=colour_name, phase=phase, offset_yx=offset,
                                      noise=noisy, seed=seed, real_point_sites_changed=int(np.sum(changed & light_mask)),
                                      any_point_changed=bool(np.any(changed & light_mask)), repairs=diagnostic)
                        records.append(record)
                        if offset_index == 4 and phase == 0 and not noisy:
                            case_name = f'{kind}-{width}-{colour_name}'
                            before, after = develop(source, metadata), develop(repaired, metadata)
                            folder = OUTPUT / 'points' / case_name
                            save_png(pixels(before), folder_path(folder, 'off.png'))
                            save_png(pixels(after), folder_path(folder, 'hot_pixel.png'))
                            previews.append(case_name)
    text_records = []
    oversample, size = 8, 192
    canvas = Image.new('L', (size*oversample, size*oversample), 0)
    drawing = ImageDraw.Draw(canvas)
    font = ImageFont.load_default(size=7*oversample)
    for top in range(12, size-12, 12):
        drawing.text((12*oversample, top*oversample), 'HDR 0123456789 glint', font=font, fill=255)
    text = np.asarray(canvas, dtype='float32') / 255
    for kind, width in profiles:
        kernel = point_psf(kind, width*oversample, (0., 0.))
        kernel /= kernel.sum()
        optical = cv2.filter2D(text, -1, kernel)
        integrated = optical.reshape(size, oversample, size, oversample).mean((1, 3))
        camera = .01 + .6 * np.repeat(integrated[..., None], 3, axis=-1)
        clean = remosaic(camera, metadata['cfa'])
        source = add_noise(clean, parameters, 17112027)
        outputs, diagnostic = render_outputs(source, metadata)
        truth = develop(clean, metadata)
        scores = evaluate(outputs, truth, masks_for(truth), metadata)
        folder = OUTPUT / 'text' / f'{kind}-{width}'
        for label, value in {**outputs, 'clean': truth}.items():
            save_png(pixels(value), folder_path(folder, label+'.png'))
        text_records.append(dict(psf=kind, width=width, repairs=diagnostic, adapters=scores,
                                 seed=17112027, optical_oversampling=oversample))
    positives = []
    for baseline in (.002, .05, .3):
        clean = np.full((96, 96), baseline, np.float32)
        noisy = add_noise(clean, parameters, 17112026)
        corrupt = noisy.copy()
        locations = [(24, 24), (24, 65), (65, 24), (65, 65)]
        for row, column in locations:
            corrupt[row, column] = .7
        repaired, diagnostic = filter_sensor(corrupt, metadata)
        found = {(item['y'], item['x']) for item in diagnostic['changed']}
        outputs, _ = render_outputs(corrupt, metadata)
        clean_rgb = develop(clean, metadata)
        scores = evaluate(outputs, clean_rgb, masks_for(clean_rgb), metadata)
        folder = OUTPUT / 'injected' / str(baseline)
        for label, value in {**outputs, 'clean': clean_rgb}.items():
            save_png(pixels(value), folder_path(folder, label + '.png'))
        positives.append(dict(background=baseline, expected=len(locations),
                              detected=len(found & set(locations)), false_positives=len(found - set(locations)),
                              adapters=scores, repairs=diagnostic))
    return dict(points=records, fine_text=text_records, positive_controls=positives, previews=previews,
                protocol='Frozen 8/2.5 sigma, .02 excursion, .98 clip guard; no tuning by public truth. 32x pixel-integrated optics, phases and subpixel centres. Colours are sensor-channel responses, not asserted physical spectra.')


def folder_path(folder, name):
    folder.mkdir(parents=True, exist_ok=True)
    return folder / name


def candidate_crops(raw, metadata, diagnostic, folder):
    height, width = raw.raw_image_visible.shape
    records = []
    for kind in ('changed', 'protected_light'):
        for index, item in enumerate(diagnostic[kind][:12]):
            top = max(0, min(height-96, item['y']-48)) // 2 * 2
            left = max(0, min(width-96, item['x']-48)) // 2 * 2
            source = read_sensor(raw, top, left, top+96, left+96)
            md = dict(metadata, tile_origin=[top, left], exposure_stops=4.)
            outputs, local = render_outputs(source, md)
            case = folder / f'{kind}-{index:02d}-x{item["x"]}-y{item["y"]}'
            for label, value in outputs.items():
                save_png(pixels(value), folder_path(case, label+'.png'))
            records.append(dict(kind=kind, site=item, crop_xywh=[left, top, 96, 96],
                                exposure_stops=4, path=str(case), local_repairs=local))
    return records


def corpus(entries):
    records = []
    for entry in entries:
        if not entry.get('camera_linear_supported') or not entry.get('cfa') or len(entry['cfa']) != 2:
            records.append(dict(photo=entry['file'], status='unsupported CFA/colour bridge', inspected=False))
            continue
        print('sensor audit', entry['file'], flush=True)
        with rawpy.imread(str(photo_root() / entry['file'])) as raw:
            metadata = metadata_from_raw(raw, entry)
            height, width = raw.raw_image_visible.shape
            source = read_sensor(raw, 0, 0, height, width)
            repaired, diagnostic = filter_sensor(source, metadata)
            del source, repaired
            folder = OUTPUT / 'corpus' / Path(entry['file']).stem
            previews = candidate_crops(raw, metadata, diagnostic, folder)
            thumbnail = raw.postprocess(half_size=True, output_bps=8, use_camera_wb=True, user_flip=0)
            overview = Image.fromarray(thumbnail)
            overview.thumbnail((960, 720))
            overview.save(folder_path(folder, 'overview.png'))
            del thumbnail
            records.append(dict(photo=entry['file'], status='measured', inspected=True,
                                pixels=height*width, metadata=metadata, repairs=diagnostic,
                                crops=previews, independently_confirmed_defects=None,
                                independently_confirmed_real_point_false_positives=None,
                                classification='Candidate count only; one exposure cannot establish physical defect truth.'))
        gc.collect()
    return dict(photos=records)


def denoise_native(sensor, metadata):
    height, width = sensor.shape
    clocks = dict(ahd=0., denoise=0.)
    def read(top, left, bottom, right):
        sy, sx = max(0, (top-16)//2*2), max(0, (left-16)//2*2)
        ey, ex = min(height, (bottom+17)//2*2), min(width, (right+17)//2*2)
        tick = time.perf_counter()
        rgb = develop(sensor[sy:ey, sx:ex], metadata)
        clocks['ahd'] += time.perf_counter() - tick
        return rgb[top-sy:bottom-sy, left-sx:right-sx].copy()
    tick = time.perf_counter()
    model = estimate_adaptive_model_from_windows(height, width, read, workers=1)
    analysis = time.perf_counter()-tick
    checksum = np.zeros(3, 'float64')
    for core, bounds in windows(height, width, tile=768, margin=86):
        top, bottom, left, right = core
        sy, ey, sx, ex = bounds
        rgb = read(sy, sx, ey, ex)
        edges = _Edges(sy == 0, ey == height, sx == 0, ex == width, height, width)
        tick = time.perf_counter()
        output = _filter_region(rgb, model, AppDefault().controls, edges)
        clocks['denoise'] += time.perf_counter()-tick
        checksum += output[top-sy:bottom-sy, left-sx:right-sx].sum((0, 1), dtype=np.float64)
    return dict(seconds=clocks, analysis_seconds=analysis, checksum=checksum.tolist())


def native(entries, photo):
    entry = next(item for item in entries if item['file'] == photo)
    records = []
    for enabled in (False, True):
        started = time.perf_counter()
        with rawpy.imread(str(photo_root() / photo)) as raw:
            unpack = time.perf_counter()-started
            metadata = metadata_from_raw(raw, entry)
            tick = time.perf_counter()
            sensor = read_sensor(raw, 0, 0, *raw.raw_image_visible.shape)
            normalise = time.perf_counter()-tick
        tick = time.perf_counter()
        if enabled:
            repaired, diagnostic = filter_sensor(sensor, metadata)
            del sensor
            sensor = repaired
        else:
            diagnostic = dict(repaired=0)
        filtering = time.perf_counter()-tick
        pipeline = denoise_native(sensor, metadata)
        records.append(dict(enabled=enabled, unpack_seconds=unpack, normalise_seconds=normalise,
                            filter_seconds=filtering, whole_wait_seconds=time.perf_counter()-started,
                            pipeline=pipeline, diagnostic=diagnostic, peak_rss_bytes=peak_rss()))
        del sensor
        if enabled:
            del repaired
        gc.collect()
    return dict(photo=photo, runs=records,
                conditions='MacBook Neo A18 Pro 8 GB; one CPU thread; native samples, bounded 768px AHD/Denoise cores, 86px+16px halos; shared lock; checksums not whole-frame pixels; no UI, geometry, lens or Opposed color. ±10% descriptive timing allowance.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('generated', 'quick', 'full', 'heldout', 'seen', 'corpus', 'native'))
    parser.add_argument('--inventory', type=Path, required=True)
    parser.add_argument('--photo')
    args = parser.parse_args()
    cv2.setNumThreads(1)
    inventory_bytes = args.inventory.read_bytes()
    entries = json.loads(inventory_bytes)['inventory']
    started = time.perf_counter()
    if args.command == 'generated':
        result = generated(entries)
    elif args.command == 'corpus':
        result = corpus(entries)
    elif args.command == 'native':
        result = native(entries, args.photo)
    else:
        result = quality(entries, args.command)
    result.update(inventory=entries, inventory_source=str(args.inventory.resolve()),
                  inventory_sha256=hashlib.sha256(inventory_bytes).hexdigest(),
                  git_head=subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
                  elapsed_seconds=time.perf_counter()-started, peak_rss_bytes=peak_rss(),
                  machine='MacBook Neo A18 Pro 8 GB, one CPU thread')
    filename = args.command + ('-' + Path(args.photo).stem if args.photo else '') + '.json'
    write(OUTPUT / filename, result)
    print(OUTPUT / filename, flush=True)


if __name__ == '__main__':
    main()
