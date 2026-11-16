"""Native-photo CPU export qualification; fresh worker per photo, no source copies.

Run with the venv Python from codebase under gpu-run-lock.py for isolation.
Uses the existing full-size resource estimate before allocating a source; a
refusal is recorded as unqualified, never silently resized or given more RAM.
"""
import argparse
from dataclasses import asdict
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'backend'), str(ROOT / 'tests/helpers'), str(ROOT / 'tools')]


def worker(photo, scratch, result):
    import numpy as np
    from PIL import Image
    from types import SimpleNamespace
    from hdr_finisher import exporters
    from hdr_finisher.color_context import RenderColorContext
    from hdr_finisher.hdr_ceiling import channel_nits
    from hdr_finisher.hdr_delivery import check_decoded_hdr_ceiling
    from hdr_finisher.loader import load_image
    from hdr_finisher.models import AdjustmentState, ExportSettings, PreviewKind
    from hdr_finisher.resource_preflight import estimate_resources, detect_memory_resources
    from delivery_comparison import decoded_lanes, metric
    # Header inspection allocates no pixels; preflight below decides whether
    # the full photo may be decoded (including the approved 192 MP panorama).
    maximum = Image.MAX_IMAGE_PIXELS
    try:
        Image.MAX_IMAGE_PIXELS = None
        with Image.open(photo) as header:
            width, height = header.size
    finally:
        Image.MAX_IMAGE_PIXELS = maximum
    resources = detect_memory_resources()
    estimate = estimate_resources(width=width, height=height, samples=3, bytes_per_sample=4, resources=resources)
    row = dict(photo=photo.name, width=width, height=height, resources=asdict(resources), estimate=asdict(estimate), lanes={})
    result.write_text(json.dumps(row))
    from hdr_finisher.app_memory import CEILING, STARTING
    if estimate.export_decision.value != 'pass' or estimate.conservative_export_peak_bytes + STARTING > CEILING:
        row['unqualified'] = 'Native export not attempted: full-size working estimate plus existing starting footprint exceeds the default app ceiling, or system reserve refuses it.'
        result.write_text(json.dumps(row)); return
    stage = lambda value: result.with_suffix('.stage').write_text(value)
    stage('sourceDecode')
    started = time.perf_counter()
    image, _, _, _, reference = load_image(photo, analyze_hdr=False)
    row['sourceDecodeSeconds'] = time.perf_counter() - started
    adjustments = AdjustmentState()
    adjustments.hdr.highlight_section_enabled = True
    adjustments.hdr.highlight_compression_mode = 'fixed_cap'
    adjustments.hdr.highlight_compression_target_nits = 1000
    session = SimpleNamespace(session_id='native-jxl', image=image, sdr_reference_image=reference,
                              adjustments=adjustments, local_adjustments=[], hdr_reference_white_nits=203,
                              color_context=RenderColorContext(203))
    # Capture the actual production finished input inside the admitted export.
    os.environ['HDR_FINISHER_TEST_CAPTURE_DIR'] = str(scratch/'captures')
    sys.path.insert(0, str(ROOT/'tests/helpers/delivery_capture'))
    import capture
    capture.install()
    from delivery_comparison import own_fidelity, finished_capture
    for lane, kind, format_name in [('hdr', PreviewKind.HDR, 'jpegxl_hdr'), ('sdr', PreviewKind.SDR, 'sdr_jpegxl')]:
        row['lanes'][lane] = dict(variants={})
        for high in [True, False]:
            # Do not run a known excessive ordinary comparison for a refused
            # high-fidelity photo: its default settings are outside this work.
            if not high and 'refused' in row['lanes'][lane]:
                continue
            target = scratch/f'{lane}-{high}.jxl'
            config = ExportSettings(format=format_name, quality=90, jpegxl_high_fidelity=high,
                                    dithering='off' if lane=='hdr' else 'auto', output_path=str(target))
            encode_times=[]
            encode_name='encode_hdr_jpegxl' if lane=='hdr' else 'encode_sdr_jpegxl'
            encode_original=getattr(exporters,encode_name)
            def timed_encode(*args, **kwargs):
                began=time.perf_counter()
                try:return encode_original(*args,**kwargs)
                finally:encode_times.append(time.perf_counter()-began)
            setattr(exporters,encode_name,timed_encode)
            stage(lane+('-high' if high else '-default')+'-export')
            started=time.perf_counter()
            from hdr_finisher.capabilities import probe_capabilities
            exported=exporters.build_export_backends(probe_capabilities())[format_name].export(session,config)
            elapsed=time.perf_counter()-started
            setattr(exporters,encode_name,encode_original)
            if not exported.accepted:
                row['lanes'][lane]['refused']=exported.message
                result.write_text(json.dumps(row));continue
            size=target.stat().st_size
            stage(lane+('-high' if high else '-default')+'-decode')
            started=time.perf_counter()
            decoded=decoded_lanes(target,format_name,203)[lane]
            decode=time.perf_counter()-started
            del decoded
            stage(lane+'-fidelity')
            fidelity=own_fidelity(target)
            folder,_=finished_capture(target)
            finished=np.load(folder/f'{lane}.npy',mmap_mode='r')
            assert finished.shape[:2]==(height,width), finished.shape
            if lane=='hdr':
                peak=max(float(channel_nits(finished[y:y+128]).max()) for y in range(0,height,128))
                assert peak<=1000,peak
                row['lanes'][lane]['finishedPeakNits']=peak
            stage(lane+'-ceiling')
            peak=check_decoded_hdr_ceiling(target,format_name,1000) if lane=='hdr' else None
            row['lanes'][lane]['variants']['high' if high else 'webDefault']=dict(
                bytes=size,exportSeconds=elapsed,encodeSeconds=sum(encode_times),encodeRounds=len(encode_times),decodeSeconds=decode,fidelity=fidelity['lanes'][lane],peakNits=peak)
            result.write_text(json.dumps(row))
            target.unlink()
    result.write_text(json.dumps(row))


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--worker', nargs=3)
    parser.add_argument('--photo', action='append')
    parser.add_argument('--output', type=Path, default=ROOT/'output/review/jpegxl-high-fidelity/native.json')
    args=parser.parse_args()
    if args.worker:
        worker(*map(Path,args.worker)); return
    from lib.machine_settings import settings
    from hdr_finisher.app_memory import process_tree, CEILING
    from hdr_finisher.resource_preflight import detect_memory_resources
    photos=Path(settings()['photosRoot'])/'HDR Test Images'
    approved={x['name']:x['sha256'] for x in json.loads((ROOT/'tests/test-photos.manifest.json').read_text())['files']}
    names=['5M071612_finished.avif','-4_stops_exposure_PQ_Rec_2020_DSC08883_03.avif','DSC_3931_01.jpg','IMG_6717.PNG','pano_192mp.jpg']
    names=args.photo or names
    rows=[]; args.output.parent.mkdir(parents=True,exist_ok=True)
    with TemporaryDirectory(prefix='hdr-jxl-native-',dir=ROOT/'output') as temp:
        temp=Path(temp)
        for name in names:
            photo=photos/name
            with photo.open('rb') as stream: assert hashlib.file_digest(stream,'sha256').hexdigest()==approved[name]
            result=temp/'result.json';result.unlink(missing_ok=True);result.with_suffix('.stage').unlink(missing_ok=True)
            env={**os.environ,'HDR_FINISHER_FORCE_CPU_DELIVERY':'1','HDR_FINISHER_USER_DATA_DIR':str(temp/'profile')}
            child=subprocess.Popen([sys.executable,__file__,'--worker',str(photo),str(temp),str(result)],env=env,stdout=subprocess.DEVNULL)
            peak=0; minimum=None; samples=0; stages={}
            while child.poll() is None:
                try:
                    charge=sum(r.get('chargedBytes',r['workingSetBytes']) for r in process_tree(child.pid))
                    available=detect_memory_resources().available_ram_bytes
                    phase=result.with_suffix('.stage').read_text() if result.with_suffix('.stage').exists() else 'startup'
                    stages[phase]=max(stages.get(phase,0),charge)
                    peak=max(peak,charge); minimum=available if minimum is None else min(minimum,available or minimum);samples+=1
                except (OSError,ProcessLookupError): pass
                time.sleep(.2)
            row=json.loads(result.read_text()) if result.exists() else dict(photo=name)
            row.update(exitCode=child.returncode,stagePeakChargedBytes=stages,workerPeakChargedBytes=peak,minimumAvailableBytes=minimum,memorySamples=samples,defaultAppCeilingBytes=CEILING)
            rows.append(row);args.output.write_text(json.dumps(rows,indent=2))
            print(name,child.returncode,round(peak/1e9,3),'GB',row.get('unqualified',''),flush=True)
            if child.returncode: raise RuntimeError(f'Native qualification failed for {name}; see {args.output}')

if __name__=='__main__':main()
