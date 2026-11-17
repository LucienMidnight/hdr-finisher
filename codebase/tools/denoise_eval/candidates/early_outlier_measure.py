"""Reproducible bounded early-outlier experiment; run under lock and guard."""
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

import cv2
import numpy as np
from PIL import Image
import rawpy

from hdr_finisher import denoise_adaptive as adaptive
from tools.denoise_eval import decision_crops, inputs, metrics
from tools.denoise_eval.adapters import Off
from tools.denoise_eval.candidates import early_outlier as trial
from tools.denoise_eval.candidates.dark_noise import factory as calibrated
from tools.denoise_eval.candidates.dark_noise_measure import signed_sample
from tools.denoise_eval.candidates.demosaic_measure import measure_sample, provenance
from tools.denoise_eval.candidates.noise_specks_measure import read_sensor
from tools.denoise_eval.candidates.pilot_wiener_measure import windows
from tools.denoise_eval.candidates.rawnind import bayer as neural
from tools.denoise_eval.candidates.signed_measure import comparison, fixed_shadow_tail
from tools.denoise_eval.candidates.signed_shadows import develop_signed
from tools.denoise_eval.datasets.summarize import summarize
from tools.denoise_eval.run import peak_rss
from tools.lib.test_photos import photo_root

ROOT = Path(__file__).resolve().parents[3]
OUTPUT = ROOT / 'output/denoise-v1/early-outlier'
VARIANTS = ('raw_support', 'raw_unprotected', 'rgb_support', 'rgb_unprotected', 'raw_stronger',
            'raw_four_single', 'raw_four_double', 'raw_rgb_support')
BEST = 'raw_support'


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, allow_nan=False) + '\n')


def stamp(args):
    result = provenance(args.inventory)
    for path in (Path(__file__), Path(trial.__file__)):
        result['code_sha256'][str(path.relative_to(ROOT))] = hashlib.sha256(path.read_bytes()).hexdigest()
    return result


def methods(include_ai=True):
    result = dict(off=Off(), denoise=calibrated())
    result.update({name: getattr(trial, name)() for name in VARIANTS})
    if include_ai:
        result['rawnind_bayer'] = neural()
    return result


def count_specks(image):
    displayed = metrics.luma_chroma(metrics.display(image))
    middle = np.stack([cv2.medianBlur(displayed[..., component].astype('float32'), 5)
                       for component in range(3)], -1)
    residual = displayed - middle
    masks = dict(dark=residual[..., 0] < -.05, bright=residual[..., 0] > .05,
                 colour=np.linalg.norm(residual[..., 1:], axis=-1) > .08)
    result = {}
    for name, mask in masks.items():
        mask[:4] = mask[-4:] = False
        mask[:, :4] = mask[:, -4:] = False
        _, _, stats, _ = cv2.connectedComponentsWithStats(mask.astype('uint8'), connectivity=8)
        sizes = stats[1:, cv2.CC_STAT_AREA]
        result[name] = dict(islands=int(np.count_nonzero((sizes >= 1) & (sizes <= 25))),
                            pixels=int(mask.sum()))
    displayed_rgb = metrics.display(image).astype('float32')
    middle_rgb = np.stack([cv2.medianBlur(displayed_rgb[..., component], 5)
                           for component in range(3)], -1)
    residual_rgb = np.abs(displayed_rgb-middle_rgb)
    union = ((residual_rgb @ np.array([.2126, .7152, .0722]) > .05) | (residual_rgb.max(-1) > .10))
    union[:6] = union[-6:] = False
    union[:, :6] = union[:, -6:] = False
    _, _, stats, _ = cv2.connectedComponentsWithStats(union.astype('uint8'), connectivity=8)
    sizes = stats[1:, cv2.CC_STAT_AREA]
    result['union'] = dict(islands=int(np.count_nonzero((sizes >= 1) & (sizes <= 25))), pixels=int(union.sum()))
    return result


def sensor_origins(output, sensor):
    scores = np.zeros(sensor.shape, np.float32)
    for row in range(2):
        for column in range(2):
            plane = np.ascontiguousarray(sensor[row::2, column::2])
            residual = plane - cv2.medianBlur(plane, 5)
            deviation = 1.4826 * np.median(np.abs(residual[56:-56, 56:-56]))
            scores[row::2, column::2] = residual / max(deviation, 1e-9)
    displayed = metrics.display(output[112:400, 112:400]).astype('float32')
    centre = np.stack([cv2.medianBlur(displayed[..., channel], 5) for channel in range(3)], -1)
    residual = np.abs(displayed-centre)
    mask = ((residual @ np.array([.2126, .7152, .0722]) > .05) | (residual.max(-1) > .10))
    mask[:6] = mask[-6:] = False
    mask[:, :6] = mask[:, -6:] = False
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype('uint8'), connectivity=8)
    counts = dict(none=0, one=0, several=0)
    crop_scores = np.abs(scores[112:400, 112:400])
    for index in range(1, count):
        if not 1 <= stats[index, cv2.CC_STAT_AREA] <= 25:
            continue
        footprint = cv2.dilate((labels == index).astype('uint8'), np.ones((3, 3), 'uint8')).astype(bool)
        extreme = int(np.count_nonzero(crop_scores[footprint] > 4))
        counts['none' if extreme == 0 else 'one' if extreme == 1 else 'several'] += 1
    random = np.random.default_rng(7)
    hits = 0
    for top, left in random.integers(8, 280, (2000, 2)):
        hits += bool(np.any(crop_scores[top-1:top+2, left-1:left+2] > 4))
    return dict(specks=sum(counts.values()), **counts,
        random_3x3_hit_fraction=hits/2000,
        definition='Union RGB absolute median residual: luma>.05 or any channel>.10; area1..25; 6px border. '
                   'Sensor |z|>4 against 5x5 same-CFA median and central 288px crop MAD; footprint dilated1px.')


def quality(args, entries):
    if args.phase in ('heldout', 'seen'):
        samples = (sample for sample in inputs.paired_samples(ROOT / 'output/denoise-v1/datasets/rawnind/pairs')
                   if bool(sample.metadata['held_out']) == (args.phase == 'heldout'))
    else:
        samples = itertools.chain(inputs.synthetic_samples(entries, args.phase == 'quick'),
                                  inputs.real_samples(entries, args.phase == 'quick'))
    result = dict(cases=[], **stamp(args))
    started = time.perf_counter()
    selected = methods(not args.no_ai)
    for index, sample in enumerate(samples):
        print(args.phase, index + 1, sample.name, flush=True)
        result['cases'].append(measure_sample(signed_sample(sample), selected))
        write(OUTPUT / (args.phase + '.json'), result)
        gc.collect()
    if args.phase in ('heldout', 'seen'):
        result['summary'] = summarize(result)
    result.update(elapsed_seconds=time.perf_counter() - started, peak_rss_bytes=peak_rss())
    write(OUTPUT / (args.phase + '.json'), result)


def gallery_entries(folder):
    rows = {}
    for path in sorted(folder.glob('cases*.json')):
        for row in json.loads(path.read_text()):
            if row['id'] in rows and rows[row['id']] != row:
                raise ValueError('Conflicting frozen gallery coordinate')
            rows[row['id']] = row
    if len(rows) != 14:
        raise ValueError('Expected exactly 14 frozen gallery windows')
    return list(rows.values())


def gallery_metadata(raw, filename, row):
    from tools.denoise_eval.inputs import flat_observations, fit_observations
    height, width = raw.raw_image_visible.shape
    observations = [[] for _ in range(4)]
    for fraction_y in (.15, .5, .85):
        for fraction_x in (.15, .5, .85):
            top = int((height - 512) * fraction_y) // 2 * 2
            left = int((width - 512) * fraction_x) // 2 * 2
            sensor = inputs.normalise_crop(raw, top, left, 512)
            for phase in range(4):
                observations[phase].extend(flat_observations(sensor[phase//2::2, phase%2::2]))
    entry = dict(file=filename, iso=row['iso'], camera=row['camera'],
                 noise_fit_positions=[fit_observations(values) for values in observations])
    return inputs.metadata_from_raw(raw, entry)


def render_row(sample, selected, folder, offset, lift, zoom=None):
    left, top = offset
    region = np.s_[top:top+288, left:left+288]
    records = {}
    folder.mkdir(parents=True, exist_ok=True)
    for name, adapter in selected.items():
        source = sample.bayer if adapter.input_kind == 'bayer' else sample.rgb
        tick = time.perf_counter()
        state = adapter.prepare(source, sample.metadata)
        result = adapter.process(source, sample.metadata, state)
        shown = result * np.float32(2 ** lift)
        decision_crops.save_png(decision_crops.pixels(shown[region]), folder / (name + '.png'))
        if zoom is not None:
            zoom_x, zoom_y = zoom
            pixels = decision_crops.pixels(shown[top+zoom_y-24:top+zoom_y+24,
                                                left+zoom_x-24:left+zoom_x+24])
            image = Image.fromarray(pixels).resize((288, 288), Image.Resampling.NEAREST)
            image.save(folder / (name + '-zoom.png'), optimize=True)
        zoom_residual = None
        if zoom is not None:
            displayed = metrics.luma_chroma(metrics.display(shown[region]))
            point = displayed[zoom[1], zoom[0]]
            middle = np.median(displayed[zoom[1]-2:zoom[1]+3, zoom[0]-2:zoom[0]+3], axis=(0, 1))
            zoom_residual = dict(luma=float(point[0]-middle[0]),
                                 chroma=float(np.linalg.norm((point-middle)[1:])))
        records[name] = dict(seconds=time.perf_counter()-tick, specks=count_specks(shown[region]),
            tail=fixed_shadow_tail(result, sample.rgb, stops=sample.metadata.get('exposure_stops', 0)),
            frozen_zoom_centre_contrast=zoom_residual,
            clean_error=comparison(result, sample.clean, sample.masks.get('valid')) if sample.clean is not None else None,
            diagnostics=state[2] if isinstance(adapter, trial.EarlyOutlier) else None)
        if zoom is not None and name == 'denoise':
            records[name]['sensor_origins'] = sensor_origins(result, sample.bayer)
        del state, result, shown
        gc.collect()
    if sample.clean is not None:
        decision_crops.save_png(decision_crops.pixels(sample.clean[region] * 2 ** lift), folder / 'clean.png')
    return records


def gallery(args):
    selected = methods(not args.no_ai)
    result = dict(cases=[], coordinate_files={path.name: hashlib.sha256(path.read_bytes()).hexdigest()
        for path in args.gallery.glob('cases*.json')}, **stamp(args))
    for row in gallery_entries(args.gallery):
        filename = row['title'].split(' · ')[0]
        if row['origin'].startswith('Public'):
            filename = filename.replace('7D-2_', 'TEST_7D-2_').replace(
                'MuseeL-Saint-Pierre-C500D_', 'TEST_MuseeL-Saint-Pierre-C500D_')
            matches = list((ROOT / 'output/denoise-v1/datasets/rawnind').glob('Bayer_' + filename + '_sha1=*'))
            if len(matches) != 1:
                raise ValueError('Ambiguous/missing public RAW ' + filename)
            path = matches[0]
        else:
            path = photo_root() / filename
        print('gallery', row['id'], flush=True)
        with rawpy.imread(str(path)) as raw:
            metadata = gallery_metadata(raw, path.name, row)
            left, top = row['sensor_xy']
            sensor = inputs.normalise_crop(raw, top, left, 512)
        metadata.update(crop=[top, left, 512, 512], exposure_stops=float(row['lift']))
        rgb = develop_signed(sensor, metadata)
        sample = inputs.Sample(row['id'], rgb, sensor, metadata, None, inputs.masks_for(rgb))
        measurements = render_row(sample, selected, OUTPUT / 'gallery' / row['id'], (112, 112), 0, row['zoom_xy'])
        result['cases'].append(dict(**row, source_path=str(path.resolve()), metadata=metadata, methods=measurements))
        write(OUTPUT / 'gallery/manifest.json', result)
    review(args)


def decisions(args, entries):
    result = dict(cases=[], **stamp(args))
    for case_id, title, sample, offset, lift, licence in decision_crops.cases(entries):
        print('decision', case_id, flush=True)
        sample = signed_sample(sample)
        measured = render_row(sample, methods(not args.no_ai), OUTPUT / 'decision' / case_id, offset, lift)
        result['cases'].append(dict(id=case_id, title=title, licence=licence, lift=lift,
                                    offset=offset, metadata=sample.metadata, methods=measured))
        write(OUTPUT / 'decision/manifest.json', result)
    review(args)


def review(args, detailed=False):
    columns = (list(methods(not args.no_ai)) if detailed else
               ['off', 'denoise', args.best] + ([] if args.no_ai else ['rawnind_bayer']))
    sections = []
    for kind in ('gallery', 'decision'):
        row_columns = columns + (['clean'] if kind == 'decision' else [])
        path = OUTPUT / kind / 'manifest.json'
        if not path.exists():
            continue
        rows = []
        for row in json.loads(path.read_text())['cases']:
            cells = []
            for name in row_columns:
                image = OUTPUT / kind / row['id'] / (name + '.png')
                prefix = kind + '/' + row['id'] + '/' + name
                content = '<img loading="lazy" width="288" height="288" src="' + prefix + '.png">' if image.exists() else 'No clean truth'
                if kind == 'gallery' and image.exists():
                    content += '<img loading="lazy" width="288" height="288" src="' + prefix + '-zoom.png">'
                cells.append('<td>' + content + '</td>')
            rows.append('<tr><th>' + escape(row['title']) + '<p>Lift ' + str(row['lift']) +
                        ' stops</p></th>' + ''.join(cells) + '</tr>')
        sections.append('<h2>' + kind.title() + '</h2><table><thead><tr><th>Fixed case</th>' +
            ''.join('<th>' + escape(name) + '</th>' for name in row_columns) + '</tr></thead><tbody>' + ''.join(rows) + '</tbody></table>')
    star_path = OUTPUT / 'stars.json'
    if star_path.exists():
        star_rows = []
        for row in json.loads(star_path.read_text())['cases']:
            prefix = 'stars/' + str(row['sigma']) + '/'
            names = ['clean'] + [name + ('-noisy' if row['noisy'] else '-clean')
                                 for name in ('denoise', args.best, 'raw_four_single', 'raw_four_double')]
            star_rows.append('<tr><th>Star FWHM ' + str(round(row['fwhm'], 2)) +
                ' px; ' + ('noisy' if row['noisy'] else 'clean') + '</th>' + ''.join(
                '<td><p>' + name + '</p><img loading="lazy" width="192" height="192" src="' +
                prefix + name + '.png"></td>' for name in names) + '</tr>')
        sections.append('<h2>Glow-shaped stars, fixed +2-stop display</h2><table>' + ''.join(star_rows) + '</table>')
    token_path = os.path.relpath(ROOT / 'frontend/visual-tokens.css', OUTPUT)
    html = ('<!doctype html><meta charset="utf-8"><title>Early outlier taming</title>'
        '<link rel="stylesheet" href="' + token_path + '"><style>'
        'body{background:var(--app);color:var(--body);font-family:var(--font-body);'
        'font-size:var(--font-size-md);font-weight:var(--font-weight-regular);line-height:var(--line-height-normal)}'
        'h1{font-size:var(--font-size-3xl);font-weight:var(--font-weight-semibold)}'
        'h2{font-size:var(--font-size-2xl);font-weight:var(--font-weight-semibold)}'
        'th{font-weight:var(--font-weight-semibold)}a{color:var(--accent)}th,td{vertical-align:top;text-align:left;'
        'padding:var(--group-disclosure-gap)}thead{position:sticky;top:0;background:var(--app)}'
        'img{display:block;image-rendering:pixelated}</style><h1>Early outlier taming — research only</h1>'
        '<p>Signed Off; today’s Denoise with dark-noise calibration repair; pre/post-demosaic soft-clamp '
        'ablations; stronger raw trial; RawNIND Bayer alone. No production changes. All 14 gallery '
        'rows retain the exact sensor windows and original 48×48 spots enlarged 6× with nearest-neighbour. '
        'Top image: 288 native pixels. Bottom: same frozen pixel zoom, never reselected per method. '
        'Speck counts are local-contrast proxies, not proof that a point is noise. '
        'Clean private RAW truth is unavailable. Best shadow cleanup is not a shipping recommendation: '
        'inspect the clean text, stars and fabric failures. <a href="ablations.html">All variants</a> · '
        '<a href="index.html">Four-column review</a>.</p>' + ''.join(sections))
    (OUTPUT / ('ablations.html' if detailed else 'index.html')).write_text(html)
    if not detailed:
        review(args, True)


def clean_safety(args, entries):
    selected = methods(False)
    rows = []
    for original in inputs.synthetic_samples(entries, False):
        if original.metadata['iso'] != 1600:
            continue
        sensor = original.clean_bayer
        reference = develop_signed(sensor, original.metadata)
        current = calibrated()
        reference_denoise = current.process(reference, original.metadata, current.prepare(reference, original.metadata))
        record = dict(name=original.name, methods={})
        for name in VARIANTS:
            adapter = selected[name]
            rgb, counts = trial.develop(sensor, original.metadata, adapter.stage, adapter.controls)
            output = adapter.process(sensor, original.metadata, adapter.prepare(sensor, original.metadata))
            record['methods'][name] = dict(vs_off=comparison(rgb, reference),
                incremental_denoise=comparison(output, reference_denoise), diagnostics=counts)
        rows.append(record)
        print('clean', original.name, flush=True)
    safety = []
    original = next(inputs.synthetic_samples(entries, True))
    from tools.denoise_eval.candidates.signed_measure import signed_sensor
    sensor = signed_sensor(original).copy()
    sensor[40, 40], sensor[60, 60] = -.01, .95
    zero = {}
    zero_reference = develop_signed(sensor, original.metadata)
    for name, adapter in selected.items():
        source = zero_reference if adapter.input_kind != 'bayer' else sensor
        zero[name] = adapter.process(source, original.metadata, adapter.prepare(source, original.metadata))
    for stops in range(-6, 7):
        info = dict(original.metadata, exposure_stops=stops)
        reference = develop_signed(sensor, info)
        for name, adapter in selected.items():
            source = reference if adapter.input_kind != 'bayer' else sensor
            state = adapter.prepare(source, info)
            output = adapter.process(source, info, state)
            safety.append(dict(stops=stops, method=name, finite=bool(np.isfinite(output).all()),
                renormalized_error=comparison(output / np.float32(2 ** stops), zero[name]),
                hdr_harness_cap_exact=bool(np.max(metrics.display(output, 'hdr')) <= metrics.pq(1000)),
                qualification='Fixed display cap only; no production delivery or GPU qualification'))
    write(OUTPUT / 'clean-safety.json', dict(clean=rows, safety=safety, **stamp(args)))


def star_safety(args, entries):
    prototype = next(inputs.synthetic_samples(entries, True))
    height = width = 192
    rows, columns = np.indices((height, width))
    result = dict(cases=[], **stamp(args))
    selected = methods(False)
    selected.pop('off')
    for sigma in (.8, 1.2, 1.8):
        camera = np.full((height, width, 3), .002, np.float32)
        positions = []
        for row_index, amplitude in enumerate((.03, .1, .4, .8)):
            for column_index, phase in enumerate((0., .33, .67)):
                centre_y, centre_x = 24+row_index*44+phase, 28+column_index*60+phase
                profile = np.exp(-((rows-centre_y)**2+(columns-centre_x)**2)/(2*sigma*sigma))
                camera += amplitude * profile[..., None]
                positions.append((centre_y, centre_x, amplitude))
        sensor = inputs.remosaic(camera, prototype.metadata['cfa'])
        clean = develop_signed(sensor, prototype.metadata)
        folder = OUTPUT / 'stars' / str(sigma)
        folder.mkdir(parents=True, exist_ok=True)
        decision_crops.save_png(decision_crops.pixels(clean * 4), folder / 'clean.png')
        for noisy in (False, True):
            source = sensor
            if noisy:
                source = inputs.add_noise(sensor, prototype.metadata['noise_parameters'], 170011, 0)
                source = (np.rint(np.minimum(source, 1)*65535)/65535).astype('float32')
            reference = develop_signed(source, prototype.metadata)
            current = calibrated()
            baseline = current.process(reference, prototype.metadata, current.prepare(reference, prototype.metadata))
            record = dict(sigma=sigma, fwhm=sigma*2*np.sqrt(2*np.log(2)), noisy=noisy, methods={})
            for name, adapter in selected.items():
                if name == 'denoise':
                    output = baseline
                    developed = reference
                else:
                    developed, _ = trial.develop(source, prototype.metadata, adapter.stage, adapter.controls)
                    output = adapter.process(source, prototype.metadata, adapter.prepare(source, prototype.metadata))
                measurements = []
                for centre_y, centre_x, amplitude in positions:
                    region = (rows-centre_y)**2+(columns-centre_x)**2 <= 8**2
                    core = (rows-centre_y)**2+(columns-centre_x)**2 <= 3**2
                    def flux(image):
                        return float(np.sum((image-clean[0, 0])[region] @ adaptive.ACESCG_LUMINANCE))
                    measurements.append(dict(amplitude=amplitude,
                        development_flux_ratio=metrics.ratio(flux(developed), flux(reference)),
                        denoise_flux_ratio=metrics.ratio(flux(output), flux(baseline)),
                        peak_vs_current=metrics.ratio(float(np.max(output[core] @ adaptive.ACESCG_LUMINANCE)),
                                                     float(np.max(baseline[core] @ adaptive.ACESCG_LUMINANCE)))))
                record['methods'][name] = dict(stars=measurements,
                    incremental_error=comparison(output, baseline))
                decision_crops.save_png(decision_crops.pixels(output * 4), folder / (name + ('-noisy' if noisy else '-clean') + '.png'))
            result['cases'].append(record)
            print('stars', sigma, noisy, flush=True)
            write(OUTPUT / 'stars.json', result)


def native(args, entries):
    entry = next(row for row in entries if row['file'] == args.photo)
    records = []
    tick = time.perf_counter()
    with rawpy.imread(str(photo_root() / args.photo)) as raw:
        open_seconds = time.perf_counter() - tick
        info = inputs.metadata_from_raw(raw, entry)
        height, width = raw.raw_image_visible.shape
        for name in dict.fromkeys(('denoise', args.best, 'raw_four_single', 'raw_four_double')):
            candidate = getattr(trial, name)() if name != 'denoise' else None
            clocks = dict(sensor_seconds=0., development_seconds=0.)
            def reader(top, left, bottom, right):
                first_y, first_x = max(0, (top-32)//2*2), max(0, (left-32)//2*2)
                last_y, last_x = min(height, (bottom+33)//2*2), min(width, (right+33)//2*2)
                tick = time.perf_counter()
                sensor = read_sensor(raw, first_y, first_x, last_y, last_x)
                clocks['sensor_seconds'] += time.perf_counter()-tick
                tick = time.perf_counter()
                rgb = (trial.develop(sensor, info, candidate.stage, candidate.controls)[0]
                       if candidate is not None else develop_signed(sensor, info))
                clocks['development_seconds'] += time.perf_counter()-tick
                return rgb[top-first_y:bottom-first_y, left-first_x:right-first_x].copy()
            adapter = calibrated()
            started = time.perf_counter()
            state = adapter.prepare(adaptive._WindowSource(height, width, reader), info)
            prepare_seconds = time.perf_counter()-started
            filter_seconds = 0.
            checksum = np.zeros(3)
            for core, bounds in windows(height, width, tile=768, margin=66):
                top, bottom, left, right = core
                first_y, last_y, first_x, last_x = bounds
                rgb = reader(first_y, first_x, last_y, last_x)
                edges = adaptive._Edges(first_y == 0, last_y == height, first_x == 0,
                                        last_x == width, height, width)
                tick = time.perf_counter()
                filtered = adaptive._filter_region(rgb, state[0], adapter.controls, edges)
                if not np.isfinite(filtered).all():
                    raise ValueError('Invalid native output')
                filter_seconds += time.perf_counter()-tick
                checksum += filtered[top-first_y:bottom-first_y, left-first_x:right-first_x].sum(axis=(0, 1), dtype=float)
                del rgb, filtered
            record = dict(method=name, shape=[height, width], open_seconds=open_seconds,
                prepare_seconds=prepare_seconds, filter_seconds=filter_seconds,
                whole_seconds=open_seconds+time.perf_counter()-started,
                checksum=checksum.tolist(), peak_rss_bytes=peak_rss(), **clocks)
            records.append(record)
            print('native', args.photo, name, record['whole_seconds'], flush=True)
            write(OUTPUT / ('native-' + Path(args.photo).stem + '.json'), dict(cases=records, **stamp(args)))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--inventory', type=Path, required=True)
    parser.add_argument('--phase', choices=('gallery', 'quick', 'full', 'heldout', 'seen', 'decision',
                                           'review', 'clean-safety', 'stars', 'native'), required=True)
    parser.add_argument('--gallery', type=Path)
    parser.add_argument('--no-ai', action='store_true')
    parser.add_argument('--photo', default='IMG_0790.CR2')
    parser.add_argument('--best', choices=VARIANTS, default=BEST)
    args = parser.parse_args()
    cv2.setNumThreads(1)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    entries = json.loads(args.inventory.read_text())['inventory']
    if args.phase in ('quick', 'full', 'heldout', 'seen'):
        quality(args, entries)
    elif args.phase == 'gallery':
        if args.gallery is None:
            parser.error('Gallery phase requires original --gallery folder')
        gallery(args)
    elif args.phase == 'decision':
        decisions(args, entries)
    elif args.phase == 'review':
        review(args)
    elif args.phase == 'clean-safety':
        clean_safety(args, entries)
    elif args.phase == 'stars':
        star_safety(args, entries)
    else:
        native(args, entries)


if __name__ == '__main__':
    main()
