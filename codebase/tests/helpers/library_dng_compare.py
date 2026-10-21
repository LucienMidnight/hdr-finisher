"""Compare the new finished pictures against matched CPU-route pictures, including borders."""
import base64,json,sys
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"backend"))
from hdr_finisher.delivery_colour import compare_finished_pixels
rows=json.loads(Path(sys.argv[1]).read_text(encoding="utf8"))["rows"]
report=[]
for row in rows:
 if row["mode"]!="gpu":continue
 cpu=next(r for r in rows if r["mode"]=="cpu" and r["repeat"]==row["repeat"])
 checks=[]
 for lane in ("hdr","sdr"):
  shape=(row["meta"]["height"],row["meta"]["width"],3)
  actual=np.frombuffer(base64.b64decode(row["lanes"][lane]),dtype="<f2").reshape(shape).astype(np.float32)
  expected=np.frombuffer(base64.b64decode(cpu["lanes"][lane]),dtype="<f2").reshape(shape).astype(np.float32)
  for region in ("whole","edges"):
   a,b=actual,expected
   if region=="edges":
    mask=np.zeros(shape[:2],bool);mask[:8]=True;mask[-8:]=True;mask[:,:8]=True;mask[:,-8:]=True
    a=a[mask].reshape(1,-1,3);b=b[mask].reshape(1,-1,3)
   metric=compare_finished_pixels(b,a,lane)
   checks.append(dict(lane=lane,region=region,mean=metric.mean,p999=metric.p999,passed=metric.passed))
   assert metric.passed,checks[-1]
 report.append(dict(repeat=row["repeat"],checks=checks))
print(json.dumps(report))
