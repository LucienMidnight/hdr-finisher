"""M10 medians and joined per-selection traces. No app or source-folder writes."""
import json,statistics as S
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'output/library-disk-reader-trial'
disk=json.loads((OUT/'disk.json').read_text());gpu=json.loads((OUT/'gpu.json').read_text())
paths=disk['manifest']['paths'];med=S.median
summary={'complete':gpu['complete'],'disk':[],'viewed':[],'background':{},'browse':[]}
for chunk in [0,4194304,1048576,262144]:
 rows=[r for r in disk['batches'] if r['chunk']==chunk];yield_rows=[r for r in disk['yield'] if r['chunk']==chunk]
 files=[{'index':i,'name':Path(paths[i]).name,'read_ms':med(next(f['read_ms'] for f in r['files'] if f['index']==i) for r in rows)} for i in range(6)]
 summary['disk'].append({'piece_bytes':chunk,'files_per_second':med(r['files_per_second'] for r in rows),'MB_per_second':med(r['MB_per_second'] for r in rows),'slowest_file':max(files,key=lambda r:r['read_ms']),'yield_median_ms':med(r['request_to_read_start_ms'] for r in yield_rows),'yield_max_ms':max(r['request_to_read_start_ms'] for r in yield_rows)})
for cached in [True,False]:
 rows=[r for r in gpu['viewed'] if r['cached']==cached];files=[]
 for i in range(6):
  samples=[r for r in rows if r['index']==i]
  if not samples:continue
  files.append({'index':i,'name':Path(paths[i]).name,'ms':med(r['end_to_end_ms'] for r in samples),'samples':len(samples),'stages':{k:med(r['meta'][k] for r in samples) for k in ['read_ms','unpack_ms','develop_ms','pack_ms']},'handoff_draw_ms':med(r['handoff_draw_ms'] for r in samples)})
 summary['viewed'].append({'cached':cached,'median_ms':med(f['ms'] for f in files),'slowest':max(files,key=lambda f:f['ms']),'files':files})
bg=gpu['background'];summary['background']={'photos_per_second':med(r['photos_per_second'] for r in bg),'foreground_ms':med(r['foreground']['end_to_end_ms'] for r in bg),'batches':[]}
for r in bg:
 start=min(t['read_start_at'] for t in r['status']['traces'].values())
 summary['background']['batches'].append({'repeat':r['repeat'],'wall_ms':r['wall_ms'],'all_reads_end_ms':max(t['read_end_at'] for t in r['status']['traces'].values())-start,'disk_io_ms':sum(t['read_ms'] for t in r['status']['traces'].values()),'slowest_preparation':max([{'index':d['meta']['index'],'name':Path(paths[d['meta']['index']]).name,'ms':d['meta']['prepare_ms'],'worker_queue_ipc_ms':d['meta']['decode_start_at']-d['meta']['submitted_at'],'result_ipc_poll_ms':d['meta']['ready_at']-d['meta']['decode_end_at'],'handoff_draw_ms':d['handoff_draw_ms']} for d in r['rows']],key=lambda f:f['ms'])})
long=gpu.get('background_long',[])
if long:
 summary['background_long']={'photos_per_second':med(r['photos_per_second'] for r in long),'batches':[]}
 for r in long:
  tr=list(r['status']['traces'].values());span=max(t['read_end_at'] for t in tr)-min(t['read_start_at'] for t in tr);io=sum(t['read_ms'] for t in tr)
  summary['background_long']['batches'].append({'repeat':r['repeat'],'wall_ms':r['wall_ms'],'reader_span_ms':span,'io_ms':io,'disk_busy_fraction':io/span,'all_thirty_disk_files_per_second':30000/span,'all_thirty_disk_MB_per_second':sum(t['raw_bytes'] for t in tr)/1000/span,'last_read_finished_before_last_draw_ms':r['wall_ms']-span})
traces=[]
for name in ['steady','fast','maximum','burst','cold-jump','cached-burst']:
 rows=[r for r in gpu['browse'] if r['scenario']['name']==name]
 if not rows:continue
 summary['browse'].append({'name':name,'sharp_median':med(r['sharp_ready_at_selection'] for r in rows),'sharp_counts':[r['sharp_ready_at_selection'] for r in rows],'count':rows[0]['scenario']['count'],'stop_median_ms':med(r['final_wait_ms'] for r in rows if r['final_wait_ms'] is not None),'stop_max_ms':max(r['final_wait_ms'] for r in rows if r['final_wait_ms'] is not None),'max_selection_lateness_ms':max(r['max_selection_lateness_ms'] for r in rows),'errors':[e for r in rows for e in r['errors']]})
 for r in rows:
  drawn={d['index']:d for d in r['draws']};ready={d['index']:d for d in r['status']['ready']}
  joined=[]
  for row in r['rows']:
   i=row['index'];tr=r['status']['traces'].get(str(i),{});m=ready.get(i,{});d=drawn.get(i,{})
   viewed=tr.get('viewed_requested_at');read_start=tr.get('read_start_at');end=tr.get('read_end_at')
   j={**row,'name':Path(paths[i]).name,'read_wait_from_viewed_ms':max(0,read_start-viewed) if read_start is not None and viewed is not None else None,'read_io_ms':tr.get('read_ms'),'read_elapsed_ms':end-read_start if end is not None else None,'read_pause_and_overhead_ms':end-read_start-tr['read_ms']-tr.get('read_copy_ms',0) if end is not None else None,'read_copy_ms':tr.get('read_copy_ms'),'worker_queue_ipc_ms':m['decode_start_at']-m['submitted_at'] if m else None,'unpack_ms':m.get('unpack_ms'),'development_ms':m.get('develop_ms'),'metadata_ms':m.get('metadata_ms'),'look_ms':m.get('look_ms'),'pack_ms':m.get('pack_ms'),'result_ipc_poll_ms':m['ready_at']-m['decode_end_at'] if m else None,'upload_ms':d.get('conversion',{}).get('upload_ms'),'compute_ms':d.get('conversion',{}).get('compute_ms'),'draw_ms':d.get('draw',{}).get('screen_ms'),'handoff_draw_ms':d.get('handoff_draw_ms'),'draw_finished_from_run_ms':d.get('prepared_ms'),'state':'drawn' if d else 'decoded_not_drawn' if m else 'partial_or_skipped'}
   j['selection_to_service_request_ms']=(viewed-r['start']['started_at'])-row['selected_ms'] if viewed is not None else None
   j['other_decode_ms']=m['decode_end_at']-m['decode_start_at']-sum(m.get(k,0) for k in ['unpack_ms','metadata_ms','develop_ms','look_ms','pack_ms']) if m else None
   j['worker_lane']=m.get('worker_lane')
   j['read_finished_to_dispatch_ms']=m['submitted_at']-end if m and end is not None and not tr.get('prefilled') else None
   j['ready_to_draw_start_ms']=(d['prepared_ms']-d['handoff_draw_ms'])-(m['ready_at']-r['start']['started_at']) if d else None
   if row is r['rows'][-1] and d:j['draw_finish_to_visible_and_poll_ms']=row['selected_ms']+r['final_wait_ms']-d['prepared_ms']
   j['prefilled_before_run']=tr.get('prefilled',False)
   joined.append(j)
  traces.append({'name':name,'repeat':r['repeat'],'final_wait_ms':r['final_wait_ms'],'photos':joined})
sizes=[Path(p).stat().st_size for p in paths]
summary['memory']={'set_bytes':sum(sizes),'mean_file_bytes':sum(sizes)/len(sizes),'forty_at_mean_bytes':sum(sizes)/len(sizes)*40,'forty_at_max_bytes':max(sizes)*40,'max_observed_raw_bytes':max(r['status']['cache_bytes'] for r in gpu['browse']) if gpu['browse'] else None,'max_observed_partial_bytes':max(r['status']['partial_bytes'] for r in gpu['browse']) if gpu['browse'] else None,'max_raw_plus_partial_bytes':max(r['status']['cache_bytes']+r['status']['partial_bytes'] for r in gpu['browse']) if gpu['browse'] else None,'ahead':12,'capacity':40,'piece_bytes':1048576}
(OUT/'summary.json').write_text(json.dumps(summary,indent=2),encoding='utf-8');(OUT/'traces.json').write_text(json.dumps(traces,indent=2),encoding='utf-8')
print(json.dumps(summary,indent=2))
