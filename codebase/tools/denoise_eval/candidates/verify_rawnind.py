"""Compare pinned upstream Bayer inference and AHD through identical colour tails."""
from __future__ import annotations

import importlib.util
import hashlib
import json
from pathlib import Path
import time

import numpy as np
import rawpy
import tifffile

from hdr_finisher.color import linear_bt2020_to_acescg
from tools.denoise_eval import metrics
from tools.denoise_eval.candidates.rawnind import RawNIND
from tools.denoise_eval.inputs import develop, inventory, metadata_from_raw, real_samples, synthetic_samples
from tools.denoise_eval.run import peak_rss, save_image
from tools.lib.test_photos import photo_root

ROOT = Path(__file__).resolve().parents[3]
OUTPUT = ROOT / 'output/denoise-v1/verify'
REVIEW = ROOT / 'output/denoise-v1/rawnind/review'


def load_demo():
    path = OUTPUT / 'upstream/darktable-ai/demo.py'
    if hashlib.sha256(path.read_bytes()).hexdigest() != '3667abc93564bad3646fd4530b7b07585a1e52e0b5c08169bee8ee48e5d1f06e':
        raise ValueError('Pinned upstream demo hash mismatch')
    spec = importlib.util.spec_from_file_location('pinned_rawnind_demo', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def differences(output, reference):
    return dict(sdr_psnr_db=metrics.psnr(metrics.display(output), metrics.display(reference)),
                sdr_delta_e=metrics.summary(metrics.colour_error(output, reference)),
                hdr_psnr_db=metrics.psnr(metrics.display(output, 'hdr'), metrics.display(reference, 'hdr')),
                hdr_delta_itp=metrics.summary(metrics.colour_error(output, reference, 'hdr')))


def upstream_pair(mosaic, metadata, matrix, demo, session):
    packed = demo.pack_rggb(np.clip(mosaic, 0, 1), np.asarray(metadata['cfa']), 'RGB')
    tensor = packed[None].astype(np.float32)
    predicted = demo._run_tiled(session, session.get_inputs()[0].name, False, tensor, scale=2)
    predicted = predicted[0].transpose(1, 2, 0)
    camera_ahd = develop(mosaic, {**metadata, 'white_balance': [1, 1, 1],
                                'camera_to_acescg': np.eye(3).tolist(), 'exposure_stops': 0})
    results = []
    gains = []
    for camera in (predicted, camera_ahd):
        matched = demo._match_gain(camera, tensor)
        gains.append(float(tensor.mean()) / float(camera.mean()))
        converted = demo.cam_rgb_to_lin_rec2020(matched, matrix)
        temporary = OUTPUT / 'demo-save.tiff'
        try:
            demo._save(str(temporary), converted)
            saved = tifffile.imread(temporary).astype(np.float32) / 65535
        finally:
            temporary.unlink(missing_ok=True)
        results.append((linear_bt2020_to_acescg(converted), linear_bt2020_to_acescg(saved)))
    return results, gains, predicted, float(camera_ahd.mean(dtype=np.float64))


def reference():
    start = time.perf_counter()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    REVIEW.mkdir(parents=True, exist_ok=True)
    demo = load_demo()
    entries = inventory()
    candidate = RawNIND('bayer')
    session = candidate._session()
    rows = []
    review_rows = []

    def compare(name, mosaic, metadata, source):
        with rawpy.imread(str(photo_root() / source)) as raw:
            matrix = np.asarray(raw.rgb_xyz_matrix, np.float32)
        pairs, gains, prediction, ahd_mean = upstream_pair(mosaic, metadata, matrix, demo, session)
        state = candidate.prepare(mosaic, metadata)
        ahd = develop(mosaic, metadata)
        oracle = prediction.astype(np.float64) * (ahd_mean / prediction.mean(dtype=np.float64))
        oracle = (oracle * np.asarray(metadata['white_balance'])) @ np.asarray(metadata['camera_to_acescg']).T
        oracle *= 2 ** metadata.get('exposure_stops', 0)
        phase_row, phase_column = (int(value) for value in np.argwhere(np.asarray(metadata['cfa']) == 0)[0])
        canonical = mosaic[phase_row:mosaic.shape[0]-phase_row, phase_column:mosaic.shape[1]-phase_column]
        canonical_metadata = {**metadata, 'cfa': [[0, 1], [1, 2]]}
        canonical_pairs, _, canonical_prediction, canonical_mean = upstream_pair(canonical, canonical_metadata, matrix, demo, session)
        canonical_state = candidate.prepare(canonical, canonical_metadata)
        canonical_oracle = canonical_prediction.astype(np.float64) * (canonical_mean / canonical_prediction.mean(dtype=np.float64))
        canonical_oracle = (canonical_oracle * np.asarray(metadata['white_balance'])) @ np.asarray(metadata['camera_to_acescg']).T
        canonical_oracle *= 2 ** metadata.get('exposure_stops', 0)
        row = dict(name=name, source=source, shape=list(mosaic.shape), cfa=metadata['cfa'], metadata=metadata,
                   upstream_rgb_xyz_matrix=matrix.tolist(),
                   input_range=[float(mosaic.min()), float(mosaic.max())],
                   upstream_gains=gains, prediction_mean_rgb=prediction.mean(axis=(0, 1)).tolist(),
                   upstream_presave_vs_ahd=differences(pairs[0][0], pairs[1][0]),
                   upstream_saved_vs_ahd=differences(pairs[0][1], pairs[1][1]),
                   adapter_vs_ahd=differences(state.denoised, ahd),
                   adapter_vs_reference_host_tail=differences(state.denoised, oracle.astype(np.float32)),
                   canonical_crop=[phase_row, phase_column, *canonical.shape],
                   upstream_canonical_presave_vs_ahd=differences(canonical_pairs[0][0], canonical_pairs[1][0]),
                   upstream_canonical_saved_vs_ahd=differences(canonical_pairs[0][1], canonical_pairs[1][1]),
                   canonical_adapter_vs_reference_host_tail=differences(canonical_state.denoised, canonical_oracle.astype(np.float32)),
                   ahd_camera_mean=ahd_mean,
                   adapter_state=candidate.state_description(state))
        rows.append(row)
        images = []
        for label, image in [('Upstream network, saved convention', pairs[0][1]),
                             ('Upstream AHD, same gain/matrix/save', pairs[1][1]),
                             ('Host network', state.denoised), ('Host AHD', ahd)]:
            filename = f'verify-{len(rows):02d}-{len(images)}.png'
            save_image(image, REVIEW / filename, 128)
            images.append((label, filename))
        review_rows.append(dict(name=f'Upstream reference: {name}', metadata=source, images=images))
        print(json.dumps(row), flush=True)

    for sample in synthetic_samples(entries, False):
        if sample.metadata['iso'] == 6400:
            compare(sample.name, sample.clean_bayer, sample.metadata, sample.metadata['source'])
    for filename in ('DSC04375.ARW', 'DSC00950.ARW'):
        entry = next(entry for entry in entries if entry['file'] == filename)
        with rawpy.imread(str(photo_root() / filename)) as raw:
            metadata = metadata_from_raw(raw, entry)
            height, width = raw.raw_image_visible.shape
            top, left = ((height - 512) // 4) * 2, ((width - 512) // 4) * 2
            mosaic = raw.raw_image_visible[top:top+512, left:left+512].astype(np.float32)
            white = float(raw.white_level)
            for row in range(2):
                for column in range(2):
                    channel = int(raw.raw_pattern[row, column])
                    black = raw.black_level_per_channel[channel]
                    mosaic[row::2, column::2] = np.clip((mosaic[row::2, column::2]-black) / max(white-black, 1), 0, 1)
            metadata['crop'] = dict(x=left, y=top, size=512)
        compare(f'low-ISO-{filename}', mosaic, metadata, filename)
    shadow_rows = []
    for sample in real_samples(entries, False):
        state = candidate.prepare(sample.bayer, sample.metadata)
        baseline = sample.rgb / np.float32(2 ** sample.metadata['exposure_stops'])
        neural = state.denoised / np.float32(2 ** sample.metadata['exposure_stops'])
        shadow = np.mean(baseline, axis=-1) < .01
        sensor_shadow = sample.bayer < .01
        raw_shift = np.clip(sample.bayer, 0, 1) - sample.bayer
        shadow_rows.append(dict(name=sample.name, metadata=sample.metadata, pixels=int(shadow.sum()),
            threshold='mean linear ACEScg RGB < .01 before viewing exposure',
            ahd_mean=float(baseline[shadow].mean()) if shadow.any() else None,
            neural_minus_ahd_mean=float((neural-baseline)[shadow].mean()) if shadow.any() else None,
            neural_minus_ahd_mean_rgb=np.mean((neural-baseline)[shadow], axis=0).tolist() if shadow.any() else None,
            raw_shadow_sites=int(sensor_shadow.sum()),
            raw_clipping_mean_shift=float(raw_shift[sensor_shadow].mean()) if sensor_shadow.any() else None,
            clipping_only_ahd_difference=float(np.max(np.abs(develop(np.clip(sample.bayer, 0, 1), sample.metadata)-sample.rgb))),
            adapter_state=candidate.state_description(state)))
    exposure_rows = []
    base_metadata = dict(cfa=[[0, 1], [1, 2]], white_balance=[2, 1, 1.5],
                         camera_to_acescg=[[1, -.8, 0], [0, 1, 0], [0, 0, 1]])
    sensor = np.full((32, 32), .2, np.float32)
    sensor[0::2, 0::2] = .05
    anchor = candidate.prepare(sensor, base_metadata).denoised
    for stops in range(-6, 7):
        output = candidate.prepare(sensor, {**base_metadata, 'exposure_stops': stops}).denoised
        exposure_rows.append(dict(stops=stops, minimum=float(output.min()), maximum=float(output.max()),
                                  difference=differences(output / np.float32(2 ** stops), anchor)))
    result = dict(rows=rows, real_shadows=shadow_rows, developed_exposure=exposure_rows,
                  review_rows=review_rows, elapsed_seconds=time.perf_counter()-start,
                  peak_rss_bytes=peak_rss())
    (OUTPUT / 'reference.json').write_text(json.dumps(result, indent=2, allow_nan=False) + '\n')


if __name__ == '__main__':
    reference()
