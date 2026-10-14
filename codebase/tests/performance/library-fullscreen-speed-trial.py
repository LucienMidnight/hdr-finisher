"""M7/M8 disposable instrument. No production patches survive this process.
From codebase, install the experiment-only codec into the ignored folder:
.venv/Scripts/python.exe -m pip install --target output/library-fullscreen-speed-trial/deps zstandard==0.25.0
Run this script with cpu, extend, read-split, step-probe, route-measure, in order.
Then set HDR_FINISHER_ELECTRON_WINDOW_SIZE=2560x1440 and run:
node tests/run-in-electron.js tests/performance/library-fullscreen-speed-trial.js
Finally run library-fullscreen-speed-summary.py with the venv Python.
The JS starts/stops the loopback service. --resume continues saved GPU results;
--current-only and --browse-only target existing checkpoints.
Primary CPU matrices/process workers use below-normal priority and native
numeric threads=1. The October 14 companion read-split data was recorded at
normal priority before the launcher was aligned; it is a separate stage probe.
OS file cache is uncontrolled; 'cold' means a fresh picture/session cache.
"""
from __future__ import annotations
import os
for n in ('OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS','NUMEXPR_NUM_THREADS'):
    os.environ[n]='1'
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'output/library-fullscreen-speed-trial'
os.environ['HDR_FINISHER_APP_DATA_DIR']=str(OUT/'app-data')
os.environ['HDR_FINISHER_SOURCE_CACHE_DISABLE']='1'
import sys,json,time,threading,shutil,statistics,inspect,zlib,lzma,ctypes,gc
from concurrent.futures import ThreadPoolExecutor,ProcessPoolExecutor,Future
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from urllib.parse import urlparse,parse_qs
sys.path.insert(0,str(ROOT/'backend'))
import numpy as np
import rawpy
from PIL import Image
from hdr_finisher import library_pictures as lp,library_diagnostics as diag,loader
from hdr_finisher.render_cache import encode_rgba_proxy_rows
sys.path.insert(0,str(OUT/'deps'))
import zstandard
TLS=threading.local()
REAL_REDUCE=lp.reduce_picture
REAL_DECODE=lp.decode_picture
REAL_IMREAD=rawpy.imread


def timed(fn):
    t=time.perf_counter();v=fn();return v,(time.perf_counter()-t)*1000

def write(name,value):
    OUT.mkdir(parents=True,exist_ok=True)
    (OUT/name).write_text(json.dumps(value,indent=2),encoding='utf-8')

def memory():
    class C(ctypes.Structure):
        _fields_=[('cb',ctypes.c_ulong),('faults',ctypes.c_ulong)]+[(n,ctypes.c_size_t) for n in ('peak','working','qpp','qp','qpn','qn','pagefile','peakpf')]
    c=C();c.cb=ctypes.sizeof(c)
    k=ctypes.WinDLL('kernel32');k.GetCurrentProcess.restype=ctypes.c_void_p
    p=ctypes.WinDLL('psapi');p.GetProcessMemoryInfo.argtypes=[ctypes.c_void_p,ctypes.c_void_p,ctypes.c_ulong]
    if not p.GetProcessMemoryInfo(k.GetCurrentProcess(),ctypes.byref(c),c.cb):raise ctypes.WinError()
    return {'working':c.working,'private':c.pagefile,'peak':c.peak}

def sources():
    text=(ROOT/'tests/performance/photo-library-remaining.py').read_text(encoding='utf-8')
    scope={'ROOT':ROOT,'Path':Path,'json':json}
    exec(text[text.index('def selected():'):text.index('def session(path):')],scope)
    ten=scope['selected']()
    corpus=json.loads((ROOT/'output/library-measurements/corpus.json').read_text())
    extras=[Path(r['path']) for r in corpus['rows'] if r.get('sensor_size') and not r.get('error') and not r.get('excluded') and Path(r['path']) not in ten]
    thirty=ten+extras[:20]
    assert len(thirty)==len(set(thirty))==30
    exr=Path(corpus['source'])/'DSC01287.exr'
    originals=thirty+[exr]
    copied=[]
    for i,p in enumerate(originals):
        d=OUT/'copies'/str(i)/p.name;d.parent.mkdir(parents=True,exist_ok=True)
        if not d.exists():shutil.copy2(p,d)
        copied.append(d)
    return copied,list(range(10))+[30]

def log(event,**fields):
    if hasattr(TLS,'stages') and 'duration_ms' in fields:TLS.stages[event]=TLS.stages.get(event,0)+fields['duration_ms']
lp.log=log
diag._sink=lambda r:None

def wrap_stage(module,name,label):
    fn=getattr(module,name)
    def call(*a,**kw):
        selected=parallel_reduce if module is lp and name=="reduce_picture" and getattr(TLS,"parallel",False) else fn
        v,ms=timed(lambda:selected(*a,**kw))
        if hasattr(TLS,'stages'):TLS.stages[label]=TLS.stages.get(label,0)+ms
        return v
    setattr(module,name,call)
wrap_stage(lp,'reduce_picture','shrink_ms')
wrap_stage(lp,'map_negative_acescg','negative_map_ms')
wrap_stage(lp,'normalize_to_acescg','colour_normalize_ms')
wrap_stage(lp,'default_look','look_ms')
# Trial-only CPU alternative: same Pillow bilinear filter, float32 matrix.
text=inspect.getsource(REAL_DECODE).replace('pixels @ matrix.T','np.einsum("...j,ij->...i", pixels, matrix.astype(np.float32), optimize=False)')
text=text.replace('def decode_picture(','def fast_decode(')
exec(text,lp.__dict__)
# Raw route for GPU experiment: preserve the current LibRaw settings and matrix.
text=inspect.getsource(REAL_DECODE)
a=text.index('            reduce_started = perf_counter()')
b=text.index('            return pixels, None,',a)
c=text.index('\n    if quality == "fast"',b)
text=text[:a]+'''            matrix = meta.camera_to_acescg * (meta.as_shot_wb * 65535 / (meta.white_level - meta.black_level))[None, :] if meta else None
            if matrix is None:
                from .color import _LINEAR_SRGB_TO_ACESCG
                matrix = _LINEAR_SRGB_TO_ACESCG.T
            threshold = (meta.white_level - meta.black_level) / 65535 * .999 if meta else .999
            return transport, None, {"matrix": matrix.tolist(), "threshold": np.broadcast_to(threshold,(3,)).tolist(), "raw_input": True, "route": "gpu-half-raw", "source_width": transport.shape[1]*2,"source_height": transport.shape[0]*2}
'''+text[c:]
text=text.replace('def decode_picture(','def gpu_raw_decode(')
exec(text,lp.__dict__)


def job(args):
    path,route,edge,serial,save=args
    if save:serial=f'{serial}-{time.time_ns()}'
    TLS.stages={};TLS.parallel=route=="fast-parallel"
    try:
        t=time.perf_counter()
        decoder=lp.fast_decode if route.startswith('fast') else REAL_DECODE
        (pixels,ref,facts),decode_ms=timed(lambda:decoder(Path(path),edge,'quick'))
        raw_input=facts.get('raw_input',False)
        grade=lp.default_look(pixels,ref,raw_input,Path(path).suffix.lower())
        meta={**facts,'path':str(path),'width':pixels.shape[1],'height':pixels.shape[0],'edge':edge,'white':203,'has_reference':ref is not None,'adjustments':grade.model_dump(mode='json')}
        quant,quant_ms=timed(lambda:np.clip(pixels,0,65504).astype(np.float16))
        reference=np.clip(ref,0,65504).astype(np.float16) if ref is not None else None
        d=OUT/'cache'/str(serial);cache=lp.LibraryPictureCache(d,limit=2**40)
        save_ms=0
        if save:
            _,save_ms=timed(lambda:cache.build(path,edge,'quick',decoded=(pixels,ref,{**facts,'starting_look':meta['adjustments']})))
        stages=dict(TLS.stages)
        raw=stages.get('picture_raw_processed',0)
        shrink=stages.get('shrink_ms',0)
        colour=max(0,decode_ms-raw-shrink-stages.get('picture_decoder_import',0))
        # For non-RAW, residual contains native decode/preflight as well as colour.
        return {'path':str(path),'route':route,'edge':edge,'serial':str(serial),'decode_ms':decode_ms,'raw_ms':raw,'shrink_ms':shrink,'colour_and_other_ms':colour,'look_ms':stages.get('look_ms',0),'quantize_ms':quant_ms,'save_ms':save_ms,'total_ms':(time.perf_counter()-t)*1000,'stages':stages,'shape':list(quant.shape),'bytes':quant.nbytes+(reference.nbytes if reference is not None else 0),'meta':meta}
    except Exception as e:return {'path':str(path),'route':route,'edge':edge,'error':repr(e)}


def ping(n):return os.getpid()

class ReusedRaw:
    def __init__(self,raw):self.raw=raw;self.transport=None
    def __getattr__(self,k):return getattr(self.raw,k)
    def __enter__(self):return self
    def __exit__(self,*a):return False
    def postprocess(self,**kw):
        if self.transport is None:self.transport=self.raw.postprocess(**kw)
        return self.transport

def dual(path,route):
    # Replays identical unconverted transport, so each size keeps its own
    # shrink-before-colour/clipping order and starting-look sampling.
    opened={};loaded={};oldload={}
    oldread=rawpy.imread
    def imread(p):
        if p not in opened:opened[p]=ReusedRaw(REAL_IMREAD(p))
        return opened[p]
    rawpy.imread=imread
    for n in ('_load_heif','_load_tiff','_load_exr','decode_avif','decode_ultrahdr_jpeg','decode_jpegxl'):
        fn=getattr(loader,n);oldload[n]=fn
        def load(*a,_n=n,_fn=fn,**kw):
            key=(_n,str(a[0]))
            if key not in loaded:loaded[key]=_fn(*a,**kw)
            return loaded[key]
        setattr(loader,n,load)
    # Linear DNG is decoded through tifffile directly; replay series.asarray.
    import tifffile
    oldarray=tifffile.TiffPageSeries.asarray
    def array(s,*a,**kw):
        key=('tiff',str(s.parent.filehandle.path))
        if key not in loaded:loaded[key]=oldarray(s,*a,**kw)
        return loaded[key]
    tifffile.TiffPageSeries.asarray=array
    decoder=lp.fast_decode if route.startswith('fast') else REAL_DECODE
    TLS.stages={};TLS.parallel=route=='fast-parallel'
    t=time.perf_counter();values=[]
    try:
        for edge in (2560,512):
            p,r,m=decoder(path,edge,'quick');g=lp.default_look(p,r,m.get('raw_input',False),path.suffix.lower());values.append(p)
        return {'path':str(path),'route':route,'mode':'both','total_ms':(time.perf_counter()-t)*1000,'shapes':[list(p.shape) for p in values]}
    finally:
        rawpy.imread=oldread;tifffile.TiffPageSeries.asarray=oldarray
        for n,f in oldload.items():setattr(loader,n,f)
        for r in opened.values():r.raw.close()


def arrays_for(row):
    c=lp.LibraryPictureCache(OUT/'cache'/row['serial'])
    with np.load(c.file(lp.picture_key(row['path'],2560,'quick')),allow_pickle=False) as f:return {n:f[n] for n in f.files}

FORMATS=('npz','npz-deflate','zip-level1','shuffle-zlib1','shuffle-zlib6','half8-shuffle-zlib1','shuffle-zstd1','half8-shuffle-zstd1')

def encode(arrays,fmt,target):
    if fmt in ('npz','npz-deflate'):
        with target.open('wb') as f:(np.savez if fmt=='npz' else np.savez_compressed)(f,**arrays)
        return
    if fmt=='zip-level1':
        import zipfile,io
        with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED,compresslevel=1) as z:
            for n,v in arrays.items():
                buf=io.BytesIO();np.save(buf,v,allow_pickle=False);z.writestr(n+'.npy',buf.getvalue())
        return
    header=[];chunks=[]
    for n,v in arrays.items():
        if fmt.startswith('half8') and v.dtype==np.float16:
            bits=v.view(np.uint16).astype(np.uint32)
            # Round to eight stored mantissa bits; preserve finite maximum.
            bits=np.minimum((bits+2)&~np.uint32(3),0x7bff).astype(np.uint16);v=bits.view(np.float16)
        b=np.frombuffer(v.tobytes(),dtype=np.uint8)
        shuffled=b.reshape(-1,v.dtype.itemsize).T.copy().tobytes() if v.dtype.itemsize>1 else b.tobytes()
        comp=zstandard.ZstdCompressor(level=1).compress(shuffled) if fmt.endswith('zstd1') else zlib.compress(shuffled,6 if fmt.endswith('zlib6') else 1)
        header.append({'name':n,'dtype':v.dtype.str,'shape':list(v.shape),'length':len(comp)});chunks.append(comp)
    h=json.dumps(header).encode();target.write_bytes(len(h).to_bytes(4,'little')+h+b''.join(chunks))

def decode_file(fmt,target):
    if fmt in ('npz','npz-deflate','zip-level1'):
        with np.load(target,allow_pickle=False) as f:return {n:f[n] for n in f.files}
    b=target.read_bytes();length=int.from_bytes(b[:4],'little');h=json.loads(b[4:4+length]);offset=4+length;arrays={}
    for r in h:
        compressed=b[offset:offset+r['length']];raw=np.frombuffer(zstandard.ZstdDecompressor().decompress(compressed) if fmt.endswith('zstd1') else zlib.decompress(compressed),dtype=np.uint8);offset+=r['length'];d=np.dtype(r['dtype'])
        data=raw.reshape(d.itemsize,-1).T.copy().tobytes() if d.itemsize>1 else raw.tobytes()
        arrays[r['name']]=np.frombuffer(data,dtype=d).reshape(r['shape'])
    return arrays

def pack(v):return encode_rgba_proxy_rows(v.astype(np.float32),0,v.shape[0],prefer_half=True,pixel_format='rgba16float')

def direct_pack(v):
    h,w=v.shape[:2];stride=((w*8+255)//256)*256
    out=np.empty((h,stride//2),dtype=np.float16);out[:,w*4:]=0
    rgba=out[:,:w*4].reshape(h,w,4);rgba[:,:,:3]=v;rgba[:,:,3]=1
    return out.tobytes(),stride

def cpu():
    paths,indices=sources();selected=[paths[i] for i in indices]
    from hdr_finisher.library_worker import _lower_priority
    priority=_lower_priority()
    results={'method':'two samples; warm OS cache, fresh disposable picture cache; one native thread per job; helper priority','priority':priority,'indices':indices,'paths':list(map(str,paths)),'matrix':[],'sizes':[],'formats':[],'complete':False}
    serial=0
    for route in ('current','fast'):
        for mode in ('alone','six-threads','six-processes'):
            executor=None;startup=0
            if mode!='alone':
                t=time.perf_counter();executor=(ThreadPoolExecutor if mode=='six-threads' else ProcessPoolExecutor)(max_workers=6)
                if mode=='six-processes':list(executor.map(ping,range(12)))
                startup=(time.perf_counter()-t)*1000
            for repeat in range(2):
                jobs=[]
                for p in selected:serial+=1;jobs.append((str(p),route,2560,f'{route}-{mode}-{repeat}-{serial}',True))
                t=time.perf_counter();rows=list(executor.map(job,jobs)) if executor else [job(a) for a in jobs]
                results['matrix'].append({'route':route,'mode':mode,'repeat':repeat,'startup_ms':startup,'wall_ms':(time.perf_counter()-t)*1000,'rows':rows})
                write('cpu.json',results);print(route,mode,repeat,'done',flush=True)
            if executor:executor.shutdown()
    for route in ('current','fast'):
        for p in selected:
            for repeat in range(2):
                for edge in (512,2560):
                    r=job((str(p),route,edge,'size',False));r.update(mode=str(edge),repeat=repeat);results['sizes'].append(r)
                try:r=dual(p,route);r['repeat']=repeat;results['sizes'].append(r)
                except Exception as e:results['sizes'].append({'path':str(p),'route':route,'mode':'both','error':repr(e)})
            write('cpu.json',results)
        print('sizes',route,'done',flush=True)
    baselines=results['matrix'][0]['rows']
    for i,row in enumerate(baselines):
        if 'error' in row:continue
        arrays=arrays_for(row)
        for fmt in FORMATS:
            target=OUT/'formats'/str(i)/(fmt+'.bin');target.parent.mkdir(parents=True,exist_ok=True)
            writes=[];opens=[]
            for repeat in range(2):
                _,ms=timed(lambda:encode(arrays,fmt,target));writes.append(ms)
                stored,ms=timed(lambda:decode_file(fmt,target));opens.append(ms)
            _,ready=timed(lambda:pack(stored['pixels']))
            dif=np.abs(stored['pixels'].astype(np.float32)-arrays['pixels'].astype(np.float32))
            results['formats'].append({'index':i,'path':row['path'],'format':fmt,'file':str(target),'bytes':target.stat().st_size,'write_ms':statistics.median(writes),'open_ms':statistics.median(opens),'pack_ms':ready,'ready_ms':statistics.median(opens)+ready,'scene_mae':float(dif.mean()),'scene_max':float(dif.max())})
        write('cpu.json',results);print('storage',i,'done',flush=True)
    # Compare CPU arithmetic against baseline float16 transport, per source.
    results['cpu_difference']=[]
    for i,r in enumerate(baselines):
        if 'error' in r:continue
        a=arrays_for(r)['pixels'];f=next(x for x in results['matrix'][6]['rows'] if x['path']==r['path'])
        b=arrays_for(f)['pixels'];d=np.abs(a.astype(np.float32)-b.astype(np.float32))
        results['cpu_difference'].append({'index':i,'path':r['path'],'mae':float(d.mean()),'max':float(d.max()),'changed_fraction':float(np.count_nonzero(d)/d.size)})
    gc.collect();before=memory();held=[arrays_for(baselines[i%len(baselines)])['pixels'].copy() for i in range(40) if 'error' not in baselines[i%len(baselines)]]
    results['memory']={'before':before,'after':memory(),'held_count':len(held),'held_bytes':sum(v.nbytes for v in held)}
    results['complete']=True;write('cpu.json',results)

def parallel_reduce(image,edge):
    h,w=image.shape[:2]
    if max(h,w)<=edge:return np.asarray(image,dtype=np.float32)
    size=(max(1,round(w*edge/max(h,w))),max(1,round(h*edge/max(h,w))))
    def channel(c):return np.asarray(Image.fromarray(image[:,:,c].astype(np.float32)).resize(size,Image.Resampling.BILINEAR))
    with ThreadPoolExecutor(max_workers=3) as pool:return np.stack(list(pool.map(channel,range(3))),axis=2)

def step_probe():
    from hdr_finisher.library_worker import _lower_priority
    priority=_lower_priority();paths,_=sources();prepared=[];parity=[]
    for index in (0,1,2,4,5,6):
        transport,_,meta=lp.gpu_raw_decode(paths[index],2560,'quick')
        original=REAL_REDUCE(transport,2560);alternative=parallel_reduce(transport,2560)
        parity.append({'path':str(paths[index]),'shrink_bit_exact':bool(np.array_equal(original,alternative))})
        prepared.append((str(paths[index]),transport,np.asarray(meta['matrix']),np.asarray(meta['threshold'])))
    rows=[];batches=[]
    for route in ('current','parallel-float32'):
        for mode in ('alone','six-threads'):
            for repeat in range(2):
                def work(item):
                    path,transport,matrix,threshold=item;t=time.perf_counter()
                    pixels,shrink_ms=timed(lambda:(REAL_REDUCE if route=='current' else parallel_reduce)(transport,2560)*np.float32(1/65535))
                    def colour():
                        clipped=np.any(pixels>=threshold,axis=2)
                        rgb=lp.map_negative_acescg(pixels@matrix.T if route=='current' else np.einsum('...j,ij->...i',pixels,matrix.astype(np.float32),optimize=False))
                        rgb[clipped]=np.max(rgb[clipped],axis=1)[:,None]
                        return rgb
                    rgb,colour_ms=timed(colour)
                    return {'path':path,'route':route,'mode':mode,'repeat':repeat,'shrink_ms':shrink_ms,'colour_ms':colour_ms,'total_ms':(time.perf_counter()-t)*1000}
                t=time.perf_counter()
                if mode=='alone':batch=[work(p) for p in prepared]
                else:
                    with ThreadPoolExecutor(max_workers=6) as pool:batch=list(pool.map(work,prepared))
                rows.extend(batch);batches.append({'route':route,'mode':mode,'repeat':repeat,'wall_ms':(time.perf_counter()-t)*1000})
                write('cpu-step-probe.json',{'priority':priority,'scope':'Six camera RAWs; already decoded integer transport; excludes sensor read, starting look and transport','parity':parity,'rows':rows,'batches':batches});print('CPU step',route,mode,repeat,flush=True)

def route_measure():
    results=json.loads((OUT/'cpu.json').read_text());paths,indices=sources();route='fast-parallel'
    from hdr_finisher.library_worker import _lower_priority
    _lower_priority()
    results['matrix']=[b for b in results['matrix'] if b['route']!=route]
    results['sizes']=[r for r in results['sizes'] if r['route']!=route]
    for mode in ('alone','six-processes'):
        pool=ProcessPoolExecutor(max_workers=6,initializer=worker_init) if mode=='six-processes' else None
        start=time.perf_counter()
        if pool:list(pool.map(ping,range(12)))
        startup=(time.perf_counter()-start)*1000
        for repeat in range(2):
            jobs=[(str(paths[i]),route,2560,f'parallel-{mode}-{repeat}-{i}',True) for i in indices]
            start=time.perf_counter();rows=list(pool.map(job,jobs)) if pool else [job(a) for a in jobs]
            results['matrix'].append({'route':route,'mode':mode,'repeat':repeat,'startup_ms':startup,'wall_ms':(time.perf_counter()-start)*1000,'rows':rows});write('cpu.json',results);print('Full CPU alternative',mode,repeat,flush=True)
        if pool:pool.shutdown()
    candidates={b['route'] for b in results['matrix']}
    results['best_cpu_route']=min(candidates,key=lambda route:statistics.median(b['wall_ms'] for b in results['matrix'] if b['route']==route and b['mode']=='six-processes'))
    if results['best_cpu_route']=='fast-parallel':
        for i in indices:
            for repeat in range(2):
                for edge in (512,2560):
                    r=job((str(paths[i]),route,edge,'size',False));r.update(mode=str(edge),repeat=repeat);results['sizes'].append(r)
                r=dual(paths[i],route);r['repeat']=repeat;results['sizes'].append(r)
            write('cpu.json',results)
    write('cpu.json',results);print('Best mixed route:',results['best_cpu_route'],flush=True)

def read_split():
    # Native readers were aggregated with colour in the first matrix. Add a
    # focused repeat to separate their read cost without rerunning storage.
    from hdr_finisher.library_worker import _lower_priority
    _lower_priority()
    import tifffile
    wrap_stage(tifffile.TiffPageSeries,'asarray','array_read_ms')
    for n in ('_load_heif','_load_tiff','_load_exr','decode_avif','decode_ultrahdr_jpeg','decode_jpegxl'):
        wrap_stage(loader,n,'native_read_ms')
    paths,indices=sources();rows=[]
    for mode in ('alone','six-threads'):
        for repeat in range(2):
            jobs=[(str(paths[i]),'current',2560,f'split-{mode}-{repeat}-{i}',False) for i in indices]
            if mode=='alone':batch=[job(a) for a in jobs]
            else:
                with ThreadPoolExecutor(max_workers=6) as pool:batch=list(pool.map(job,jobs))
            for r in batch:
                r.update(mode=mode,repeat=repeat)
                if 'error' not in r:
                    r['read_ms']=r['raw_ms'] or r['stages'].get('native_read_ms',0) or r['stages'].get('array_read_ms',0)
                    r['colour_and_other_ms']=max(0,r['decode_ms']-r['read_ms']-r['shrink_ms']-r['stages'].get('picture_decoder_import',0))
                rows.append(r)
            write('read-split.json',rows);print('stage split',mode,repeat,flush=True)

def extend():
    results=json.loads((OUT/'cpu.json').read_text());rows=results['matrix'][0]['rows']
    results['cpu_difference']=[]
    fast=next(b for b in results['matrix'] if b['route']=='fast' and b['mode']=='alone')['rows']
    for i,row in enumerate(rows):
        arrays=arrays_for(row);other=arrays_for(next(r for r in fast if r['path']==row['path']))
        dif=np.abs(arrays['pixels'].astype(np.float32)-other['pixels'].astype(np.float32))
        results['cpu_difference'].append({'index':i,'path':row['path'],'mae':float(dif.mean()),'max':float(dif.max()),'changed_fraction':float(np.count_nonzero(dif)/dif.size)})
        for fmt in ('shuffle-zstd1','half8-shuffle-zstd1'):
            target=OUT/'formats'/str(i)/(fmt+'.bin');writes=[];opens=[]
            for repeat in range(2):
                _,ms=timed(lambda:encode(arrays,fmt,target));writes.append(ms)
                stored,ms=timed(lambda:decode_file(fmt,target));opens.append(ms)
            _,ready=timed(lambda:pack(stored['pixels']));dif=np.abs(stored['pixels'].astype(np.float32)-arrays['pixels'].astype(np.float32))
            results['formats']=[r for r in results['formats'] if not (r['index']==i and r['format']==fmt)]
            results['formats'].append({'index':i,'path':row['path'],'format':fmt,'file':str(target),'bytes':target.stat().st_size,'write_ms':statistics.median(writes),'open_ms':statistics.median(opens),'pack_ms':ready,'ready_ms':statistics.median(opens)+ready,'scene_mae':float(dif.mean()),'scene_max':float(dif.max())})
        write('cpu.json',results);print('zstd',i,'done',flush=True)
    results['best_cpu_route']=min(('current','fast'),key=lambda route:statistics.median(b['wall_ms'] for b in results['matrix'] if b['route']==route and b['mode']=='six-processes'))
    write('cpu.json',results)

PREPARED={};FUTURES={};POOL=None;PATHS=[];BASE=[];HELD=[];PENDING=set();ACTIVE={};CURRENT=0;LOCK=threading.RLock();CURRENT_ROUTE=False

def prepare(index,route='fast',key='one',disk=False,raw=False):
    p=PATHS[index]
    TLS.stages={};TLS.parallel=route=='fast-parallel';t=time.perf_counter()
    (pixels,ref,facts),decode_ms=timed(lambda:(lp.gpu_raw_decode if raw else lp.fast_decode if route.startswith('fast') else REAL_DECODE)(p,2560,'quick'))
    if raw:
        body=np.ascontiguousarray(pixels.astype(np.uint16)).tobytes()
        meta={**facts,'path':str(p),'key':key,'raw_width':pixels.shape[1],'raw_height':pixels.shape[0]}
        PREPARED[key]={'raw':body,'meta':meta};meta['decode_ms']=decode_ms;return meta
    grade=lp.default_look(pixels,ref,facts.get('raw_input',False),p.suffix.lower()).model_dump(mode='json')
    meta={**facts,'path':str(p),'key':key,'width':pixels.shape[1],'height':pixels.shape[0],'white':203,'edge':2560,'has_reference':ref is not None,'adjustments':grade,'decode_ms':decode_ms}
    quant=None if disk else np.clip(pixels,0,65504).astype(np.float16);reference=np.clip(ref,0,65504).astype(np.float16) if ref is not None and not disk else None
    PREPARED[key]={'pixels':quant,'reference':reference,'meta':meta,'disk':disk}
    if disk:
        cache=lp.LibraryPictureCache(OUT/'screen-cache'/(key+'-'+str(time.time_ns())),limit=2**40)
        result,ms=timed(lambda:cache.build(p,2560,'quick',decoded=(pixels,ref,{**facts,'starting_look':grade})))
        PREPARED[key]['cache']=cache;PREPARED[key]['cache_key']=result['key'];meta['save_ms']=ms
    meta['prepare_ms']=(time.perf_counter()-t)*1000;meta['stages']=dict(TLS.stages)
    meta['finished_at']=time.perf_counter()
    return meta

def process_prepare(path,route,key):
    TLS.stages={};TLS.parallel=route=='fast-parallel';t=time.perf_counter()
    pixels,ref,facts=(lp.fast_decode if route.startswith('fast') else REAL_DECODE)(Path(path),2560,'quick')
    decode_ms=(time.perf_counter()-t)*1000
    grade=lp.default_look(pixels,ref,facts.get('raw_input',False),Path(path).suffix.lower()).model_dump(mode='json')
    meta={**facts,'path':path,'key':key,'width':pixels.shape[1],'height':pixels.shape[0],'white':203,'edge':2560,'has_reference':ref is not None,'adjustments':grade,'decode_ms':decode_ms}
    return np.clip(pixels,0,65504).astype(np.float16),np.clip(ref,0,65504).astype(np.float16) if ref is not None else None,meta

def worker_init():
    from hdr_finisher.library_worker import _lower_priority
    _lower_priority()

def dispatch():
    # Keep only six jobs submitted to the executor. Pending look-ahead can be
    # reprioritized; already running native decodes are never interrupted.
    while POOL is not None and len(ACTIVE)<6 and PENDING:
        index=min(PENDING,key=lambda i:(i<CURRENT,abs(i-CURRENT)))
        PENDING.remove(index);key='browse'+str(index)
        task=POOL.submit(prepare,index,'current',key,True,False) if CURRENT_ROUTE else POOL.submit(process_prepare,str(PATHS[index]),CPU.get('best_cpu_route','current'),key)
        ACTIVE[index]=task
        def complete(f,_index=index):
            with LOCK:
                ACTIVE.pop(_index,None)
                future=FUTURES[_index]
                if not future.cancelled():
                    try:future.set_result(f.result())
                    except Exception as e:future.set_exception(e)
                dispatch()
        task.add_done_callback(complete)

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*a):pass
    def send(self,data,headers=None,status=200):
        body=data if isinstance(data,bytes) else json.dumps(data).encode()
        self.send_response(status)
        for n,v in {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Expose-Headers':'*',**(headers or {})}.items():self.send_header(n,str(v))
        self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
    def do_OPTIONS(self):self.send(b'')
    def do_GET(self):
        try:
            u=urlparse(self.path);q={k:v[0] for k,v in parse_qs(u.query).items()}
            if u.path=='/health':return self.send({'ok':True})
            if u.path=='/paths':return self.send({'paths':list(map(str,PATHS)),'indices':BASE})
            if u.path=='/pixels':
                e=PREPARED[q['key']];lane=q.get('lane','hdr');t=time.perf_counter()
                if e['disk']:body,w,h,stride,space=e['cache'].pixels(e['cache_key'],lane)
                else:
                    v=e['reference'] if lane=='sdr' and e.get('reference') is not None else e['pixels'];body,stride=direct_pack(v);h,w=v.shape[:2];space='linear-srgb' if lane=='sdr' and e.get('reference') is not None else 'acescg'
                return self.send(body,{'X-Image-Width':w,'X-Image-Height':h,'X-Bytes-Per-Row':stride,'X-Working-Space':space,'X-Open-Pack-Ms':(time.perf_counter()-t)*1000})
            if u.path=='/raw':return self.send(PREPARED[q['key']]['raw'])
            raise ValueError('unknown endpoint')
        except Exception as e:self.send({'error':repr(e)},status=500)
    def do_POST(self):
        global POOL,FUTURES,HELD,CURRENT,CURRENT_ROUTE
        try:
            u=urlparse(self.path);route=u.path
            if route=='/gpu-result':
                q={k:v[0] for k,v in parse_qs(u.query).items()};w=int(q['width']);h=int(q['height']);index=int(q['index'])
                body=self.rfile.read(int(self.headers['Content-Length']));v=np.frombuffer(body,dtype=np.float16).reshape(h,w,4)[:,:,:3].copy()
                grade=lp.default_look(v.astype(np.float32),None,True,PATHS[index].suffix.lower()).model_dump(mode='json')
                meta={'key':q['key'],'width':w,'height':h,'edge':2560,'white':203,'adjustments':grade,'has_reference':False,'path':str(PATHS[index])}
                PREPARED[q['key']]={'pixels':v,'reference':None,'meta':meta,'disk':False};return self.send(meta)
            a=json.loads(self.rfile.read(int(self.headers.get('Content-Length',0))) or b'{}')
            if route=='/prepare':return self.send(prepare(**a))
            if route=='/hold':
                rows=CPU['matrix'][0]['rows'];before=memory();HELD=[arrays_for(rows[i%len(rows)])['pixels'].copy() for i in range(40)]
                return self.send({'before':before,'after':memory(),'count':len(HELD),'bytes':sum(v.nbytes for v in HELD)})
            if route=='/variant':
                row=CPU['matrix'][0]['rows'][a['index']];fmt=a.get('format','npz');r=next(r for r in CPU['formats'] if r['index']==a['index'] and r['format']==fmt)
                stored,ms=timed(lambda:decode_file(fmt,Path(r['file'])));key=a['key'];meta={**row['meta'],'key':key}
                PREPARED[key]={'pixels':stored['pixels'],'reference':stored.get('reference'),'meta':meta,'disk':False};return self.send({**meta,'open_ms':ms})
            if route=='/upload-result':
                key=a['key'];v=np.frombuffer(bytes.fromhex(a['hex']),dtype=np.float16).reshape(a['height'],a['width'],4)[:,:,:3].copy()
                # GPU route supplies scene data back for identical starting-look analysis.
                grade=lp.default_look(v.astype(np.float32),None,True,Path(a['path']).suffix.lower()).model_dump(mode='json')
                meta={'key':key,'width':a['width'],'height':a['height'],'edge':2560,'white':203,'adjustments':grade,'has_reference':False,'path':a['path']}
                PREPARED[key]={'pixels':v,'reference':None,'meta':meta,'disk':False};return self.send(meta)
            if route=='/start':
                with LOCK:PENDING.clear()
                if POOL:POOL.shutdown(wait=True)
                PREPARED.clear();POOL=ThreadPoolExecutor(max_workers=6) if a.get('current') else ProcessPoolExecutor(max_workers=6,initializer=worker_init)
                list(POOL.map(ping,range(12)))
                with LOCK:FUTURES={};CURRENT=0;CURRENT_ROUTE=bool(a.get('current'));ACTIVE.clear()
                return self.send({'ok':True})
            if route=='/select':
                with LOCK:
                    CURRENT=a['index']
                    for i in list(PENDING):
                        if i<CURRENT:PENDING.remove(i);FUTURES[i].cancel()
                    dispatch()
                return self.send({'ok':True})
            if route=='/enqueue':
                i=a['index']
                with LOCK:
                    if i not in FUTURES:FUTURES[i]=Future();PENDING.add(i);dispatch()
                return self.send({'ready':FUTURES[i].done() and not FUTURES[i].cancelled()})
            if route=='/status':
                f=FUTURES[a['index']]
                if not f.done() or f.cancelled():return self.send({'ready':False,'meta':None})
                result=f.result()
                if isinstance(result,dict):return self.send({'ready':True,'meta':result})
                v,ref,meta=result;PREPARED[meta['key']]={'pixels':v,'reference':ref,'meta':meta,'disk':False}
                return self.send({'ready':True,'meta':meta})
            if route=='/release':
                PREPARED.clear();gc.collect();return self.send({'ok':True})
            raise ValueError('unknown endpoint')
        except Exception as e:self.send({'error':repr(e)},status=500)

if __name__=='__main__':
    import argparse
    p=argparse.ArgumentParser();p.add_argument('mode',choices=['cpu','extend','read-split','step-probe','route-measure','serve']);args=p.parse_args()
    OUT.mkdir(parents=True,exist_ok=True)
    if args.mode=='cpu':cpu()
    elif args.mode=='extend':extend()
    elif args.mode=='read-split':read_split()
    elif args.mode=='step-probe':step_probe()
    elif args.mode=='route-measure':route_measure()
    else:
        PATHS,BASE=sources();CPU=json.loads((OUT/'cpu.json').read_text());ThreadingHTTPServer(('127.0.0.1',8803),Handler).serve_forever()
