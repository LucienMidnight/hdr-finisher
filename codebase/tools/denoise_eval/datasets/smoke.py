"""One 96px pair interface check per available candidate; no quality evaluation."""
import os
for variable in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'VECLIB_MAXIMUM_THREADS', 'HDR_CPU_THREADS'):
    os.environ[variable] = '1'
import argparse
import json
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
import numpy as np
from tools.denoise_eval.inputs import paired_samples
from tools.denoise_eval.candidates import darktable_profiled, galosh, rawnind
from tools.denoise_eval.candidates.build_galosh import BINARY


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pairs', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    sample = next(paired_samples(args.pairs))
    source_slice = np.s_[208:304, 208:304]
    if min(sample.rgb.shape[:2]) < 304:
        raise ValueError('Interface smoke expects a prepared 512px pair')
    entries = [('darktable_profiled', darktable_profiled.factory(), None),
               ('galosh', galosh.factory(), None if BINARY.is_file() else 'native binary absent')]
    neural = rawnind.bayer()
    entries.append(('rawnind_bayer', neural, None if neural.model_path.is_file() else 'model absent'))
    results = []
    for name, adapter, missing in entries:
        if missing:
            results.append(dict(adapter=name, skipped=missing))
            continue
        image = (sample.rgb if adapter.input_kind == 'rgb' else sample.bayer)[source_slice].copy()
        metadata = dict(sample.metadata, frame_shape=[96, 96])
        start = time.perf_counter()
        try:
            state = adapter.prepare(image, metadata)
            output = adapter.process(image, metadata, state)
            if output.shape != (96, 96, 3) or not np.isfinite(output).all():
                raise ValueError('Invalid tiny-crop output')
            results.append(dict(adapter=name, shape=list(output.shape), finite=True,
                                fallback=bool(state.get('fallback')) if isinstance(state, dict) else getattr(state, 'fallback', None),
                                seconds=time.perf_counter() - start))
        except Exception as error:
            results.append(dict(adapter=name, error=f'{type(error).__name__}: {error}'))
    args.output.write_text(json.dumps(dict(sample=sample.name, purpose='interface only; not scored', candidates=results), indent=2) + '\n')
    if any('error' in result for result in results):
        raise SystemExit(1)


if __name__ == '__main__':
    main()
