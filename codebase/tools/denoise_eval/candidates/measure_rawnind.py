"""Locked, RSS-guarded offline RawNIND quality/probe/full-frame research runs."""
from __future__ import annotations

import argparse
import html
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

for variable in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS', 'VECLIB_MAXIMUM_THREADS', 'HDR_CPU_THREADS'):
    os.environ[variable] = '1'
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'backend'))
ROOT = Path(__file__).resolve().parents[3]
OUTPUT = ROOT / 'output/denoise-v1/rawnind'
PLUGIN = 'tools.denoise_eval.candidates.rawnind:'


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, allow_nan=False)+'\n')


def quality():
    from tools.denoise_eval.run import main
    names = ['off', 'denoise_v2'] + [PLUGIN+name for name in
             ('linear_half', 'linear_three_quarters', 'linear', 'bayer_half', 'bayer_three_quarters', 'bayer')]
    main(['--set', 'full', '--adapters', ','.join(names), '--output-dir', str(OUTPUT), '--review-size', '128'])


def probes():
    import gc
    import numpy as np
    from tools.denoise_eval import metrics
    from tools.denoise_eval.inputs import inventory, synthetic_samples
    from tools.denoise_eval.candidates.rawnind import RawNIND
    from tools.denoise_eval.run import peak_rss, save_image
    entries = inventory()
    results = dict(clean_mosaic=[], seams={}, domain=[], review_rows=[], coreml='Not attempted: CPU candidate qualification first')
    candidate = RawNIND('bayer')
    for sample in synthetic_samples(entries, False):
        if sample.metadata['iso'] != 6400:
            continue
        state = candidate.prepare(sample.clean_bayer, sample.metadata)
        results['clean_mosaic'].append(dict(name=sample.name, gain=state.gain, fallback=state.fallback,
            measures=metrics.evaluate(state.denoised, sample.clean, sample.clean, sample.masks, 'slanted-edge' in sample.name)))
        images = []
        for label, output in [('AHD clean reference', sample.clean), ('Bayer model on CLEAN mosaic', state.denoised)]:
            filename = f'clean-{sample.name}-{len(images)}.png'
            save_image(output, OUTPUT/'review'/filename, 128)
            images.append((label, filename))
        results['review_rows'].append(dict(name=f'No-noise demosaic difference: {sample.name}',
                                         metadata='No added noise; not a denoising gain', images=images))
        if 'fabric' in sample.name:
            for kind in ('linear', 'bayer'):
                adapter = RawNIND(kind)
                source = sample.rgb if kind == 'linear' else sample.bayer
                unshifted = adapter.prepare(source, sample.metadata)
                adapter.tile_shift = 192 if kind == 'linear' else 384
                shifted = adapter.prepare(source, sample.metadata)
                results['seams'][kind] = dict(sdr=metrics.summary(metrics.colour_error(unshifted.denoised, shifted.denoised)),
                    hdr=metrics.summary(metrics.colour_error(unshifted.denoised, shifted.denoised, 'hdr')),
                    native_core=384 if kind == 'linear' else 768, shift=adapter.tile_shift,
                    unshifted_gain=unshifted.gain, shifted_gain=shifted.gain,
                    unshifted_tiles=unshifted.timing['tiles'], shifted_tiles=shifted.timing['tiles'])
                del adapter, unshifted, shifted
        del state
        gc.collect()
    linear = RawNIND('linear')
    for name, colour in [('near_black', [1e-7]*3), ('saturated', [0., .02, 1.]),
                         ('negative_hdr', [-.125, 1.5, 8.]), ('black', [0.]*3)]:
        image = np.broadcast_to(np.array(colour, np.float32), (64, 64, 3)).copy()
        try:
            state = linear.prepare(image, {})
            results['domain'].append(dict(name=name, domain=state.domain, gain=state.gain,
                finite=bool(np.isfinite(state.denoised).all()), output_min=float(state.denoised.min()),
                output_max=float(state.denoised.max()), max_abs_drift=float(np.max(np.abs(state.denoised-image)))))
        except ValueError as error:
            results['domain'].append(dict(name=name, error=str(error)))
    results['peak_rss_bytes'] = peak_rss()
    write_json(OUTPUT/'probes.json', results)
    print(json.dumps(results, indent=2), flush=True)


def full_frame(filename, kind, extrapolate):
    import gc
    import numpy as np
    import rawpy
    from tools.lib.test_photos import photo_root
    from tools.denoise_eval.candidates.rawnind import RawNIND
    from tools.denoise_eval.inputs import metadata_from_raw, crop_choices, develop
    from tools.denoise_eval.run import peak_rss, save_image
    from hdr_finisher.raw_import import (_develop_libraw_camera_rgb, _camera_rgb_to_acescg_float32,
                                        _camera_linear_metadata_from_libraw, _normalize_camera_rgb_float32)
    start = time.perf_counter()
    entry = dict(file=filename, camera='from native metadata', iso=3200 if filename=='IMG_0790.CR2' else 4000,
                 noise_fit_positions=[])
    adapter = RawNIND(kind, extrapolate_bayer=extrapolate)
    rows = []
    with tempfile.TemporaryDirectory(prefix=f'full-frame-{os.getpid()}-', dir=OUTPUT) as scratch:
        with rawpy.imread(str(photo_root()/filename)) as raw:
            metadata = metadata_from_raw(raw, entry)
            native_metadata = _camera_linear_metadata_from_libraw(raw)
            height, width = raw.raw_image_visible.shape
            sensor_shape = [height, width]
            orientation = int(raw.sizes.flip)
            choices = crop_choices(raw, 256)
            if kind == 'linear':
                transport = _develop_libraw_camera_rgb(raw, rawpy)
                for crop in choices.values():
                    top, left, size = crop['y'], crop['x'], 256
                    if orientation == 3:
                        crop.update(y=height-top-size, x=width-left-size)
                    elif orientation == 5:
                        crop.update(y=width-left-size, x=top)
                    elif orientation == 6:
                        crop.update(y=left, x=height-top-size)
                    elif orientation != 0:
                        raise ValueError(f'Unsupported native orientation {orientation}')
                height, width = transport.shape[:2]
                source = np.memmap(Path(scratch)/'source.f32', dtype=np.float32, mode='w+', shape=(height, width, 3))
                for top in range(0, height, 128):
                    strip = _normalize_camera_rgb_float32(transport[top:top+128], native_metadata)
                    source[top:top+128] = _camera_rgb_to_acescg_float32(strip, native_metadata)
                del transport
            else:
                source = np.memmap(Path(scratch)/'source.f32', dtype=np.float32, mode='w+', shape=(height, width))
                for top in range(0, height, 128):
                    strip = raw.raw_image_visible[top:top+128].astype(np.float32)
                    pattern = raw.raw_pattern
                    whites = raw.camera_white_level_per_channel or [raw.white_level]*4
                    for row in range(2):
                        for column in range(2):
                            channel = int(pattern[row, column])
                            strip[row::2, column::2] -= raw.black_level_per_channel[channel]
                            strip[row::2, column::2] /= (whites[channel] or raw.white_level)-raw.black_level_per_channel[channel]
                    source[top:top+strip.shape[0]] = strip
        source.flush()
        gc.collect()
        prep_seconds = time.perf_counter()-start
        destination = np.memmap(Path(scratch)/'output.f32', dtype=np.float32, mode='w+', shape=(height, width, 3))
        state = adapter.prepare(source, metadata, destination=destination)
        measured_seconds = time.perf_counter()-start
        record = dict(file=filename, variant=kind, shape=[height, width], sensor_shape=sensor_shape,
                      native_orientation=orientation if kind == 'linear' else 0, measured=True,
                      experimental_extrapolation=extrapolate, domain=state.domain, fallback=state.fallback,
                      decode_prep_seconds=prep_seconds, **state.timing, wall_seconds=measured_seconds,
                      peak_rss_bytes=peak_rss(), gain=state.gain, conditions='MacBook Neo A18 Pro 8 GB, CPU one thread, disk-backed source/result, no presentation')
        record['normalised_24mp_seconds_estimated'] = measured_seconds*24_000_000/(height*width)
        for role, crop in choices.items():
            top, left = crop['y'], crop['x']
            output = state.denoised[top:top+256, left:left+256].copy()
            baseline = source[top:top+256, left:left+256].copy()
            if kind == 'bayer':
                baseline = develop(baseline, metadata)
            lift = float(np.clip(np.log2(.18/max(float(np.median(np.maximum(baseline, 0))), 1e-6)), 0, 6))
            images = []
            for strength in (0., 1.):
                crop_name = f"full-{Path(filename).stem}-{kind}-{role}-{strength}.png"
                blended = baseline + np.float32(strength)*(output-baseline)
                save_image(blended*np.float32(2**lift), OUTPUT/'review'/crop_name)
                images.append((f'{kind} strength {strength}; common +{lift:.2f} stop viewing lift', crop_name))
            rows.append(dict(name=f'{filename} / {kind} / {role}',
                             metadata=str(dict(crop=crop, iso=entry['iso'], experimental_extrapolation=extrapolate)), images=images))
        record['crops'] = choices
        record['review_rows'] = rows
        write_json(OUTPUT/f'full-{Path(filename).stem}-{kind}.json', record)
        del state, destination, source
        gc.collect()
    print(json.dumps(record, indent=2), flush=True)


def assemble_review():
    from tools.denoise_eval.run import review_page
    page = OUTPUT/'review/index.html'
    results = json.loads((OUTPUT/'results-full.json').read_text())
    rows = []
    for index, case in enumerate(results['cases']):
        images = [('Noisy input', f'crop-{index:03d}-0.png')]
        if case['clean']:
            images.append(('AHD clean reference', f'crop-{index:03d}-1.png'))
        for name, measured in case['adapters'].items():
            if 'error' in measured or 'skipped' in measured:
                continue
            filename = f'crop-{index:03d}-{len(images)}.png'
            label = name.rsplit(':', 1)[-1]
            if measured.get('adapter_state', {}).get('fallback'):
                label += ' — AHD FALLBACK: '+measured['adapter_state']['fallback']
            images.append((label, filename))
        rows.append(dict(name=case['name'], metadata=str(case['metadata']), images=images))
    review_page(rows, page.parent, results)
    content = page.read_text().replace('Denoise baseline: full', 'RawNIND research: full quality + native crops')
    marker = '<!-- RawNIND additional probes -->'
    content = content.split(marker)[0].replace('</body></html>', '')
    sections = []
    for path in [OUTPUT/'probes.json', *sorted(OUTPUT.glob('full-*.json'))]:
        if not path.exists():
            continue
        record = json.loads(path.read_text())
        if path.name.startswith('full-'):
            for row in record.get('review_rows', []):
                retained = []
                for label, filename in row['images']:
                    if 'strength 0.5;' in label or 'strength 0.75;' in label:
                        (OUTPUT/'review'/filename).unlink(missing_ok=True)
                    else:
                        retained.append((label, filename))
                row['images'] = retained
            write_json(path, record)
        for row in record.get('review_rows', []):
            figures = ''.join(f'<figure><img loading="lazy" src="{html.escape(filename)}"><figcaption>{html.escape(label)}</figcaption></figure>'
                              for label, filename in row['images'])
            sections.append(f'<section><h2>{html.escape(row["name"])}</h2><p>{html.escape(row["metadata"])}</p><div class="row">{figures}</div></section>')
    page.write_text(content+marker+''.join(sections)+'</body></html>')
    for row in rows:
        for label, filename in row['images']:
            if not (page.parent/filename).exists():
                raise RuntimeError(f'Missing review crop: {filename}')
    size = sum(path.stat().st_size for path in page.parent.iterdir() if path.is_file())
    if size > 20_000_000:
        raise RuntimeError(f'Review exceeds 20 MB: {size}')
    print(json.dumps(dict(review_bytes=size, path=str(page))), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=('quality', 'probes', 'full-frame', 'pytest', 'review'))
    parser.add_argument('--file', choices=('IMG_0790.CR2', '2025_0730_1331_3.arw'))
    parser.add_argument('--kind', choices=('linear', 'bayer'), default='linear')
    parser.add_argument('--extrapolate-bayer', action='store_true')
    parser.add_argument('--worker', action='store_true')
    args = parser.parse_args()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT/'review').mkdir(exist_ok=True)
    if args.mode == 'review':
        assemble_review()
        return
    if args.worker:
        if args.mode == 'quality':
            quality()
        elif args.mode == 'probes':
            probes()
        elif args.file:
            full_frame(args.file, args.kind, args.extrapolate_bayer)
        else:
            parser.error('--file required for full-frame')
        return
    import psutil
    command = [sys.executable, '-m', 'pytest', 'tests', '-q'] if args.mode == 'pytest' else [
        sys.executable, '-m', 'tools.denoise_eval.candidates.measure_rawnind', *sys.argv[1:], '--worker']
    temporary = tempfile.TemporaryDirectory(prefix='rawnind-guard-', dir=None if args.mode == 'pytest' else OUTPUT)
    environment = {**os.environ, 'TMPDIR': temporary.name, 'TMP': temporary.name, 'TEMP': temporary.name}
    process = subprocess.Popen(command, env=environment)
    peak = 0
    aborted = False
    try:
        while process.poll() is None:
            try:
                peak = max(peak, psutil.Process(process.pid).memory_info().rss)
            except psutil.NoSuchProcess:
                break
            if peak > 2_500_000_000:
                process.terminate()
                aborted = True
                break
            time.sleep(.02)
        process.wait(timeout=10)
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()
        for scratch in OUTPUT.glob(f'full-frame-{process.pid}-*'):
            shutil.rmtree(scratch)
        temporary.cleanup()
    receipt = dict(mode=args.mode, file=args.file, kind=args.kind, sampled_peak_rss_bytes=peak,
                   aborted=aborted, returncode=process.returncode, limit_bytes=2_500_000_000)
    write_json(OUTPUT/f'guard-{args.mode}-{args.file or "all"}-{args.kind}.json', receipt)
    print(json.dumps(receipt), flush=True)
    raise SystemExit(1 if aborted else process.returncode)


if __name__ == '__main__':
    main()
