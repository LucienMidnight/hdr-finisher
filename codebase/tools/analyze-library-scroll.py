"""Summarize retained grid pictures, owner shares and individual process charge."""
import csv, json, sys
from pathlib import Path
folder=Path(sys.argv[1]);report=json.loads((folder/'measurement.json').read_text())
rows=[json.loads(line) for line in (folder/'measurement-memory.jsonl').read_text().splitlines()]
end=report['scrollEndSample'];peak=report['scrollPeakSample'];rows=[r for r in rows if r['at']<=end['at']]
start=rows[0]['at'];scroll_start=end['at']-report['scrollSeconds']*1000
roles={v['pid']:v['type'] for row in rows for v in (row.get('electron') or {}).get('roles',[])}
python=[p for p in peak['processes'] if p['name']=='python.exe'];backend=max(python,key=lambda p:p['chargedBytes'])['pid']
roles[backend]='Backend'
for p in peak['processes']:
 if p['parentPid']==backend:roles[p['pid']]='Helper'
def grouped(row):
 result={key:0 for key in ('Browser','Tab','GPU','Backend','Helper','Other')}
 for p in row['processes']:
  key=roles.get(p['pid'],'Other');key=key if key in result else 'Other';result[key]+=p['chargedBytes']
 return result
pids=sorted({p['pid'] for row in rows for p in row['processes']})
with (folder/'process-curve.csv').open('w',newline='') as f:
 writer=csv.writer(f);writer.writerow(['observerSeconds','scrollSeconds','totalBytes']+[f'{pid}:{roles.get(pid,"Other")}' for pid in pids])
 for row in rows:
  values={p['pid']:p['chargedBytes'] for p in row['processes']}
  writer.writerow([(row['at']-start)/1000,(row['at']-scroll_start)/1000,row['totalBytes']]+[values.get(pid,0) for pid in pids])
with (folder/'finished-grid-cells.csv').open('w',newline='') as f:
 writer=csv.DictWriter(f,fieldnames=['seconds','count']);writer.writeheader();writer.writerows(report['finishedGridCells'])
shares={k:{'peakBytes':v['bytes'],'endBytes':end['caches']['caches'][k]['bytes'],'shareBytes':v['limitBytes']} for k,v in peak['caches']['caches'].items()}
with (folder/'cache-peak-end.csv').open('w',newline='') as f:
 writer=csv.writer(f);writer.writerow(['share','peakBytes','endBytes','shareBytes']);writer.writerows([k,*v.values()] for k,v in shares.items())
curve=[]
for second in [0,60,120,180,240,300]:
 sample=min(rows,key=lambda row:abs(row['at']-(scroll_start+second*1000)))
 count=min(report['finishedGridCells'],key=lambda row:abs(row['seconds']-second))['count']
 curve.append(dict(seconds=second,totalBytes=sample['totalBytes'],finishedCells=count,thumbnails=(sample.get('caches') or {}).get('caches',{}).get('thumbnails',{}).get('bytes'),**grouped(sample)))
result=dict(peakBytes=peak['totalBytes'],endBytes=end['totalBytes'],peakProcesses=grouped(peak),endProcesses=grouped(end),shares=shares,curve=curve,scrollLock=report['scrollLock'],maxFinishedCells=max(r['count'] for r in report['finishedGridCells']),cacheTelemetryAgeAtPeakMs=peak['at']-peak['caches']['at'],cacheTelemetryAgeAtEndMs=end['at']-end['caches']['at'])
result['memoryRetentionVerdict']='PASS' if result['endBytes']<=report['ceilingBytes'] and report['retention']['finishedLastMinute'] and result['shares']['thumbnails']['endBytes']>max((row.get('caches') or {}).get('caches',{}).get('thumbnails',{}).get('bytes',0) for row in rows if row['at']<=scroll_start+120000) else 'FAIL'
result['overallVerdict']='FAIL: normal-use lock exceeds 250 ms' if report['scrollLock']['hold_ms']>250 else result['memoryRetentionVerdict']
(folder/'analysis.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
