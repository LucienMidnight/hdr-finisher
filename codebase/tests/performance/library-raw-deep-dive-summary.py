"""Summarize the M9 prototype's ignored JSON results and make review crops."""
from pathlib import Path
import json,statistics as stats
import numpy as np
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'output/library-raw-deep-dive'
d=json.loads((OUT/'gpu.json').read_text());summary={'floor':[],'routes':[],'stages':{},'background':d.get('background'), 'browse':d.get('browse'),'comparisons':d['comparisons'],'grade_idle_ms':d.get('grade_idle_ms'),'grade_ready':d.get('grade_after',{}).get('status'),'grade_exact':d.get('grade_after',{}).get('exact')}
for i in range(6):
 row={'index':i,'name':Path(next(r['meta']['path'] for r in d['rows'] if r['index']==i)).name}
 for threads in [1,12]:
  f=json.loads((OUT/f'floor-{threads}.json').read_text());r=[v for v in f['rows'] if v['index']==i]
  for stage in ['read','unpack']:row[f'{stage}_{threads}_ms']=stats.median(v[stage+'_ms'] for v in r)
 summary['floor'].append(row)
for route in ['cpu','gpu']:
 perfile=[{'index':i,'name':summary['floor'][i]['name'],'ms':stats.median(r['end_to_end_ms'] for r in d['rows'] if r['index']==i and r['route']==route)} for i in range(6)]
 summary['routes'].append({'route':route,'median_ms':stats.median(r['ms'] for r in perfile),'slowest':max(perfile,key=lambda r:r['ms']),'perfile':perfile})
 for k in ['read_ms','read_copy_ms','unpack_ms','metadata_ms','develop_ms','look_ms','shrink_ms','colour_ms','pack_ms','prepare_ms']:
  summary['stages'][route+'_'+k]=stats.median(stats.median(r['meta'][k] for r in d['rows'] if r['index']==i and r['route']==route) for i in range(6))
 summary['stages'][route+'_page_tail_ms']=stats.median(stats.median(r['end_to_end_ms']-r['meta']['prepare_ms'] for r in d['rows'] if r['index']==i and r['route']==route) for i in range(6))
for k in ['upload_ms','compute_ms']:
 summary['stages']['gpu_'+k]=stats.median(stats.median(r['conversion'][k] for r in d['rows'] if r['index']==i and r['route']=='gpu') for i in range(6))
summary['read_batches']=[];f=json.loads((OUT/'floor-12.json').read_text())
for lanes in [1,2,3,6]:summary['read_batches'].append({'lanes':lanes,'median_wall_ms':stats.median(r['wall_ms'] for r in f['parallel_reads'] if r['lanes']==lanes)})
(OUT/'summary.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
# Paired bright/shadow detail crops at identical screen coordinates. Screenshots
# are SDR PNGs even for the HDR rendering lane; they are not physical HDR proof.
for i in range(6):
 im=Image.open(OUT/f'comparison-{i}.png').convert('RGB');w,h=im.size;panel=w//2;tile=128
 contact=Image.new('RGB',(tile*4,2*(tile+30)),(17,17,17));draw=ImageDraw.Draw(contact)
 for row in range(2):
  lo=90 if row==0 else h//2+70;hi=h//2-10 if row==0 else h-10;candidates=[]
  for y in range(lo,hi-tile,32):
   for x in range(20,panel-tile-20,32):
    a=np.asarray(im.crop((x,y,x+tile,y+tile))).astype(float).mean(axis=2)
    if np.mean(a<8)>.05:continue
    candidates.append((float(a.mean()),x,y))
  dark=min(candidates);bright=max(candidates)
  for col,(label,p) in enumerate([('Today bright',bright),('M9 bright',bright),('Today shadow',dark),('M9 shadow',dark)]):
   _,x,y=p;x+=panel if col%2 else 0;contact.paste(im.crop((x,y,x+tile,y+tile)),(col*tile,row*(tile+30)+30));draw.text((col*tile+3,row*(tile+30)+8),('HDR' if row else 'SDR')+' '+label,fill='white')
 contact.save(OUT/f'details-{i}.png')
print(json.dumps({'routes':summary['routes'],'background':[(r['lanes'],r['photos_per_second'],r.get('grade_preview_ms')) for r in summary['background']], 'browse':[(r['interval'],r['sharp_ready_at_selection'],r['final_wait_ms']) for r in summary['browse']]},indent=2))
