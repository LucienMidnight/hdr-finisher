"""Make bounded, aligned Bayer/ACEScg research pairs; no network or candidate tuning."""
import os
for variable in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'VECLIB_MAXIMUM_THREADS', 'HDR_CPU_THREADS'):
    os.environ[variable] = '1'
import argparse
from collections import defaultdict
import gc
import json
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
import cv2
import numpy as np
import rawpy
from tools.denoise_eval.datasets.download import digest
from tools.denoise_eval.inputs import (normalise_crop, metadata_from_raw, develop,
                                      masks_for, flat_observations, fit_observations)
from hdr_finisher.export_metadata import command as exiftool_command

cv2.setNumThreads(1)
POLICY = dict(crop_size=512, crops_per_pair=4, alignment_sensor_limit=16.,
              alignment_local_deviation_sensor_limit=1., alignment_ecc_min=.90,
              crop_structure_correlation_min=.97, crop_relative_rmse_max=.12,
              mask_filter_halo=40, minimum_valid_fraction=.20,
              gain_signal_interval=[.005, .85], gain_outlier_mad=4.,
              interpolation='CFA-plane Lanczos4 on clean only; noisy never resampled')


def capture_tags(paths):
    tags = json.loads(subprocess.check_output([*exiftool_command(), '-json', '-ISO', '-Model', '-Make',
                                               '-ExposureTime', '-FNumber', '-FocalLength',
                                               '-RecommendedExposureIndex', '-BaseISO', '-n', *map(str, paths)], text=True))
    result = {}
    for tag in tags:
        name = Path(tag.pop('SourceFile')).name
        tag['EXIF_ISO'] = tag['ISO']
        if float(tag['ISO']) == 65535:
            extended = tag.get('RecommendedExposureIndex', tag.get('BaseISO'))
            if extended is None:
                raise ValueError(f'ISO sentinel without an authoritative extension: {name}')
            tag['ISO'] = float(extended)
        tag['ExposureTime'] = float(tag['ExposureTime'])
        result[name] = tag
    return result


def green(mosaic, pattern):
    planes = [mosaic[row::2, column::2] for row, column in np.argwhere(pattern == 1)]
    return cv2.GaussianBlur(np.mean(planes, axis=0).astype('float32'), (0, 0), 2)


def standard(image):
    deviation = float(image.std())
    if deviation < 1e-5:
        raise ValueError('Insufficient structure to estimate alignment')
    return (image - float(image.mean())) / deviation


def translation(noisy, clean, pattern):
    template, source = standard(green(noisy, pattern)), standard(green(clean, pattern))
    window = cv2.createHanningWindow((source.shape[1], source.shape[0]), cv2.CV_32F)
    offset, response = cv2.phaseCorrelate(template, source, window)
    warp = np.array([[1, 0, offset[0]], [0, 1, offset[1]]], dtype='float32')
    correlation, warp = cv2.findTransformECC(template, source, warp, cv2.MOTION_TRANSLATION,
                                           (cv2.TERM_CRITERIA_COUNT | cv2.TERM_CRITERIA_EPS, 100, 1e-5), None, 5)
    return dict(sensor_xy=(warp[:, 2] * 2).tolist(), ecc=float(correlation), phase_response=float(response))


def align_clean(mosaic, sensor_xy):
    result = np.empty_like(mosaic)
    for row in range(2):
        for column in range(2):
            plane = mosaic[row::2, column::2]
            height, width = plane.shape
            grid_y, grid_x = np.indices((height, width), dtype='float32')
            result[row::2, column::2] = cv2.remap(plane, grid_x + np.float32(sensor_xy[0] / 2),
                                                grid_y + np.float32(sensor_xy[1] / 2), cv2.INTER_LANCZOS4,
                                                borderMode=cv2.BORDER_REFLECT_101)
    return result


def fit_gain(observations, pattern):
    gains = []
    low, high = POLICY['gain_signal_interval']
    for channel in range(3):
        inputs, targets = [], []
        for noisy, clean in observations:
            for row, column in np.argwhere(pattern == channel):
                source, target = clean[row::2, column::2], noisy[row::2, column::2]
                valid = (source > low) & (source < high) & (target > low) & (target < high)
                inputs.append(source[valid][::4].astype('float64'))
                targets.append(target[valid][::4].astype('float64'))
        source, target = np.concatenate(inputs), np.concatenate(targets)
        if len(source) < 1024:
            raise ValueError('Too few unclipped samples for a global gain')
        gain = float(source @ target / (source @ source))
        residual = target - source * gain
        median = np.median(residual)
        deviation = np.median(np.abs(residual - median)) * 1.4826
        keep = np.abs(residual - median) <= POLICY['gain_outlier_mad'] * max(deviation, 1e-7)
        gain = float(source[keep] @ target[keep] / (source[keep] @ source[keep]))
        if not .05 < gain < 20:
            raise ValueError('Exposure mismatch exceeds the bounded gain domain')
        gains.append(gain)
    return gains


def apply_gain(mosaic, pattern, gains):
    return mosaic * np.asarray(gains, dtype='float32')[np.tile(pattern, (mosaic.shape[0] // 2, mosaic.shape[1] // 2))]


def metric_masks(noisy, clean_original, clean_aligned, clean_rgb):
    invalid = (noisy <= 0) | (noisy >= 1) | (clean_original <= 0) | (clean_original >= 1)
    invalid |= (clean_aligned <= 0) | (clean_aligned >= 1)
    radius = POLICY['mask_filter_halo']
    invalid = cv2.dilate(invalid.astype('uint8'), np.ones((2 * radius + 1, 2 * radius + 1), 'uint8'))
    valid = invalid == 0
    valid[:radius] = valid[-radius:] = False
    valid[:, :radius] = valid[:, -radius:] = False
    masks = masks_for(clean_rgb)
    masks = {name: mask & valid for name, mask in masks.items()}
    gray = cv2.GaussianBlur(clean_rgb.mean(-1), (0, 0), 1)
    gradient = np.hypot(cv2.Sobel(gray, cv2.CV_32F, 1, 0), cv2.Sobel(gray, cv2.CV_32F, 0, 1))
    masks['edge'] = valid & (gradient >= np.percentile(gradient[valid], 80)) if valid.any() else valid.copy()
    masks['valid'] = valid
    return masks


def crop_agreement(noisy, clean, pattern, valid):
    source, target = green(noisy, pattern), green(clean, pattern)
    mask = valid[::2, ::2]
    if mask.sum() < 100:
        raise ValueError('Too few unclipped pixels after filter-support exclusion')
    source, target = source[mask], target[mask]
    spread = float(np.percentile(target, 95) - np.percentile(target, 5))
    rmse = float(np.sqrt(np.mean((source - target)**2)))
    correlation = float(np.corrcoef(source, target)[0, 1]) if target.std() > 1e-5 else None
    relative_rmse = rmse / max(spread, .01)
    accepted = relative_rmse <= POLICY['crop_relative_rmse_max'] and (correlation is None or correlation >= POLICY['crop_structure_correlation_min'])
    return dict(accepted=accepted, correlation=correlation, relative_rmse=relative_rmse)


def windows(raw, size):
    height, width = raw.raw_image_visible.shape
    return [(int((height - size) * vertical) // 2 * 2, int((width - size) * horizontal) // 2 * 2)
            for vertical in (.15, .5, .85) for horizontal in (.15, .5, .85)]


def choose_crops(clean, coordinates, size, pattern):
    descriptors = []
    for vertical, horizontal in coordinates:
        mosaic = normalise_crop(clean, vertical, horizontal, size)
        image = green(mosaic, pattern)
        laplacian = cv2.Laplacian(image, cv2.CV_32F)
        gradient = np.hypot(cv2.Sobel(image, cv2.CV_32F, 1, 0), cv2.Sobel(image, cv2.CV_32F, 0, 1))
        descriptors.append(dict(y=vertical, x=horizontal, mean=float(np.median(image)),
                                texture=float(np.std(laplacian)), edge=float(np.percentile(gradient, 95))))
    chosen = []
    for kind, key, reverse in (('flat', 'texture', False), ('shadow', 'mean', False),
                               ('texture', 'texture', True), ('edge', 'edge', True)):
        candidate = next(item for item in sorted(descriptors, key=lambda item: item[key], reverse=reverse)
                         if (item['y'], item['x']) not in [(entry['y'], entry['x']) for entry in chosen])
        chosen.append({**candidate, 'kind': kind})
    return chosen


def prepare_pair(noisy_raw, clean_raw, entry, clean_entry, tags, destination):
    size = POLICY['crop_size']
    if noisy_raw.raw_image_visible.shape != clean_raw.raw_image_visible.shape:
        raise ValueError('Different sensor shapes')
    tag = tags[entry['file']]
    basic = dict(iso=tag['ISO'], camera=tag['Model'], file=entry['file'], noise_fit_positions=None)
    metadata = metadata_from_raw(noisy_raw, basic)
    pattern = np.asarray(metadata['cfa'])
    if pattern.shape != (2, 2) or not np.array_equal(noisy_raw.raw_pattern, clean_raw.raw_pattern):
        raise ValueError('Only matching 2x2 Bayer patterns are supported')
    coordinates = windows(clean_raw, size)
    raw_windows = [(normalise_crop(noisy_raw, vertical, horizontal, size),
                    normalise_crop(clean_raw, vertical, horizontal, size)) for vertical, horizontal in coordinates]
    alignments = []
    for index, (noisy, clean) in enumerate(raw_windows):
        try:
            estimate = translation(noisy, clean, pattern)
            if estimate['ecc'] >= POLICY['alignment_ecc_min']:
                alignments.append(dict(window=index, **estimate))
        except (cv2.error, ValueError):
            pass
    if len(alignments) < 3:
        raise ValueError('Fewer than three independent alignment anchors')
    offsets = np.asarray([item['sensor_xy'] for item in alignments])
    offset = np.median(offsets, axis=0)
    deviations = np.linalg.norm(offsets - offset, axis=1)
    stable = deviations <= POLICY['alignment_local_deviation_sensor_limit']
    if np.max(np.abs(offset)) > POLICY['alignment_sensor_limit'] or stable.sum() < max(3, len(offsets) - 1):
        raise ValueError(f'Non-rigid/moving or excessive translation: {offset.tolist()}, deviations {deviations.tolist()}')
    observations = [(raw_windows[item['window']][0], align_clean(raw_windows[item['window']][1], offset))
                    for item, accepted in zip(alignments, stable) if accepted]
    gains = fit_gain(observations, pattern)
    noise = [[] for _ in range(4)]
    for noisy, clean in raw_windows:
        for position in range(4):
            noise[position].extend(flat_observations(noisy[position // 2::2, position % 2::2]))
    metadata['noise_fit_positions'] = [fit_observations(values) for values in noise]
    metadata.update(scene_id=entry['scene_id'], held_out=entry['held_out'], contamination=entry['contamination'],
                    dataset='RawNIND-CC0', clean_source=clean_entry['file'],
                    capture_exposure=tag, clean_capture_exposure=tags[clean_entry['file']],
                    registration=dict(clean_sample_offset_sensor_xy=offset.tolist(), anchors=alignments,
                                      anchor_deviation_sensor=deviations.tolist()),
                    brightness=dict(clean_to_noisy_rgb_gain=gains, offset=0, domain='black-subtracted white-normalised pre-WB Bayer'),
                    policy=POLICY)
    pairs, rejected = [], []
    for index, crop in enumerate(choose_crops(clean_raw, coordinates, size, pattern)):
        vertical, horizontal = crop['y'], crop['x']
        noisy = normalise_crop(noisy_raw, vertical, horizontal, size)
        clean_original = normalise_crop(clean_raw, vertical, horizontal, size)
        clean = apply_gain(align_clean(clean_original, offset), pattern, gains)
        clean_rgb = develop(clean, metadata)
        masks = metric_masks(noisy, clean_original, clean, clean_rgb)
        fraction = float(masks['valid'].mean())
        if fraction < POLICY['minimum_valid_fraction']:
            rejected.append(dict(crop=crop, reason='clipping/filter-support valid area below minimum', valid_fraction=fraction))
            continue
        agreement = crop_agreement(noisy, clean, pattern, masks['valid'])
        if not agreement['accepted']:
            rejected.append(dict(crop=crop, reason='local structure/illumination disagreement', agreement=agreement))
            continue
        cropped_metadata = dict(metadata, crop=[vertical, horizontal, size, size], crop_kind=crop['kind'],
                                valid_fraction=fraction, agreement=agreement)
        name = f'{entry["scene_id"]}-{entry["source_sha1"][:8]}-{index}'
        bundle = name + '.npz'
        np.savez_compressed(destination / bundle, rgb=develop(noisy, metadata), clean=clean_rgb,
                            bayer=noisy, clean_bayer=clean, **masks)
        pairs.append(dict(name=name, bundle=bundle, metadata=cropped_metadata))
    return pairs, dict(source=entry['file'], clean=clean_entry['file'], metadata=metadata,
                       accepted=len(pairs), rejected=rejected)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, default=Path(__file__).with_name('rawnind-manifest.json'))
    parser.add_argument('--source', type=Path, default=ROOT / 'output/denoise-v1/datasets/rawnind')
    parser.add_argument('--destination', type=Path, default=ROOT / 'output/denoise-v1/datasets/rawnind/pairs')
    args = parser.parse_args()
    start = time.perf_counter()
    manifest = json.loads(args.manifest.read_text())
    groups = defaultdict(list)
    for entry in manifest['files']:
        path = args.source / entry['file']
        if path.name != entry['file'] or path.stat().st_size != entry['bytes'] or digest(path) != entry['sha256']:
            raise ValueError(f'Unverified data: {entry["file"]}')
        groups[entry['scene_id']].append(entry)
    args.destination.mkdir(parents=True, exist_ok=True)
    tags = capture_tags([args.source / entry['file'] for entry in manifest['files']])
    pairs, receipts = [], []
    for scene, entries in groups.items():
        clean_entry = next(entry for entry in entries if entry['role'] == 'clean')
        with rawpy.imread(str(args.source / clean_entry['file'])) as clean_raw:
            for entry in entries:
                if entry['role'] == 'clean':
                    continue
                print(f'{scene} ISO {tags[entry["file"]]["ISO"]}', flush=True)
                try:
                    with rawpy.imread(str(args.source / entry['file'])) as noisy_raw:
                        accepted, receipt = prepare_pair(noisy_raw, clean_raw, entry, clean_entry, tags, args.destination)
                    pairs.extend(accepted)
                    receipts.append(receipt)
                    print(f'  accepted {len(accepted)} crops; rejected {len(receipt["rejected"])}', flush=True)
                except (ValueError, rawpy.LibRawError) as error:
                    receipts.append(dict(source=entry['file'], error=str(error), accepted=0))
                    print(f'  rejected pair: {error}', flush=True)
                gc.collect()
    (args.destination / 'pairs.json').write_text(json.dumps(pairs, indent=2, allow_nan=False) + '\n')
    (args.destination / 'preparation.json').write_text(json.dumps(dict(policy=POLICY, captures=tags, pairs=receipts,
                                                                    elapsed_seconds=time.perf_counter() - start), indent=2, allow_nan=False) + '\n')
    if not pairs:
        raise SystemExit('No aligned pairs accepted')
    print(f'{len(pairs)} crops prepared', flush=True)


if __name__ == '__main__':
    main()
