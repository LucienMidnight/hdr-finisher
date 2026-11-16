"""Select current controls by mean full-set SDR PSNR, with a sharp alternative.

In-sample, not held-out validation. MTF50 constrained to >=0.90 on each ISO's
slanted edge. The grid includes untouched off as a feasible safety choice.
"""
import os
for variable in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'VECLIB_MAXIMUM_THREADS', 'HDR_CPU_THREADS'):
    os.environ[variable] = '1'
import itertools
import json
from pathlib import Path
import time
import numpy as np
from hdr_finisher.denoise_adaptive import AdaptiveControls, estimate_adaptive_model, resolve_adaptive
from tools.denoise_eval.inputs import inventory, synthetic_samples
from tools.denoise_eval import metrics

OUTPUT = Path(__file__).resolve().parents[3]/'output/denoise-v1'


def main():
    start = time.perf_counter()
    grid = [dict(amount=amount, detail_recovery=detail, luminance=luma, color_noise=chroma)
            for amount, detail, luma, chroma in itertools.product((.125, .25, .5, .75, 1.), (.25, .5, .75, 1.), (.5, .75), (.5, .75))]
    grid.append(dict(amount=0., detail_recovery=.5, luminance=.5, color_noise=.5))
    scores = {str(iso):[dict(controls=controls, psnr=[], mtf50_ratio=None) for controls in grid] for iso in (1600, 6400, 25600)}
    for sample in synthetic_samples(inventory(), False):
        print(sample.name, flush=True)
        model = estimate_adaptive_model(sample.rgb, workers=1)
        truth = metrics.display(sample.clean)
        clean_mtf = metrics.mtf50(sample.clean) if 'slanted-edge' in sample.name else None
        for row in scores[str(sample.metadata['iso'])]:
            output = resolve_adaptive(sample.rgb, model, AdaptiveControls(**row['controls']))
            row['psnr'].append(metrics.psnr(metrics.display(output), truth))
            if clean_mtf:
                row['mtf50_ratio'] = metrics.mtf50(output)/clean_mtf
    selected = {}
    for iso, rows in scores.items():
        for row in rows:
            row['sdr_psnr_db'] = float(np.mean(row['psnr']))
        best = max(rows, key=lambda row: row['sdr_psnr_db'])
        sharp = max((row for row in rows if row['mtf50_ratio'] is not None and row['mtf50_ratio'] >= .9), key=lambda row: row['sdr_psnr_db'])
        selected[iso] = {name:{key:row[key] for key in ('controls', 'sdr_psnr_db', 'mtf50_ratio')} for name, row in [('psnr', best), ('sharp', sharp)]}
    result = dict(grid=grid, scores=scores, selected=selected, elapsed_seconds=time.perf_counter()-start,
                  criterion='arithmetic mean SDR PSNR across nine scenes per ISO, in-sample tuning',
                  sharp_constraint='slanted-edge MTF50 ratio >=0.90')
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT/'classical-tuning.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(selected, indent=2))


if __name__ == '__main__':
    main()
