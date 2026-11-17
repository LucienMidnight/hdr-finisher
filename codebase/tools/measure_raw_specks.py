"""Read-only approved-corpus qualification; run with the shared machine lock."""
from pathlib import Path
import json
import platform
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'backend'), str(ROOT / 'tools')]
import numpy as np
import rawpy
from lib.machine_settings import settings
from hdr_finisher import raw_import, raw_pixel_cleanup as hot, raw_speck_cleanup as specks
from hdr_finisher.models import RawImportSettings


def main():
    result = {'machine': platform.platform(), 'architecture': platform.machine(),
              'commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
              'window': settings()['windowSize'], 'timing_allowance': '±10%', 'photos': []}
    for name in ('IMG_0790.CR2', 'DSC04375.ARW'):
        path = Path(settings()['photosRoot']) / 'HDR Test Images' / name
        with rawpy.imread(str(path)) as raw:
            camera = raw_import._camera_linear_metadata_from_libraw(raw)
            original = raw.raw_image_visible.copy()
            start = time.perf_counter()
            config = hot.configuration(original, camera)
            fit_s = time.perf_counter() - start
            assert config is not None
            row = {'photo': name, 'shape': original.shape, 'noise_fit_s': fit_s, 'floors': []}
            for floor in (0, .001, .002, .005):
                trial = original.copy()
                start = time.perf_counter()
                count = specks.apply(trial, config, absolute_floor=floor)
                elapsed = time.perf_counter() - start
                total = 0
                for top in range(0, len(trial), 256):
                    total += int(np.abs(trial[top:top+256].astype(np.int32) - original[top:top+256]).sum())
                row['floors'].append(dict(floor=floor, seconds=elapsed, changed=count, absolute_dn=total))
                del trial
            # Compare complete sensor cleanup + highlight + AHD development on
            # the same unpacked source. EXIF, lens, finishing/UI are excluded.
            row['development'] = []
            for enabled in (False, True, True, False, False, True):
                raw.raw_image_visible[:] = original
                controls = RawImportSettings(pixel_cleanup={'even_out_specks': enabled})
                start = time.perf_counter()
                diagnostic = hot.apply_raw(raw, camera, controls)
                cleanup_s = time.perf_counter() - start
                raw_import._apply_raw_highlight_reconstruction(raw, camera, controls)
                image = raw_import._develop_libraw_camera_rgb(raw, rawpy)
                row['development'].append(dict(enabled=enabled, seconds=time.perf_counter()-start,
                                                cleanup_s=cleanup_s, finite=bool(np.isfinite(image).all()),
                                                diagnostic=diagnostic))
                del image
            print(json.dumps(row), flush=True)
            result['photos'].append(row)
    destination = ROOT / 'output/raw-speck-cleanup'
    destination.mkdir(exist_ok=True)
    (destination / 'measurement.json').write_text(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
