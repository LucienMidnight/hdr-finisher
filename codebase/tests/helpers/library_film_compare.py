"""Perceptual agreement of finished Library / Grade GPU pixels, no codec."""
import base64,json,sys
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'backend'))
from hdr_finisher.delivery_colour import compare_finished_pixels
row=json.loads(Path(sys.argv[1]).read_text())
def pixels(key):
    return np.frombuffer(base64.b64decode(row[key]),dtype='<f2').reshape(row['height'],row['width'],3).astype(np.float32)
checks=[]
for key in ('actual','quick'):
    if not row.get(key): continue
    metric=compare_finished_pixels(pixels('expected'),pixels(key),row['lane'])
    checks.append(dict(draw=key,mean=metric.mean,p999=metric.p999,passed=metric.passed))
print(json.dumps(dict(photo=Path(row['photo']).name,edge=row['edge'],lane=row['lane'],checks=checks,timing=row['timing'],camera=row['camera'])))