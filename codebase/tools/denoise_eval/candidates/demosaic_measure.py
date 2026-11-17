"""Serial bounded demosaic/noise investigation; use machine lock and guard."""
from __future__ import annotations

import os
for variable in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS',
                 'VECLIB_MAXIMUM_THREADS', 'HDR_CPU_THREADS'):
    os.environ[variable] = '1'

import argparse
from dataclasses import replace
import gc
import hashlib
from html import escape
import itertools
import json
from pathlib import Path
import subprocess
import time

import numpy as np
import rawpy

from hdr_finisher import denoise_adaptive as adaptive
from tools.denoise_eval import decision_crops, inputs, metrics
from tools.denoise_eval.adapters import Off
from tools.denoise_eval.candidates import demosaic_noise as trial
from tools.denoise_eval.candidates.dark_noise import factory as calibration
from tools.denoise_eval.candidates.dark_noise_measure import signed_sample
from tools.denoise_eval.candidates.denoise_v2_appdefault import AppDefault
from tools.denoise_eval.candidates.noise_specks_measure import read_sensor
from tools.denoise_eval.candidates.pilot_wiener_measure import windows
from tools.denoise_eval.candidates.rawnind import bayer as neural
from tools.denoise_eval.candidates.signed_measure import fixed_shadow_tail, signed_sensor
from tools.denoise_eval.candidates.signed_shadows import develop_signed
from tools.denoise_eval.datasets.summarize import summarize
from tools.denoise_eval.run import peak_rss
from tools.lib.test_photos import photo_root

ROOT = Path(__file__).resolve().parents[3]
OUTPUT = ROOT / 'output/denoise-v1/demosaic-noise'
VARIANTS = ('bilinear', 'lmmse', 'raw_ahd', 'raw_lmmse')


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, allow_nan=False) + '\n')


def provenance(inventory_path):
    sources = [Path(__file__), Path(trial.__file__), Path(__file__).with_name('signed_ahd.c'),
               ROOT / 'backend/hdr_finisher/denoise_adaptive.py', Path(__file__).with_name('dark_noise.py')]
    return dict(machine='MacBook Neo A18 Pro 8 GB; one CPU/native thread',
                git_head=subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
                inventory_sha256=hashlib.sha256(inventory_path.read_bytes()).hexdigest(),
                code_sha256={str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
                             for path in sources}, controls=AppDefault().description()['controls'])


def adapters(rawnind=True):
    selected = dict(off=Off(), current=AppDefault(), current_fix=calibration())
    for name in VARIANTS:
        selected[name] = getattr(trial, name)()
        selected[name + '_fix'] = getattr(trial, name + '_fix')()
    if rawnind:
        selected['rawnind_bayer'] = neural()
    return selected


def output(adapter, sample):
    source = sample.bayer if adapter.input_kind == 'bayer' else sample.rgb
    state = adapter.prepare(source, sample.metadata)
    return adapter.process(source, sample.metadata, state)


def measure_sample(sample, selected, crop=None):
    records = {}
    for name, adapter in selected.items():
        tick = time.perf_counter()
        result = output(adapter, sample)
        if result.shape != sample.rgb.shape or not np.isfinite(result).all():
            raise ValueError('Invalid demosaic research output: ' + name)
        elapsed = time.perf_counter() - tick
        measured = metrics.evaluate(result, sample.rgb, sample.clean, sample.masks,
                                    'slanted-edge' in sample.name,
                                    exposure_stops=sample.metadata.get('exposure_stops', 0))
        measured['seconds'] = elapsed
        measured['fixed_tail'] = fixed_shadow_tail(result, sample.rgb,
            stops=sample.metadata.get('exposure_stops', 0), valid=sample.masks.get('valid'))
        if crop is not None:
            region, lift, folder = crop
            decision_crops.save_png(decision_crops.pixels(result[region] * 2 ** lift), folder / (name + '.png'))
            measured['decision_tail'] = fixed_shadow_tail(result[region], sample.rgb[region],
                                                          stops=sample.metadata.get('exposure_stops', 0))
        records[name] = measured
        del result
    return dict(name=sample.name, metadata=sample.metadata, shape=list(sample.rgb.shape),
                clean=sample.clean is not None, adapters=records,
                negative_sensor_fraction=float(np.mean(sample.bayer < 0)),
                valid_pixels=int(sample.masks['valid'].sum()) if 'valid' in sample.masks else None)


def quality(args, entries):
    quick = args.phase == 'quick'
    if args.phase in ('heldout', 'seen'):
        samples = (sample for sample in inputs.paired_samples(ROOT / 'output/denoise-v1/datasets/rawnind/pairs')
                   if bool(sample.metadata['held_out']) == (args.phase == 'heldout'))
    else:
        samples = itertools.chain(inputs.synthetic_samples(entries, quick), inputs.real_samples(entries, quick))
    selected = adapters(not args.no_rawnind)
    result = dict(phase=args.phase, cases=[], inventory=entries,
                  adapters={name: adapter.description() for name, adapter in selected.items()},
                  truth='Both noisy/clean signed AHD; inherited fixed masks, seed and capture gains',
                  **provenance(args.inventory))
    started = time.perf_counter()
    for index, sample in enumerate(samples):
        print(args.phase, index + 1, sample.name, flush=True)
        result['cases'].append(measure_sample(signed_sample(sample), selected))
        write(OUTPUT / (args.phase + '.json'), result)
        gc.collect()
    if args.phase in ('heldout', 'seen'):
        result['summary'] = summarize(result)
    result.update(elapsed_seconds=time.perf_counter()-started, peak_rss_bytes=peak_rss())
    write(OUTPUT / (args.phase + '.json'), result)


def decisions(args, entries):
    selected = adapters(not args.no_rawnind)
    result = dict(cases=[], **provenance(args.inventory))
    for case_id, title, sample, offset, lift, licence in decision_crops.cases(entries):
        if args.canon_only and not case_id.startswith('canon-'):
            continue
        print('decision', case_id, flush=True)
        sample = signed_sample(sample)
        left, top = offset
        region = np.s_[top:top+288, left:left+288]
        folder = OUTPUT / 'decision' / case_id
        folder.mkdir(parents=True, exist_ok=True)
        record = measure_sample(sample, selected, (region, lift, folder))
        record.update(id=case_id, title=title, offset=offset, lift=lift, licence=licence)
        if sample.clean is not None:
            decision_crops.save_png(decision_crops.pixels(sample.clean[region] * 2 ** lift), folder / 'clean.png')
        result['cases'].append(record)
        write(OUTPUT / 'decision/manifest.json', result)
        gc.collect()
    review(selected.keys())


def review(columns):
    records = json.loads((OUTPUT / 'decision/manifest.json').read_text())['cases']
    columns = [*columns, 'clean']
    headings = ''.join('<th>' + escape(name.replace('_', ' ')) + '</th>' for name in columns)
    rows = []
    for record in records:
        cells = []
        for name in columns:
            exists = (OUTPUT / 'decision' / record['id'] / (name + '.png')).exists()
            cells.append('<td><img width="288" height="288" loading="lazy" src="' + record['id'] + '/' + name +
                         '.png"></td>' if exists else '<td>No clean reference</td>')
        rows.append('<tr><th>' + escape(record['title']) + '</th>' + ''.join(cells) + '</tr>')
    tokens = os.path.relpath(ROOT / 'frontend/visual-tokens.css', OUTPUT / 'decision')
    html = ('<!doctype html><meta charset="utf-8"><title>Signed demosaic noise decision crops</title>'
            '<link rel="stylesheet" href="' + tokens + '"><style>'
            'body{background:var(--app);color:var(--text);font-family:var(--font-body);'
            'font-size:var(--font-size-md);line-height:var(--line-height-normal);font-weight:var(--font-weight-regular)}'
            'h1{font-size:var(--font-size-3xl);font-weight:var(--font-weight-semibold)}'
            'th,td{padding:var(--group-disclosure-gap);text-align:left;vertical-align:top}'
            'th{font-weight:var(--font-weight-semibold)}'
            'thead{position:sticky;top:0;background:var(--app)}img{display:block}</style>'
            '<h1>Signed input: changing demosaic versus raw-plane smoothing</h1>'
            '<p>12 fixed decision rows; 288 native pixels, same exposure in each row. Fix = calibration repair. '
            'LMMSE = independent linear-MMSE-style trial, NOT upstream RawTherapee LMMSE. '
            'RawNIND Bayer alone. Private Canon/Sony have no clean truth. Research only.</p>'
            '<table><thead><tr><th>Case</th>' + headings + '</tr></thead><tbody>' + ''.join(rows) + '</tbody></table>')
    (OUTPUT / 'decision/index.html').write_text(html)
    size = sum(path.stat().st_size for path in (OUTPUT / 'decision').rglob('*') if path.is_file())
    if size > 13_000_000:
        raise ValueError('Decision review exceeds the inherited 13 MB budget')


def clean_quality(args, entries):
    records = []
    seen = set()
    for sample in inputs.synthetic_samples(entries, False):
        if sample.metadata['iso'] != 1600:
            continue
        key = sample.name.rsplit('-iso', 1)[0]
        if key in seen:
            continue
        seen.add(key)
        sensor = sample.clean_bayer
        reference = develop_signed(sensor, sample.metadata)
        row = dict(name=key, methods={})
        generated = sample.metadata.get('generated')
        analytic = dict(inputs.targets(512)).get(generated)
        if analytic is not None:
            camera = analytic @ np.linalg.inv(np.asarray(sample.metadata['camera_to_acescg'])).T / np.asarray(
                sample.metadata['white_balance'])
            from tools.denoise_eval.candidates.signed_shadows import to_aces
            analytic = to_aces(np.clip(camera, 0, 1), sample.metadata)
        for name, method, strength in [('ahd', 'ahd', 0), ('bilinear', 'bilinear', 0),
                                        ('lmmse', 'lmmse', 0), ('raw_ahd', 'ahd', .65),
                                        ('raw_lmmse', 'lmmse', .65)]:
            result = trial.develop(sensor, sample.metadata, method, strength)
            row['methods'][name] = dict(vs_ahd=metrics.evaluate(result, reference, reference, sample.masks,
                'slanted-edge' in key), vs_analytic=metrics.evaluate(result, reference, analytic, sample.masks,
                'slanted-edge' in key) if analytic is not None else None)
        records.append(row)
        print('clean', key, flush=True)
    write(OUTPUT / 'clean.json', dict(cases=records, **provenance(args.inventory)))


def safety(args, entries):
    sample = next(sample for sample in inputs.synthetic_samples(entries, True)
                  if sample.name == 'synthetic-fabric-iso6400')
    sample = signed_sample(sample)
    records = {}
    for name, adapter in adapters(False).items():
        if name == 'off':
            continue
        reference = output(adapter, sample)
        rows = []
        for stops in range(-6, 7):
            scaled = replace(sample, metadata={**sample.metadata, 'exposure_stops': stops},
                             rgb=sample.rgb * np.float32(2 ** stops))
            actual = output(adapter, scaled)
            normalized = actual / np.float32(2 ** stops)
            rows.append(dict(stops=stops, finite=bool(np.isfinite(actual).all()),
                sdr=metrics.summary(metrics.colour_error(normalized, reference)),
                hdr=metrics.summary(metrics.colour_error(normalized, reference, 'hdr')),
                fixed_display_ceiling_exact=bool(np.max(metrics.display(actual, 'hdr')) <= metrics.pq(1000))))
        records[name] = rows
        print('safety', name, flush=True)
    write(OUTPUT / 'safety.json', dict(methods=records,
        qualification='Exposure after sensor development, before Denoise; not RAW saturation or delivery qualification',
        **provenance(args.inventory)))


def native(args, entries):
    entry = next(row for row in entries if row['file'] == args.photo)
    records = []
    started = time.perf_counter()
    with rawpy.imread(str(photo_root() / args.photo)) as raw:
        opened = time.perf_counter() - started
        info = inputs.metadata_from_raw(raw, entry)
        height, width = raw.raw_image_visible.shape
        for method, strength in [('ahd', 0), ('bilinear', 0), ('lmmse', 0), ('ahd', .65), ('lmmse', .65)]:
            clocks = dict(sensor_seconds=0., develop_seconds=0.)
            def reader(top, left, bottom, right):
                tick = time.perf_counter()
                first_y, first_x = max(0, (top-32)//2*2), max(0, (left-32)//2*2)
                end_y, end_x = min(height, (bottom+33)//2*2), min(width, (right+33)//2*2)
                sensor = read_sensor(raw, first_y, first_x, end_y, end_x)
                clocks['sensor_seconds'] += time.perf_counter()-tick
                tick = time.perf_counter()
                rgb = trial.develop(sensor, info, method, strength)
                clocks['develop_seconds'] += time.perf_counter()-tick
                return rgb[top-first_y:bottom-first_y, left-first_x:right-first_x].copy()
            tick = time.perf_counter()
            checksum = np.zeros(3)
            for top in range(0, height, 256):
                rgb = reader(top, 0, min(top+256, height), width)
                checksum += rgb.sum(axis=(0, 1), dtype=float)
                del rgb
            development_seconds = time.perf_counter()-tick
            development_clocks = clocks.copy()
            for repair in (False, True):
                clocks = dict(sensor_seconds=0., develop_seconds=0.)
                print('native', args.photo, method, strength, repair, flush=True)
                adapter = calibration() if repair else AppDefault()
                tick = time.perf_counter()
                source = adaptive._WindowSource(height, width, reader)
                state = adapter.prepare(source, info) if repair else adaptive._estimate(source)
                model = state[0] if repair else state
                prepare_seconds = time.perf_counter()-tick
                crop_rows = [row for row in decision_crops.NATIVE if row[2] == args.photo]
                crops = {row[0]: np.zeros((288, 288, 3), np.float32) for row in crop_rows}
                filter_seconds = 0.
                for core, bounds in windows(height, width, tile=768, margin=66):
                    top, bottom, left, right = core
                    first_y, end_y, first_x, end_x = bounds
                    image = reader(first_y, first_x, end_y, end_x)
                    edges = adaptive._Edges(first_y == 0, end_y == height, first_x == 0, end_x == width, height, width)
                    stamp = time.perf_counter()
                    filtered = adaptive._filter_region(image, model, adapter.controls, edges)
                    if not np.isfinite(filtered).all():
                        raise ValueError('Invalid native filtered output')
                    filter_seconds += time.perf_counter()-stamp
                    for case_id, _, _, origin, offset, _ in crop_rows:
                        crop_x, crop_y = origin[0]+offset[0], origin[1]+offset[1]
                        start_y, stop_y = max(top, crop_y), min(bottom, crop_y+288)
                        start_x, stop_x = max(left, crop_x), min(right, crop_x+288)
                        if stop_y > start_y and stop_x > start_x:
                            crops[case_id][start_y-crop_y:stop_y-crop_y, start_x-crop_x:stop_x-crop_x] = filtered[
                                start_y-first_y:stop_y-first_y, start_x-first_x:stop_x-first_x]
                    del image, filtered
                elapsed = time.perf_counter()-tick
                tails = {}
                for case_id, _, _, origin, offset, lift in crop_rows:
                    crop_x, crop_y = origin[0]+offset[0], origin[1]+offset[1]
                    sensor = read_sensor(raw, crop_y-32, crop_x-32, crop_y+320, crop_x+320)
                    reference = develop_signed(sensor, info)[32:320, 32:320]
                    tails[case_id] = fixed_shadow_tail(crops[case_id], reference)
                    folder = OUTPUT / 'native-crops' / case_id
                    folder.mkdir(parents=True, exist_ok=True)
                    label = method + ('_raw' if strength else '') + ('_fix' if repair else '')
                    decision_crops.save_png(decision_crops.pixels(crops[case_id] * 2 ** lift), folder / (label+'.png'))
                records.append(dict(method=method, raw_strength=strength, repair=repair,
                    raw_open_seconds=opened, development_seconds=development_seconds,
                    prepare_seconds=prepare_seconds, filter_seconds=filter_seconds,
                    total_seconds=opened+elapsed, clocks=clocks.copy(),
                    standalone_development_clocks=development_clocks, model=model.as_dict(),
                    development_checksum=checksum.tolist(), fixed_tails=tails, peak_rss_bytes=peak_rss()))
                write(OUTPUT / ('native-'+Path(args.photo).stem+'.json'), dict(photo=args.photo,
                    shape=[height, width], methods=records, **provenance(args.inventory)))
                del source, state, model, crops
                gc.collect()


def probe(args, entries):
    records = []
    for case_id, title, sample, offset, lift, licence in decision_crops.cases(entries):
        if not case_id.startswith('canon-'):
            continue
        sample = signed_sample(sample)
        left, top = offset
        region = np.s_[top:top+288, left:left+288]
        methods = {}
        for name, method, strength in [('ahd', 'ahd', 0), ('bilinear', 'bilinear', 0),
                                        ('lmmse', 'lmmse', 0), ('raw_ahd', 'ahd', .65),
                                        ('raw_lmmse', 'lmmse', .65)]:
            developed = trial.develop(sample.bayer, sample.metadata, method, strength)
            folder = OUTPUT / 'pre-denoise' / case_id
            folder.mkdir(parents=True, exist_ok=True)
            decision_crops.save_png(decision_crops.pixels(developed[region] * 2 ** lift), folder / (name+'.png'))
            methods[name] = dict(before_denoise_tail=fixed_shadow_tail(developed[region], sample.rgb[region]),
                finite=bool(np.isfinite(developed).all()), negative_fraction=float(np.mean(developed < 0)))
        records.append(dict(id=case_id, title=title, methods=methods))
    write(OUTPUT / 'probe.json', dict(cases=records, **provenance(args.inventory)))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inventory', type=Path, required=True)
    parser.add_argument('--phase', choices=('quick', 'full', 'heldout', 'seen', 'decision', 'clean', 'safety', 'native', 'probe'), required=True)
    parser.add_argument('--photo', choices=('IMG_0790.CR2', '2025_0730_1331_3.arw'), default='IMG_0790.CR2')
    parser.add_argument('--no-rawnind', action='store_true')
    parser.add_argument('--canon-only', action='store_true')
    args = parser.parse_args()
    entries = json.loads(args.inventory.read_text())['inventory']
    if args.phase == 'decision':
        decisions(args, entries)
    elif args.phase == 'clean':
        clean_quality(args, entries)
    elif args.phase == 'safety':
        safety(args, entries)
    elif args.phase == 'native':
        native(args, entries)
    elif args.phase == 'probe':
        probe(args, entries)
    else:
        quality(args, entries)


if __name__ == '__main__':
    main()
