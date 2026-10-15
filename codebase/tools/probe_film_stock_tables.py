"""Report unchanged 33-cubed table errors against pinned local spektrafilm.

Run with output/film-bake-venv/Scripts/python.exe from ai. Needs the pinned
checkout at output/spektrafilm-phase1 (same dependency setup as the baker).
Samples 1,000 uniform linear-sRGB colours, seed 0, plus 256 greys.
"""
import sys,json,subprocess
from pathlib import Path
import numpy as np
root=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(root/'codebase/tools'))
sys.path.insert(0,str(root/'codebase/backend'))
import bake_film_stocks as bake
clone=root/'output/spektrafilm-phase1'
revision=subprocess.check_output(['git','-c',f'safe.directory={clone.as_posix()}','-C',str(clone),'rev-parse','HEAD'],text=True).strip()
if revision != bake.SOURCE_REVISION:
 raise ValueError(f'Expected {bake.SOURCE_REVISION}, found {revision}')
bake.setup_spektrafilm(clone)
from hdr_finisher.film_stock import load_film_stock,render_film_stock,stock_parameters
from types import SimpleNamespace
import spektrafilm.runtime.stages.scanning as scanning
scanning.add_glare=bake.mean_glare
rng=np.random.default_rng(0)
rgb=np.vstack([rng.random((1000,3)),np.repeat(np.linspace(0,1,256)[:,None],3,axis=1)])
def encode(v):
 v=np.clip(v,0,1)
 return np.where(v<=0.0031308,12.92*v,1.055*v**(1/2.4)-0.055)*255
report={}
for stock_id in ['fujifilm_c200','kodak_vision3_500t']:
 pipe=bake.build_pipeline(bake.build_params(stock_id))
 pipe.scanner.unsharp_mask=(0,0)
 pipe.scanner.lens_blur=0
 reference=pipe.process(rgb[None])[0]
 look=SimpleNamespace(stock_exposure=0,stock_separation=0,stock_print_warmth=0,stock_print_tint=0,stock_preflash=0)
 ours=render_film_stock(load_film_stock(stock_id),rgb.astype(np.float32),stock_parameters(look))
 diff=np.abs(encode(ours)-encode(reference))
 worst=np.argsort(diff.max(axis=1))[-5:][::-1]
 report[stock_id]={'mean_levels':float(diff.mean()),'max_levels':float(diff.max()),'worst':[{'linear_srgb':rgb[i].tolist(),'channel':'RGB'[int(np.argmax(diff[i]))],'levels':float(diff[i].max())}for i in worst]}
print(json.dumps(report,indent=2))
(root/'output/phase3-table-result.json').write_text(json.dumps(report,indent=2))
