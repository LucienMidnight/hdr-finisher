"""Add the previously frozen actual green-leaf reference, never score-select it.

Run under the same machine lock/guard as chroma_measure, with --inventory.
The automatic first Vaxt texture crop is bark/fungi; retain it and add leaves.
"""
from tools.denoise_eval.candidates import chroma_measure as base
import argparse
import hashlib
import json
from pathlib import Path
import cv2
import numpy as np


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--inventory',type=Path,required=True)
    args=parser.parse_args();cv2.setNumThreads(1)
    pairs=base.ROOT/'output/denoise-v1/datasets/rawnind/pairs'
    name='pair-TEST_Vaxt-i-trad-0aa84691-3'
    original=next(sample for sample in base.base.inputs.paired_samples(pairs) if sample.name==name)
    md=dict(original.metadata)
    manifest=json.loads((base.ROOT/'tools/denoise_eval/datasets/rawnind-manifest.json').read_text())['files']
    clean_iso=next(row['iso'] for row in manifest if row['file']==md['clean_source'])
    ratio=float(clean_iso)/md['iso']
    md['noise_parameters']=[dict(a=a*ratio,b=b*ratio*ratio) for a,b in base.trial.noise_positions(md)]
    md.update(iso=clean_iso,clean_noise_model_qualification='ISO-scaled provisional sensor fit; not clean camera calibration')
    sensor=original.clean_bayer
    reference=base.develop_signed(sensor,md)
    valid=original.masks['valid']
    feature=(np.ptp(base.base.metrics.display(reference),axis=-1)>.1)&valid
    folder=base.OUTPUT/'review/clean/lowiso-green-foliage';folder.mkdir(exist_ok=True)
    record=dict(id='lowiso-green-foliage',title='Actual green foliage, ISO100 reference, frozen decision crop',
        metadata=md,source_pair=name,methods={},feature_pixels=int(feature.sum()),
        selection='Pre-existing decision_crops.PUBLIC heldout-foliage; chosen by subject, not candidate score',
        **base.stamp(args))
    record['code_sha256'][str(Path(__file__).relative_to(base.ROOT))]=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    record['pairs_manifest_sha256']=hashlib.sha256((pairs/'pairs.json').read_bytes()).hexdigest()
    baseline=None
    for method,adapter in base.methods().items():
        source=sensor if adapter.input_kind=='bayer' else reference
        state=adapter.prepare(source,md);output=adapter.process(source,md,state)
        if not np.isfinite(output).all():raise ValueError('Nonfinite foliage output')
        if method=='taming':baseline=output.copy()
        if method in base.REVIEW:base.save(output,folder/(method+'.png'),288)
        retention=None
        if baseline is not None and feature.any():
            q=base.base.metrics.display(output)@base.trial.GM
            ref=base.base.metrics.display(baseline)@base.trial.GM
            retention=base.base.metrics.ratio(float(np.sum(abs(q[feature]))),float(np.sum(abs(ref[feature]))))
        record['methods'][method]=dict(error=base.comparison(output,reference,valid),
            feature_error=base.comparison(output,reference,feature),feature_gm_retention_vs_taming=retention,
            incremental_vs_taming=base.comparison(output,baseline,valid) if baseline is not None else None,
            diagnostics=state[2] if isinstance(adapter,base.trial.ChromaCleanup) else None)
    base.save(reference,folder/'clean.png',288)
    path=base.OUTPUT/'review/clean/manifest.json'
    receipt=json.loads(path.read_text())
    receipt['cases']=[row for row in receipt['cases'] if row['id']!=record['id']]+[record]
    base.base.write(path,receipt)
    base.base.write(base.OUTPUT/'foliage.json',record)
    base.review(args)


if __name__=='__main__':main()
