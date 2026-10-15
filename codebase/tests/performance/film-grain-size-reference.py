"""Scan reference and CPU fallback for the Fit grain acceptance matrix."""
import json
import os
import sys
from pathlib import Path
import numpy as np
from PIL import Image
root = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(root / 'codebase/backend'))
os.environ['HDR_FINISHER_SOURCE_CACHE_DIR'] = str(root / 'output/phase3-grain/source-cache')
from hdr_finisher.sessions import SessionStore
from hdr_finisher.models import AdjustmentState, ExportSettings, OutputFinishingSettings, PreviewKind
from hdr_finisher.exporters import _render_export_branch
from hdr_finisher.finishing import apply_output_finishing
from hdr_finisher.main import encode_processed_rgba8

work = root / 'output/phase3-grain'
store = SessionStore()
report = []
failures = []
# Accept at most 15% grain RMS error and one 8-bit display level.
# This excludes the visibly stronger old preview (~30% RMS error).
# Box quadrature approximates Lanczos, so exact per-pixel noise is not pinned.
# The old 30% stronger reduced grain must fail; native retains strict parity.
MAX_STRENGTH_RATIO_ERROR = 0.15
MAX_STRENGTH_LEVEL_ERROR = 1.0

def encoded(image, kind):
    return np.frombuffer(encode_processed_rgba8(image, kind), np.uint8).reshape(*image.shape[:2], 4)

for record in json.loads((work / 'matrix.json').read_text()):
    payload = store.create_session(work / (record['fixture'] + '.tiff'))
    session = store.get(payload.session_id)
    recipe = AdjustmentState.model_validate(record['recipe'])
    kind = PreviewKind(record['lane'])
    session.adjustments = recipe
    native = _render_export_branch(session, ExportSettings(output_finishing=OutputFinishingSettings(sharpening='off')), kind, recipe)
    np.save(work / f"native-{record['fixture']}-{record['lane']}-{record['format']}.npy", native)
    references = {}
    for capture in record['captures']:
        edge = capture['edge']
        if edge not in references:
            # Resize the completed native scan with the export's own finisher.
            # The fixture leaves output highlight compression neutral.
            reference = encoded(apply_output_finishing(native, OutputFinishingSettings(resize_mode='long_edge', long_edge=edge, sharpening='off'), kind), kind)
            fallback = encoded(session.render_cache.adjusted_frame(recipe, kind, edge), kind)
            references[edge] = (reference, fallback)
        reference, fallback = references[edge]
        gpu = np.asarray(Image.open(work / capture['file']))
        h,w = reference.shape[:2]
        patches = [('grey',0,0)] if record['fixture']=='flat' else [
            ('grey',0,0),('dark',0,1),('colour',1,0),('white',1,1)]
        for patch,y,x in patches:
            crop = (slice(y*h//2+80,(y+1)*h//2-80),slice(x*w//2+80,(x+1)*w//2-80))
            reference_patch = reference[crop][...,:3].astype(float)
            ref_std = float(reference_patch.std(axis=(0,1)).mean())
            for route, candidate in [(capture['route'],gpu)] + ([('cpu',fallback)] if capture['route']=='direct' else []):
                candidate_patch = candidate[crop][...,:3].astype(float)
                std = float(candidate_patch.std(axis=(0,1)).mean())
                error = abs(std / max(ref_std,1e-10) - 1)
                difference = np.abs(candidate_patch-reference_patch)
                bias = float(np.abs(candidate_patch.mean(axis=(0,1))-reference_patch.mean(axis=(0,1))).max())
                ok = error <= MAX_STRENGTH_RATIO_ERROR and abs(std-ref_std) <= MAX_STRENGTH_LEVEL_ERROR and bias <= 1.0
                if edge == 2400:
                    # Existing native parity limits apply to the complete frame,
                    # not separately to the stock shader's hardest colour patch.
                    native_difference = np.abs(candidate[...,:3].astype(float)-reference[...,:3].astype(float))
                    ok = ok and float(native_difference.mean()) <= 0.1 and float(np.percentile(native_difference,99.9)) <= 2
                row = dict(fixture=record['fixture'],patch=patch,lane=record['lane'],format=record['format'],edge=edge,route=route,mean=float(difference.mean()),mean_bias=bias,preview_std=std,export_std=ref_std,strength_error=error,ok=ok)
                report.append(row)
                if not ok: failures.append(row)
        crop = (slice(80,h//2-80),slice(80,w//2-80))
        Image.fromarray(np.concatenate([gpu[crop][:256,:384], reference[crop][:256,:384]], axis=1)).save(work / ('comparison-' + capture['file']))
    print(f"{record['fixture']} {record['lane']} {record['format']}: complete", flush=True)
(work / 'result.json').write_text(json.dumps(report,indent=2))
print(json.dumps(dict(cases=len(report),failures=failures),indent=2))
if failures: raise SystemExit(1)
