"""CPU export half of film-grain-size-diagnostic.js; synthetic source only."""
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
from hdr_finisher.main import encode_processed_rgba8

work = root / 'output/phase3-grain'
store = SessionStore()
payload = store.create_session(work / 'fixture.tiff')
session = store.get(payload.session_id)
recipe = AdjustmentState.model_validate(json.loads((work / 'recipe.json').read_text()))
session.adjustments = recipe
report = {}
capture_sizes=json.loads((work/'capture-sizes.json').read_text())
for edge in capture_sizes['edges']:
    settings = ExportSettings(output_finishing=OutputFinishingSettings(
        resize_mode='long_edge', long_edge=edge, sharpening='off'))
    rendered = _render_export_branch(session, settings, PreviewKind.SDR, recipe)
    rgba = np.frombuffer(encode_processed_rgba8(rendered, PreviewKind.SDR), np.uint8).reshape(*rendered.shape[:2], 4)
    Image.fromarray(rgba).save(work / f'export-{edge}.png')
    gpu = np.asarray(Image.open(work / f'gpu-{edge}.png'))
    difference = np.abs(gpu[..., :3].astype(float) - rgba[..., :3].astype(float))
    # Flat mid-grey patch away from boundaries: grain strength, no picture detail.
    crop = (slice(100, rendered.shape[0]//2-100), slice(100, rendered.shape[1]//2-100))
    preview = gpu[crop][..., :3].astype(float)
    exported = rgba[crop][..., :3].astype(float)
    report[str(edge)] = dict(mean=float(difference.mean()), p999=float(np.percentile(difference,99.9)),
        preview_grain_std=float(preview.std(axis=(0,1)).mean()), export_grain_std=float(exported.std(axis=(0,1)).mean()))
    # Side-by-side 1:1 crops for visual judgement, identical encoding.
    Image.fromarray(np.concatenate([gpu[crop][:256,:384], rgba[crop][:256,:384]], axis=1)).save(work / f'comparison-{edge}.png')
print(json.dumps(report, indent=2))
(work / 'result.json').write_text(json.dumps(report, indent=2))
