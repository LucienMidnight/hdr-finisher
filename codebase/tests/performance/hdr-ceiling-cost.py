"""Real-photo CPU export/Proof peaks and paired cost of mandatory decoding.

Run under tools/gpu-run-lock.py for an uncontended machine. Sources are read
only, loaded once; each export includes CPU rendering, encoding and validation.
The baseline bypasses only the post-encode check, as the old unchecked option
did. No production switch is added. Temporary files are removed on failure too.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import subprocess
from tempfile import TemporaryDirectory
from time import perf_counter
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
os.environ['HDR_FINISHER_FORCE_CPU_DELIVERY'] = '1'
import numpy as np
from hdr_finisher import exporters, hdr_ceiling
from hdr_finisher.capabilities import probe_capabilities
from hdr_finisher.color_context import RenderColorContext
from hdr_finisher.loader import load_image
from hdr_finisher.models import AdjustmentState, ExportSettings, ProofArtifactRequest
from hdr_finisher.proofing import ProofArtifactStore
from hdr_finisher.render_cache import SessionRenderCache


# Loaded only by the disposable benchmark sidecar. The unchecked baseline
# bypasses the check at runtime; tracked production files are never edited.
GPU_INSTRUMENT = """
import os,json,time
if os.environ.get('HDR_CEILING_BENCHMARK_MODE'):
    from hdr_finisher import exporters
    original = exporters.encode_within_ceiling
    def measured(hdr, white, encode, decode, ceiling=None, notes=None, **kwargs):
        row = {'encodes':0, 'decode_s':0, 'peaks':[]}
        def enc(image):
            row['encodes'] += 1
            return encode(image)
        def dec(delivery):
            start=time.perf_counter()
            image=decode(delivery)
            row['decode_s'] += time.perf_counter()-start
            row['peaks'].append(float(image.max()))
            return image
        if os.environ['HDR_CEILING_BENCHMARK_MODE']=='checked':
            result=original(hdr,white,enc,dec,ceiling,notes,**kwargs)
        else:
            result=enc(hdr)
        with open(os.environ['HDR_CEILING_BENCHMARK_CALLS'],'a') as log:
            log.write(json.dumps(row)+'\\n')
        return result
    exporters.encode_within_ceiling=measured
"""


def measure_gpu(args):
    root = Path(__file__).resolve().parents[2]
    records = []
    args.output.parent.mkdir(parents=True, exist_ok=True)
    try:
        with TemporaryDirectory(prefix='hdr-ceiling-benchmark-') as folder:
            folder = Path(folder)
            (folder / 'sitecustomize.py').write_text(GPU_INSTRUMENT)
            cases = [(args.photos[0], -6), *[(photo, 3) for photo in args.photos]]
            for index, (photo, exposure) in enumerate(cases):
                row = {'photo': str(photo), 'exposure':exposure, 'format':'jpeg_ultrahdr', 'policies':[]}
                records.append(row)
                # Alternate phase order between photos.
                for checked in ([False,True] if index%2==0 else [True,False]):
                    mode = 'checked' if checked else 'unchecked'
                    calls, result = folder/'calls.jsonl', folder/'result.json'
                    calls.unlink(missing_ok=True)
                    env = dict(os.environ, HDR_FINISHER_FORCE_CPU_DELIVERY='0',
                        PYTHONPATH=os.pathsep.join([str(folder),str(root/'backend')]),
                        HDR_CEILING_SOURCE=str(photo.resolve()), HDR_CEILING_EXPOSURE=str(exposure),
                        HDR_CEILING_RESULT=str(result),
                        HDR_CEILING_BENCHMARK_MODE=mode, HDR_CEILING_BENCHMARK_CALLS=str(calls))
                    subprocess.run(['node','tests/run-in-electron.js','tests/hdr-ceiling-delivery.js','--benchmark'],
                        cwd=root, env=env, check=True)
                    runs=json.loads(result.read_text())
                    observed=[json.loads(line) for line in calls.read_text().splitlines()]
                    assert len(runs)==len(observed)==3, (runs,observed)
                    row['policies'].append({'checked':checked,'runs':[dict(a,**b) for a,b in zip(runs,observed)]})
    finally:
        args.output.write_text(json.dumps({'machine':'MacBook Neo, Apple A18 Pro, 8 GB, 6 cores',
            'renderer':'gpu', 'long_edge':1600, 'timing_noise_allowance':0.05, 'records':records},indent=2)+'\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('photos', nargs='+', type=Path)
    parser.add_argument('--output', type=Path, default=Path('output/ceiling-followup/cost.json'))
    parser.add_argument('--long-edge', type=int, default=1600)
    parser.add_argument('--repeats', type=int, default=2)
    parser.add_argument('--formats', nargs='+', default=['jpeg_ultrahdr', 'avif_gain_map', 'jpegxl_hdr'])
    parser.add_argument('--skip-proofs', action='store_true')
    parser.add_argument('--gpu', action='store_true', help='Time real Electron GPU exports, JPEG 1600px, one warm-up then two runs per policy.')
    args = parser.parse_args()
    if args.gpu:
        return measure_gpu(args)
    backends = exporters.build_export_backends(probe_capabilities())
    real_check = exporters.encode_within_ceiling
    records = []
    report = {'machine': 'MacBook Neo, Apple A18 Pro, 8 GB, 6 cores',
              'timing_noise_allowance': 0.05, 'long_edge': args.long_edge, 'records': records}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    try:
        with TemporaryDirectory(prefix='hdr-ceiling-cost-') as folder:
            for photo in args.photos:
                image = load_image(photo, analyze_hdr=False)[0]
                edits = AdjustmentState()
                edits.hdr.highlight_section_enabled = True
                edits.hdr.highlight_compression_target_nits = 1000
                edits.hdr.exposure = 3
                session = SimpleNamespace(session_id='cost', image=image, adjustments=edits,
                    hdr_reference_white_nits=203, color_context=RenderColorContext(203),
                    sdr_reference_image=None, local_adjustments=[], denoise=None,
                    render_cache=SessionRenderCache(image, None))
                for fmt in args.formats:
                    backend = backends[fmt]
                    if backend.capability.status.value != 'available':
                        raise RuntimeError(backend.capability.detail)
                    record = {'photo': str(photo), 'format': fmt, 'runs': [], 'proofs': []}
                    records.append(record)
                    active = {}
                    def observed(hdr, white, encode, decode, ceiling=None, notes=None, **kwargs):
                        def measured_encode(pixels):
                            active['encodes'] += 1
                            return encode(pixels)
                        def measured_decode(delivery):
                            start = perf_counter()
                            pixels = decode(delivery)
                            active['decode_s'] += perf_counter() - start
                            active['peaks'].append(float(pixels.max()))
                            return pixels
                        if active['checked']:
                            return real_check(hdr, white, measured_encode, measured_decode, ceiling, notes, **kwargs)
                        return measured_encode(hdr)
                    exporters.encode_within_ceiling = observed
                    settings = ExportSettings(format=fmt, quality=90, overwrite=True,
                        output_path=str(Path(folder) / 'export'),
                        output_finishing={'resize_mode':'long_edge', 'long_edge':args.long_edge, 'sharpening':'off'})
                    for run in range(args.repeats + 1):
                        for checked in ([False, True] if run % 2 == 0 else [True, False]):
                            active = {'checked': checked, 'encodes': 0, 'decode_s': 0, 'peaks': []}
                            start = perf_counter()
                            result = backend.export(session, settings)
                            active.update(seconds=perf_counter() - start, warmup=run == 0, accepted=result.accepted)
                            if not result.accepted:
                                raise AssertionError(result.message)
                            active['landed_nits'] = float(hdr_ceiling.decoded_channel_nits(Path(result.output_path), fmt).max())
                            if checked:
                                assert active['landed_nits'] <= 1000 * (1 + hdr_ceiling.ENCODING_ALLOWANCE)
                                if len(active['peaks']) > 1:
                                    assert 970 <= active['landed_nits'] <= 1000, active
                            record['runs'].append(active.copy())
                    if args.skip_proofs:
                        print(json.dumps(record), flush=True)
                        continue
                    active = {'checked': True, 'encodes': 0, 'decode_s': 0, 'peaks': []}
                    result = backend.export(session, settings)
                    assert result.accepted, result.message
                    exported_hash = hashlib.sha256(Path(result.output_path).read_bytes()).hexdigest()
                    store = ProofArtifactStore()
                    try:
                        for full in (False, True):
                            active = {'checked': True, 'encodes': 0, 'decode_s': 0, 'peaks': []}
                            proof = store.create(session, ProofArtifactRequest(adjustments=edits,
                                format=fmt, quality=90, full_size=full, long_edge=800,
                                output_finishing=settings.output_finishing), backend)
                            peak = float(hdr_ceiling.decoded_channel_nits(store.artifact(proof.artifact_id).path, fmt).max())
                            assert peak <= 1000 * (1 + hdr_ceiling.ENCODING_ALLOWANCE)
                            if full:
                                assert proof.sha256 == exported_hash
                            record['proofs'].append(dict(active, full_size=full, landed_nits=peak,
                                export_identical=proof.sha256 == exported_hash))
                    finally:
                        store.clear()
                    print(json.dumps(record), flush=True)
    finally:
        exporters.encode_within_ceiling = real_check
        args.output.write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    main()
