"""Build the fixed November 16 visual decision set, without tuning or timing.

From codebase, under gpu-run-lock.py and candidates/guard.py, run:
    .venv/bin/python -m tools.denoise_eval.decision_crops --inventory RESULTS.json

RESULTS.json is the existing harness receipt containing its measured inventory
(a previous decision manifest also works); noise fits are reused, never remeasured.
The approved prepared public pairs and
verified Bayer checkpoint must already be in the usual output locations.

Selections are fixed native coordinates, not chosen by candidate scores. Public
flat/shadow/foliage use held-out Vaxt ISO6400; Pen-pile ISO3200 deliberately keeps
both printed digits and the fine dot pattern that neural methods can change.
The Canon windows keep the outer flame edge (not its clipped core) and shadow;
Sony windows keep sign lettering (not LEDs) and smooth wall. Synthetic windows
are inset crops of the unchanged full-set 512px fabric/fine-text scenes.
Adapters see the whole 512/640px context before the final 288px crop. Display
exposure is fixed per case, shared by all columns, never fitted to an output.
This is a bounded-context comparison, not whole-frame denoising qualification.
"""
from __future__ import annotations

import os

for variable in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS',
                 'VECLIB_MAXIMUM_THREADS', 'HDR_CPU_THREADS'):
    os.environ[variable] = '1'

import argparse
import gc
import hashlib
import json
from pathlib import Path
import subprocess

import colour
import cv2
import numpy as np
from PIL import Image, PngImagePlugin
import rawpy

from tools.denoise_eval import metrics
from tools.denoise_eval.adapters import load_adapter
from tools.denoise_eval.candidates.rawnind import HASHES, MODEL_ROOT
from tools.denoise_eval.inputs import (
    Sample, develop, masks_for, metadata_from_raw, normalise_crop,
    paired_samples, synthetic_samples,
)
from tools.denoise_eval.run import peak_rss
from tools.lib.test_photos import photo_root

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / 'output/denoise-v1/decision'
PREFIX = 'tools.denoise_eval.candidates.'
COLUMNS = (
    ('off', 'off'),
    ('denoise_v2', 'denoise_v2'),
    ('denoise_v2_app', PREFIX + 'denoise_v2_appdefault:factory'),
    ('speck_cleanup', PREFIX + 'speck_cleanup:factory'),
    ('denoise_v2_tuned', PREFIX + 'denoise_v2_tuned:factory'),
    ('pilot_wiener_bayer_both', PREFIX + 'pilot_wiener:bayer_both'),
    ('rawnind_bayer', PREFIX + 'rawnind:bayer'),
)
PUBLIC = (
    ('heldout-smooth', 'Held-out pair, ISO 6400, smooth background',
     'TEST_Vaxt-i-trad-0aa84691-0', (112, 112), 0.),
    ('heldout-foliage', 'Held-out pair, ISO 6400, fine leaf texture',
     'TEST_Vaxt-i-trad-0aa84691-3', (112, 112), 0.),
    ('heldout-print-dots', 'Held-out pair, ISO 3200, printed digits and fine dots',
     'TEST_Pen-pile-a3221270-2', (158, 66), 0.),
    ('heldout-shadow', 'Held-out pair, ISO 6400, deep background shadow',
     'TEST_Vaxt-i-trad-0aa84691-1', (112, 112), 2.),
)
NATIVE = (
    ('canon-flame-edge', 'Private RAW, ISO 3200, outer flame edge',
     'IMG_0790.CR2', (2840, 0), (232, 66), 0.),
    ('canon-flame-edge-lifted', 'Private RAW, ISO 3200, outer flame edge +4 stops',
     'IMG_0790.CR2', (2840, 0), (232, 66), 4.),
    ('canon-dark-shadow', 'Private RAW, ISO 3200, dark shadow',
     'IMG_0790.CR2', (4000, 2100), (176, 176), 4.),
    ('sony-sign-lettering', 'Private RAW, ISO 4000, lit sign lettering',
     '2025_0730_1331_3.arw', (4600, 3700), (176, 176), 1.),
    ('sony-flat-wall', 'Private RAW, ISO 4000, smooth wall',
     '2025_0730_1331_3.arw', (3700, 1000), (176, 176), 3.),
)


def cases(entries):
    wanted = {name: (case_id, title, offset, lift)
              for case_id, title, name, offset, lift in PUBLIC}
    found = {}
    for sample in paired_samples(ROOT / 'output/denoise-v1/datasets/rawnind/pairs'):
        name = sample.name.removeprefix('pair-')
        if name not in wanted:
            continue
        if not sample.metadata['held_out']:
            raise ValueError('Decision pair must be held out from RawNIND training')
        found[name] = sample
    if found.keys() != wanted.keys():
        raise ValueError(f'Missing prepared pairs: {wanted.keys() - found.keys()}')
    for case_id, title, name, offset, lift in PUBLIC:
        sample = found.pop(name)
        yield case_id, title, sample, offset, lift, 'CC0-1.0; ' + sample.metadata['scene_id']
    for case_id, title, filename, origin, offset, lift in NATIVE:
        entry = next(item for item in entries if item['file'] == filename)
        with rawpy.imread(str(photo_root() / filename)) as raw:
            metadata = metadata_from_raw(raw, entry)
            left, top = origin
            mosaic = normalise_crop(raw, top, left, 640)
        metadata['crop'] = [top, left, 640, 640]
        rgb = develop(mosaic, metadata)
        sample = Sample(case_id, rgb, mosaic, metadata, None, masks_for(rgb))
        yield case_id, title, sample, offset, lift, 'Private test image; not licensed for redistribution'
    for sample in synthetic_samples(entries, False):
        if sample.name not in ('synthetic-fabric-iso25600', 'synthetic-fine-text-iso25600'):
            continue
        name = sample.metadata['generated']
        offset = (66, 112) if name == 'fine-text' else (112, 112)
        yield ('synthetic-' + name, 'Synthetic ISO 25600, ' + name.replace('-', ' '),
               sample, offset, 0., 'Deterministic repository harness scene; GPL-3.0')
        if name == 'fabric':
            break


def pixels(image):
    return np.uint8(np.rint(np.clip(metrics.display(image), 0, 1) * 255))


def save_png(image, path):
    profile = PngImagePlugin.PngInfo()
    profile.add(b'sRGB', b'\x00')
    Image.fromarray(image).save(path, pnginfo=profile, optimize=True)


def scores(image, clean, valid):
    actual, reference = image.astype(np.float64) / 255, clean.astype(np.float64) / 255
    actual_lab = colour.XYZ_to_Lab(colour.sRGB_to_XYZ(actual))
    reference_lab = colour.XYZ_to_Lab(colour.sRGB_to_XYZ(reference))
    difference = colour.delta_E(actual_lab, reference_lab, method='CIE 2000')
    return dict(sdr_psnr_db=metrics.psnr(actual, reference, valid),
                delta_e2000_mean=float(np.mean(difference[valid])))


def render_case(folder, sample, offset, lift, size):
    left, top = offset
    region = np.s_[top:top + size, left:left + size]
    if min(left, top, sample.rgb.shape[0] - top - size,
           sample.rgb.shape[1] - left - size) < 66:
        raise ValueError('Decision crop must retain at least 66px processing context')
    metadata = dict(sample.metadata, exposure_stops=lift)
    rgb = sample.rgb * np.float32(2 ** lift)
    clean = pixels(sample.clean[region] * np.float32(2 ** lift)) if sample.clean is not None else None
    valid = sample.masks.get('valid', np.ones(sample.rgb.shape[:2], dtype=bool))[region]
    if clean is not None and not valid.any():
        raise ValueError('Clean-reference crop has no valid scoring pixels')
    rows = []
    for column, adapter_name in COLUMNS:
        adapter = load_adapter(adapter_name)
        source = sample.bayer if adapter.input_kind == 'bayer' else rgb
        state = adapter.prepare(source, metadata)
        output = adapter.process(source, metadata, state)
        if output.shape != rgb.shape or not np.isfinite(output).all():
            raise ValueError(f'Invalid output from {adapter_name}')
        encoded = pixels(output[region])
        save_png(encoded, folder / f'{column}.png')
        rows.append(dict(column=column, adapter=adapter_name,
                         settings=adapter.description(),
                         metrics_vs_clean=scores(encoded, clean, valid) if clean is not None else None,
                         shadow_tails_sdr_lift4=metrics.shadow_tails(
                             output[region], rgb[region],
                             sample.clean[region]*np.float32(2**lift) if sample.clean is not None else None,
                             {'valid': valid}, source_exposure_stops=lift)))
        del adapter, state, output, encoded
        gc.collect()
        if peak_rss() > 2_500_000_000:
            raise MemoryError('Decision generator exceeded 2.5 GB peak RSS')
    if clean is not None:
        save_png(clean, folder / 'clean.png')
        rows.append(dict(column='clean', adapter=None, metrics_vs_clean=scores(clean, clean, valid)))
    return rows, int(valid.sum())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inventory', type=Path, required=True)
    parser.add_argument('--size', type=int, choices=(256, 288), default=288)
    args = parser.parse_args()
    cv2.setNumThreads(1)
    inventory_bytes = args.inventory.read_bytes()
    entries = json.loads(inventory_bytes)['inventory']
    model_hash = hashlib.sha256((MODEL_ROOT / 'model_bayer.onnx').read_bytes()).hexdigest()
    if model_hash != HASHES['bayer']:
        raise ValueError('RawNIND model SHA-256 mismatch')
    OUTPUT.mkdir(parents=True, exist_ok=True)
    manifest_path = OUTPUT / 'manifest.json'
    manifest_path.unlink(missing_ok=True)
    manifest = dict(
        schema_version=1,
        generator='tools.denoise_eval.decision_crops',
        git_head=subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
        inventory_source=str(args.inventory.resolve()),
        inventory_sha256=hashlib.sha256(inventory_bytes).hexdigest(),
        inventory=entries,
        model_sha256=model_hash,
        column_order=[column for column, _ in COLUMNS] + ['clean'],
        transform='Harness metrics.display SDR: clip linear sRGB 0..1, sRGB OETF, round to 8-bit; sRGB PNG chunk',
        exposure_policy='Fixed per-case stops, applied identically before each adapter and to clean; no auto exposure',
        sampling='1 native sensor/developed pixel per PNG pixel; no resizing, sharpening or orientation transform',
        scoring='Saved 8-bit sRGB pixels; shared inherited valid mask; PSNR null means exact equality (+infinity)',
        limitations=[
            '512/640px context, not full-frame adaptive estimates or whole-frame qualification.',
            'Public clean references retain inherited ISO100 noise, registration and per-capture gain limitations.',
            'Public metrics exclude inherited clipping/support/registration masks; PNGs show all crop pixels.',
            'Decision shadow-tail scores use the fixed ROI and valid support, without the general harness automatic-flat mask; no-truth scores are contrast proxies.',
            'Print/dots deliberately exposes the reported neural-sensitive structure, not an exhaustive worst-case ranking.',
            'Synthetic ISO25600 reuses extrapolated harness noise, not a laboratory-calibrated real ISO25600 capture.',
        ], cases=[],
    )
    for case_id, title, sample, offset, lift, licence in cases(entries):
        print(f'Rendering {case_id}', flush=True)
        folder = OUTPUT / case_id
        folder.mkdir(exist_ok=True)
        rows, valid_count = render_case(folder, sample, offset, lift, args.size)
        crop = sample.metadata.get('crop', [0, 0, *sample.rgb.shape[:2]])
        top, left, height, width = crop
        generated = sample.metadata.get('generated')
        source = ('tools/denoise_eval/inputs.py:targets/' + generated if generated else
                  sample.metadata.get('file', sample.metadata.get('source', sample.name)))
        manifest['cases'].append(dict(
            id=case_id, title=title, source_file=source,
            source_path=str((ROOT / 'output/denoise-v1/datasets/rawnind' / source).resolve())
            if sample.metadata.get('held_out') else
            (str(photo_root() / source) if case_id.startswith(('canon-', 'sony-')) else
             str(ROOT / 'tools/denoise_eval/inputs.py')),
            licence=licence, iso=sample.metadata['iso'], exposure_lift_stops=lift,
            crop_rectangle=dict(x=left + offset[0], y=top + offset[1], width=args.size, height=args.size),
            context_rectangle=dict(x=left, y=top, width=width, height=height),
            crop_offset_xy=list(offset), columns_present=[row['column'] for row in rows],
            clean_reference=sample.metadata.get('clean_source', 'AHD-developed clean harness mosaic')
            if sample.clean is not None else None,
            valid_scoring_pixels=valid_count if sample.clean is not None else None,
            valid_scoring_fraction=valid_count / args.size ** 2 if sample.clean is not None else None,
            input_metadata=sample.metadata, columns=rows,
        ))
        del sample
        gc.collect()
    if len(manifest['cases']) != 10:
        raise ValueError('Expected exactly ten decision cases')
    manifest['peak_rss_bytes'] = peak_rss()
    manifest_path.write_text(json.dumps(manifest, indent=2, allow_nan=False) + '\n')
    total = sum(path.stat().st_size for path in OUTPUT.rglob('*') if path.is_file())
    if total > 13_000_000:
        manifest_path.unlink()
        raise ValueError(f'Decision set is {total} bytes; rerun with --size 256 (no resizing)')
    print(f'{OUTPUT}: {total} bytes; peak RSS {peak_rss()} bytes', flush=True)


if __name__ == '__main__':
    main()
