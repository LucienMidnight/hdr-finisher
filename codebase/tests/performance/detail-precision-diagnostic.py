"""Compare pre-Detail rounding and early clipping on a native patch; never saves input."""
import argparse
import json
from pathlib import Path

import numpy as np

from reference_session import isolate_source_cache, open_reference_session
from preview_export_compare import export_to_presentation_linear, presentation_space


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--project', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--x', type=int, required=True)
    parser.add_argument('--y', type=int, required=True)
    args = parser.parse_args()
    isolate_source_cache(args.output.parent / 'detail-precision-source-cache')
    _, session = open_reference_session(args.project)
    from hdr_finisher import adjustments
    from hdr_finisher.detail import apply_detail, _gaussian_blur, _local_extrema
    from hdr_finisher.exporters import _finishing_adjustments_for_export, _render_export_branch
    from hdr_finisher.models import ExportSettings, PreviewKind

    class Captured(Exception):
        pass

    def capture(image, detail, kind, **kwargs):
        # This diagnostic deliberately stops before whole-frame Detail/export.
        # Only Sharpen is active: this patch includes its complete neighbourhood.
        if detail.texture_amount or detail.clarity_amount:
            raise ValueError('Diagnostic requires isolated Sharpen')
        radius = 64
        x, y = args.x, args.y
        patch = image[y-radius:y+radius+1, x-radius:x+radius+1].copy()
        rounded = patch.astype(np.float16).astype(np.float32)
        full = apply_detail(patch, detail, kind, **kwargs)
        half = apply_detail(rounded, detail, kind, **kwargs)
        early_clipped = apply_detail(np.maximum(rounded, 0), detail, kind, **kwargs)
        white = float(session.hdr_reference_white_nits)
        space = presentation_space('hdr', True, white)
        to_y = space['toXyz'][1]
        a = export_to_presentation_linear(full, lane='hdr', hdr_surface=True, reference_white_nits=white)
        b = export_to_presentation_linear(half, lane='hdr', hdr_surface=True, reference_white_nits=white)
        clipped = export_to_presentation_linear(early_clipped, lane='hdr', hdr_surface=True, reference_white_nits=white)
        ya, yb = float(a[radius,radius] @ to_y), float(b[radius,radius] @ to_y)
        log_y = np.log2(np.maximum(patch @ np.array([.2722287,.6740818,.0536895],np.float32),1e-4))
        blur = _gaussian_blur(log_y,detail.sharpen_radius_px)
        lo,hi = _local_extrema(log_y)
        report = {'pixel': {'x': x, 'y': y}, 'sourceRgb': patch[radius,radius].tolist(),
                  'halfRgb': rounded[radius,radius].tolist(), 'fullDetailRgb': full[radius,radius].tolist(),
                  'halfDetailRgb': half[radius,radius].tolist(), 'displayYFull': ya, 'displayYHalf': yb,
                  'relativeY': abs(ya-yb)/max(ya,.01*space['white']),
                  'earlyClippedDisplayY':float(clipped[radius,radius] @ to_y),
                  'earlyClippedRelativeY':float(abs((clipped[radius,radius] @ to_y)-ya)/max(ya,.01*space['white'])),
                  'logY':float(log_y[radius,radius]), 'sharpenBase':float(blur[radius,radius]),
                  'extrema':[float(lo[radius,radius]),float(hi[radius,radius])],
                  'scope': 'pre-Detail half rounding and early clipping; source transport and later locals excluded'}
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
        print(json.dumps(report))
        raise Captured()

    original = adjustments.apply_detail
    adjustments.apply_detail = capture
    try:
        _render_export_branch(session, ExportSettings(), PreviewKind.HDR, _finishing_adjustments_for_export(session))
    except Captured:
        pass
    finally:
        adjustments.apply_detail = original


if __name__ == '__main__':
    main()
