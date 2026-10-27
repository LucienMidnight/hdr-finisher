"""Generate independent CPU reference pixels for the isolated GPU driver."""
import json,sys
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from hdr_finisher.hsl import HSLRange,from_lab,selection
from hdr_finisher.hsl_selection import prepare,select
rng=np.random.default_rng(42)
h,w=129,257
lab=np.zeros((h,w,3),np.float32);lab[...,0]=.6
angle=np.radians(109+rng.normal(0,18,(h,w)))
lab[...,1]=.12*np.cos(angle);lab[...,2]=.12*np.sin(angle)
lab[:,160:,1:]=0
rgb=from_lab(lab).astype(np.float32)
rgb[:,158:160]*=8
ranges=[HSLRange(center=109,width=15,feather=21)]
weight,target=select(prepare(rgb),ranges)
before=selection(rgb,ranges)[0]
path=Path(__file__).resolve().parents[1]/'output/hsl-selection-engine'
path.mkdir(parents=True,exist_ok=True)
payload=dict(width=w,height=h,pixels=rgb.tolist(),weight=weight.tolist(),target=target.tolist(),
             ranges=[r.model_dump() for r in ranges],
             noisy_std_before=float(before[16:112,16:140].std()),
             noisy_std_after=float(weight[16:112,16:140].std()),selected_mean=float(weight[16:112,16:140].mean()),
             fringe_mean=float(weight[:,158:160].mean()),neutral_mean=float(weight[:,180:].mean()))
(path/'fixture.json').write_text(json.dumps(payload))
print(json.dumps({k:v for k,v in payload.items() if k not in ('pixels','weight','target')}))
