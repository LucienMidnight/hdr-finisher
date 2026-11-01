"""Compare full finished fixture arrays; retain hashes and small review images."""
import hashlib,json,sys
from pathlib import Path
import numpy as np
from PIL import Image
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root/'backend'));out=root/'output/library-freeze-pixels';rows=[];failures=[]
edges=[int(sys.argv[1])] if len(sys.argv)>1 else [640,2560]
assert all(edge in [640,2560] for edge in edges)
for edge in edges:
 dirs=[out/phase/str(edge) for phase in ['before','after']]
 reports=[json.loads((d/'report.json').read_text(encoding='utf-8')) for d in dirs]
 for phase,report in zip(['before','after'],reports):
  for r in report['rows']:r['capture_phase']=phase
  retry=out/('retry-'+phase)/str(edge)/'report.json'
  if retry.exists():
   replacement=json.loads(retry.read_text(encoding='utf-8'))
   assert replacement.get('complete'),'Incomplete retry'
   by_name={r['name']:i for i,r in enumerate(report['rows'])}
   for r in replacement['rows']:
    r['capture_phase']='retry-'+phase;report['rows'][by_name[r['name']]]=r
 assert all(r.get('complete') and len(r['rows'])==50 for r in reports), 'Incomplete fixture pass'
 for a,b in zip(*[r['rows'] for r in reports]):
  assert a['name']==b['name']
  row={'name':a['name'],'edge':edge,'before_capture':a['capture_phase'],'after_capture':b['capture_phase'],'checks':[]};rows.append(row)
  if a.get('error') or b.get('error'):
   row.update(before_error=a.get('error'),after_error=b.get('error'),pixels_verified=False)
   row['same_outcome']=a.get('error') == b.get('error')
   if not row['same_outcome']:failures.append(row)
   continue
  for lane in ['sdr','hdr']:
   paths=[out/r['capture_phase']/str(edge)/r['lanes'][lane] for r in [a,b]]
   hashes=[hashlib.sha256(p.read_bytes()).hexdigest() for p in paths]
   exact=hashes[0]==hashes[1]
   finite=all(np.isfinite(np.fromfile(p,dtype='<f2')).all() for p in paths)
   check={'lane':lane,'sha256':hashes,'exact':exact,'max_difference':0 if exact else None,'finite':bool(finite),'passed':exact and bool(finite)};row['checks'].append(check)
   if exact and not finite: failures.append({'name':a['name'],'edge':edge,**check})
   if not exact:
    arrays=[np.fromfile(p,dtype='<f2').reshape(r['height'],r['width'],3).astype(np.float32) for p,r in zip(paths,[a,b])]
    if arrays[0].shape!=arrays[1].shape:check['error']='dimensions differ'
    else:
     check['max_difference']=float(np.max(np.abs(arrays[0]-arrays[1])))
     import colour
     errors=[]
     space=colour.RGB_COLOURSPACES['sRGB' if lane=='sdr' else 'ACEScg']
     for y in range(0,arrays[0].shape[0],128):
      lab=[colour.XYZ_to_Lab(colour.RGB_to_XYZ(x[y:y+128],space),illuminant=space.whitepoint) for x in arrays]
      errors.append(colour.difference.delta_E_CIE2000(*lab).ravel())
     errors=np.concatenate(errors);check.update(mean_delta_e2000=float(errors.mean()),p999_delta_e2000=float(np.percentile(errors,99.9)))
     check['passed']=a['name']=='DSCF6495.RAF' and check['mean_delta_e2000']<1 and check['p999_delta_e2000']<=3
    if not check['passed']:
     failures.append({'name':a['name'],'edge':edge,**check})
     for phase,array in zip(['before','after'],arrays):
      image=np.maximum(array,0)
      if lane=='hdr':
       from hdr_finisher.color import acescg_to_linear_srgb
       image=acescg_to_linear_srgb(image)
      image=np.clip(image,0,1);image=np.where(image<=.0031308,image*12.92,1.055*image**(1/2.4)-.055)
      im=Image.fromarray(np.rint(np.clip(image,0,1)*255).astype('uint8'));im.thumbnail((600,400));im.save(out/f'{edge}-{a["name"]}-{lane}-{phase}.png')
summary={'rows':rows,'failures':failures,'exact_lanes':sum(c['exact'] for r in rows for c in r['checks']),'verified_photos':sum(bool(r['checks']) for r in rows),'unavailable_photos':sum(not r['checks'] for r in rows)}
(out/('comparison-'+str(edges[0])+'.json' if len(edges)==1 else 'comparison.json')).write_text(json.dumps(summary,indent=2))
if failures:
 html='<html><body><h1>Fixture differences</h1>'
 for f in failures:
  html+='<pre>'+json.dumps(f,indent=2)+'</pre>'
  if 'lane' in f:
   for phase in ['before','after']:html+=f'<img width="600" src="{f["edge"]}-{f["name"]}-{f["lane"]}-{phase}.png">'
 (out/'review.html').write_text(html+'</body></html>')
else:
 (out/'review.html').unlink(missing_ok=True)
print(json.dumps({k:v for k,v in summary.items() if k!='rows'}))
sys.exit(bool(failures))
