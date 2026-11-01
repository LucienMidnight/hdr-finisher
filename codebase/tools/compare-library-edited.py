"""Compare finished SDR review captures; no exact pixel gate or error exclusions."""
from pathlib import Path
import json,sys
import numpy as np
from PIL import Image
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from hdr_finisher.delivery_colour import compare_finished_pixels
root=Path(__file__).resolve().parents[1]/'output/part-c-edited'
def linear(a): return np.where(a<=.04045,a/12.92,((a+.055)/1.055)**2.4)
def read(phase,name): return np.asarray(Image.open(root/phase/name).convert('RGB'),dtype=np.float32)/255
rows=[]
for name in ['grid.png','filmstrip-all.png',*[f'single-{i}.png' for i in range(5)]]:
 a,b=read('baseline',name),read('after',name)
 assert a.shape==b.shape,(name,a.shape,b.shape)
 pairs=[]
 if name=='grid.png':
  # Fixed 2560x1440 capture layout: compare pictures only, excluding labels/UI.
  pairs=[(f'grid-{i}',(57+205*i,10,152+205*i,151)) for i in range(5)]
 elif name=='filmstrip-all.png':
  pairs=[(f'filmstrip-{i}',(33+119*i,7,89+119*i,89)) for i in range(5)]
 else:
  # Remove the constant canvas matte, retaining the full photographic rectangle.
  cols=np.flatnonzero(a.std(axis=0).max(axis=1)>1/255)
  bounds=(int(cols[0]),0,int(cols[-1])+1,a.shape[0])
  pairs=[(name.removesuffix('.png'),bounds)]
 for label,(l,t,r,bottom) in pairs:
  result=compare_finished_pixels(linear(a[t:bottom,l:r]),linear(b[t:bottom,l:r]),'sdr')
  rows.append(dict(name=label,file=name,bounds=[l,t,r,bottom],mean=result.mean,p999=result.p999,passed=result.passed))
(root/'comparison.json').write_text(json.dumps(rows,indent=2),encoding='utf-8')
html=['<!doctype html><meta charset="utf-8"><title>Part C edited pictures</title><style>body{background:#17191b;color:#eee;font:16px system-ui;margin:24px}section{margin:24px 0}img{width:48%;object-fit:contain;vertical-align:top}table{border-collapse:collapse}td,th{padding:6px 14px;border-bottom:1px solid #555}</style><h1>Edited pictures: original / Part C</h1><p>Finished SDR screenshots; mean Delta E 2000 below 1, p99.9 at most 3. No pixels excluded. Steve observed intermittent VRAM corruption (bright red artifacts); inspect any flagged pair visually.</p><table><tr><th>Picture<th>Mean<th>p99.9<th>Within limits']
for row in rows: html.append(f"<tr><td>{row['name']}<td>{row['mean']:.5f}<td>{row['p999']:.5f}<td>{row['passed']}")
html.append('</table>')
for name in dict.fromkeys(r['file'] for r in rows):
 html.append(f'<section><h2>{name}</h2><img src="baseline/{name}" alt="Original"><img src="after/{name}" alt="Part C"></section>')
(root/'index.html').write_text('\n'.join(html),encoding='utf-8')
print(json.dumps(rows,indent=2))