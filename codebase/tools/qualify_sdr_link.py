"""Re-Match the original 49 trial cases with both approved ordering policies."""
from pathlib import Path
import argparse
import json
import sys
import subprocess
import hashlib
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from hdr_finisher.models import AdjustmentState, PreviewKind
from hdr_finisher.adjustments import apply_adjustments
from hdr_finisher.sdr_match import (_materialize_sdr_match_impl, SDRMatchMaterializationError, build_sdr_match_target)
from hdr_finisher.sdr_link import try_linked_match
from linked_sdr_tail_probe import frame_metrics, measure

p=argparse.ArgumentParser();p.add_argument('--output',type=Path,default=Path('output/review/safe-link'));args=p.parse_args()
fixtures=Path('output/review/film-equal-input-trial-2026-11-16');sources=Path('output/review/m1-all-colours/reduced-sources')
args.output.mkdir(parents=True,exist_ok=True)
revision=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
backend_hashes={name:hashlib.sha256((Path('backend/hdr_finisher')/name).read_bytes()).hexdigest()
                for name in ('adjustments.py','sdr_link.py','sdr_match.py','models.py','color.py','sdr_gamut.py')}
inputs=sorted(fixtures.glob('chart*-gpu.npz'))+sorted(sources.glob('*.npz'))
input_hashes={str(file):hashlib.sha256(file.read_bytes()).hexdigest() for file in inputs}
rows=[]
for population in ('chart176','chart224','A7R00619.ARW','DSC00264.ARW','IMG_3129.CR2','IMG_0790.CR2','IMG_7723.CR3'):
    for stock,strength in [('none',0)]+[(stock,strength) for stock in ('kodak_portra_400','kodak_ektar_100','fujifilm_velvia_100') for strength in (50,100)]:
        file=fixtures/f"{population if population.startswith('chart') else 'chart176'}-{stock}-{strength}-gpu.npz"
        with np.load(file) as archive:
            a=AdjustmentState.model_validate_json(str(archive['adjustments']));source=archive['source']
        if not population.startswith('chart'):
            with np.load(sources/f'{population}.npz') as archive:source=archive['source']
        hdr=apply_adjustments(source,a,PreviewKind.HDR,include_grain=False);target=build_sdr_match_target(hdr)
        policy={}
        independent=None; independent_error=None
        for name,relative in [('old_absolute',False),('target_relative',True)]:
            linked,reason=try_linked_match(source,a,[],hdr,reference_white_nits=203,source_pixel_scale=1,relative_order=relative)
            result=linked
            if result is None:
                if independent is None and independent_error is None:
                    try:independent=_materialize_sdr_match_impl(source,a,[],reference_white_nits=203,source_pixel_scale=1,settled_hdr=hdr)
                    except SDRMatchMaterializationError as e:independent_error=str(e)
                result=independent
            entry=dict(linked=linked is not None,reason=reason,status=result.status if result else 'refused')
            if result:
                state=result.adjustments
                candidate=apply_adjustments(source,state,PreviewKind.SDR,include_grain=False)
                raised=state.model_copy(deep=True)
                if linked:raised.sdr.output_exposure+=.5
                else:raised.sdr.exposure+=.5
                raised_pixels=apply_adjustments(source,raised,PreviewKind.SDR,include_grain=False)
                entry['colour']=measure(hdr,target,candidate,raised_pixels,len(source.reshape(-1,3))) if population.startswith('chart') else frame_metrics(hdr,target,candidate,raised_pixels)
                entry['hdr_exact']=bool(np.array_equal(hdr,apply_adjustments(source,state,PreviewKind.HDR,include_grain=False)))
                entry['tail']={key:getattr(state.sdr,key) for key in ('highlight_compression_mode','highlight_compression_start_percent')}
            else:entry['error']=independent_error
            policy[name]=entry
        rows.append(dict(population=population,stock=stock,strength=strength,**policy))
        print(population,stock,strength,[policy[name]['linked'] for name in policy],flush=True)
        (args.output/'corpus.json').write_text(json.dumps(dict(revision=revision,backend_sha256=backend_hashes,input_sha256=input_hashes,rows=rows),indent=2,allow_nan=False))
print({policy:sum(row[policy]['linked'] for row in rows) for policy in ('old_absolute','target_relative')})
