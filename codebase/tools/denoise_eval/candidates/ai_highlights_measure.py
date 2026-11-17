"""Serial, guarded full-frame highlight/RawNIND research; no shipping changes."""
from __future__ import annotations

import os
for variable in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS',
                 'VECLIB_MAXIMUM_THREADS', 'HDR_CPU_THREADS'):
    os.environ[variable] = '1'

import argparse
import gc
import hashlib
import html
import io
import json
from pathlib import Path
import platform
import signal
import subprocess
import tempfile
import time
from types import SimpleNamespace

import cv2
import colour
import numpy as np
from PIL import Image
import rawpy

from hdr_finisher import raw_import
from hdr_finisher.adjustments import apply_hdr_output_highlight_compression, clip_hdr_output_target
from hdr_finisher.color import acescg_to_linear_bt2020
from hdr_finisher.color_context import RenderColorContext
from hdr_finisher.hdr_ceiling import channel_nits
from hdr_finisher.import_defaults import RAW_CALIBRATION_EV
from hdr_finisher.highlight_edge_colour import reconstruct_edge_colour
from hdr_finisher.models import AdjustmentState
from tools.denoise_eval import metrics
from tools.denoise_eval.run import peak_rss
from tools.lib.test_photos import photo_root, sha256
from .ai_highlights import (camera_develop, model_sensor, protect_weight, reconstruction_support,
                           region_blend, sensor_clip_ratio, settings, to_scene)
from .rawnind import HASHES, RawNIND

ROOT = Path(__file__).resolve().parents[3]
OUTPUT = ROOT / 'output/denoise-v1/ai-highlights'
REVIEW = OUTPUT / 'review'
PHOTOS = ('IMG_0790.CR2', 'IMG_3129.CR2', 'IMG_0114.CR2', '2025_0730_1331_3.arw')
METHODS = ('opposed_color_v1', 'edge_colour_v1')
VIEW_CALIBRATION = np.float32(2 ** RAW_CALIBRATION_EV)


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, allow_nan=False) + '\n')


def provenance():
    import onnxruntime
    return dict(date='2026-11-17', machine='MacBook Neo, Apple A18 Pro, 8 GB',
                platform=platform.platform(), runtime=onnxruntime.__version__, provider='CPUExecutionProvider',
                model_sha256=HASHES['bayer'], head=subprocess.check_output(
                    ['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
                code_sha256={path.name: sha256(path) for path in (
                    Path(__file__), Path(__file__).with_name('ai_highlights.py'),
                    ROOT / 'backend/hdr_finisher/raw_import.py',
                    ROOT / 'backend/hdr_finisher/highlight_edge_colour.py',
                    ROOT / 'backend/hdr_finisher/signed_raw.py')},
                provisional_limits=dict(seam_delta_e_mean=1., seam_delta_e_p99=3.,
                    texture_noise_step_ratio=[.8, 1.25], timing_noise_fraction=.1,
                    support_linear_epsilon=1e-6, shipping_approval=False),
                viewing=f'Fixed RAW {RAW_CALIBRATION_EV:g} EV; common linear-sRGB clamp + sRGB OETF; no auto exposure. HDR uses 203-nit/.18 host units.')


def record_image(name, image, exposure=0, *, calibrated=True):
    REVIEW.mkdir(parents=True, exist_ok=True)
    factor = np.float32(2 ** exposure) * (VIEW_CALIBRATION if calibrated else 1.)
    pixels = np.rint(np.clip(metrics.display(image * factor), 0, 1) * 255).astype(np.uint8)
    buffer = io.BytesIO()
    Image.fromarray(pixels).save(buffer, format='PNG')
    payload = buffer.getvalue()
    path = REVIEW / f'{hashlib.sha256(payload).hexdigest()}.png'
    if not path.exists():
        path.write_bytes(payload)
    return path.name


def disk_copy(folder, name, image):
    output = np.memmap(Path(folder) / f'{name}.f32', mode='w+', dtype=np.float32, shape=image.shape)
    for top in range(0, image.shape[0], 128):
        output[top:top + 128] = image[top:top + 128]
    output.flush()
    return output


def release_pages(*arrays):
    import ctypes
    outputs = []
    for array in arrays:
        filename, shape, dtype = array.filename, array.shape, array.dtype
        array._mmap.close()
        outputs.append(np.memmap(filename, mode='r', dtype=dtype, shape=shape))
    gc.collect()
    if platform.system() == 'Darwin':
        library = ctypes.CDLL(None)
        library.malloc_zone_pressure_relief.argtypes = [ctypes.c_void_p, ctypes.c_size_t]
        library.malloc_zone_pressure_relief.restype = ctypes.c_size_t
        library.malloc_zone_pressure_relief(None, 0)
    return outputs


def summary(values, mask=None):
    selected = values.ravel() if mask is None else values[mask]
    if not selected.size:
        return dict(count=0, mean=None, p99=None)
    return dict(count=int(selected.size), mean=float(selected.mean()), p99=float(np.percentile(selected, 99)))


def safety(image):
    state = AdjustmentState()
    state.hdr.highlight_compression_target_nits = 1000.
    state.hdr.highlight_section_enabled = True
    result = []
    sample = image[::max(1, image.shape[0] // 128), ::max(1, image.shape[1] // 128)]
    for exposure in (-6, -3, 0, 3, 6):
        lifted = sample * np.float32(2 ** exposure)
        restored = lifted / np.float32(2 ** exposure)
        finished = apply_hdr_output_highlight_compression(lifted, state,
                                                          color_context=RenderColorContext(203))
        peak = float(channel_nits(finished, 203).max())
        result.append(dict(exposure=exposure, finite=bool(np.isfinite(finished).all()),
                           roundtrip_exact=bool(np.array_equal(restored, sample)),
                           finished_peak_nits=peak, exact_cap_pass=peak <= 1000.))
    return result


def colour_delta(image, reference, exposure=0, hdr=False):
    factor = np.float32(2 ** exposure) * VIEW_CALIBRATION
    if not hdr:
        return metrics.colour_error(image * factor, reference * factor)
    first = np.clip(acescg_to_linear_bt2020(image * factor) * np.float32(203 / .18), 0, 1000)
    second = np.clip(acescg_to_linear_bt2020(reference * factor) * np.float32(203 / .18), 0, 1000)
    difference = (colour.RGB_to_ICtCp(first, method='ITU-R BT.2100-2 PQ')
                  - colour.RGB_to_ICtCp(second, method='ITU-R BT.2100-2 PQ'))
    difference[..., 1] *= .5
    return 720 * np.linalg.norm(difference, axis=-1)


def seam_measure(image, normal, neural, weight, clip_ratio):
    crossings = []
    boundary = np.zeros(weight.shape, bool)
    for axis in (0, 1):
        crossing = np.logical_xor(weight >= .5, np.roll(weight >= .5, 1, axis=axis))
        if axis == 0:
            crossing[0, :] = False
        else:
            crossing[:, 0] = False
        boundary |= crossing
        rows, columns = np.nonzero(crossing)
        crossings.append((rows, columns, rows - (axis == 0), columns - (axis == 1)))
    band = cv2.dilate(boundary.astype(np.uint8), np.ones((17, 17), np.uint8)) > 0
    high = weight == 1
    outside = weight == 0
    result = dict(protected_rgb_exact=bool(np.array_equal(image[high], normal[high])),
                  outside_rgb_exact=bool(np.array_equal(image[outside], neural[outside])),
                  highlight_sensor_pixels=int(np.count_nonzero(clip_ratio >= 1)),
                  sample_protected_fraction=float(np.mean(high)),
                  sample_fully_neural_fraction=float(np.mean(outside)), views={})
    for exposure in (0, -3):
        delta = colour_delta(image, normal, exposure)
        view = dict(highlight_delta_e=summary(delta, clip_ratio >= 1),
                    inside_band_delta_e=summary(delta, band & (weight >= .5)),
                    outside_band_delta_e=summary(delta, band & (weight < .5)),
                    transition_delta_e=summary(delta, (weight > 0) & (weight < 1)),
                    transition_delta_itp=summary(colour_delta(image, normal, exposure, hdr=True),
                                                (weight > 0) & (weight < 1)))
        jumps = []
        for rows, columns, other_rows, other_columns in crossings:
            if not len(rows):
                continue
            paired = colour_delta(image[rows, columns][:, None], image[other_rows, other_columns][:, None], exposure)
            reference = colour_delta(normal[rows, columns][:, None], normal[other_rows, other_columns][:, None], exposure)
            jumps.append(np.abs(paired - reference).ravel())
        if jumps:
            view['cross_boundary_excess_delta_e'] = summary(np.concatenate(jumps))
        else:
            view['cross_boundary_excess_delta_e'] = summary(np.empty(0))
        highpass = []
        for source in (image, normal):
            luma = metrics.display(source * np.float32(2 ** exposure) * VIEW_CALIBRATION) @ metrics.LUMA
            highpass.append(luma - cv2.GaussianBlur(luma, (0, 0), 1.))
        energy = []
        for selected in (band & (weight >= .5), band & (weight < .5)):
            numerator = float(np.std(highpass[0][selected])) if np.any(selected) else None
            denominator = float(np.std(highpass[1][selected])) if np.any(selected) else None
            energy.append(None if not denominator or denominator < 1e-9 else numerator / denominator)
        view['inside_outside_highpass_relative_to_normal'] = energy
        view['highpass_step_ratio'] = None if None in energy or not energy[1] else energy[0] / energy[1]
        result['views'][str(exposure)] = view
    result['safety'] = safety(image)
    return result


def window(center, shape, size=512):
    height, width = shape
    top = min(max(0, int(center[0]) - size // 2), max(0, height - size)) // 2 * 2
    left = min(max(0, int(center[1]) - size // 2), max(0, width - size)) // 2 * 2
    return (slice(top, min(top + size, height)), slice(left, min(left + size, width)))


def strongest_center(mask):
    labels_count, labels, stats, centers = cv2.connectedComponentsWithStats(mask.astype(np.uint8))
    if labels_count <= 1:
        return np.array(mask.shape) // 2
    label = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    return centers[label][::-1]


def inspect_real():
    entries = []
    for filename in PHOTOS:
        started = time.perf_counter()
        with rawpy.imread(str(photo_root() / filename)) as raw:
            info = raw_import._camera_linear_metadata_from_libraw(raw)
            sensor = raw.raw_image_visible
            ratio = sensor_clip_ratio(sensor, info)
            small = model_sensor(sensor, info, raw.white_level)
            height, width = small.shape
            camera = np.stack([small[row::2, column::2] for row, column in
                              ((0, 0), (0, 1), (1, 1))], axis=-1)
            cfa = info.raw_channel_to_rgb[info.raw_pattern]
            for channel in range(3):
                locations = np.argwhere(cfa == channel)
                camera[..., channel] = np.mean([small[row::2, column::2] for row, column in locations], axis=0)
            scene = to_scene(camera, info)
            thumbnail = cv2.resize(scene, (max(1, width // 16), max(1, height // 16)), interpolation=cv2.INTER_AREA)
            center = strongest_center(ratio[::8, ::8] >= 1) * 8
            image = record_image(f'survey-{Path(filename).stem}', thumbnail)
            entries.append(dict(file=filename, shape=list(sensor.shape), flip=int(raw.sizes.flip),
                                cfa=cfa.tolist(), wb=info.as_shot_wb.tolist(),
                                clipped_fraction=float(np.mean(ratio >= 1)), highlight_center=center.tolist(),
                                thumbnail=image, seconds=time.perf_counter() - started))
            print(json.dumps(entries[-1]), flush=True)
    write_json(OUTPUT / 'survey.json', dict(provenance=provenance(), photos=entries))


def evaluate_frame(sensor, info, matrix, global_white, name, folder):
    clocks = {}
    started = time.perf_counter()
    camera = camera_develop(sensor, info, matrix)
    anchor = float(camera.mean(dtype=np.float64))
    ratio = sensor_clip_ratio(sensor, info)
    center = strongest_center(ratio[::8, ::8] >= 1) * 8
    original_scene = to_scene(camera, info)
    off = disk_copy(folder, 'off', original_scene)
    del camera, original_scene
    normalized = model_sensor(sensor, info, global_white)
    normalized_store = disk_copy(folder, 'sensor', normalized)
    clipping = dict(negative_fraction=float(np.mean(normalized < 0)),
                    negative_clip_mean_shift=float(np.mean(np.maximum(normalized, 0) - normalized)),
                    above_white_fraction=float(np.mean(normalized > 1)))
    del normalized
    clocks['original_ahd_sensor_anchor'] = time.perf_counter() - started
    md = dict(cfa=info.raw_channel_to_rgb[info.raw_pattern].tolist(),
              white_balance=info.as_shot_wb.tolist(), camera_to_acescg=info.camera_to_acescg.tolist(),
              exposure_stops=0.)
    off, normalized_store = release_pages(off, normalized_store)
    neural = np.memmap(Path(folder) / 'neural.f32', mode='w+', dtype=np.float32, shape=off.shape)
    adapter = RawNIND('bayer')
    state = adapter.prepare(normalized_store, md, destination=neural, camera_anchor_mean=anchor)
    clocks['ai'] = state.timing
    gain = state.gain
    neural.flush()
    del state, adapter
    print(json.dumps(dict(stage='AI complete', name=name, clocks=clocks, gain=gain)), flush=True)
    write_json(OUTPUT / f'partial-{name}.json', dict(name=name, shape=list(sensor.shape),
               provenance=provenance(), clocks=clocks, gain=gain, completed=False, results=[]))
    off, normalized_store, neural = release_pages(off, normalized_store, neural)
    rows = []
    results = []
    for method in METHODS:
        for expand in ((0., 1., 3.) if method == 'edge_colour_v1' else (0.,)):
            started = time.perf_counter()
            repaired = sensor.copy()
            diagnostics = raw_import._apply_raw_highlight_reconstruction(
                SimpleNamespace(raw_image_visible=repaired), info, settings(method, expand))
            repair_seconds = time.perf_counter() - started
            started = time.perf_counter()
            camera = camera_develop(repaired, info, matrix)
            reconstructed_anchor = float(camera.mean(dtype=np.float64))
            del repaired
            camera_ratio = camera.max(axis=-1) / np.float32(raw_import.OPPOSED_COLOR_THRESHOLD_SAFETY)
            normal_array = to_scene(camera, info)
            ahd_tail_seconds = time.perf_counter() - started
            edge_seconds = 0.
            edge_diagnostics = None
            if method == 'edge_colour_v1':
                started = time.perf_counter()
                normal_array, edge_diagnostics = reconstruct_edge_colour(normal_array, camera_ratio, expand)
                edge_seconds = time.perf_counter() - started
            normal = disk_copy(folder, 'normal', normal_array)
            del normal_array, camera, camera_ratio
            off, normal, neural = release_pages(off, normal, neural)
            started = time.perf_counter()
            changed = np.empty(sensor.shape, bool)
            for top in range(0, sensor.shape[0], 128):
                changed[top:top + 128] = reconstruction_support(normal[top:top + 128], off[top:top + 128])
            support_seconds = time.perf_counter() - started
            off, normal = release_pages(off, normal)
            ai_first = None
            ai_first_seconds = 0.
            if method == 'edge_colour_v1':
                off, normal, neural = release_pages(off, normal, neural)
                started = time.perf_counter()
                ai_first_array, _ = reconstruct_edge_colour(neural, ratio, expand)
                ai_first_seconds = time.perf_counter() - started
                ai_first = disk_copy(folder, 'ai-first', ai_first_array)
                del ai_first_array
                off, normal, neural, ai_first = release_pages(off, normal, neural, ai_first)
            for feather in (32, 128):
                started = time.perf_counter()
                weight = protect_weight(ratio, changed=changed, feather=feather)
                weight_seconds = time.perf_counter() - started
                transition = (weight[::8, ::8] > .35) & (weight[::8, ::8] < .65)
                difference = np.max(np.abs(neural[::8, ::8] - normal[::8, ::8]), axis=-1)
                seam_center = (np.unravel_index(np.argmax(np.where(transition, difference, -1)), transition.shape)
                               if np.any(transition) else center // 8)
                selections = dict(highlight=window(center, sensor.shape),
                                  seam=window(np.array(seam_center) * 8, sensor.shape))
                observations = {}
                started = time.perf_counter()
                for role, selection in selections.items():
                    normal_crop = normal[selection].copy()
                    neural_crop = neural[selection].copy()
                    off_crop = off[selection].copy()
                    weight_crop = weight[selection].copy()
                    combined = region_blend(neural_crop, normal_crop, weight_crop)
                    observations[role] = seam_measure(combined, normal_crop, neural_crop, weight_crop, ratio[selection])
                    observations[role]['sensor_origin'] = [selection[0].start, selection[1].start]
                    displayed = (method == 'opposed_color_v1' or expand == 1.)
                    if feather == 32 and displayed and (role == 'seam' or name in ('IMG_0790', 'IMG_3129')):
                        label = f'{name}-{method}-{expand:g}-{role}'
                        mask_rgb = np.repeat(weight_crop[..., None], 3, axis=-1)
                        columns = [('Normal reconstruction', normal_crop), ('AI only (no reconstruction)', neural_crop),
                                   ('Region blend', combined), ('Protection mask', mask_rgb)]
                        if method == 'edge_colour_v1':
                            after = ai_first[selection].copy()
                            columns.append(('AI first, RGB Edge only', after))
                            observations[role]['ai_first_edge'] = dict(
                                delta_e_normal=summary(colour_delta(after, normal_crop)),
                                delta_e_minus3=summary(colour_delta(after, normal_crop, -3)))
                        for exposure in (0, -3):
                            images = [(title, record_image(f'{label}-{index}-{exposure}', pixels[64:448, 64:448],
                                                          0 if title == 'Protection mask' else exposure,
                                                          calibrated=title != 'Protection mask'))
                                      for index, (title, pixels) in enumerate(columns)]
                            rows.append(dict(name=f'{name}: {method}, Expand {expand:g}%, {role}, {exposure:+} EV',
                                             sensor_origin=observations[role]['sensor_origin'], images=images))
                sample_seconds = time.perf_counter() - started
                started = time.perf_counter()
                outside_max = protected_max = 0.
                blend_sum = 0.
                full_safety = {}
                check_full = feather == 32 and (method == 'opposed_color_v1' or expand == 1.)
                if check_full:
                    full_safety = {str(exposure): dict(peak_nits=0., finite=True, roundtrip_exact=True)
                                   for exposure in (-6, 0, 6)}
                finish_seconds = 0.
                cap_state = AdjustmentState()
                cap_state.hdr.highlight_compression_target_nits = 1000.
                for top in range(0, sensor.shape[0], 128):
                    selected = slice(top, top + 128)
                    combined = region_blend(neural[selected], normal[selected], weight[selected])
                    blend_sum += float(np.sum(combined, dtype=np.float64))
                    fully_neural = weight[selected] == 0
                    protected = weight[selected] == 1
                    if np.any(fully_neural):
                        outside_max = max(outside_max, float(np.max(np.abs(combined[fully_neural] - neural[selected][fully_neural]))))
                    if np.any(protected):
                        protected_max = max(protected_max, float(np.max(np.abs(combined[protected] - normal[selected][protected]))))
                    if check_full:
                        finish_started = time.perf_counter()
                        for exposure in (-6, 0, 6):
                            factor = np.float32(2 ** exposure)
                            lifted = combined * factor
                            finished = clip_hdr_output_target(lifted, cap_state,
                                                               color_context=RenderColorContext(203))
                            entry = full_safety[str(exposure)]
                            entry['peak_nits'] = max(entry['peak_nits'], float(channel_nits(finished, 203).max()))
                            entry['finite'] &= bool(np.isfinite(finished).all())
                            entry['roundtrip_exact'] &= bool(np.array_equal(lifted / factor, combined))
                        finish_seconds += time.perf_counter() - finish_started
                blend_seconds = time.perf_counter() - started - finish_seconds
                result = dict(method=method, expand_percent=expand, feather=feather,
                              reconstruction=diagnostics, edge=edge_diagnostics,
                              repair_seconds=repair_seconds, ahd_tail_seconds=ahd_tail_seconds,
                              edge_seconds=edge_seconds, support_seconds=support_seconds,
                              ai_first_edge_seconds=ai_first_seconds,
                              weight_seconds=weight_seconds, blend_seconds=blend_seconds,
                              whole_frame_limiter_seconds=finish_seconds, whole_frame_limiter_safety=full_safety,
                              crop_measure_seconds=sample_seconds,
                              incremental_seconds=repair_seconds + ahd_tail_seconds + edge_seconds
                                  + support_seconds + weight_seconds + blend_seconds,
                              protected_fraction=float(np.mean(weight == 1)),
                              fully_neural_fraction=float(np.mean(weight == 0)),
                              reconstruction_changed_fraction=float(np.mean(changed)),
                              wrong_repaired_anchor_relative_shift=reconstructed_anchor / anchor - 1,
                              whole_frame_outside_max_difference=outside_max,
                              whole_frame_protected_max_difference=protected_max,
                              checksum_mean=blend_sum / off.size, crops=observations)
                results.append(result)
                write_json(OUTPUT / f'partial-{name}.json', dict(name=name, shape=list(sensor.shape),
                           provenance=provenance(), clocks=clocks, gain=gain,
                           completed=False, results=results, review_rows=rows))
                print(json.dumps({key: value for key, value in result.items() if key not in ('crops', 'reconstruction', 'edge')}), flush=True)
                del weight
                off, normal, neural = release_pages(off, normal, neural)
            del changed, normal, ai_first
            gc.collect()
    inverse = np.linalg.inv(info.camera_to_acescg).astype(np.float32)
    safe = ratio[::8, ::8] < .5
    off_camera = (off[::8, ::8] @ inverse.T) / info.as_shot_wb
    neural_camera = (neural[::8, ::8] @ inverse.T) / info.as_shot_wb
    safe_denominator = float(np.sum(neural_camera[safe], dtype=np.float64))
    unclipped_anchor_relative_shift = (float(np.sum(off_camera[safe], dtype=np.float64))
        / safe_denominator - 1) if safe_denominator > 0 else None
    shadow = np.max(np.abs(off[::8, ::8]), axis=-1) < .01
    shadow_difference = neural[::8, ::8] - off[::8, ::8]
    clipping['neural_minus_signed_ahd_shadow_mean'] = (
        float(np.mean(shadow_difference[shadow])) if np.any(shadow) else None)
    return dict(name=name, shape=list(sensor.shape), clocks=clocks, gain=gain, anchor=anchor,
                unclipped_anchor_relative_gain_diagnostic=unclipped_anchor_relative_shift,
                sensor_clipping=clipping, results=results, review_rows=rows, peak_rss_bytes=peak_rss())


def real(filename):
    started = time.perf_counter()
    source = photo_root() / filename
    with rawpy.imread(str(source)) as raw:
        info = raw_import._camera_linear_metadata_from_libraw(raw)
        matrix = raw_import._ahd_lab_matrix(raw)
        sensor = raw.raw_image_visible.copy()
        global_white = raw.white_level
        orientation = int(raw.sizes.flip)
    decode_seconds = time.perf_counter() - started
    OUTPUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='ai-highlights-', dir=OUTPUT) as folder:
        record = evaluate_frame(sensor, info, matrix, global_white, Path(filename).stem, folder)
    record.update(provenance=provenance(), source=filename, source_sha256=sha256(source),
                  flip=orientation, decode_seconds=decode_seconds, wall_seconds=time.perf_counter() - started,
                  white_levels=info.raw_white_level.tolist(), global_white=float(global_white),
                  qualification='Native sensor coordinates; no lens/rotation/grade/encoding/live UI. RGB Edge comparator uses the full original sensor clip map, without Opposed.')
    write_json(OUTPUT / f'real-{Path(filename).stem}.json', record)


def synthetic_info():
    from hdr_finisher.raw_import import CameraLinearMetadata
    return CameraLinearMetadata(black_level=np.full(3, 2048.), white_level=np.full(3, 34816.),
        raw_black_level=np.full(4, 2048.), raw_white_level=np.full(4, 34816.),
        raw_pattern=np.array([[0, 1], [3, 2]]), raw_channel_to_rgb=np.array([0, 1, 2, 1]),
        as_shot_wb=np.array([2., 1., 1.5]), camera_to_xyz_d65=np.eye(3), camera_to_acescg=np.eye(3),
        color_description='RGBG', normalization_basis='synthetic', matrix_source='synthetic',
        matrix_reference_white='D65', white_level_source='synthetic', wb_channel_sources=('R', 'G', 'B'))


def synthetic():
    info = synthetic_info()
    results = []
    review_rows = []
    for subject in ('smooth-sky', 'lamp', 'specular-texture', 'signed-shadow'):
        size = 512
        rows, columns = np.indices((size, size), dtype=np.float32)
        radius = np.hypot(rows - 256, columns - 256)
        level = .08 + 1.7 * np.exp(-(radius / (170 if subject == 'smooth-sky' else 55)) ** 2)
        if subject == 'specular-texture':
            level += .07 * np.sin(columns * .8) * np.exp(-(radius / 190) ** 2)
        if subject == 'signed-shadow':
            level = .0003 + .0001 * columns / size
        truth = level[..., None] * np.array([.68, 1., .42], np.float32)
        cfa = info.raw_channel_to_rgb[info.raw_pattern]
        mosaic = np.empty((size, size), np.float32)
        for phase_row in range(2):
            for phase_column in range(2):
                mosaic[phase_row::2, phase_column::2] = truth[phase_row::2, phase_column::2,
                                                                          cfa[phase_row, phase_column]]
        rng = np.random.default_rng(17112026)
        noisy = mosaic + rng.normal(0, np.sqrt(.0004 * np.maximum(mosaic, 0) + .000002))
        sensor = np.rint(np.clip(noisy, -2048 / 32768, 1) * 32768 + 2048).astype(np.uint16)
        clean = np.rint(np.clip(mosaic, 0, 1) * 32768 + 2048).astype(np.uint16)
        with tempfile.TemporaryDirectory(prefix='ai-highlights-synth-', dir=OUTPUT) as folder:
            record = evaluate_frame(sensor, info, np.eye(3, dtype=np.float32), 34816, subject, folder)
        original = camera_develop(sensor, info, np.eye(3, dtype=np.float32))
        anchor = float(original.mean(dtype=np.float64))
        off = to_scene(original, info)
        clean_camera = camera_develop(clean, info, np.eye(3, dtype=np.float32))
        clean_scene = to_scene(clean_camera, info)
        repaired = sensor.copy()
        raw_import._apply_raw_highlight_reconstruction(SimpleNamespace(raw_image_visible=repaired), info, settings())
        repaired_normalized = model_sensor(repaired, info, 34816)
        md = dict(cfa=cfa.tolist(), white_balance=info.as_shot_wb.tolist(),
                  camera_to_acescg=info.camera_to_acescg.tolist())
        adapter = RawNIND('bayer')
        base = adapter.prepare(model_sensor(sensor, info, 34816), md, camera_anchor_mean=anchor)
        scale = max(1., float(repaired_normalized.max()))
        scaled = adapter.prepare(repaired_normalized / np.float32(scale), md,
                                 camera_anchor_mean=anchor / scale)
        scaled.denoised *= np.float32(scale)
        highlight = sensor_clip_ratio(sensor, info) >= 1
        normal = to_scene(camera_develop(repaired, info, np.eye(3, dtype=np.float32)), info)
        outside = protect_weight(sensor_clip_ratio(sensor, info), feather=32) == 0
        normal_error = metrics.display(off * VIEW_CALIBRATION) - metrics.display(clean_scene * VIEW_CALIBRATION)
        neural_error = metrics.display(base.denoised * VIEW_CALIBRATION) - metrics.display(clean_scene * VIEW_CALIBRATION)
        record['synthetic'] = dict(
            headroom_scale=scale,
            repaired_then_clipped_changed_fraction=float(np.mean(np.clip(repaired_normalized, 0, 1)
                != np.clip(model_sensor(sensor, info, 34816), 0, 1))),
            headroom_highlight_delta_e_normal=summary(colour_delta(scaled.denoised, normal), highlight),
            headroom_highlight_delta_e_minus3=summary(colour_delta(scaled.denoised, normal, -3), highlight),
            neural_highlight_delta_e_normal=summary(colour_delta(base.denoised, normal), highlight),
            outside_mse_neural=summary(np.mean(neural_error ** 2, axis=-1), outside),
            outside_mse_ahd=summary(np.mean(normal_error ** 2, axis=-1), outside),
            signed_ahd_mean=float(off.mean()), neural_mean=float(base.denoised.mean()),
            clean_ahd_mean=float(clean_scene.mean()))
        for exposure in (0, -3):
            images = [(label, record_image(f'{subject}-headroom-{index}-{exposure}', image[64:448, 64:448], exposure))
                      for index, (label, image) in enumerate((('Normal Opposed', normal), ('AI only', base.denoised),
                                                              ('Repaired + headroom-scaled AI', scaled.denoised)))]
            record['review_rows'].append(dict(name=f'{subject}: headroom probe, {exposure:+} EV', images=images))
        results.append(record)
        review_rows.extend(record['review_rows'])
        write_json(OUTPUT / f'synthetic-{subject}.json', record)
        print(json.dumps(dict(subject=subject, synthetic=record['synthetic'])), flush=True)
    write_json(OUTPUT / 'synthetic.json', dict(provenance=provenance(), subjects=[item['name'] for item in results]))


def review():
    paths = sorted(OUTPUT.glob('real-*.json')) + sorted(OUTPUT.glob('synthetic-*.json'))
    records = [record for path in paths if 'review_rows' in (record := json.loads(path.read_text()))]
    completed = {record['name'] for record in records}
    records += [record for path in sorted(OUTPUT.glob('partial-*.json'))
                if (record := json.loads(path.read_text()))['name'] not in completed]
    rows = [row for record in records for row in record.get('review_rows', [])]
    sections = []
    for row in rows:
        cells = ''.join(f'<figure><figcaption>{html.escape(title)}</figcaption><img src="{filename}" '
                        f'width="384" height="384" alt="{html.escape(title)}"></figure>'
                        for title, filename in row['images'])
        sections.append(f'<section><h2>{html.escape(row["name"])}</h2><div class="row">{cells}</div></section>')
    page = '''<!doctype html><html><head><meta charset="utf-8"><title>AI and highlights — decision crops</title>
<link rel="stylesheet" href="../../../../frontend/visual-tokens.css"><style>
body{background:var(--app);color:var(--text);font-family:var(--font-body);font-size:var(--font-size-lg);
line-height:var(--line-height-normal)}h1,h2{font-size:var(--font-size-xl);font-weight:var(--font-weight-semibold)}
.row{display:flex;overflow:auto;gap:var(--workspace-leading)}figure{margin:0;flex:none}figcaption{color:var(--body)}
img{display:block;image-rendering:auto}section{margin-block:var(--panel-header-h)}a{color:var(--accent)}
</style></head><body><h1>AI Denoise with highlights — not shipping approval</h1>
<p>Sensor-coordinate crops at 1:1. Scroll sideways. Normal = signed AHD with the selected reconstruction;
AI only deliberately has no reconstruction. Region blend protects the reconstruction and feathers to AI.
The existing fixed −0.8 EV RAW calibration is applied to every photographic view.
Compare normal and −3 EV rows for a brightness ridge, halo, colour step or a change in texture/noise.
White in the mask = normal, black = AI. RGB Edge comparator uses the whole frame but lacks sensor Opposed repair;
do not treat it as the production Edge pipeline. No automatic exposure or white-balance matching.</p>
<p>Both feather widths and Expand 0/1/3% are scored in the JSON; displayed primary is 32px, Expand 0/1%.
The 42 MP Sony run stopped at the memory guard after Opposed; its Edge result is unmeasured.
Saturation is not a guarantee that all channels are noiseless. Synthetic captures have clean AHD truth;
real-photo highpass measurements mix texture and noise. Visual sign-off is Steve's, not a metric pass.</p>
''' + ''.join(sections) + '</body></html>'
    REVIEW.mkdir(parents=True, exist_ok=True)
    (REVIEW / 'index.html').write_text(page)
    write_json(REVIEW / 'manifest.json', dict(records=[record['name'] for record in records], rows=rows))
    referenced = {filename for row in rows for title, filename in row['images']}
    for filename in referenced:
        if not (REVIEW / filename).is_file():
            raise ValueError(f'Missing decision crop {filename}')
    print(json.dumps(dict(rows=len(rows), images=len(referenced),
                          bytes=sum((REVIEW / filename).stat().st_size for filename in referenced))), flush=True)


def main():
    def interrupted(signum, frame):
        raise SystemExit(128 + signum)

    signal.signal(signal.SIGTERM, interrupted)
    parser = argparse.ArgumentParser()
    parser.add_argument('--phase', required=True, choices=('survey', 'real', 'synthetic', 'review'))
    parser.add_argument('--photo', choices=PHOTOS)
    args = parser.parse_args()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    if args.phase == 'survey':
        inspect_real()
    elif args.phase == 'real':
        if not args.photo:
            parser.error('--photo required for native real phase')
        real(args.photo)
    elif args.phase == 'synthetic':
        synthetic()
    else:
        review()


if __name__ == '__main__':
    main()
