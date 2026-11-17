"""Serial signed-shadow trial; invoke through gpu-run-lock.py and guard.py."""
import os
for variable in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS',
                 'VECLIB_MAXIMUM_THREADS', 'HDR_CPU_THREADS'):
    os.environ[variable] = '1'

import argparse
from dataclasses import asdict
import gc
import hashlib
import itertools
import json
from pathlib import Path
import shutil
import subprocess
import time

import cv2
import numpy as np
import rawpy

from hdr_finisher.raw_import import (
    _camera_linear_metadata_from_libraw, _develop_libraw_camera_rgb,
    _normalize_camera_rgb_float32, _camera_rgb_to_acescg_float32,
)
from hdr_finisher.color import map_negative_acescg
from tools.denoise_eval import metrics
from tools.denoise_eval.candidates.denoise_v2_appdefault import AppDefault
from tools.denoise_eval.candidates.signed_shadows import (
    ROOT, camera_ahd, develop_signed, develop_pedestal, to_aces,
)
from tools.denoise_eval.inputs import (
    add_noise, develop, metadata_from_raw, paired_samples, real_samples, synthetic_samples,
)
from tools.denoise_eval.run import peak_rss
from tools.denoise_eval.datasets.summarize import summarize
from tools.lib.test_photos import photo_root

OUTPUT = ROOT / 'output/denoise-v1/signed-shadows'
CURRENT = 'tools.denoise_eval.candidates.denoise_v2_appdefault:factory'
RAWNIND = 'tools.denoise_eval.candidates.rawnind:bayer'


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + '\n')


def provenance():
    return dict(git_head=subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
                machine='MacBook Neo A18 Pro 8 GB; one CPU/native thread',
                signed_ahd_sha256=hashlib.sha256(Path(__file__).with_name('signed_ahd.c').read_bytes()).hexdigest(),
                controls=asdict(AppDefault().controls), peak_rss_bytes=peak_rss())


def signed_sensor(sample):
    if sample.clean_bayer is not None and sample.name.startswith('synthetic-'):
        info = sample.metadata
        sensor = add_noise(sample.clean_bayer, info['noise_parameters'], info['seed'], info['banding_sigma'])
        sensor = (np.rint(np.minimum(sensor, 1) * 65535) / 65535).astype('float32')
        expected = (np.rint(np.clip(sensor, 0, 1) * 65535) / 65535).astype('float32')
        if not np.array_equal(expected, sample.bayer):
            raise AssertionError('Recreated signed noise does not reproduce frozen clipped input')
        return sensor
    return sample.bayer


def denoise(rgb, metadata):
    adapter = AppDefault()
    model = adapter.prepare(rgb, metadata)
    return adapter.process(rgb, metadata, model), asdict(model)


def comparison(first, second, valid=None):
    return {lane: metrics.summary(metrics.colour_error(first, second, lane)[valid])
            for lane in ('sdr', 'hdr')}


def fixed_shadow_tail(output, noisy, *, stops=0, valid=None):
    reference = noisy @ np.array([.2722287, .6740818, .0536895]) / 2 ** stops
    support = cv2.GaussianBlur(reference, (0, 0), 2) < .02
    if valid is not None:
        support &= valid
    support[:4] = support[-4:] = False
    support[:, :4] = support[:, -4:] = False
    support = cv2.erode(support.astype('uint8'), np.ones((5, 5), 'uint8')).astype(bool)
    if not support.any():
        return None
    actual = metrics.luma_chroma(metrics.display(output * np.float32(2 ** (4 - stops))))
    median = np.stack([cv2.medianBlur(actual[..., component].astype('float32'), 5)
                       for component in range(3)], -1)
    residual = actual - median
    tails = {}
    for name, selected in (('dark', residual[..., 0] < -.05), ('bright', residual[..., 0] > .05)):
        binary = (selected & support).astype('uint8')
        _, _, stats, _ = cv2.connectedComponentsWithStats(binary, connectivity=8)
        areas = stats[1:, cv2.CC_STAT_AREA]
        tails[name] = dict(fraction=float(binary.sum() / support.sum()),
                           small_islands=int(np.count_nonzero((areas >= 1) & (areas <= 25))))
    return dict(support_pixels=int(support.sum()),
                support='Fixed Off Gaussian-sigma2 luma <.02 before exposure, eroded 2px, 4px border excluded',
                reference='Local-median contrast proxy, not clean truth; real detail can count',
                luma_abs_p999=float(np.percentile(abs(residual[..., 0])[support], 99.9)),
                chroma_abs_p999=float(np.percentile(np.linalg.norm(residual[..., 1:], axis=-1)[support], 99.9)),
                **tails)


def quality(phase, baseline_root):
    started = time.perf_counter()
    name = phase if phase in ('quick', 'full') else 'pairs'
    baseline_path = baseline_root / phase / ('results-' + name + '.json')
    original_bytes = baseline_path.read_bytes()
    baseline = json.loads(original_bytes)
    entries = baseline['inventory']
    samples = ((sample for sample in paired_samples(ROOT / 'output/denoise-v1/datasets/rawnind/pairs')
                if bool(sample.metadata['held_out']) == (phase == 'heldout'))
               if phase in ('heldout', 'seen') else
               itertools.chain(synthetic_samples(entries, phase == 'quick'), real_samples(entries, phase == 'quick')))
    inherited = {case['name']: case for case in baseline['cases']}
    records = []
    for sample in samples:
        tick = time.perf_counter()
        print(phase, sample.name, flush=True)
        old = inherited[sample.name]
        if sample.metadata != old['metadata']:
            raise ValueError('Frozen baseline metadata mismatch')
        sensor = signed_sensor(sample)
        outputs = dict(signed=develop_signed(sensor, sample.metadata))
        outputs['signed_denoise'], model = denoise(outputs['signed'], sample.metadata)
        outputs['signed_ahd_clipped_control'] = develop_signed(np.clip(sensor, 0, 1), sample.metadata, clipped=True)
        outputs['signed_ahd_clipped_denoise'], control_model = denoise(outputs['signed_ahd_clipped_control'], sample.metadata)
        adapters = {label: old['adapters'][key] for label, key in
                    (('off', 'off'), ('current_denoise', CURRENT), ('rawnind_bayer', RAWNIND))}
        current, current_model = denoise(sample.rgb, sample.metadata)
        valid = sample.masks.get('valid', np.ones(sensor.shape, dtype=bool)).copy()
        valid[:12] = valid[-12:] = False
        valid[:, :12] = valid[:, -12:] = False
        diagnostics = dict(clipped_control_vs_libraw=comparison(outputs['signed_ahd_clipped_control'], sample.rgb, valid),
                           current_recomputed_model=current_model,
                           signed_model=model, clipped_control_model=control_model,
                           below_black_fraction=float(np.mean(sensor < 0)),
                           signed_vs_clipped_denoise=comparison(outputs['signed_denoise'], current, valid))
        if phase == 'quick':
            pedestal = develop_pedestal(sensor, sample.metadata)
            outputs['pedestal'], outputs['pedestal_denoise'] = pedestal, denoise(pedestal, sample.metadata)[0]
            diagnostics['pedestal_vs_signed'] = comparison(pedestal, outputs['signed'], valid)
            diagnostics['pedestal_offset_invariance'] = comparison(pedestal, develop_pedestal(sensor, sample.metadata, .25), valid)
        for label, output in outputs.items():
            if not np.isfinite(output).all():
                raise ValueError('Nonfinite signed output')
            adapters[label] = metrics.evaluate(output, sample.rgb, sample.clean, sample.masks,
                                                'slanted-edge' in sample.name,
                                                exposure_stops=sample.metadata.get('exposure_stops', 0))
            adapters[label]['negative_channel_fraction'] = float(np.mean(output < 0))
        record = dict(name=sample.name, metadata=sample.metadata, clean=sample.clean is not None,
                      adapters=adapters, diagnostics=diagnostics, elapsed_seconds=time.perf_counter() - tick)
        records.append(record)
        write(OUTPUT / (phase + '-partial.json'), dict(cases=records, **provenance()))
        del sample, sensor, outputs, current
        gc.collect()
    result = dict(phase=phase, cases=records, inventory=entries, **provenance(),
                  elapsed_seconds=time.perf_counter() - started,
                  baseline=dict(path=str(baseline_path), sha256=hashlib.sha256(original_bytes).hexdigest(),
                                reused='Off/current/RawNIND metrics; signed outputs and current models freshly run',
                                truth='Frozen existing clean. Public clean also has clipped development and low-ISO noise.'))
    if phase in ('heldout', 'seen'):
        result['summary'] = summarize(result)
    write(OUTPUT / (phase + '.json'), result)
    (OUTPUT / (phase + '-partial.json')).unlink()


def decision(entries, source_folder):
    from tools.denoise_eval import decision_crops as decisions
    from tools.denoise_eval.candidates.rawnind import bayer
    destination = ROOT / 'output/denoise-v1/decision'
    if source_folder.resolve() != destination.resolve():
        shutil.copytree(source_folder, destination, dirs_exist_ok=True)
    manifest_path = destination / 'manifest.json'
    manifest = json.loads(manifest_path.read_text())
    by_id = {case['id']: case for case in manifest['cases']}
    for case_id, title, sample, offset, lift, licence in decisions.cases(entries):
        print('decision', case_id, flush=True)
        sensor = signed_sensor(sample)
        metadata = {**sample.metadata, 'exposure_stops': lift}
        rgb = sample.rgb * np.float32(2 ** lift)
        clean = sample.clean * np.float32(2 ** lift) if sample.clean is not None else None
        signed = develop_signed(sensor, metadata)
        current = denoise(rgb, metadata)[0]
        variants = dict(signed=signed, signed_denoise=denoise(signed, metadata)[0],
                        pedestal_denoise=denoise(develop_pedestal(sensor, metadata), metadata)[0],
                        signed_ahd_clipped_denoise=denoise(develop_signed(np.clip(sensor, 0, 1), metadata, clipped=True), metadata)[0])
        variants['current_import_gamut_denoise'] = denoise(map_negative_acescg(rgb), metadata)[0]
        variants['signed_import_gamut_denoise'] = denoise(map_negative_acescg(signed), metadata)[0]
        variants['signed_denoise_then_gamut'] = map_negative_acescg(variants['signed_denoise'])
        neural = bayer()
        neural_state = neural.prepare(sample.bayer, metadata)
        variants['rawnind_bayer'] = neural.process(sample.bayer, metadata, neural_state)
        del neural_state, neural
        left, top = offset
        size = by_id[case_id]['crop_rectangle']['width']
        region = np.s_[top:top + size, left:left + size]
        valid = sample.masks.get('valid', np.ones(sensor.shape, dtype=bool))[region]
        rows = []
        for label, output in variants.items():
            encoded = decisions.pixels(output[region])
            decisions.save_png(encoded, destination / case_id / (label + '.png'))
            rows.append(dict(column=label, adapter=RAWNIND if label == 'rawnind_bayer' else 'signed_shadows research',
                             metrics_vs_clean=decisions.scores(encoded, decisions.pixels(clean[region]), valid) if clean is not None else None,
                             vs_current=comparison(output[region], current[region], valid),
                             fixed_roi_shadow_tail=fixed_shadow_tail(output[region], rgb[region], stops=lift, valid=valid),
                             shadow_tails_sdr_lift4=metrics.shadow_tails(output[region], rgb[region], clean[region] if clean is not None else None,
                                                                        {'valid': valid}, source_exposure_stops=lift)))
        by_id[case_id]['columns'] = [row for row in by_id[case_id]['columns'] if row['column'] not in variants] + rows
        for row in by_id[case_id]['columns']:
            if row['column'] in ('off', 'denoise_v2_app'):
                reference = rgb if row['column'] == 'off' else current
                row['fixed_roi_shadow_tail'] = fixed_shadow_tail(reference[region], rgb[region], stops=lift, valid=valid)
        by_id[case_id]['columns_present'] = [row['column'] for row in by_id[case_id]['columns']]
        del variants, signed, current, sample
        gc.collect()
    columns = ['signed', 'signed_denoise', 'pedestal_denoise', 'signed_ahd_clipped_denoise',
               'current_import_gamut_denoise', 'signed_import_gamut_denoise', 'signed_denoise_then_gamut']
    manifest['column_order'] = list(dict.fromkeys(manifest['column_order'] + columns))
    manifest['signed_research'] = provenance()
    write(manifest_path, manifest)
    write(OUTPUT / 'decision.json', dict(cases=manifest['cases'], **provenance()))


def safety(entries):
    from hdr_finisher.adjustments import apply_hdr_output_highlight_compression
    from hdr_finisher.color_context import RenderColorContext
    from hdr_finisher.hdr_ceiling import channel_nits
    from hdr_finisher.models import AdjustmentState
    from tools.denoise_eval.inputs import remosaic
    entry = next(item for item in entries if item['file'] == 'IMG_0790.CR2')
    with rawpy.imread(str(photo_root() / entry['file'])) as raw:
        metadata = metadata_from_raw(raw, entry)
    rng = np.random.default_rng(16112026)
    neutral = []
    ensemble = []
    for level in (0., .0001, .001, .01):
        wanted = np.full((256, 256, 3), level, 'float32')
        camera = wanted @ np.linalg.inv(np.asarray(metadata['camera_to_acescg'])).T / metadata['white_balance']
        mosaic = remosaic(camera, metadata['cfa'])
        parameters = entry['noise_fit_positions']
        noisy = add_noise(mosaic, parameters, 713)
        clean = develop(mosaic, metadata)
        variants = dict(off=develop(noisy, metadata), signed=develop_signed(noisy, metadata))
        variants['current_denoise'] = denoise(variants['off'], metadata)[0]
        variants['signed_denoise'] = denoise(variants['signed'], metadata)[0]
        rows = {}
        for label, output in variants.items():
            means = output[16:-16, 16:-16].mean((0, 1), dtype=np.float64)
            mean_image = np.broadcast_to(means, (16, 16, 3)).astype('float32') * 16
            target_image = np.full((16, 16, 3), level * 16, 'float32')
            rows[label] = dict(mean_linear=means.tolist(), luminance_bias=float(means @ np.array([.2722287, .6740818, .0536895]) - level),
                               mean_patch_lift4=comparison(mean_image, target_image),
                               negative_channel_fraction=float(np.mean(output < 0)))
        neutral.append(dict(level=level, rows=rows, noise_seed=713, noise_parameters=parameters))
        means_by_method = {label: [] for label in variants}
        for seed in range(8):
            sensor = add_noise(mosaic, parameters, 17000 + seed)
            fresh = dict(off=develop(sensor, metadata), signed=develop_signed(sensor, metadata))
            fresh['current_denoise'] = denoise(fresh['off'], metadata)[0]
            fresh['signed_denoise'] = denoise(fresh['signed'], metadata)[0]
            for label, output in fresh.items():
                means_by_method[label].append(output[16:-16, 16:-16].mean((0, 1), dtype=np.float64))
        measurements = {}
        for label, values in means_by_method.items():
            values = np.asarray(values)
            mean_rgb = values.mean(axis=0)
            mean_image = np.broadcast_to(mean_rgb, (16, 16, 3)).astype('float32') * 16
            target_image = np.full((16, 16, 3), level * 16, 'float32')
            measurements[label] = dict(mean_rgb=mean_rgb.tolist(), per_seed_mean_rgb=values.tolist(),
                                        luminance_bias=float(mean_rgb @ np.array([.2722287, .6740818, .0536895]) - level),
                                        mean_patch_lift4=comparison(mean_image, target_image))
        quiet = develop_signed(mosaic, metadata)
        ensemble.append(dict(level=level, seeds=list(range(17000, 17008)), methods=measurements,
                             noiseless_signed_lift4=comparison(quiet * 16, wanted * 16)))
    exposure = []
    test = rng.normal(.05, .15, (64, 64)).astype('float32')
    test[20:30, 20:30] = 1
    state = AdjustmentState()
    state.hdr.highlight_section_enabled = True
    state.hdr.highlight_compression_target_nits = 1000
    for stops in (-6, 0, 6):
        metadata['exposure_stops'] = stops
        signed = develop_signed(test, metadata)
        current = denoise(signed, metadata)[0]
        for mode in ('peak_fit', 'soft_ceiling', 'clip', 'fixed_cap'):
            state.hdr.highlight_compression_mode = mode
            finished = apply_hdr_output_highlight_compression(current, state, color_context=RenderColorContext(203))
            nits = channel_nits(finished, 203)
            if not np.isfinite(finished).all() or np.max(nits) > 1000:
                raise AssertionError('Exact unencoded HDR ceiling or finite exposure safety failed')
            exposure.append(dict(stops=stops, mode=mode, peak_nits=float(np.max(nits)),
                                 negative_channels=int(np.count_nonzero(current < 0)), finite=True))
    write(OUTPUT / 'safety.json', dict(neutral=neutral, neutral_ensemble=ensemble, exposure=exposure, **provenance(),
                                     limitation='Actual CPU compression, not GPU delivery or encoded export qualification'))


def native(photo, entries):
    from hdr_finisher.library_gpu_raw import XYZ_RGB, D65_WHITE
    entry = next(item for item in entries if item['file'] == photo)
    started = time.perf_counter()
    with rawpy.imread(str(photo_root() / photo)) as raw:
        unpack = time.perf_counter() - started
        metadata = _camera_linear_metadata_from_libraw(raw)
        tick = time.perf_counter()
        transport = _develop_libraw_camera_rgb(raw, rawpy)
        baseline_ahd = time.perf_counter() - tick
        tick = time.perf_counter()
        image = _camera_rgb_to_acescg_float32(_normalize_camera_rgb_float32(transport, metadata), metadata)
        baseline_tail = time.perf_counter() - tick
        baseline_shape = list(image.shape)
        del transport, image
        gc.collect()
    with rawpy.imread(str(photo_root() / photo)) as raw:
        height, width = raw.raw_image_visible.shape
        metadata = _camera_linear_metadata_from_libraw(raw)
        pattern = metadata.raw_channel_to_rgb[metadata.raw_pattern]
        cam_rgb = np.asarray(raw.rgb_xyz_matrix, dtype=np.float64)[:3] @ XYZ_RGB
        cam_rgb /= cam_rgb.sum(axis=1, keepdims=True)
        rgb_cam = np.linalg.inv(cam_rgb).astype(np.float32)
        lab_matrix = np.zeros((3, 3), dtype=np.float32)
        for component in range(3):
            lab_matrix += (XYZ_RGB[:, component, None] * rgb_cam[component] / D65_WHITE[:, None]).astype(np.float32)
        clocks = dict(sensor=0., ahd=0., tail=0.)
        negative, checksum = 0, np.zeros(3)
        for top in range(0, height, 256):
            bottom = min(height, top + 256)
            first, last = max(0, top - 8), min(height, bottom + 8)
            tick = time.perf_counter()
            sensor = raw.raw_image_visible[first:last].astype('float32')
            for vertical in range(2):
                for horizontal in range(2):
                    channel = raw.raw_pattern[vertical, horizontal]
                    sensor[vertical::2, horizontal::2] -= raw.black_level_per_channel[channel]
            sensor /= 65535
            clocks['sensor'] += time.perf_counter() - tick
            tick = time.perf_counter()
            camera = camera_ahd(sensor, pattern, lab_matrix=lab_matrix, rows=512)[top-first:bottom-first].copy()
            clocks['ahd'] += time.perf_counter() - tick
            tick = time.perf_counter()
            camera *= (65535 / (metadata.white_level - metadata.black_level)).astype('float32')
            rgb = _camera_rgb_to_acescg_float32(camera, metadata)
            negative += int(np.count_nonzero(rgb < 0))
            checksum += rgb.sum((0, 1), dtype=np.float64)
            clocks['tail'] += time.perf_counter() - tick
            del sensor, camera, rgb
    write(OUTPUT / ('native-' + Path(photo).stem + '.json'), dict(photo=photo, sensor_shape=[height, width],
          baseline_shape=baseline_shape, pixels=height * width, unpack_seconds=unpack,
          current=dict(ahd=baseline_ahd, tail=baseline_tail, total=unpack+baseline_ahd+baseline_tail),
          signed=dict(**clocks, total=unpack+sum(clocks.values())), checksum=checksum.tolist(),
          negative_channels=negative, **provenance(),
          limitation='Native sensor through AHD and ACEScg, no highlights/lens/UI/Denoise; current rawpy orientation versus unrotated signed strip output. One run each, descriptive ±10% timing allowance.'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=('quick', 'full', 'heldout', 'seen', 'decision', 'safety', 'native'))
    parser.add_argument('--baseline-root', type=Path, required=True)
    parser.add_argument('--decision-source', type=Path)
    parser.add_argument('--photo', choices=('IMG_0790.CR2', '2025_0730_1331_3.arw'))
    args = parser.parse_args()
    cv2.setNumThreads(1)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    if args.phase in ('quick', 'full', 'heldout', 'seen'):
        quality(args.phase, args.baseline_root)
        return
    entries = json.loads((args.baseline_root / 'full/results-full.json').read_text())['inventory']
    if args.phase == 'decision':
        if not args.decision_source:
            parser.error('decision requires --decision-source')
        decision(entries, args.decision_source)
    elif args.phase == 'safety':
        safety(entries)
    else:
        if not args.photo:
            parser.error('native requires --photo')
        native(args.photo, entries)


if __name__ == '__main__':
    main()
