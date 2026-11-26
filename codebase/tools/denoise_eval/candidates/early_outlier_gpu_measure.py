"""Bounded common-downstream CPU/WebGPU clamp agreement, not app qualification."""
from __future__ import annotations

import argparse
from dataclasses import asdict
import hashlib
import json
from pathlib import Path

from tools.denoise_eval.candidates import early_outlier_measure as base

import numpy as np
import rawpy

OUTPUT = base.OUTPUT


def fixtures(args):
    cases = []
    controls = (base.trial.Controls(), base.trial.Controls(threshold=4., envelope=2.5, max_area=1),
                base.trial.Controls(threshold=4., envelope=2.5, max_area=2),
                base.trial.Controls(threshold=2., support=False))
    generator = np.random.default_rng(170011)
    for index, pattern in enumerate(([[0,1],[1,2]], [[2,1],[1,0]], [[1,0],[2,1]], [[1,2],[0,1]])):
        sensor = generator.normal(.005, .01, (96,96)).astype('float32')
        sensor[30,30:33:2], sensor[60,60] = -.15, .2
        sensor[45,45], sensor[45,47] = 1.1, .3
        metadata = dict(cfa=pattern, white_balance=[1,1,1], camera_to_acescg=np.eye(3).tolist(),
                        noise_parameters=[dict(a=0.,b=.0001)]*4)
        for setting in controls:
            cases.append(dict(name='generated-'+str(index)+'-'+str(len(cases)), shape=list(sensor.shape),
                samples=sensor.ravel().tolist(), metadata=metadata, controls=asdict(setting),
                noise=base.trial.noise_positions(metadata).tolist()))
    manifest = json.loads((OUTPUT / 'gallery/manifest.json').read_text())
    selected = ('IMG_0790-1','7D-1_ISO12800-1','Blombukett_ISO6400-1','MuseeL-Saint-Pierre-C500D_ISO3200-2')
    real = [row for row in manifest['cases'] if row['id'] in selected]
    if len(real) != 4:
        raise ValueError('Missing fixed real GPU coverage')
    for row in real:
        with rawpy.imread(row['source_path']) as raw:
            left,top = row['sensor_xy']
            sensor = base.inputs.normalise_crop(raw,top+112,left+112,256)
        for setting in controls[:3]:
            cases.append(dict(name=row['id']+'-'+str(len(cases)), shape=list(sensor.shape),
                samples=sensor.ravel().tolist(), metadata=row['metadata'], controls=asdict(setting),
                noise=base.trial.noise_positions(row['metadata']).tolist()))
    base.write(OUTPUT / 'gpu-input.json',dict(cases=cases, **base.stamp(args)))


def compare(args):
    source = json.loads((OUTPUT / 'gpu-input.json').read_text())
    gpu = json.loads((OUTPUT / 'gpu-output.json').read_text())
    outputs = {row['name']:row for row in gpu['cases']}
    records = []
    for fixture in source['cases']:
        sensor = np.array(fixture['samples'],np.float32).reshape(fixture['shape'])
        actual = np.array(outputs[fixture['name']]['samples'],np.float32).reshape(sensor.shape)
        controls = base.trial.Controls(**fixture['controls'])
        expected = sensor.copy()
        for phase, (shot,read) in enumerate(fixture['noise']):
            row,column = divmod(phase,2)
            expected[row::2,column::2] = base.trial.tame_plane(sensor[row::2,column::2],shot,read,controls)[0]
        if not np.isfinite(actual).all():
            raise ValueError('Invalid GPU output; CPU fallback required')
        valid = np.zeros(sensor.shape,bool)
        valid[24:-24,24:-24] = True
        for stops in (-6,0,6):
            metadata = dict(fixture['metadata'],exposure_stops=stops)
            cpu_rgb = base.develop_signed(expected,metadata)
            gpu_rgb = base.develop_signed(actual,metadata)
            current = base.calibrated()
            cpu_output = current.process(cpu_rgb,metadata,current.prepare(cpu_rgb,metadata))
            gpu_output = current.process(gpu_rgb,metadata,current.prepare(gpu_rgb,metadata))
            record = dict(name=fixture['name'],stops=stops,controls=fixture['controls'],
                raw_abs_max=float(np.max(abs(actual-expected))),
                development=base.comparison(gpu_rgb,cpu_rgb,valid),
                denoise=base.comparison(gpu_output,cpu_output,valid))
            record['pass'] = all(record[stage][lane]['mean'] < 1 and record[stage][lane]['p99'] < 3
                                 for stage in ('development','denoise') for lane in ('sdr','hdr'))
            records.append(record)
    provenance = base.stamp(args)
    for path in (Path(__file__),Path(__file__).with_name('early_outlier_gpu.cjs')):
        provenance['code_sha256'][str(path.relative_to(base.ROOT))] = hashlib.sha256(path.read_bytes()).hexdigest()
    base.write(OUTPUT / 'gpu-compare.json',dict(cases=records,adapter=gpu.get('adapter'),
        all_pass=all(row['pass'] for row in records),
        qualification='Clamp kernel only, common CPU signed AHD and Denoise; not production GPU RAW/highlight delivery',
        **provenance))
    if not all(row['pass'] for row in records):
        raise ValueError('Finished-pixel agreement failed; CPU fallback required')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--inventory',type=Path,required=True)
    parser.add_argument('--phase',choices=('fixtures','compare'),required=True)
    args = parser.parse_args()
    base.cv2.setNumThreads(1)
    (fixtures if args.phase == 'fixtures' else compare)(args)


if __name__ == '__main__':
    main()
