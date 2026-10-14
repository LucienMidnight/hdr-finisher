"""Aggregate M7/M8 by median per file first; preserve slowest names.
Writes only raw summary JSON in the ignored trial output folder.
"""
import json,statistics
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'output/library-fullscreen-speed-trial'

def stat(rows,key):
    groups={}
    for r in rows:
        if 'error' in r:continue
        value=key(r) if callable(key) else r[key]
        groups.setdefault(r['path'],[]).append(value)
    med={p:statistics.median(v) for p,v in groups.items()}
    worst=max(med,key=med.get)
    return {'median':statistics.median(med.values()),'slowest':Path(worst).name,'slowest_value':med[worst],'per_file':{Path(p).name:v for p,v in med.items()}}

c=json.loads((OUT/'cpu.json').read_text());g=json.loads((OUT/'gpu.json').read_text());s={}
s['cpu']={}
for route in sorted({b['route'] for b in c['matrix']}):
    for mode in ('alone','six-threads','six-processes'):
        batches=[b for b in c['matrix'] if b['route']==route and b['mode']==mode]
        if not batches:continue
        rows=[r for b in batches for r in b['rows']]
        s['cpu'][route+'-'+mode]={k:stat(rows,k) for k in ('decode_ms','total_ms','raw_ms','shrink_ms','colour_and_other_ms','look_ms','quantize_ms','save_ms')}
        s['cpu'][route+'-'+mode]['throughput_per_second']=11/(statistics.median(b['wall_ms'] for b in batches)/1000)
        s['cpu'][route+'-'+mode]['batch_wall_ms']=statistics.median(b['wall_ms'] for b in batches)
s['sizes']={}
for route in sorted({r['route'] for r in c['sizes']}):
    for mode in ('512','2560','both'):
        rows=[r for r in c['sizes'] if r['route']==route and r['mode']==mode]
        s['sizes'][route+'-'+mode]=stat(rows,lambda r:r['total_ms'] if mode=='both' else r['decode_ms']+r['look_ms'])
s['handoff']={k:stat(g['handoff'],k) for k in ('disk_after_decode_ms','direct_after_decode_ms','disk_end_to_end_ms','direct_end_to_end_ms','save_ms')}
for route in ('disk','direct','redraw'):
    s['handoff'][route]={k:stat(g['handoff'],lambda r:r[route][k]) for k in ('screen_ms','gpu_ms')}
s['formats']={}
for fmt in dict.fromkeys(r['format'] for r in c['formats']):
    rows=[r for r in c['formats'] if r['format']==fmt];dif=[r for r in g['storage_difference'] if r['format']==fmt]
    s['formats'][fmt]={k:stat(rows,k) for k in ('bytes','write_ms','open_ms','pack_ms','ready_ms')}
    s['formats'][fmt]['sdr_mae']=stat(dif,lambda r:r['sdr']['code_mae'])
    s['formats'][fmt]['sdr_p99']=stat(dif,lambda r:r['sdr']['code_p99'])
    s['formats'][fmt]['sdr_max']=max(r['sdr']['code_max'] for r in dif)
    s['formats'][fmt]['hdr_mae']=stat(dif,lambda r:r['hdr']['relative_mae'])
    s['formats'][fmt]['hdr_max_relative_mae']=max(r['hdr']['relative_mae'] for r in dif)
s['cpu_display_difference']={'sdr_mae':stat(g['cpu_difference'],lambda r:r['sdr']['code_mae']),'sdr_max':max(r['sdr']['code_max'] for r in g['cpu_difference']),'hdr_mae':stat(g['cpu_difference'],lambda r:r['hdr']['relative_mae'])}
if g['gpu']:
    s['gpu_conversion']={k:stat(g['gpu'],k) for k in ('raw_decode_ms','upload_ms','compute_ms','readback_ms','including_roundtrip_ms')}
    s['gpu_conversion']['sdr_mae']=stat(g['gpu'],lambda r:r['sdr']['code_mae']);s['gpu_conversion']['sdr_max']=max(r['sdr']['code_max'] for r in g['gpu'])
    s['gpu_conversion']['hdr_mae']=stat(g['gpu'],lambda r:r['hdr']['relative_mae'])
if g.get('gpu_six'):
    s['gpu_six']={k:stat(g['gpu_six'],k) for k in ('decode_ms','ready_ms','upload_ms','compute_ms','including_roundtrip_ms','finished_ms')}
if g.get('current_six'):
    s['current_six']={'wall_ms':g['current_six']['wall_ms'],'draw_screen_ms':stat(g['current_six']['rows'],lambda r:r['draw']['screen_ms']),'save_ms':stat(g['current_six']['rows'],lambda r:r['meta']['save_ms'])}
if (OUT/'read-split.json').exists():
    split=json.loads((OUT/'read-split.json').read_text());s['read_split']={mode:{k:stat([r for r in split if r['mode']==mode],k) for k in ('read_ms','shrink_ms','colour_and_other_ms')} for mode in ('alone','six-threads')}
if (OUT/'cpu-step-probe.json').exists():
    probe=json.loads((OUT/'cpu-step-probe.json').read_text());s['cpu_step']={}
    for route in ('current','parallel-float32'):
        for mode in ('alone','six-threads'):
            rows=[r for r in probe['rows'] if r['route']==route and r['mode']==mode]
            s['cpu_step'][route+'-'+mode]={k:stat(rows,k) for k in ('shrink_ms','colour_ms','total_ms')}
s['browse_queue']=g.get('browse_queue');s['browse_fifo']=g.get('browse_fifo');s['best_cpu_route']=c['best_cpu_route']
s['browse_current_cpu']=g.get('browse_current_cpu')
s['browse']=g['browse'];s['memory']={k:g.get(k) for k in ('memory','ram','grade','vram_before','vram_after')};s['cpu_memory']=c['memory'];s['complete']=g['complete']
# The initial hold driver emitted a static false; it did not monitor device loss.
if s['memory'].get('memory'):
    s['memory']['memory']['device_lost']=None
    s['memory']['memory']['device_loss_note']='Not independently monitored; successful allocation/work is the observation.'
(OUT/'summary.json').write_text(json.dumps(s,indent=2),encoding='utf-8')
print('Summary written:',OUT/'summary.json')
