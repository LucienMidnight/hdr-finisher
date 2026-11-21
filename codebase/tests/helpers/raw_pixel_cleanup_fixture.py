from __future__ import annotations

import base64
import json
from pathlib import Path
import sys
from types import SimpleNamespace

import numpy as np

sys.path[:0] = [str(Path(__file__).resolve().parents[2]), str(Path(__file__).resolve().parents[2] / 'backend')]
from signed_raw_fixture import compare
from hdr_finisher import raw_import, raw_pixel_cleanup, raw_speck_cleanup
from hdr_finisher.color import _ACESCG_TO_LINEAR_BT2020
from hdr_finisher.models import RawImportSettings
from hdr_finisher.signed_raw import demosaic


def fixtures():
    patterns = [[[0, 1], [3, 2]], [[1, 0], [2, 3]], [[3, 2], [0, 1]], [[2, 3], [1, 0]]]
    cases = []
    for pattern in patterns:
        channels = np.asarray(pattern)
        colours = np.asarray([0, 1, 2, 1])[channels]
        black = np.asarray([1000, 1010, 1020, 1030])
        white = np.asarray([13000, 13020, 13040, 13060])
        rgb_black = np.asarray([black[np.asarray([0, 1, 2, 1]) == colour].mean() for colour in range(3)])
        rgb_white = np.asarray([white[np.asarray([0, 1, 2, 1]) == colour].mean() for colour in range(3)])
        wb = np.asarray([1.8, 1, 1.3], np.float32)
        sensor = (np.tile(black[channels], (20, 24)) - 24
                  + np.random.default_rng(90).integers(-2, 3, (40, 48))).astype(np.uint16)
        for row, column in ((10, 10), (10, 31), (31, 10), (31, 31)):
            sensor[row, column] = 7000
        sensor[18, 18], sensor[18, 19] = 7000, 2800
        sensor[20, 34], sensor[21, 35] = 7000, 12900
        sensor[5, 40] = 14000
        thresholds = raw_pixel_cleanup.cleanup_thresholds()
        relative = thresholds[1] < 0
        sensor[28, 20] += 180
        camera = SimpleNamespace(raw_pattern=channels, raw_channel_to_rgb=np.asarray([0, 1, 2, 1]),
            raw_black_level=black, raw_white_level=white, as_shot_wb=wb)
        config = dict(noise=[dict(a=.00001 * (phase + 1), b=.0000002 * (phase + 1)) for phase in range(4)],
            black=black[channels].ravel().tolist(), spans=(white - black)[channels].ravel().tolist(),
            colours=colours.ravel().tolist(), thresholds=thresholds)
        for enabled, specks, threshold in ((False, False, 2.5), (True, False, 2.5),
                                           (False, True, 2), (False, True, 2.5),
                                           (True, True, 2.5), (True, True, 4)):
            settings = RawImportSettings(pixel_cleanup={'remove_hot_pixels': enabled,
                'even_out_specks': specks, 'speck_threshold': threshold})
            cleaned = sensor.copy()
            if enabled:
                assert raw_pixel_cleanup.apply(cleaned, config) == 4 + relative
            if specks:
                assert raw_speck_cleanup.apply(cleaned, config, threshold) > 0
            transported = cleaned.copy() if specks else sensor
            raw_import._apply_raw_highlight_reconstruction(SimpleNamespace(raw_image_visible=cleaned), camera, settings)
            expected = demosaic(cleaned, colours, black[channels], np.eye(3))
            expected *= (1 / (rgb_white - rgb_black)).astype(np.float32)
            expected *= wb
            for flip in (0, 3, 5, 6):
                meta = dict(width=48, height=40, flip=flip, cfa_raw=channels.ravel().tolist(),
                    cfa_rgb=colours.ravel().tolist(), raw_black=black.tolist(), raw_white=white.tolist(),
                    rgb_black=rgb_black.tolist(), rgb_white=rgb_white.tolist(), wb=wb.tolist(),
                    threshold=raw_import.OPPOSED_COLOR_THRESHOLD_SAFETY, camera_to_acescg=np.eye(3).tolist(),
                    xyz_cam=np.eye(3).tolist(), acescg_to_bt2020=np.asarray(_ACESCG_TO_LINEAR_BT2020).T.tolist(),
                    calibration_gain=1, sample_stride=1, raw_import_settings=settings.model_dump(mode='json'),
                    pixel_cleanup=config if enabled and not specks else None, pixel_cleanup_applied=specks)
                case = dict(meta=meta, mosaic=base64.b64encode(transported.astype('<u2').tobytes()).decode(),
                    expected=base64.b64encode(expected.astype('<f4').tobytes()).decode())
                if not specks:
                    legacy = json.loads(json.dumps(meta))
                    legacy['raw_import_settings']['pixel_cleanup'] = {'remove_hot_pixels': enabled}
                    del legacy['pixel_cleanup_applied']
                    case['identical_to'] = len(cases)
                    cases.append(dict(case, meta=legacy))
                    del cases[-1]['identical_to']
                cases.append(case)
    return cases


if __name__ == '__main__':
    if len(sys.argv) == 1:
        print(json.dumps(fixtures()))
    else:
        receipt = json.loads(Path(sys.argv[1]).read_text())
        print(json.dumps(compare(receipt['cases'], receipt['results'])))
