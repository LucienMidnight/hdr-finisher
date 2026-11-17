"""Bounded faithful LMMSE trial; every phase requires the shared machine lock."""
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
from types import SimpleNamespace

import cv2
import numpy as np
import rawpy

from hdr_finisher import denoise_adaptive as adaptive
from hdr_finisher.color_context import RenderColorContext
from hdr_finisher.exporters import _render_export_branch
from hdr_finisher.hdr_from_sdr import delivery_ceiling_metrics
from hdr_finisher.models import AdjustmentState, ExportSettings, PreviewKind
from tools.denoise_eval import decision_crops, inputs, metrics
from tools.denoise_eval.candidates import demosaic_measure as shared
from tools.denoise_eval.candidates import demosaic_noise as previous
from tools.denoise_eval.candidates import lmmse_demosaic as trial
from tools.denoise_eval.candidates.dark_noise import factory as calibrated
from tools.denoise_eval.candidates.dark_noise_measure import signed_sample
from tools.denoise_eval.candidates.noise_specks_measure import read_sensor
from tools.denoise_eval.candidates.pilot_wiener_measure import windows
from tools.denoise_eval.candidates.rawnind import bayer as neural
from tools.denoise_eval.candidates.signed_shadows import develop_signed, to_aces
from tools.denoise_eval.run import peak_rss
from tools.lib.test_photos import photo_root

ROOT = Path(__file__).resolve().parents[3]
OUTPUT = ROOT / 'output/denoise-v1/lmmse-demosaic'
write = shared.write


def provenance(inventory):
    sources = [Path(__file__), Path(trial.__file__), trial.VENDOR, trial.SHIM,
               Path(previous.__file__), ROOT / 'backend/hdr_finisher/signed_ahd.c',
               ROOT / 'backend/hdr_finisher/denoise_adaptive.py', Path(__file__).with_name('dark_noise.py')]
    return dict(machine='MacBook Neo Apple A18 Pro 8 GB; one CPU/native thread',
                git_head=subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
                upstream_commit=trial.UPSTREAM_COMMIT, iterations=trial.ITERATIONS,
                inventory_sha256=hashlib.sha256(inventory.read_bytes()).hexdigest(),
                code_sha256={str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
                             for path in sources}, controls=calibrated().description()['controls'])


def adapters(rawnind=True):
    selected = dict(off=trial.off(), signed_ahd_fix=trial.ahd(), rt_lmmse_fix=trial.factory(),
                    previous_mmse_fix=previous.lmmse_fix())
    if rawnind:
        selected['rawnind_bayer'] = neural()
    return selected


def signed_primary(sample):
    inherited = signed_sample(sample)
    clean = trial.develop_ahd(inherited.clean_bayer, inherited.metadata) if inherited.clean_bayer is not None else inherited.clean
    return replace(inherited, rgb=trial.develop_ahd(inherited.bayer, inherited.metadata), clean=clean)


def measure_sample(sample, selected, crop=None):
    inherited_support = develop_signed(sample.bayer, sample.metadata)
    records = {}
    for name, adapter in selected.items():
        started = time.perf_counter()
        result = shared.output(adapter, sample)
        elapsed = time.perf_counter() - started
        if result.shape != sample.rgb.shape or not np.isfinite(result).all():
            raise ValueError('Invalid output: ' + name)
        measured = metrics.evaluate(result, sample.rgb, sample.clean, sample.masks,
                                    'slanted-edge' in sample.name,
                                    exposure_stops=sample.metadata.get('exposure_stops', 0))
        measured['seconds'] = elapsed
        measured['fixed_tail'] = shared.fixed_shadow_tail(result, inherited_support,
            stops=sample.metadata.get('exposure_stops', 0), valid=sample.masks.get('valid'))
        if crop is not None:
            region, lift, folder = crop
            decision_crops.save_png(decision_crops.pixels(result[region] * 2 ** lift), folder / (name + '.png'))
            measured['decision_tail'] = shared.fixed_shadow_tail(result[region], inherited_support[region],
                stops=sample.metadata.get('exposure_stops', 0))
        records[name] = measured
    parameters = sample.metadata.get('noise_parameters')
    sigma = float(np.sqrt(np.mean([item['a'] * .18 + item['b'] for item in parameters]))) if parameters else None
    return dict(name=sample.name, metadata=sample.metadata, shape=list(sample.rgb.shape),
                clean=sample.clean is not None, adapters=records,
                provisional_sensor_sigma18=sigma,
                negative_sensor_fraction=float(np.mean(sample.bayer < 0)))


def artifact_scores(result, reference):
    error = metrics.luma_chroma(metrics.display(result)) - metrics.luma_chroma(metrics.display(reference))
    center = error[32:-32, 32:-32]
    zipper = np.diff(center[..., 0], n=2, axis=0)
    maze = cv2.Laplacian(center[..., 0].astype('float32'), cv2.CV_32F)
    return dict(false_colour_chroma_rms=float(np.sqrt(np.mean(center[..., 1:] ** 2))),
                zipper_second_difference_rms=float(np.sqrt(np.mean(zipper ** 2))),
                maze_laplacian_rms=float(np.sqrt(np.mean(maze ** 2))),
                qualification='Descriptive residual bands, not validated artifact detectors; inspect crops')


def clean(args, entries):
    records, used = [], set()
    charts = dict(inputs.targets(512))
    generated = (sample for sample in inputs.synthetic_samples(entries, False) if sample.metadata['iso'] == 1600)
    paired = []
    scenes = set()
    for sample in inputs.paired_samples(ROOT / 'output/denoise-v1/datasets/rawnind/pairs'):
        if sample.metadata['held_out'] and sample.metadata['scene_id'] not in scenes:
            paired.append(sample)
            scenes.add(sample.metadata['scene_id'])
    samples = itertools.chain(generated, paired)
    for sample in samples:
        subject = sample.name.rsplit('-iso', 1)[0]
        if subject in used:
            continue
        used.add(subject)
        meta, sensor = sample.metadata, sample.clean_bayer
        reference = trial.develop_ahd(sensor, meta)
        analytic = charts.get(meta.get('generated'))
        if analytic is not None:
            camera = analytic @ np.linalg.inv(np.asarray(meta['camera_to_acescg'])).T / np.asarray(meta['white_balance'])
            analytic = to_aces(np.clip(camera, 0, 1).astype('float32'), meta)
        methods = {}
        for name, developer in [('signed_ahd', trial.develop_ahd), ('rt_lmmse', trial.develop),
                                ('rt_lmmse_linear', lambda image, info: trial.develop(image, info, iterations=0)),
                                ('previous_mmse', lambda image, info: previous.develop(image, info, 'lmmse'))]:
            result = developer(sensor, meta)
            filtered = calibrated()
            denoised = filtered.process(result, meta, filtered.prepare(result, meta))
            truth = analytic if analytic is not None else reference
            methods[name] = dict(reference='analytic camera-gamut chart' if analytic is not None else 'low-noise RAW signed-AHD surrogate, not truth',
                alone=metrics.evaluate(result, reference, truth, sample.masks, 'slanted-edge' in subject),
                denoised=metrics.evaluate(denoised, reference, truth, sample.masks, 'slanted-edge' in subject),
                artifacts=artifact_scores(result, truth))
            folder = OUTPUT / 'clean-crops' / subject
            folder.mkdir(parents=True, exist_ok=True)
            left, top = (66, 112) if meta.get('generated') == 'fine-text' else (112, 112)
            decision_crops.save_png(decision_crops.pixels(result[top:top+288, left:left+288]), folder / (name + '.png'))
            if analytic is not None:
                decision_crops.save_png(decision_crops.pixels(analytic[top:top+288, left:left+288]), folder / 'analytic.png')
        records.append(dict(name=subject, metadata=meta, methods=methods))
        print('clean', subject, flush=True)
        write(OUTPUT / 'clean.json', dict(cases=records, **provenance(args.inventory)))
    review_clean(records)


def review_clean(records):
    columns = ['analytic', 'signed_ahd', 'rt_lmmse', 'rt_lmmse_linear', 'previous_mmse']
    rows = []
    for record in records:
        cells = ''.join('<td><img width="288" height="288" loading="lazy" src="' + escape(record['name']) + '/' + column + '.png"></td>'
                        if (OUTPUT / 'clean-crops' / record['name'] / (column + '.png')).exists()
                        else '<td>No independent clean truth</td>' for column in columns)
        rows.append('<tr><th>' + escape(record['name']) + '</th>' + cells + '</tr>')
    write_page(OUTPUT / 'clean-crops/index.html', 'Clean input — no added noise, no Denoise', columns, rows,
               'Binned low-ISO RAWs are low-noise surrogates, not laboratory clean photographs. Charts have analytic truth.')


def write_page(path, title, columns, rows, note):
    tokens = os.path.relpath(ROOT / 'frontend/visual-tokens.css', path.parent)
    html = ('<!doctype html><meta charset="utf-8"><title>' + escape(title) + '</title>'
            '<link rel="stylesheet" href="' + tokens + '"><style>'
            'body{background:var(--app);color:var(--text);font-family:var(--font-body);'
            'font-size:var(--font-size-md);line-height:var(--line-height-normal);font-weight:var(--font-weight-regular)}'
            'h1{font-size:var(--font-size-3xl);font-weight:var(--font-weight-semibold)}'
            'th,td{padding:var(--group-disclosure-gap);text-align:left;vertical-align:top}'
            'th{font-weight:var(--font-weight-semibold)}thead{position:sticky;top:0;background:var(--app)}img{display:block}'
            '</style><h1>' + escape(title) + '</h1><p>' + escape(note) + '</p>'
            '<table><thead><tr><th>Case</th>' + ''.join('<th>' + escape(column.replace('_', ' ')) + '</th>' for column in columns)
            + '</tr></thead><tbody>' + ''.join(rows) + '</tbody></table>')
    path.write_text(html)


def review(columns):
    manifest_path = OUTPUT / 'decision/manifest.json'
    manifest = json.loads(manifest_path.read_text())
    columns = [*columns, 'clean']
    rows = []
    for record in manifest['cases']:
        images = {}
        cells = []
        for column in columns:
            filename = column + '.png'
            path = OUTPUT / 'decision' / record['id'] / filename
            if path.exists():
                images[column] = filename
                cells.append('<td><img width="288" height="288" loading="lazy" src="' + record['id'] + '/' + filename + '"></td>')
            else:
                cells.append('<td>No clean reference</td>')
        record['images'] = images
        rows.append('<tr><th>' + escape(record['title']) + '</th>' + ''.join(cells) + '</tr>')
    write(manifest_path, manifest)
    write_page(OUTPUT / 'decision/index.html', 'Faithful RawTherapee LMMSE — signed sensor comparison', columns, rows,
        '12 fixed 288px rows; same lift within each row. All classical methods use the calibration repair and shipping Denoise controls. '
        'Previous MMSE is not upstream LMMSE. RawNIND Bayer runs alone. Private crops have no clean truth. Research only.')
    size = sum(path.stat().st_size for path in (OUTPUT / 'decision').rglob('*') if path.is_file())
    if size > 13_000_000:
        raise ValueError('Decision page exceeds inherited 13 MB budget')


def native(args, entries):
    entry = next(row for row in entries if row['file'] == args.photo)
    records = []
    started = time.perf_counter()
    with rawpy.imread(str(photo_root() / args.photo)) as raw:
        opened = time.perf_counter() - started
        info = inputs.metadata_from_raw(raw, entry)
        height, width = raw.raw_image_visible.shape
        methods = [('signed_ahd', trial.develop_ahd), ('rt_lmmse', trial.develop),
                   ('previous_mmse', lambda image, meta: previous.develop(image, meta, 'lmmse'))]
        for name, developer in methods:
            clocks = dict(sensor_seconds=0., develop_seconds=0.)
            def reader(top, left, bottom, right):
                stamp = time.perf_counter()
                first_y, first_x = max(0, (top-32)//2*2), max(0, (left-32)//2*2)
                end_y, end_x = min(height, (bottom+33)//2*2), min(width, (right+33)//2*2)
                sensor = read_sensor(raw, first_y, first_x, end_y, end_x)
                clocks['sensor_seconds'] += time.perf_counter() - stamp
                stamp = time.perf_counter()
                image = developer(sensor, info)
                clocks['develop_seconds'] += time.perf_counter() - stamp
                return image[top-first_y:bottom-first_y, left-first_x:right-first_x].copy()
            stamp = time.perf_counter()
            checksum = np.zeros(3)
            for top in range(0, height, 256):
                image = reader(top, 0, min(top+256, height), width)
                checksum += image.sum(axis=(0, 1), dtype=float)
                del image
            development_seconds = time.perf_counter() - stamp
            development_clocks = clocks.copy()
            clocks = dict(sensor_seconds=0., develop_seconds=0.)
            stamp = time.perf_counter()
            source = adaptive._WindowSource(height, width, reader)
            adapter = calibrated()
            state = adapter.prepare(source, info)
            model = state[0]
            prepare_seconds = time.perf_counter() - stamp
            crop_rows = [row for row in decision_crops.NATIVE if row[2] == args.photo]
            crops = {row[0]: np.zeros((288, 288, 3), np.float32) for row in crop_rows}
            filter_seconds = 0.
            print('native', args.photo, name, flush=True)
            for core, bounds in windows(height, width, tile=768, margin=66):
                top, bottom, left, right = core
                first_y, end_y, first_x, end_x = bounds
                image = reader(first_y, first_x, end_y, end_x)
                edges = adaptive._Edges(first_y == 0, end_y == height, first_x == 0, end_x == width, height, width)
                tick = time.perf_counter()
                filtered = adaptive._filter_region(image, model, adapter.controls, edges)
                filter_seconds += time.perf_counter() - tick
                if not np.isfinite(filtered).all():
                    raise ValueError('Invalid native output')
                for case_id, _, _, origin, offset, _ in crop_rows:
                    crop_x, crop_y = origin[0]+offset[0], origin[1]+offset[1]
                    start_y, stop_y = max(top, crop_y), min(bottom, crop_y+288)
                    start_x, stop_x = max(left, crop_x), min(right, crop_x+288)
                    if stop_y > start_y and stop_x > start_x:
                        crops[case_id][start_y-crop_y:stop_y-crop_y, start_x-crop_x:stop_x-crop_x] = filtered[
                            start_y-first_y:stop_y-first_y, start_x-first_x:stop_x-first_x]
                del image, filtered
            total = time.perf_counter() - stamp + opened
            tails = {}
            for case_id, _, _, origin, offset, lift in crop_rows:
                crop_x, crop_y = origin[0]+offset[0], origin[1]+offset[1]
                sensor = read_sensor(raw, crop_y-32, crop_x-32, crop_y+320, crop_x+320)
                reference = develop_signed(sensor, info)[32:320, 32:320]
                tails[case_id] = shared.fixed_shadow_tail(crops[case_id], reference)
                folder = OUTPUT / 'native-crops' / case_id
                folder.mkdir(parents=True, exist_ok=True)
                decision_crops.save_png(decision_crops.pixels(crops[case_id] * 2 ** lift), folder / (name + '.png'))
            records.append(dict(method=name, raw_open_seconds=opened, development_seconds=development_seconds,
                standalone_development_clocks=development_clocks, prepare_seconds=prepare_seconds,
                filter_seconds=filter_seconds, total_seconds=total, clocks=clocks,
                model=model.as_dict(), development_checksum=checksum.tolist(), fixed_tails=tails,
                peak_rss_bytes=peak_rss()))
            write(OUTPUT / ('native-' + Path(args.photo).stem + '.json'), dict(photo=args.photo,
                shape=[height, width], methods=records, **provenance(args.inventory)))
            del source, state, model, crops
            gc.collect()


def safety(args, entries):
    selected = adapters(False)
    samples = (sample for sample in inputs.synthetic_samples(entries, True)
               if sample.name in ('synthetic-fabric-iso6400', 'synthetic-star-field-iso6400',
                                  'synthetic-colour-patches-iso6400'))
    cases = []
    for sample in samples:
        sample = signed_primary(sample)
        methods = {}
        for name, adapter in selected.items():
            reference = shared.output(adapter, sample)
            rows = []
            for stops in range(-6, 7):
                scaled = replace(sample, metadata={**sample.metadata, 'exposure_stops': stops},
                                 rgb=sample.rgb * np.float32(2 ** stops))
                actual = shared.output(adapter, scaled)
                normalized = actual / np.float32(2 ** stops)
                settings, adjustments = ExportSettings(), AdjustmentState()
                adjustments.hdr.highlight_section_enabled = True
                adjustments.hdr.highlight_compression_mode = 'fixed_cap'
                adjustments.hdr.highlight_compression_target_nits = 1000
                session = SimpleNamespace(image=actual, sdr_reference_image=None,
                    color_context=RenderColorContext(), local_adjustments=[])
                finished = _render_export_branch(session, settings, PreviewKind.HDR, adjustments)
                ceiling = delivery_ceiling_metrics(finished, adjustments, 203)
                rows.append(dict(stops=stops, finite=bool(np.isfinite(actual).all()),
                    sdr=metrics.summary(metrics.colour_error(normalized, reference)),
                    hdr=metrics.summary(metrics.colour_error(normalized, reference, 'hdr')),
                    finished_cpu_ceiling=ceiling))
            methods[name] = rows
            print('safety', sample.name, name, flush=True)
        cases.append(dict(name=sample.name, methods=methods))
        write(OUTPUT / 'safety.json', dict(cases=cases,
            qualification='Exposure after sensor development, before Denoise; actual CPU finished renderer fixed-cap 1000 nit. No GPU/codec/highlight-reconstruction qualification.',
            **provenance(args.inventory)))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inventory', type=Path, required=True)
    parser.add_argument('--phase', choices=('quick', 'full', 'heldout', 'seen', 'decision', 'clean', 'safety', 'native', 'review'), required=True)
    parser.add_argument('--photo', choices=('IMG_0790.CR2', '2025_0730_1331_3.arw'), default='IMG_0790.CR2')
    parser.add_argument('--no-rawnind', action='store_true')
    parser.add_argument('--canon-only', action='store_true')
    args = parser.parse_args()
    entries = json.loads(args.inventory.read_text())['inventory']
    shared.OUTPUT, shared.adapters, shared.provenance = OUTPUT, adapters, provenance
    shared.measure_sample, shared.signed_sample, shared.review = measure_sample, signed_primary, review
    if args.phase == 'clean':
        clean(args, entries)
    elif args.phase == 'native':
        native(args, entries)
    elif args.phase == 'decision':
        shared.decisions(args, entries)
    elif args.phase == 'safety':
        safety(args, entries)
    elif args.phase == 'review':
        review(adapters(not args.no_rawnind).keys())
    else:
        shared.quality(args, entries)


if __name__ == '__main__':
    main()
