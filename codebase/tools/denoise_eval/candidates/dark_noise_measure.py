"""Bounded dark-noise research; run serially through the shared lock and guard."""
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
import json
from pathlib import Path
import subprocess
import time

import cv2
import numpy as np
import rawpy

from hdr_finisher import denoise_adaptive as adaptive
from hdr_finisher.color import map_negative_acescg
from tools.denoise_eval.candidates.denoise_v2_appdefault import AppDefault
from tools.denoise_eval.candidates.dark_noise import prepare_informative, independent
from tools.denoise_eval.candidates.dark_noise import factory, calibration_only, independent_energy_filter
from tools.denoise_eval.candidates.dark_noise import detail_zero
from tools.denoise_eval.candidates.noise_specks_measure import read_sensor, rgb_reader
from tools.denoise_eval.candidates.pilot_wiener_measure import windows
from tools.denoise_eval.candidates.noise_model_specks import prepare_model
from tools.denoise_eval.candidates.signed_measure import fixed_shadow_tail, signed_sensor
from tools.denoise_eval.candidates.signed_shadows import develop_signed
from tools.denoise_eval.decision_crops import NATIVE, pixels, save_png
from tools.denoise_eval.inputs import develop, metadata_from_raw, normalise_crop
from tools.denoise_eval.run import peak_rss
from tools.lib.test_photos import photo_root

ROOT = Path(__file__).resolve().parents[3]
OUTPUT = ROOT / 'output/denoise-v1/dark-noise'


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + '\n')


def provenance(inventory_path):
    files = [Path(__file__), Path(__file__).with_name('dark_noise.py'),
             Path(__file__).with_name('noise_model_specks.py'),
             ROOT / 'backend/hdr_finisher/denoise_adaptive.py']
    return dict(inventory_path=str(inventory_path.resolve()),
                inventory_sha256=hashlib.sha256(inventory_path.read_bytes()).hexdigest(),
                code_sha256={str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
                             for path in files})


def describe(values, support):
    selected = np.asarray(values)[support]
    return dict(zip(('p10', 'p50', 'p90', 'p999'),
                    np.percentile(selected, [10, 50, 90, 99.9]).tolist()))


def signed_sample(sample):
    sensor = signed_sensor(sample)
    if sensor is None:
        raise ValueError('Signed comparison requires a Bayer source')
    clean = develop_signed(sample.clean_bayer, sample.metadata) if sample.clean_bayer is not None else sample.clean
    return replace(sample, rgb=develop_signed(sensor, sample.metadata), bayer=sensor, clean=clean)


def decision(inventory_path):
    from tools.denoise_eval import decision_crops
    from tools.denoise_eval.adapters import Off
    from tools.denoise_eval.candidates.rawnind import bayer
    entries = json.loads(inventory_path.read_text())['inventory']
    records = []
    for case_id, title, sample, offset, lift, licence in decision_crops.cases(entries):
        print('decision', case_id, flush=True)
        signed = signed_sample(sample)
        left, top = offset
        region = np.s_[top:top + 288, left:left + 288]
        folder = OUTPUT / 'decision' / case_id
        folder.mkdir(parents=True, exist_ok=True)
        methods = [('signed_off', Off(), signed), ('signed_current', AppDefault(), signed),
                   ('signed_fix', factory(), signed), ('signed_independent', independent(), signed),
                   ('signed_detail0', detail_zero(), signed), ('clipped_off', Off(), sample),
                   ('clipped_current', AppDefault(), sample), ('clipped_fix', factory(), sample),
                   ('rawnind_bayer', bayer(), signed)]
        rows = {}
        for label, adapter, selected in methods:
            source = selected.bayer if adapter.input_kind == 'bayer' else selected.rgb
            state = adapter.prepare(source, selected.metadata)
            output = adapter.process(source, selected.metadata, state)
            encoded = pixels(output[region] * np.float32(2 ** lift))
            save_png(encoded, folder / (label + '.png'))
            clean = signed.clean[region] * np.float32(2 ** lift) if signed.clean is not None else None
            valid = sample.masks.get('valid', np.ones(sample.rgb.shape[:2], bool))[region]
            rows[label] = dict(adapter=adapter.description(),
                               tail=fixed_shadow_tail(output[region], selected.rgb[region],
                                                     stops=selected.metadata.get('exposure_stops', 0)),
                               scores_vs_signed_clean=decision_crops.scores(encoded, pixels(clean), valid)
                               if clean is not None else None)
            del adapter, state, output
            gc.collect()
        if signed.clean is not None:
            save_png(pixels(signed.clean[region] * np.float32(2 ** lift)), folder / 'signed_clean.png')
            save_png(pixels(sample.clean[region] * np.float32(2 ** lift)), folder / 'clipped_clean.png')
        records.append(dict(id=case_id, title=title, licence=licence, source=sample.metadata,
                            offset_xy=list(offset), lift=lift, columns=rows))
        write(OUTPUT / 'decision/manifest.json', dict(cases=records, **provenance(inventory_path),
              processing='Unlifted context at native pixel scale; fixed per-case presentation exposure afterwards',
              clean='Signed-developed clean Bayer; frozen masks; clipped clean also shown',
              limitations='Context-local estimates, not whole-frame app output. RawNIND Bayer alone, not followed by Denoise. No import gamut projection.'))
    decision_index()


def decision_index():
    records = json.loads((OUTPUT / 'decision/manifest.json').read_text())['cases']
    columns = ('signed_off', 'signed_current', 'signed_fix', 'rawnind_bayer', 'signed_clean',
               'signed_independent', 'signed_detail0', 'clipped_current', 'clipped_fix', 'clipped_off')
    headings = ''.join('<th>' + escape(column.replace('_', ' ')) + '</th>' for column in columns)
    body = []
    for row in records:
        cells = []
        for column in columns:
            present = (OUTPUT / 'decision' / row['id'] / (column + '.png')).is_file()
            cells.append('<td><img width="288" height="288" src="' + row['id'] + '/' + column + '.png"></td>'
                         if present else '<td>No clean reference</td>')
        body.append('<tr><th>' + escape(row['title']) + '</th>' + ''.join(cells) + '</tr>')
    (OUTPUT / 'decision/index.html').write_text(
        '<!doctype html><meta charset="utf-8"><title>Signed dark-noise decision crops</title>'
        '<style>body{font:15px system-ui;background:#202124;color:#eee}td,th{padding:8px;max-width:288px}'
        'img{display:block}th{vertical-align:top;text-align:left}thead{position:sticky;top:0;background:#202124}</style>'
        '<h1>Signed development is the primary baseline</h1><p>Native pixels; same fixed exposure per row. '
        'No clean truth for private Canon/Sony. Fix repairs calibration, not all specks. RawNIND Bayer alone.</p>'
        '<table><thead><tr><th>Case</th>' + headings + '</tr></thead><tbody>' + ''.join(body) + '</tbody></table>')


def native(inventory_path, photo, signed=False):
    entries = json.loads(inventory_path.read_text())['inventory']
    entry = next(item for item in entries if item['file'] == photo)
    records = []
    mode = 'signed' if signed else 'clipped'
    with rawpy.imread(str(photo_root() / photo)) as raw:
        metadata = metadata_from_raw(raw, entry)
        height, width = raw.raw_image_visible.shape
        reader = rgb_reader(raw, metadata)
        if signed:
            def reader(top, left, bottom, right):
                first_y, first_x = max(0, (top-24)//2*2), max(0, (left-24)//2*2)
                end_y, end_x = min(height, (bottom+25)//2*2), min(width, (right+25)//2*2)
                sensor = read_sensor(raw, first_y, first_x, end_y, end_x)
                image = develop_signed(sensor, metadata)
                return image[top-first_y:bottom-first_y, left-first_x:right-first_x].copy()
        selected = [row for row in NATIVE if row[2] == photo and row[0] != 'canon-flame-edge']
        for label, adapter in (('current', AppDefault()), ('calibration_only', calibration_only()),
                               ('informative', factory()), ('independent', independent())):
            print('native', photo, mode, label, flush=True)
            started = time.perf_counter()
            source = adaptive._WindowSource(height, width, reader)
            state = adaptive._estimate(source) if label == 'current' else adapter.prepare(source, metadata)
            model = state if label == 'current' else state[0]
            analysis_seconds = time.perf_counter() - started
            del source
            filter_seconds = 0.
            checksum = np.zeros(3)
            crops = {row[0]: np.zeros((288, 288, 3), 'float32') for row in selected}
            for core, bounds in windows(height, width, tile=768, margin=66):
                top, bottom, left, right = core
                first_y, end_y, first_x, end_x = bounds
                image = reader(first_y, first_x, end_y, end_x)
                edges = adaptive._Edges(first_y == 0, end_y == height, first_x == 0, end_x == width, height, width)
                tick = time.perf_counter()
                filter_function = independent_energy_filter if label == 'independent' else adaptive._filter_region
                output = filter_function(image, model, adapter.controls, edges)
                filter_seconds += time.perf_counter() - tick
                checksum += output[top-first_y:bottom-first_y, left-first_x:right-first_x].sum(axis=(0, 1), dtype=float)
                for case_id, _, _, origin, offset, _ in selected:
                    crop_x, crop_y = origin[0] + offset[0], origin[1] + offset[1]
                    start_y, stop_y = max(top, crop_y), min(bottom, crop_y+288)
                    start_x, stop_x = max(left, crop_x), min(right, crop_x+288)
                    if stop_y > start_y and stop_x > start_x:
                        crops[case_id][start_y-crop_y:stop_y-crop_y, start_x-crop_x:stop_x-crop_x] = output[
                            start_y-first_y:stop_y-first_y, start_x-first_x:stop_x-first_x]
                del image, output
            elapsed_seconds = time.perf_counter() - started
            crop_rows = {}
            for case_id, _, _, origin, offset, lift in selected:
                crop_x, crop_y = origin[0] + offset[0], origin[1] + offset[1]
                noisy = reader(crop_y, crop_x, crop_y+288, crop_x+288)
                folder = OUTPUT / 'review' / case_id
                folder.mkdir(parents=True, exist_ok=True)
                save_png(pixels(crops[case_id] * 2 ** lift), folder / f'native_{mode}_{label}.png')
                crop_rows[case_id] = dict(tail=fixed_shadow_tail(crops[case_id], noisy),
                                         off_tail=fixed_shadow_tail(noisy, noisy))
            records.append(dict(method=label, model=model.as_dict(),
                calibration=None if label == 'current' else state[1], analysis_seconds=analysis_seconds,
                filter_seconds=filter_seconds, elapsed_seconds=elapsed_seconds,
                peak_rss_bytes=peak_rss(), checksum=checksum.tolist(), crops=crop_rows))
            write(OUTPUT / f'native-{Path(photo).stem}-{mode}.json', dict(photo=photo, mode=mode,
                shape=[height, width], methods=records, machine='MacBook Neo A18 Pro 8 GB; CPU one thread',
                git_head=subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
                **provenance(inventory_path),
                limitations='Full native streaming CPU; preparation includes AHD of sampled windows; no UI/GPU/delivery timing'))
            del crops, state
            gc.collect()


def diagnose(image, model, region, controls):
    edges = adaptive._Edges(True, True, True, True, *image.shape[:2])
    variance = adaptive._noise_variance(image @ adaptive.ACESCG_LUMINANCE, model, edges)
    support = cv2.GaussianBlur(image @ adaptive.ACESCG_LUMINANCE, (0, 0), 2) < .02
    support = support[region]
    current = image @ adaptive.OPPONENT.T
    records = []
    for level in range(adaptive.LEVELS):
        smooth = adaptive._atrous(current, level, edges)
        band = current - smooth
        energy = adaptive._box(band * band, adaptive.WIENER_RADIUS)
        components = []
        for component in range(3):
            strength = controls.strengths()[int(component > 0)] * controls.size_multiplier(level)
            if level < 2:
                strength *= controls.fine_band_multiplier()
            noise = np.float32((strength * model.band_sigmas[component][level]) ** 2) * variance
            ratio = noise / np.maximum(energy[..., component], np.float32(1e-20))
            gain = np.maximum(1 - ratio, 0)
            components.append(dict(component=component,
                                   predicted_sigma=describe(np.sqrt(noise)[region], support),
                                   observed_rms=describe(np.sqrt(energy[..., component])[region], support),
                                   gain=describe(gain[region], support)))
        records.append(dict(level=level, components=components))
        current = smooth
    luminance = image @ adaptive.ACESCG_LUMINANCE
    signal = np.maximum(adaptive._atrous(adaptive._atrous(luminance, 0, edges), 1, edges), 0)
    return dict(model=model.as_dict(), shadow_pixels=int(support.sum()), bands=records,
                smoothed_signal=describe(signal[region], support),
                base_sigma=describe(np.sqrt(variance)[region], support))


def native_probe(inventory_path):
    entries = json.loads(inventory_path.read_text())['inventory']
    records = []
    for case_id, _, filename, origin, offset, _ in NATIVE:
        if case_id == 'canon-flame-edge':
            continue
        entry = next(item for item in entries if item['file'] == filename)
        with rawpy.imread(str(photo_root() / filename)) as raw:
            metadata = metadata_from_raw(raw, entry)
            mosaic = normalise_crop(raw, origin[1], origin[0], 640)
        region = np.s_[offset[1]:offset[1] + 288, offset[0]:offset[0] + 288]
        for mode, develop_image in (('signed', develop_signed), ('clipped', develop)):
            image = develop_image(mosaic, metadata)
            receipt = json.loads((OUTPUT / f'native-{Path(filename).stem}-{mode}.json').read_text())
            for row in receipt['methods']:
                if row['method'] == 'independent':
                    continue
                model = adaptive.AdaptiveNoiseModel(**{key: value for key, value in row['model'].items()
                                                       if key != 'algorithm_version'})
                records.append(dict(case=case_id, mode=mode, method=row['method'],
                                    diagnostics=diagnose(image, model, region, AppDefault().controls)))
    write(OUTPUT / 'native-probe.json', dict(cases=records, **provenance(inventory_path),
          qualification='Saved full-frame model evaluated on the 640px context; retained ROI has at least 66px halo. Independent-energy variant omitted because its gain differs.'))


def probe(inventory_path):
    started = time.perf_counter()
    entries = json.loads(inventory_path.read_text())['inventory']
    records = []
    for case_id, title, filename, origin, offset, lift in NATIVE:
        if case_id == 'canon-flame-edge':
            continue
        print(case_id, flush=True)
        entry = next(item for item in entries if item['file'] == filename)
        with rawpy.imread(str(photo_root() / filename)) as raw:
            metadata = metadata_from_raw(raw, entry)
            left, top = origin
            mosaic = normalise_crop(raw, top, left, 640)
        left, top = offset
        region = np.s_[top:top + 288, left:left + 288]
        folder = OUTPUT / 'review' / case_id
        folder.mkdir(parents=True, exist_ok=True)
        modes = {}
        clipped_rgb = develop(mosaic, metadata)
        signed_rgb = develop_signed(mosaic, metadata)
        for mode, image in (('clipped', clipped_rgb), ('signed', signed_rgb),
                            ('clipped_projected', map_negative_acescg(clipped_rgb)),
                            ('signed_projected', map_negative_acescg(signed_rgb))):
            model = adaptive.estimate_adaptive_model(image, workers=1)
            corrected, corrected_fit = prepare_model(image)
            save_png(pixels(image[region] * 2 ** lift), folder / (mode + '_off.png'))
            variants = {'current': (model, AppDefault().controls),
                        'amount1': (model, replace(AppDefault().controls, amount=1)),
                        'amount_luma1': (model, replace(AppDefault().controls, amount=1, luminance=1)),
                        'detail0': (model, replace(AppDefault().controls, detail_recovery=0)),
                        'all1': (model, adaptive.AdaptiveControls(amount=1, luminance=1,
                                                                color_noise=1, detail_recovery=0)),
                        'corrected': (corrected, AppDefault().controls)}
            calibration = {}
            for label, all_bands in (('informative', False), ('perband', True)):
                candidate, details = prepare_informative(image, all_bands=all_bands)
                variants[label] = (candidate, AppDefault().controls)
                calibration[label] = details
            candidate, calibration['calibration_only'] = prepare_informative(image, stable_shape=False)
            variants['calibration_only'] = (candidate, AppDefault().controls)
            variants['informative_detail0'] = (variants['informative'][0], replace(AppDefault().controls, detail_recovery=0))
            for control in ('finest_noise', 'fine_noise', 'medium_noise', 'coarse_noise'):
                variants[control + '1'] = (model, replace(AppDefault().controls, **{control: 1}))
            rows = {}
            for label, (selected_model, controls) in variants.items():
                output = adaptive.resolve_adaptive(image, selected_model, controls)
                save_png(pixels(output[region] * 2 ** lift), folder / (mode + '_' + label + '.png'))
                rows[label] = dict(tail=fixed_shadow_tail(output[region], image[region]),
                                   diagnostics=diagnose(image, selected_model, region, controls))
            adapter = independent()
            output = adapter.process(image, metadata, (variants['informative'][0], {}))
            save_png(pixels(output[region] * 2 ** lift), folder / (mode + '_independent.png'))
            rows['independent'] = dict(tail=fixed_shadow_tail(output[region], image[region]))
            modes[mode] = dict(off_tail=fixed_shadow_tail(image[region], image[region]),
                               corrected_fit=corrected_fit, calibration=calibration, variants=rows)
        records.append(dict(id=case_id, source=filename, origin_xy=list(origin),
                            offset_xy=list(offset), lift=lift, modes=modes))
    write(OUTPUT / 'probe.json', dict(cases=records, **provenance(inventory_path),
          git_head=subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
          machine='MacBook Neo A18 Pro 8 GB; CPU one thread',
          elapsed_seconds=time.perf_counter() - started, peak_rss_bytes=peak_rss()))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inventory', type=Path, required=True)
    parser.add_argument('--phase', choices=('probe', 'quick', 'full', 'heldout', 'seen', 'native', 'native-probe', 'decision', 'review'), default='probe')
    parser.add_argument('--photo', choices=('IMG_0790.CR2', '2025_0730_1331_3.arw'), default='IMG_0790.CR2')
    parser.add_argument('--signed', action='store_true')
    parser.add_argument('--rawnind', action='store_true')
    args = parser.parse_args()
    if args.phase == 'probe':
        probe(args.inventory)
    elif args.phase == 'native':
        native(args.inventory, args.photo, args.signed)
    elif args.phase == 'native-probe':
        native_probe(args.inventory)
    elif args.phase == 'decision':
        decision(args.inventory)
    elif args.phase == 'review':
        decision_index()
    else:
        from tools.denoise_eval import run
        entries = json.loads(args.inventory.read_text())['inventory']
        run.inventory = lambda: entries
        if args.signed:
            for name in ('synthetic_samples', 'real_samples', 'paired_samples'):
                original = getattr(run, name)
                def converted(*arguments, original=original, **keywords):
                    return (signed_sample(sample) for sample in original(*arguments, **keywords))
                setattr(run, name, converted)
        prefix = 'tools.denoise_eval.candidates.'
        adapters = ['off', prefix + 'denoise_v2_appdefault:factory', prefix + 'dark_noise:factory',
                    prefix + 'dark_noise:calibration_only', prefix + 'dark_noise:independent']
        if args.signed:
            adapters.append(prefix + 'dark_noise:detail_zero')
            if args.phase == 'quick':
                adapters.append(prefix + 'dark_noise:strong')
        if args.rawnind:
            adapters.append(prefix + 'rawnind:bayer')
        folder = OUTPUT / (('signed-' if args.signed else '') + args.phase)
        options = ['--set', args.phase if args.phase in ('quick', 'full') else 'pairs',
                   '--adapters', ','.join(adapters), '--output-dir', str(folder),
                   '--review-size', '128']
        if args.phase in ('heldout', 'seen'):
            options += ['--pairs', str(ROOT / 'output/denoise-v1/datasets/rawnind/pairs'),
                        '--pair-split', args.phase]
        run.main(options)
        path = folder / ('results-' + (args.phase if args.phase in ('quick', 'full') else 'pairs') + '.json')
        result = json.loads(path.read_text())
        result['research_provenance'] = provenance(args.inventory)
        result['development'] = 'signed' if args.signed else 'clipped'
        if args.signed:
            result['limitations'] = [item for item in result['limitations'] if not item.startswith('Synthetic sensor readout')]
            result['limitations'].append('Signed noisy and clean Bayer development; inherited frozen masks. Synthetic below-black samples reconstructed from the frozen seed and verified against the clipped Bayer. No import gamut projection.')
        write(path, result)


if __name__ == '__main__':
    main()
