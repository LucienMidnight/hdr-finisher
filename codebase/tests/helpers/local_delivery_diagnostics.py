"""Locate local-delivery differences before and after Ultra HDR encoding."""
import json
from dataclasses import asdict
from pathlib import Path
import sys

import numpy as np
from hdr_finisher.adjustments import apply_adjustments
from hdr_finisher.color_context import RenderColorContext
from hdr_finisher.delivery_colour import compare_finished_pixels
from hdr_finisher.hdr_ceiling import channel_nits
from hdr_finisher.loader import load_image
from hdr_finisher.models import EditDocument, PreviewKind

def codec_bisect(array_path):
    """Change one codec input/operation at a time; never alter production defaults."""
    from tempfile import TemporaryDirectory
    import shutil
    from PIL import Image
    from hdr_finisher import exporters as e
    from hdr_finisher.color import linear_bt2020_to_acescg
    from hdr_finisher.models import ExportSettings
    arrays = np.load(array_path)
    def metric(a, b, lane):
        value = compare_finished_pixels(a, b, lane)
        return {**asdict(value), 'passed': value.passed}
    results = {'quantization': {}, 'encodes': {}}
    for lane in ('hdr', 'sdr'):
        pair = []
        for renderer in ('gpu', 'cpu'):
            image = arrays[f'{renderer}_{lane}']
            if lane == 'hdr':
                raw = e._prepare_hdr_linear_rgba_f16(image)[0][..., :3]
                back = linear_bt2020_to_acescg(raw.astype(np.float32) * np.float32(.18))
            else:
                raw = e._floor_ultrahdr_base(e._linear_to_srgb8(image, dither='off'), arrays[f'{renderer}_hdr'])
                x = raw.astype(np.float32) / 255
                back = np.where(x <= .04045, x / 12.92, ((x + .055) / 1.055) ** 2.4)
            pair.append((raw, back))
        results['quantization'][lane] = {'difference': metric(pair[0][1], pair[1][1], lane),
            'different_channels': int(np.count_nonzero(pair[0][0] != pair[1][0])),
            'total_channels': int(pair[0][0].size)}
    original_filter, original_writer = e._denoise_ultrahdr_gain_map, e._write_sdr_rgba8888_pixels
    def decoded_base(path, rgb):
        with Image.open(path.parent / 'sdr_primary.jpg') as jpeg:
            original_writer(path, np.asarray(jpeg.convert('RGB')))
    try:
        for scenario in ('normal', 'same_sdr', 'same_hdr', 'same_both', 'unfiltered', 'quality100', 'gain100', 'decoded_base'):
            e._denoise_ultrahdr_gain_map = (lambda source, destination, *a, **k: shutil.copyfile(source, destination)) if scenario == 'unfiltered' else original_filter
            e._write_sdr_rgba8888_pixels = decoded_base if scenario == 'decoded_base' else original_writer
            with TemporaryDirectory(prefix='sharp-codec-bisect-') as tmp:
                decoded, peaks = {}, {}
                for renderer in ('gpu', 'cpu'):
                    hdr = arrays[f'{"cpu" if scenario in ("same_hdr", "same_both") else renderer}_hdr']
                    sdr = arrays[f'{"cpu" if scenario in ("same_sdr", "same_both") else renderer}_sdr']
                    settings = ExportSettings(format='jpeg_ultrahdr', quality=100 if scenario == 'quality100' else 95,
                        jpeg_chroma_subsampling='444', jpeg_gain_map_quality=100 if scenario in ('quality100', 'gain100') else 95,
                        jpeg_gain_map_scale='full', dithering='off')
                    file = Path(tmp) / f'{renderer}.jpg'
                    # These isolate the initial codec, before local ceiling correction.
                    e._write_jpeg_gainmap_once(file, hdr, sdr, settings)
                    decoded[renderer] = load_image(file)
                    peaks[renderer] = float(channel_nits(decoded[renderer][0]).max())
                results['encodes'][scenario] = {lane: metric(decoded['gpu'][index], decoded['cpu'][index], lane)
                    for lane, index in (('hdr', 0), ('sdr', 4))}
                results['encodes'][scenario]['decoded_peaks_nits'] = peaks
    finally:
        e._denoise_ultrahdr_gain_map, e._write_sdr_rgba8888_pixels = original_filter, original_writer
    print(json.dumps(results, indent=2))


if sys.argv[1] == '--codec-bisect':
    codec_bisect(sys.argv[2])
    sys.exit(0)

root = Path(sys.argv[1])
doc = EditDocument.model_validate_json((root / 'document.json').read_text())
source = load_image(root / 'diagnostic-source.tiff', overrides=doc.interpretation_override.model_dump())[0]
captured = json.loads((root / 'finished.json').read_text())
decoded = {name: load_image(root / f'{name}.jpg') for name in ('gpu', 'cpu')}
results = {}
arrays = {}
for i, lane in enumerate(('hdr', 'sdr')):
    item = captured[i]
    gpu = np.asarray(item['pixels'], np.float32).reshape(item['height'], item['width'], 4)[..., :3]
    cpu = apply_adjustments(source, doc.global_adjustments, PreviewKind(lane),
        local_adjustments=doc.local_adjustments, color_context=RenderColorContext())
    arrays[f'gpu_{lane}'] = gpu
    arrays[f'cpu_{lane}'] = cpu
    index = 0 if lane == 'hdr' else 4
    pairs = {'float_gpu_cpu': (gpu, cpu),
        'decoded_gpu_cpu': (decoded['gpu'][index], decoded['cpu'][index]),
        'gpu_encoding_error': (gpu, decoded['gpu'][index]),
        'cpu_encoding_error': (cpu, decoded['cpu'][index])}
    results[lane] = {name: {**asdict(m := compare_finished_pixels(*pair, lane)), 'passed': m.passed}
        for name, pair in pairs.items()}
    if lane == 'hdr':
        results[lane]['float_peaks_nits'] = [float(channel_nits(v).max()) for v in (gpu, cpu)]
if len(sys.argv) > 2:
    np.savez_compressed(sys.argv[2], **arrays)
print(json.dumps(results, indent=2))
