"""Focused JXL fixtures and independent DATA-profile source oracle; no hfmd."""
import base64
import hashlib
import json
import shutil
import sys
from pathlib import Path

import imagecodecs
import numpy as np
from colour import RGB_COLOURSPACES
from colour.models import matrix_RGB_to_RGB

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
from hdr_finisher import jpegxl
from hdr_finisher.adjustments import apply_adjustments, apply_hdr_output_highlight_compression, apply_sdr_output_highlight_compression
from hdr_finisher.color_context import RenderColorContext
from hdr_finisher.delivery_colour import compare_finished_pixels
from hdr_finisher.library_pictures import reduce_picture
from hdr_finisher.models import AdjustmentState, PreviewKind


def oracle(path, white):
    info = jpegxl.inspect_jpegxl(path)
    assert not info.get('app_metadata'), 'Fixtures must use standard tags, never hfmd'
    profile = info['data_color_encoding']
    assert profile['white_point'] == 1 and profile['color_space'] == 0
    space = {1: 'sRGB', 9: 'ITU-R BT.2020', 11: 'Display P3'}[profile['primaries']]
    raw = np.asarray(imagecodecs.jpegxl_decode(path.read_bytes()))[..., :3]
    x = raw.astype(np.float64)
    if raw.dtype.kind in 'ui':
        x /= (1 << int(info['bits_per_sample'])) - 1
    transfer = profile['transfer_function']
    if transfer == 16:
        v = x ** (32 / 2523)
        linear = (np.maximum(v - 3424 / 4096, 0) / (2413 / 128 - 2392 / 128 * v)) ** (16384 / 2610) * 10000
    elif transfer == 18:
        scene = np.where(x <= .5, x*x/3, (np.exp((x-.55991073)/.17883277)+.28466892)/12)
        weights = [.2627, .6780, .0593] if space == 'ITU-R BT.2020' else RGB_COLOURSPACES[space].matrix_RGB_to_XYZ[1]
        linear = scene * np.sum(scene * weights, axis=-1, keepdims=True) ** .2 * 1000
    elif transfer in [8, 13, 1]:
        # libjxl may return a normalized DATA encoding rather than ORIGINAL.
        if transfer == 8:
            linear = x
        elif transfer == 13:
            linear = np.where(x <= .04045, x / 12.92, ((x + .055) / 1.055) ** 2.4)
        else:
            linear = np.where(x < .081, x / 4.5, ((x + .099) / 1.099) ** (1/.45))
        matrix = matrix_RGB_to_RGB(RGB_COLOURSPACES[space], RGB_COLOURSPACES['ACEScg'], 'CAT02')
        result = (linear @ matrix.T).astype(np.float32)
        assert np.isfinite(result).all()
        return result
    else:
        raise AssertionError(('Unexpected DATA transfer', profile))
    matrix = matrix_RGB_to_RGB(RGB_COLOURSPACES[space], RGB_COLOURSPACES['ACEScg'], 'CAT02')
    result = ((linear * (.18 / white)) @ matrix.T).astype(np.float32)
    assert np.isfinite(result).all() and result.max() > .18, 'Finite HDR source required'
    return result


def prepare(folder):
    folder = Path(folder); folder.mkdir(parents=True, exist_ok=True)
    original = Path('D:/Photos/HDR Test Images/e053a5bf16a9398eaa3da890-900x1200.jxl')
    real = folder / 'real.jxl'
    if not real.exists():
        shutil.copyfile(original, real)
    digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
    assert digest(real) == digest(original), 'Shared real JXL differs from original'
    photos = [str(real)]
    # Large constant blocks avoid resampling colour edges dominating the metric.
    colours = np.array([[.72,.31,.12],[.16,.63,.43],[.51,.23,.81],[.9,.9,.9]], np.float32)
    values = np.repeat(np.repeat(colours.reshape(2,2,3), 48, axis=0), 48, axis=1)
    for space, primaries in [('p3',11), ('srgb',1), ('bt2020',9)]:
        for transfer, code in [('pq',16), ('hlg',18)]:
            target = folder / f'{space}-{transfer}.jxl'
            target.write_bytes(imagecodecs.jpegxl_encode(values, lossless=True, distance=0,
                usecontainer=True, primaries=primaries, transfer=code))
            photos.append(str(target))
    # Cheap source-only coverage at both whites; no sidecars or grades are saved.
    for photo in photos:
        for white in [100,203]:
            oracle(Path(photo), white)
    return dict(photos=photos, real_sha256=digest(real))


def compare(file):
    rows = json.loads(Path(file).read_text())['rows']; results = []
    for row in rows:
        meta = row['meta']; white = meta['white']
        source = oracle(Path(row['photo']), white)
        # Import policy projects negative AP1 channels toward the maximum neutral.
        affected = np.any(source < 0, axis=-1)
        if np.any(affected):
            values = source[affected].astype(np.float64)
            lo, hi = values.min(axis=-1, keepdims=True), values.max(axis=-1, keepdims=True)
            source[affected] = np.where(hi > 0, hi * (values-lo) / np.maximum(hi-lo, 1e-30), 0).astype(np.float32)
        image = reduce_picture(source, meta['edge'])
        grade = AdjustmentState.model_validate(meta['adjustments'])
        grade.hdr.highlight_compression_target_nits = 1000
        checks = []
        for lane in ['hdr','sdr']:
            expected = apply_adjustments(image, grade, PreviewKind(lane), include_grain=True,
                include_output_highlight_compression=False, color_context=RenderColorContext(white))
            expected = apply_hdr_output_highlight_compression(expected, grade, color_context=RenderColorContext(white)) if lane == 'hdr' else apply_sdr_output_highlight_compression(expected, grade)
            actual = np.frombuffer(base64.b64decode(row['lanes'][lane]), dtype='<f2').reshape(meta['height'],meta['width'],3).astype(np.float32)
            assert np.isfinite(actual).all()
            metric = compare_finished_pixels(expected, actual, lane)
            checks.append(dict(lane=lane, mean=metric.mean, p999=metric.p999, passed=metric.passed))
        results.append(dict(photo=Path(row['photo']).name, white=white, checks=checks))
    return results


if __name__ == '__main__':
    print(json.dumps(prepare(sys.argv[2]) if sys.argv[1] == 'prepare' else compare(sys.argv[2])))
