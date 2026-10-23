"""Grade DNG finished SDR/HDR checks, actual import start states and unchanged limits."""
import ast,json,statistics,sys
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'backend'))
from hdr_finisher.adjustments import apply_adjustments
from hdr_finisher.color_context import RenderColorContext
from hdr_finisher.delivery_colour import compare_finished_pixels
from hdr_finisher.models import AdjustmentState,PreviewKind
p=Path(sys.argv[1]);data=json.loads(p.read_text());folder=p.parent
report=[]
def proxy(row):
 h=row['proxy'];w,hh,stride=[int(h[k]) for k in ('x-image-width','x-image-height','x-bytes-per-row')]
 return np.fromfile(folder/row['file'],'<f4').reshape(hh,stride//4)[:,:w*4].reshape(hh,w,4)[...,:3].copy()
for row in data['rows']:
 if row['mode']!='gpu':continue
 cpu=next(r for r in data['rows'] if r['mode']=='cpu' and r['photo']==row['photo'] and r['repeat']==row['repeat'])
 a,b=proxy(cpu),proxy(row);assert a.shape==b.shape
 assert np.isfinite(a).all() and np.isfinite(b).all() and a.max()>0 and b.max()>0
 grades=[AdjustmentState.model_validate(r['session']['adjustments']) for r in (cpu,row)]
 mask=np.zeros(a.shape[:2],bool);mask[:8]=True;mask[-8:]=True;mask[:,:8]=True;mask[:,-8:]=True
 checks=[]
 for lane in ('sdr','hdr'):
  first,second=[apply_adjustments(v,grade,PreviewKind(lane),color_context=RenderColorContext(203)) for v,grade in zip((a,b),grades)]
  for region,m in [('whole',None),('borders',mask)]:
   x,y=(first,second) if m is None else (first[m][None],second[m][None])
   metric=compare_finished_pixels(x,y,lane)
   checks.append(dict(lane=lane,region=region,mean=metric.mean,p999=metric.p999,passed=metric.passed))
 report.append(dict(photo=Path(row['photo']).name,repeat=row['repeat'],source_absolute_mean=float(np.mean(np.abs(a-b))),source_absolute_max=float(np.max(np.abs(a-b))),checks=checks))
(folder/'comparison.json').write_text(json.dumps(report,indent=2))
timings=[]
for photo in dict.fromkeys(r['photo'] for r in data['rows']):
 for mode in ('cpu','gpu'):
  rows=[r for r in data['rows'] if r['photo']==photo and r['mode']==mode]
  def median(fn):return statistics.median(fn(r) for r in rows)
  def phases(r,name):return sum(p.get('duration_ms',0) for p in r['job']['phase_history'] if p['phase']==name)
  row=dict(photo=Path(photo).name,mode=mode,runs=len(rows),first_frame_ms=median(lambda r:r['firstFrameMs']),exact_frame_ms=median(lambda r:r['exactMs']),decode_ms=median(lambda r:phases(r,'developing_raw')),gain_ms=median(lambda r:phases(r,'dng_gain_map')),warp_ms=median(lambda r:phases(r,'dng_warp')),colour_ms=median(lambda r:phases(r,'dng_colour')))
  if mode=='gpu':
   diagnostics=[ast.literal_eval(r['session']['metadata']['extra']['dng_opcode_audit'])['gpu_correction'] for r in rows]
   row['correction']={key:statistics.median(d[key] for d in diagnostics) for key in ('total_ms','queue_ms','prepare_handoff_ms','result_copy_ms','memory_peak_bytes','reserved_bytes','input_handoff_and_initialization_ms','output_handoff_ms')}
   row['gpu_stages_ms']={key:statistics.median(d['timings_ms'].get(key,0) for d in diagnostics) for key in ('permits','upload','gain_map','warp_colour_measure','readback')}
  timings.append(row)
summary=dict(quality=report,timings=timings)
(folder/'summary.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary))
assert all(c['passed'] for r in report for c in r['checks'])
