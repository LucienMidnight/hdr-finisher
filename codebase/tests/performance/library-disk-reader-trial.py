"""M10 only: single unbuffered piece reader; M9 GPU preparation from memory."""
import os, sys, importlib.util, time, json, threading, ctypes as C
from pathlib import Path
from collections import OrderedDict
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor
from http.server import ThreadingHTTPServer

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('m9', HERE/'library-raw-deep-dive.py')
m9 = importlib.util.module_from_spec(spec); sys.modules['m9']=m9; spec.loader.exec_module(m9)
ORIGINAL_COLD=m9.cold
OUT = m9.ROOT/'output/library-disk-reader-trial'; OUT.mkdir(parents=True, exist_ok=True)
MANIFEST = json.loads((m9.OUT/'manifest.json').read_text())
PATHS = [Path(p) for p in MANIFEST['paths']]
m9.paths = lambda: PATHS
os.environ['HDR_FINISHER_APP_DATA_DIR'] = str(OUT/'app-data')
def write(n, v): (OUT/n).write_text(json.dumps(v, indent=2), encoding='utf-8')
def now(): return time.perf_counter()*1000

class Piece:
 def __init__(self, index, size):
  self.index=index; self.size=PATHS[index].stat().st_size; self.length=(self.size+4095)//4096*4096
  self.p=m9.K.VirtualAlloc(None,self.length,0x3000,4)
  self.h=m9.K.CreateFileW(str(PATHS[index]),0x80000000,7,None,3,0x20000000|0x08000000,None)
  if not self.p or self.h==C.c_void_p(-1).value: raise C.WinError(C.get_last_error())
  self.offset=0; self.chunk=size or self.length; self.started=now(); self.io=0; self.chunks=[]
 def step(self):
  got=C.c_uint32(); t=now(); n=min(self.chunk,self.length-self.offset)
  if not m9.K.ReadFile(self.h,self.p+self.offset,n,C.byref(got),None): raise C.WinError(C.get_last_error())
  end=now(); self.io+=end-t; self.chunks.append([t,end,got.value]); self.offset+=got.value
  return self.offset>=self.size
 def finish(self):
  t=now(); b=C.string_at(self.p,self.size); copy=now()-t; self.close(); return b,copy
 def close(self):
  if self.h is not None: m9.K.CloseHandle(self.h); self.h=None
  if self.p: m9.K.VirtualFree(self.p,0,0x8000); self.p=None

def memory_process(index, body, key):
 # Each process handles one job at a time. Main foreground is a single thread.
 m9.cold=lambda p:(body,0,0)
 t=now(); b,meta=m9.process(index,'gpu',key,False,True)
 meta['decode_start_at']=t; meta['decode_end_at']=now()
 return b,meta

class Trial:
 def __init__(self):
  self.cv=threading.Condition(threading.RLock()); self.raw=OrderedDict(); self.partial={}; self.active={}; self.done={}; self.traces={}
  self.selected=-1; self.wanted=[]; self.ahead=12; self.chunk=1024*1024; self.capacity=40; self.generation=0; self.busy=False;self.batch=False
  os.environ['M9_THREADS']='1'; self.pool=ProcessPoolExecutor(max_workers=2,initializer=m9.background_init)
  # Warm actual decode, including worker startup; discarded before trial clocks.
  body,_,_=ORIGINAL_COLD(PATHS[0])
  [f.result() for f in [self.pool.submit(memory_process,0,body,'worker-warm'+str(i)) for i in range(2)]]
  self.fg=ThreadPoolExecutor(max_workers=1)
  self.reader=threading.Thread(target=self.read_loop,daemon=True); self.reader.start()
 def wanted_order(self):
  if self.selected<0: return self.wanted
  if self.batch:return [self.selected]+[i for i in self.wanted if i!=self.selected]
  return [self.selected]+[i for i in self.wanted if self.selected<i<=self.selected+self.ahead]
 def read_loop(self):
  while True:
   with self.cv:
    order=self.wanted_order(); index=next((i for i in order if i not in self.raw),None)
    if index is None: self.cv.wait(.01); continue
    self.busy=True
    if index not in self.partial:
     self.partial[index]=Piece(index,self.chunk)
     tr=self.traces.setdefault(index,{}); tr['read_start_at']=self.partial[index].started
    piece=self.partial[index]
   complete=piece.step()
   with self.cv:
    if complete:
     b,copy=piece.finish(); del self.partial[index]; self.raw[index]=b
     self.traces[index].update(read_end_at=now(),read_ms=piece.io,read_copy_ms=copy,chunks=piece.chunks,raw_bytes=len(b))
     while len(self.raw)>self.capacity:self.raw.popitem(last=False)
    self.busy=False; self.cv.notify_all()
 def pump(self):
  for i,(f,submitted,lane) in list(self.active.items()):
   if f.done():
    body,meta=f.result(); m9.DATA[meta['key']]=(body,meta)
    tr=self.traces[i]; meta.update(tr); meta.update(submitted_at=submitted,worker_lane=lane,ready_at=now(),index=i)
    self.done[i]=meta; del self.active[i]
  fg_busy=any(lane=='viewed' for _,_,lane in self.active.values())
  for i in self.wanted_order():
   if i not in self.raw or i in self.active or i in self.done:continue
   lane='viewed' if i==self.selected else 'background'
   if lane=='viewed' and fg_busy:continue
   if lane=='background' and sum(l=='background' for _,_,l in self.active.values())>=2:continue
   t=now(); key=f'm10-{self.generation}-{i}'; executor=self.fg if lane=='viewed' else self.pool
   self.active[i]=(executor.submit(memory_process,i,self.raw[i],key),t,lane)
   if lane=='viewed':fg_busy=True
 def start(self, indices, selected=0, prefill=None, chunk=1048576, batch=False):
  with self.cv:
   self.wanted=[]; self.selected=-1
   while self.busy:self.cv.wait()
   for f,_,_ in self.active.values():f.result()
   for p in self.partial.values():p.close()
   self.partial={}; self.active={}; self.done={}; self.traces={}; self.raw.clear();m9.DATA.clear()
   self.generation+=1; self.chunk=chunk;self.batch=batch
   for i in prefill or []:
    p=Piece(i,chunk)
    while not p.step():pass
    b,copy=p.finish();self.raw[i]=b;self.traces[i]={'read_ms':p.io,'read_copy_ms':copy,'read_start_at':p.started,'read_end_at':now(),'chunks':p.chunks,'raw_bytes':len(b),'prefilled':True}
   self.wanted=indices; self.selected=selected; t=now()
   for i in indices:self.traces.setdefault(i,{})['requested_at']=t
   self.cv.notify_all(); self.pump()
   return {'started_at':t,'raw_cached':list(self.raw),'ahead':self.ahead,'capacity':self.capacity,'chunk':self.chunk}
 def select(self,index):
  with self.cv:
   self.selected=index
   if index not in self.wanted:self.wanted.append(index)
   self.traces.setdefault(index,{})['viewed_requested_at']=now()
   self.cv.notify_all(); self.pump();return {'ok':True,'raw_cached':index in self.raw}
 def status(self):
  with self.cv:
   self.pump();return {'ready':list(self.done.values()),'active':list(self.active),'raw_cached':list(self.raw),'traces':self.traces,'cache_bytes':sum(map(len,self.raw.values())),'partial_bytes':sum(p.length for p in self.partial.values()),'at':now()}

TRIAL=None
class Handler(m9.Handler):
 protocol_version='HTTP/1.1'
 def send(self,b,kind='application/json',meta=None):
  if not isinstance(b,bytes):b=json.dumps(b).encode()
  self.send_response(200);self.send_header('Content-Type',kind);self.send_header('Content-Length',str(len(b)));self.send_header('Access-Control-Allow-Origin','*')
  if meta:
   for k,v in {'X-Image-Width':meta['width'],'X-Image-Height':meta['height'],'X-Bytes-Per-Row':meta['stride'],'X-Working-Space':'ACEScg'}.items():self.send_header(k,str(v))
   self.send_header('Access-Control-Expose-Headers','X-Image-Width,X-Image-Height,X-Bytes-Per-Row,X-Working-Space')
  self.end_headers();self.wfile.write(b)
 def do_POST(self):
  a=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
  try:
   if self.path=='/start':return self.send(TRIAL.start(**a))
   if self.path=='/select':return self.send(TRIAL.select(**a))
   if self.path=='/status':return self.send(TRIAL.status())
   if self.path=='/prepare':
    # Warm renderer only; restore disk function immediately afterward.
    b,_,_=ORIGINAL_COLD(PATHS[a['index']]);body,meta=memory_process(a['index'],b,a['key']);m9.DATA[meta['key']]=(body,meta);return self.send(meta)
  except Exception as e:self.send_error(500,repr(e))

def disk_probe():
 rows=[]; yields=[]
 for chunk in (0,4*1048576,1048576,262144):
  for repeat in range(2):
   t=now();files=[]
   for i in range(6):
    p=Piece(i,chunk)
    while not p.step():pass
    b,copy=p.finish();files.append({'index':i,'read_ms':p.io,'copy_ms':copy,'bytes':len(b),'pieces':len(p.chunks)})
   wall=now()-t;rows.append({'chunk':chunk,'repeat':repeat,'wall_ms':wall,'files_per_second':6000/wall,'MB_per_second':sum(f['bytes'] for f in files)/1000/wall,'files':files})
   # Request arrives mid-read, not conveniently on a piece boundary.
   for i in (0,5):
    p=Piece(i,chunk);trigger=threading.Event();request={}
    def request_viewed():
     trigger.wait();time.sleep(.007);request['at']=now()
    th=threading.Thread(target=request_viewed);th.start();trigger.set()
    while not p.step() and not request:pass
    th.join();q=Piece(4,chunk);start=now();q.step();q.close();p.close()
    yields.append({'chunk':chunk,'repeat':repeat,'background_index':i,'request_to_read_start_ms':max(0,start-request['at'])})
  print('disk probe',chunk,flush=True)
 write('disk.json',{'batches':rows,'yield':yields,'manifest':MANIFEST})

if __name__=='__main__':
 if sys.argv[1]=='disk':disk_probe()
 if sys.argv[1]=='serve':
  TRIAL=Trial();ThreadingHTTPServer(('127.0.0.1',8810),Handler).serve_forever()
