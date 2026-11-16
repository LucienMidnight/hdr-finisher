"""Bounded full-native CPU trial; retain only four 256px review crops per photo.

Run inside gpu-run-lock and guard. Inputs never change; scratch is removed on
failure too. Phase clocks separate sensor prep, filtering and development.
"""
import os
for variable in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'VECLIB_MAXIMUM_THREADS', 'HDR_CPU_THREADS'):
    os.environ[variable] = '1'
import argparse
import gc
import json
from pathlib import Path
import tempfile
import time
import signal
import numpy as np
import rawpy
from tools.lib.test_photos import photo_root
from tools.denoise_eval.inputs import inventory, metadata_from_raw, develop, crop_choices
from tools.denoise_eval.run import save_image, peak_rss
from .darktable_profiled import DarktableProfiled, vst, inverse_vst, decompose
from .galosh import Galosh

OUTPUT = Path(__file__).resolve().parents[3]/'output/denoise-v1'


def interrupted(signum, frame):
    raise SystemExit(128+signum)


def capture(value, top, left, destinations, crops):
    bottom, right = top+value.shape[0], left+value.shape[1]
    for role, crop in crops.items():
        start_y, start_x = max(top, crop['y']), max(left, crop['x'])
        end_y, end_x = min(bottom, crop['y']+256), min(right, crop['x']+256)
        if end_y > start_y and end_x > start_x:
            destinations[role][start_y-crop['y']:end_y-crop['y'], start_x-crop['x']:end_x-crop['x']] = value[start_y-top:end_y-top, start_x-left:end_x-left]


def filter_camera(image, state):
    transformed = vst(image, state['shot'], state['read'])
    current, accumulated = transformed, np.zeros_like(transformed)
    for scale, threshold in enumerate(state['thresholds']):
        current, detail = decompose(current, scale)
        accumulated += np.maximum(detail-threshold, 0) + np.minimum(detail+threshold, 0)
    value = inverse_vst(current+accumulated, state['shot'], state['read'])
    value[image < 0] = image[image < 0]
    return value


def main():
    signal.signal(signal.SIGTERM, interrupted)
    parser = argparse.ArgumentParser()
    parser.add_argument('--method', choices=('darktable', 'galosh'), required=True)
    parser.add_argument('--photo', choices=('IMG_0790.CR2', '2025_0730_1331_3.arw'), required=True)
    args = parser.parse_args()
    overall = time.perf_counter()
    entry = next(value for value in inventory() if value['file'] == args.photo)
    calibration_seconds = time.perf_counter()-overall
    prep, denoise, development = 0., 0., 0.
    label = f'{args.method}-{Path(args.photo).stem}'
    review = OUTPUT/'review'
    review.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='full-frame-', dir=OUTPUT) as folder:
        then = time.perf_counter()
        with rawpy.imread(str(photo_root()/args.photo)) as raw:
            md = metadata_from_raw(raw, entry)
            height, width = raw.raw_image_visible.shape
            crops = crop_choices(raw, 256)
            mosaic = np.memmap(Path(folder)/'sensor.bin', dtype=np.float32, mode='w+', shape=(height, width))
            white = raw.camera_white_level_per_channel or [raw.white_level]*4
            for row in range(0, height, 256):
                strip = raw.raw_image_visible[row:row+256].astype(np.float32)
                for py in range(2):
                    for px in range(2):
                        channel = int(raw.raw_pattern[py, px])
                        black = raw.black_level_per_channel[channel]
                        strip[py::2, px::2] -= black
                        strip[py::2, px::2] /= (white[channel] or raw.white_level)-black
                mosaic[row:row+len(strip)] = strip
            mosaic.flush()
        prep += time.perf_counter()-then
        md['frame_shape'] = [height, width]
        originals, outputs = {}, {}
        for role, crop in crops.items():
            top, left = max(0, crop['y']-16), max(0, crop['x']-16)
            then = time.perf_counter()
            value = develop(mosaic[top:crop['y']+272, left:crop['x']+272], md)
            development += time.perf_counter()-then
            originals[role] = value[crop['y']-top:crop['y']-top+256, crop['x']-left:crop['x']-left+256].copy()
            outputs[role] = np.empty_like(originals[role])
        if args.method == 'darktable':
            adapter = DarktableProfiled()
            developed = np.memmap(Path(folder)/'developed.bin', dtype=np.float32, mode='w+', shape=(height, width, 3))
            for row in range(0, height, 1024):
                for column in range(0, width, 1024):
                    bottom, right = min(height, row+1024), min(width, column+1024)
                    top, left = max(0, row-16), max(0, column-16)
                    then = time.perf_counter()
                    value = develop(mosaic[top:min(height, bottom+16), left:min(width, right+16)], md)
                    developed[row:bottom, column:right] = value[row-top:bottom-top, column-left:right-left]
                    development += time.perf_counter()-then
            then = time.perf_counter()
            state = adapter.prepare(developed, md)
            prep += time.perf_counter()-then
            for row in range(0, height, 1024):
                for column in range(0, width, 1024):
                    bottom, right = min(height, row+1024), min(width, column+1024)
                    top, left = max(0, row-adapter.margin), max(0, column-adapter.margin)
                    end_y, end_x = min(height, bottom+adapter.margin), min(width, right+adapter.margin)
                    then = time.perf_counter()
                    camera = adapter._camera(developed[top:end_y, left:end_x], state)
                    development += time.perf_counter()-then
                    then = time.perf_counter()
                    filtered = filter_camera(camera, state)
                    denoise += time.perf_counter()-then
                    then = time.perf_counter()
                    value = filtered @ state['matrix'].T
                    capture(value[row-top:bottom-top, column-left:right-left], row, column, outputs, crops)
                    development += time.perf_counter()-then
                    print(f'{label}: {row},{column}', flush=True)
        else:
            adapter = Galosh()
            then = time.perf_counter()
            state = adapter.prepare(mosaic, md)
            prep += time.perf_counter()-then
            for row in range(0, height, 768):
                for column in range(0, width, 768):
                    bottom, right = min(height, row+768), min(width, column+768)
                    top, left = max(0, row-adapter.margin), max(0, column-adapter.margin)
                    end_y, end_x = min(height, bottom+adapter.margin), min(width, right+adapter.margin)
                    tile_md = {**md, 'tile_origin':[top, left]}
                    then = time.perf_counter()
                    filtered = adapter.denoise_mosaic(mosaic[top:end_y, left:end_x], tile_md, state)
                    denoise += time.perf_counter()-then
                    then = time.perf_counter()
                    value = develop(filtered, tile_md)
                    capture(value[row-top:bottom-top, column-left:right-left], row, column, outputs, crops)
                    development += time.perf_counter()-then
                    print(f'{label}: {row},{column}', flush=True)
        for role in crops:
            lift = float(np.clip(np.log2(.18/max(float(np.median(originals[role])), 1e-6)), 0, 6))
            crops[role]['exposure_stops'] = lift
            save_image(originals[role]*np.float32(2**lift), review/f'frame-{Path(args.photo).stem}-{role}-off.png')
            save_image(outputs[role]*np.float32(2**lift), review/f'frame-{Path(args.photo).stem}-{role}-{args.method}.png')
        result = dict(method=args.method, photo=args.photo, shape=[height, width],
                      machine='MacBook Neo A18 Pro, 8 GB; serial native CPU; no GPU/Electron',
                      calibration_all_corpus_seconds=calibration_seconds,
                      prep_seconds=prep, denoise_seconds=denoise, development_seconds=development,
                      total_seconds=time.perf_counter()-overall, peak_parent_rss_bytes=peak_rss(),
                      crops=crops, description=adapter.description(),
                      fit={key:np.asarray(value).tolist() for key, value in state.items()},
                      note='No whole output is retained. AHD uses 16px halo; denoiser support is separate. No editor/geometry/highlight repair. Process-tree RSS is in guard receipt.')
        (OUTPUT/f'full-{label}.json').write_text(json.dumps(result, indent=2))
        print(json.dumps({key:value for key, value in result.items() if key.endswith('seconds') or key.endswith('bytes')}, indent=2), flush=True)
        del mosaic
        if args.method == 'darktable':
            del developed
        gc.collect()


if __name__ == '__main__':
    main()
