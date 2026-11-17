"""Reuse the bounded early-outlier harness for the requested scope addition."""
from __future__ import annotations

import argparse
import hashlib
from html import escape
import json
import math
from pathlib import Path

from tools.denoise_eval.candidates import early_outlier_measure as base
from tools.denoise_eval.candidates import early_uniformity as trial

import cv2
import numpy as np

VARIANTS = ('raw_sigma2', 'raw_sigma2_5', 'raw_sigma3', 'raw_sigma4',
            'grain_only', 'grain_sigma2_5', 'grain_sigma4')
OUTPUT = base.OUTPUT / 'threshold-grain'
BASE_STAMP = base.stamp


def stamp(args):
    result = BASE_STAMP(args)
    for path in (Path(__file__), Path(trial.__file__)):
        result['code_sha256'][str(path.relative_to(base.ROOT))] = hashlib.sha256(path.read_bytes()).hexdigest()
    result['variants'] = {name: getattr(trial, name)().description() for name in VARIANTS}
    return result


def methods(include_ai=True):
    selected = dict(off=base.Off(), denoise=base.calibrated())
    selected.update({name: getattr(trial, name)() for name in VARIANTS})
    if include_ai:
        selected['rawnind_bayer'] = base.neural()
    return selected


def grain_statistics(image, reference, lift=0, valid=None):
    source_luma = reference @ np.array([.2722287, .6740818, .0536895])
    smooth = cv2.GaussianBlur(source_luma.astype('float32'), (0, 0), 2)
    support = cv2.erode((smooth < .02).astype('uint8'), np.ones((5, 5), 'uint8')).astype(bool)
    if valid is not None:
        support &= valid
    support[:8] = support[-8:] = False
    support[:, :8] = support[:, -8:] = False
    shown = base.metrics.luma_chroma(base.metrics.display(image * np.float32(2 ** lift)))
    residual = shown - cv2.GaussianBlur(shown, (0, 0), 1.)
    block_rms = []
    for top in range(8, support.shape[0] - 16, 16):
        for left in range(8, support.shape[1] - 16, 16):
            region = np.s_[top:top+16, left:left+16]
            if np.mean(support[region]) >= .9:
                block_rms.append(float(np.std(residual[region][..., 0][support[region]])))
    if not support.any():
        return dict(support_pixels=0)
    luma = residual[..., 0][support]
    return dict(support_pixels=int(support.sum()), luma_std=float(np.std(luma)),
                chroma_rms=float(np.sqrt(np.mean(residual[..., 1:][support] ** 2))),
                luma_tail_to_rms=float(np.percentile(abs(luma), 99.9) / max(np.std(luma), 1e-12)),
                block_rms_cv=float(np.std(block_rms) / max(np.mean(block_rms), 1e-12)) if block_rms else None,
                blocks=len(block_rms), support='Fixed clean (when available), otherwise signed Off, sigma2 luma < .02; inherited valid mask')


def grain_review(args, entries):
    result = dict(cases=[], **base.stamp(args))
    samples = list(base.decision_crops.cases(entries))
    paired = (sample for sample in base.inputs.paired_samples(base.ROOT / 'output/denoise-v1/datasets/rawnind/pairs')
              if sample.metadata['held_out'])
    for index, sample in enumerate(paired):
        if index == 3:
            break
        samples.append(('heldout-grain-' + str(index), sample.name, sample, (112, 112), 4, 'CC0-1.0; held-out'))
    for case_id, title, original, offset, lift, licence in samples:
        sample = base.signed_sample(original)
        reference = sample.clean if sample.clean is not None else sample.rgb
        record = dict(id=case_id, title=title, lift=lift, licence=licence, methods={})
        folder = OUTPUT / 'grain' / case_id
        folder.mkdir(parents=True, exist_ok=True)
        left, top = offset
        region = np.s_[top:top+288, left:left+288]
        valid = sample.masks['valid'][region] if 'valid' in sample.masks else None
        for name, adapter in methods(not args.no_ai).items():
            source = sample.bayer if adapter.input_kind == 'bayer' else sample.rgb
            output = adapter.process(source, sample.metadata, adapter.prepare(source, sample.metadata))
            record['methods'][name] = grain_statistics(output[region], reference[region], lift, valid)
            base.decision_crops.save_png(base.decision_crops.pixels(output[region] * 2 ** lift), folder / (name + '.png'))
        if sample.clean is not None:
            record['methods']['clean'] = grain_statistics(reference[region], reference[region], lift, valid)
            base.decision_crops.save_png(base.decision_crops.pixels(reference[region] * 2 ** lift), folder / 'clean.png')
        result['cases'].append(record)
        print('grain', case_id, flush=True)
        base.write(OUTPUT / 'grain/manifest.json', result)


def gaussian(args):
    noise = np.random.default_rng(170011).normal(0, .01, (768, 768)).astype('float32')
    records = []
    for value in (2., 2.5, 3., 4.):
        adapter = trial.threshold(value)
        output, counts = base.trial.tame_plane(noise, 0, .0001, adapter.controls)
        plain, plain_counts = base.trial.tame_plane(noise, 0, .0001, base.replace(adapter.controls, support=False))
        records.append(dict(threshold=value, ideal_gaussian_two_tailed_fraction=math.erfc(value/math.sqrt(2)),
            known_mean_observed_fraction=float(np.mean(abs(noise) > value * .01)),
            candidate_fraction=counts['candidates']/noise.size, changed_fraction=counts['changed']/noise.size,
            no_support_changed_fraction=plain_counts['changed']/noise.size,
            input_std=float(np.std(noise)), output_std=float(np.std(output)), no_support_std=float(np.std(plain))))
    base.write(OUTPUT / 'gaussian.json', dict(cases=records, **base.stamp(args)))


def review(args):
    columns = ['off', 'denoise', *VARIANTS] + ([] if args.no_ai else ['rawnind_bayer'])
    sections = []
    for kind in ('gallery', 'decision', 'grain'):
        manifest = OUTPUT / kind / 'manifest.json'
        if not manifest.exists():
            continue
        names = columns + (['clean'] if kind != 'gallery' else [])
        rows = []
        for row in json.loads(manifest.read_text())['cases']:
            cells = []
            for name in names:
                prefix = kind + '/' + row['id'] + '/' + name
                image = OUTPUT / (prefix + '.png')
                content = '<img loading="lazy" width="288" src="' + prefix + '.png">' if image.exists() else 'No clean truth'
                if kind == 'gallery' and image.exists():
                    content += '<img loading="lazy" width="288" src="' + prefix + '-zoom.png">'
                cells.append('<td>' + content + '</td>')
            rows.append('<tr><th>' + escape(row['title']) + '</th>' + ''.join(cells) + '</tr>')
        sections.append('<h2>' + kind.title() + '</h2><table><tr><th>Fixed case</th>' +
            ''.join('<th>' + name + '</th>' for name in names) + '</tr>' + ''.join(rows) + '</table>')
    stars = OUTPUT / 'stars.json'
    if stars.exists():
        rows = []
        for row in json.loads(stars.read_text())['cases']:
            suffix = '-noisy' if row['noisy'] else '-clean'
            names = ['clean'] + ['denoise', *VARIANTS]
            rows.append('<tr><th>FWHM ' + str(round(row['fwhm'], 2)) + ' px; ' + str(row['noisy']) + ' noisy</th>' + ''.join(
                '<td>' + name + '<img loading="lazy" width="192" src="stars/' + str(row['sigma']) + '/' + name +
                ('' if name == 'clean' else suffix) + '.png"></td>' for name in names) + '</tr>')
        sections.append('<h2>Realistic glowing star safeguards</h2><table>' + ''.join(rows) + '</table>')
    html = ('<!doctype html><meta charset="utf-8"><title>Threshold and uniform-grain review</title>'
        '<link rel="stylesheet" href="../../../../frontend/visual-tokens.css"><style>'
        'body{background:var(--app);color:var(--body);font-family:var(--font-body)}'
        'td,th{vertical-align:top;text-align:left;padding:var(--group-disclosure-gap)}'
        'img{display:block;image-rendering:pixelated}a{color:var(--accent)}'
        'tr:first-child{position:sticky;top:0;background:var(--app)}</style>'
        '<h1>Threshold and uniform-grain research</h1><p>Both signs, strength .75, envelope 1.5σ, '
        'maximum 5 same-colour samples, support on. Only threshold changes across raw_sigma2 / 2_5 / 3 / 4. '
        'Grain variants: Amount .75, Luminance .25, Color Noise 1, Detail .5, all sizes .5. '
        'grain_only isolates the Denoise control change without clamping. No grain is added. '
        'Exactly the original 6× gallery zooms. Native crops first, pixel zooms below. '
        '<a href="../index.html">Main stage/support/size review</a>.</p>' + ''.join(sections))
    (OUTPUT / 'index.html').write_text(html)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--inventory', type=Path, required=True)
    parser.add_argument('--gallery', type=Path)
    parser.add_argument('--phase', choices=('quick', 'gallery', 'decision', 'stars', 'clean-safety',
                                           'heldout', 'seen', 'full', 'grain', 'gaussian', 'review'), required=True)
    parser.add_argument('--no-ai', action='store_true')
    args = parser.parse_args()
    args.best = 'raw_sigma2_5'
    base.OUTPUT, base.VARIANTS, base.methods, base.review, base.stamp = OUTPUT, VARIANTS, methods, review, stamp
    cv2.setNumThreads(1)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    entries = json.loads(args.inventory.read_text())['inventory']
    if args.phase in ('quick', 'full', 'heldout', 'seen'):
        base.quality(args, entries)
    elif args.phase == 'gallery':
        if args.gallery is None:
            parser.error('Gallery phase requires original coordinates')
        base.gallery(args)
    elif args.phase == 'decision':
        base.decisions(args, entries)
    elif args.phase == 'stars':
        base.star_safety(args, entries)
    elif args.phase == 'clean-safety':
        base.clean_safety(args, entries)
    elif args.phase == 'grain':
        grain_review(args, entries)
    elif args.phase == 'gaussian':
        gaussian(args)
    review(args)


if __name__ == '__main__':
    main()
