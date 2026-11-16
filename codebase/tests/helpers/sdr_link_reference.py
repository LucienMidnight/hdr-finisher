"""Small deterministic linked SDR renderer references; disposable output only."""
import json
from pathlib import Path
import sys
import numpy as np
import tifffile
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
from hdr_finisher.models import AdjustmentState, LocalAdjustment, MaskExpression, MaskLeaf, PreviewKind, OutputFinishingSettings
from hdr_finisher.adjustments import apply_adjustments, apply_sdr_output_highlight_compression
from hdr_finisher.finishing import apply_output_finishing

out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
source = tifffile.imread(Path(__file__).parents[1] / 'fixtures/hdr_match_scene.tiff').astype(np.float32)
tifffile.imwrite(out / 'source.tiff', source, photometric='rgb')
rows = []
for index, stock in enumerate(('none', 'kodak_portra_400', 'kodak_ektar_100', 'fujifilm_velvia_100')):
    for effects in (False, True):
        a = AdjustmentState(); a.sdr.linked_to_hdr = True; a.sdr.use_authored_base = False
        a.hdr.exposure = .2; a.hdr.contrast = .12; a.hdr.saturation = .1
        a.hdr.film_look.film_stock = stock; a.hdr.film_look.look_strength = 50
        a.sdr.highlight_compression_mode = 'soft_ceiling'; a.sdr.highlight_compression_start_percent = 95
        a.sdr.highlight_compression_softness = 100
        a.sdr.highlight_compression_mode = ('fixed_cap' if effects else 'soft_ceiling') if index % 2 == 0 else ('clip' if effects else 'peak_fit')
        if index == 2:
            a.sdr.output_exposure = .1
        locals_ = []
        if effects:
            a.hdr.film_look.grain_amount = 20
            a.hdr.film_look.halation_amount = 10
            a.hdr.detail.softness = 10
            a.hdr.film_look.lens_filter = "black_pro_mist"
            one, two = LocalAdjustment(name='one'), LocalAdjustment(name='overlap')
            one.hdr_grade.exposure = .2; two.hdr_grade.exposure = -.1
            one.sdr_grade.exposure = 2; two.sdr_grade.enabled = False
            hue = LocalAdjustment(name='HDR hue', mask=MaskExpression(leaf=MaskLeaf(type='hue_range', hue_center=230, hue_width=40)))
            hue.hdr_grade.saturation = .05
            locals_ = [one, two, hue]
        for lane in ('hdr', 'sdr'):
            pixels = apply_adjustments(source, a, PreviewKind(lane), local_adjustments=locals_)
            pixels.astype('<f4').tofile(out / f'{index}-{int(effects)}-{lane}.f32')
            if lane == 'sdr':
                pre = apply_adjustments(source, a, PreviewKind.SDR, local_adjustments=locals_, include_output_highlight_compression=False)
                delivered = apply_output_finishing(pre, OutputFinishingSettings(resize_mode='original', sharpening='off'), PreviewKind.SDR)
                delivered = apply_sdr_output_highlight_compression(delivered, a)
                delivered.astype('<f4').tofile(out / f'{index}-{int(effects)}-delivery.f32')
        rows.append(dict(name=f'{index}-{int(effects)}', adjustments=a.model_dump(), locals=[x.model_dump() for x in locals_]))
(out / 'cases.json').write_text(json.dumps(dict(width=source.shape[1], height=source.shape[0], rows=rows)))
