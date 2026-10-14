"""M9 test-only RAW probe. All writes confined to ignored output; no app patches.
Cold = CreateFile(FILE_FLAG_NO_BUFFERING|SEQUENTIAL_SCAN), sector-aligned reads.
This bypasses Windows file cache, not enclosure/drive firmware cache.
"""
import os,sys
THREADS=int(os.environ.get('M9_THREADS','12'))
for k in ('OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS','NUMEXPR_NUM_THREADS'):os.environ[k]=str(THREADS)
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'output/library-raw-deep-dive'
os.environ['HDR_FINISHER_APP_DATA_DIR']=str(OUT/'app-data');os.environ['HDR_FINISHER_SOURCE_CACHE_DISABLE']='1'
sys.path.insert(0,str(ROOT/'backend'))
import ctypes as C,json,time,io,shutil,statistics,threading
from concurrent.futures import ThreadPoolExecutor,ProcessPoolExecutor
import numpy as np,rawpy
from PIL import Image
from hdr_finisher import library_pictures as lp,raw_import
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
K=C.WinDLL('kernel32',use_last_error=True)
K.CreateFileW.argtypes=[C.c_wchar_p,C.c_uint32,C.c_uint32,C.c_void_p,C.c_uint32,C.c_uint32,C.c_void_p];K.CreateFileW.restype=C.c_void_p
K.VirtualAlloc.argtypes=[C.c_void_p,C.c_size_t,C.c_uint32,C.c_uint32];K.VirtualAlloc.restype=C.c_void_p
K.ReadFile.argtypes=[C.c_void_p,C.c_void_p,C.c_uint32,C.POINTER(C.c_uint32),C.c_void_p]
K.CloseHandle.argtypes=[C.c_void_p];K.VirtualFree.argtypes=[C.c_void_p,C.c_size_t,C.c_uint32]
def timed(fn):
 t=time.perf_counter();v=fn();return v,(time.perf_counter()-t)*1000
def write(n,v):OUT.mkdir(parents=True,exist_ok=True);(OUT/n).write_text(json.dumps(v,indent=2),encoding='utf-8')
def cold(path):
 size=path.stat().st_size;n=(size+4095)//4096*4096
 p=K.VirtualAlloc(None,n,0x3000,4)
 h=K.CreateFileW(str(path),0x80000000,7,None,3,0x20000000|0x08000000,None)
 if not p or h==C.c_void_p(-1).value:raise C.WinError(C.get_last_error())
 try:
  got=C.c_uint32();t=time.perf_counter()
  if not K.ReadFile(h,p,n,C.byref(got),None):raise C.WinError(C.get_last_error())
  ms=(time.perf_counter()-t)*1000
  if got.value!=size:raise RuntimeError('short disk read')
  b,copy=timed(lambda:C.string_at(p,size));return b,ms,copy
 finally:K.CloseHandle(h);K.VirtualFree(p,0,0x8000)
def paths():return [Path(p) for p in json.loads((OUT/'manifest.json').read_text())['paths']]
def init():
 corpus=json.loads((ROOT/'output/library-measurements/corpus.json').read_text());names=['DSC02767.ARW','DSC06615.ARW','2L1B8631.CR2','Fujifilm_X-E2S_DSCF6495.RAF','Nikon_D7500_DSC_3931.NEF','DJI_0071-2.DNG']
 originals=[Path(next(r['path'] for r in corpus['rows'] if Path(r['path']).name==n)) for n in names]
 # Corpus tops out at 48 MP and contains no additional camera brand.
 extra=[Path(r['path']) for r in corpus['rows'] if Path(r['path']).suffix.lower() in ('.arw','.cr2','.nef','.raf') and not r.get('error') and Path(r['path']) not in originals]
 all_sources=originals+extra
 unique_count=len(all_sources)
 all_sources=(all_sources+[all_sources[i%unique_count] for i in range(max(0,30-unique_count))])[:30]
 copies=[]
 for i,p in enumerate(all_sources):
  d=OUT/'copies'/str(i)/p.name;d.parent.mkdir(parents=True,exist_ok=True)
  if not d.exists():shutil.copy2(p,d)
  copies.append(str(d))
 write('manifest.json',{'paths':copies,'representatives':6,'unique_camera_sources':unique_count,'originals':list(map(str,all_sources)),'source':corpus['source'],'method':'unbuffered 4096-aligned ReadFile; no Windows cache; drive firmware cache uncontrolled','threads':THREADS})
def opened(b):
 r=rawpy.imread(io.BytesIO(b));r.raw_image_visible;return r
def process(index,route='cpu',key=None,keep=False,return_body=False):
 p=paths()[index];t=time.perf_counter();b,read,copy=cold(p)
 raw,unpack=timed(lambda:opened(b))
 try:
  try:meta,metadata=timed(lambda:raw_import._camera_linear_metadata_from_libraw(raw))
  except raw_import._CameraLinearUnsupported:meta=None;metadata=0
  transport,develop=timed(lambda:raw.postprocess(half_size=True,demosaic_algorithm=rawpy.DemosaicAlgorithm.LINEAR,**({'user_wb':[1.]*4,'no_auto_scale':True} if meta else {'use_camera_wb':True}),no_auto_bright=True,use_auto_wb=False,output_color=rawpy.ColorSpace.raw if meta else rawpy.ColorSpace.sRGB,gamma=(1.,1.),output_bps=16,highlight_mode=rawpy.HighlightMode.Clip))
  h,w=transport.shape[:2];scale=min(2160/w,1440/h,1);dw,dh=round(w*scale),round(h*scale)
  if meta:
   matrix=meta.camera_to_acescg*(meta.as_shot_wb*65535/(meta.white_level-meta.black_level))[None,:];threshold=(meta.white_level-meta.black_level)/65535*.999
  else:
   from hdr_finisher.color import _LINEAR_SRGB_TO_ACESCG
   matrix=_LINEAR_SRGB_TO_ACESCG.T;threshold=np.full(3,.999)
  def convert(v):
   v=v.astype(np.float32)/65535;clipped=np.any(v>=threshold,axis=2);v=lp.map_negative_acescg(np.einsum('...j,ij->...i',v,matrix.astype(np.float32),optimize=False));v[clipped]=np.max(v[clipped],axis=1)[:,None];return v
  sample=convert(transport[::max(1,h//128),::max(1,w//128)])
  grade,look=timed(lambda:lp.default_look(sample,None,True,p.suffix.lower()).model_dump(mode='json'))
  shrink=colour=pack=0
  if route=='cpu':
   def resize():return np.stack([np.asarray(Image.fromarray(transport[:,:,c].astype(np.float32)).resize((dw,dh),Image.Resampling.BILINEAR)) for c in range(3)],axis=2)
   small,shrink=timed(resize);scene,colour=timed(lambda:convert(small))
   stride=(dw*8+255)//256*256
   def packing():
    a=np.zeros((dh,stride//2),np.float16);r=a[:,:dw*4].reshape(dh,dw,4);r[:,:,:3]=scene;r[:,:,3]=1;return a.tobytes()
   body,pack=timed(packing)
  else:body,pack=timed(transport.tobytes);stride=0
  key=key or f'{index}-{time.time_ns()}'
  result={'index':index,'path':str(p),'key':key,'route':route,'read_ms':read,'read_copy_ms':copy,'unpack_ms':unpack,'metadata_ms':metadata,'develop_ms':develop,'look_ms':look,'shrink_ms':shrink,'colour_ms':colour,'pack_ms':pack,'prepare_ms':(time.perf_counter()-t)*1000,'bytes':len(body),'width':dw,'height':dh,'raw_width':w,'raw_height':h,'matrix':matrix.tolist(),'threshold':threshold.tolist(),'stride':stride,'adjustments':grade,'edge':max(dw,dh),'white':203,'has_reference':False}
  if keep:DATA[key]=(body,result)
  return (body,result) if return_body else result
 finally:raw.close()
def floor(index):
 p=paths()[index];b,read,copy=cold(p);r,unpack=timed(lambda:opened(b))
 try:return {'index':index,'path':str(p),'read_ms':read,'copy_ms':copy,'unpack_ms':unpack,'shape':list(r.raw_image_visible.shape),'pattern':r.raw_pattern.tolist(),'bytes':len(b),'threads':THREADS}
 finally:r.close()
DATA={}
POOL=None
FG=ThreadPoolExecutor(max_workers=1)
LOCK=threading.Lock();ACTIVE={};PENDING=[];DONE={};SELECTED=0;LANES=2;FOREGROUND=None
def ping():return os.getpid()
def background_init():
 K.GetCurrentProcess.restype=C.c_void_p;K.SetPriorityClass.argtypes=[C.c_void_p,C.c_uint32];K.SetPriorityClass(K.GetCurrentProcess(),0x4000)
def pump():
 global PENDING,FOREGROUND
 for slot,f in list(ACTIVE.items()):
  if f.done():
   body,meta=f.result();DATA[meta['key']]=(body,meta);DONE[slot]=meta;del ACTIVE[slot]
   if slot==FOREGROUND:FOREGROUND=None
 # One lane reserved for the photo currently viewed; do not queue behind read-ahead.
 if SELECTED not in DONE and SELECTED not in ACTIVE and SELECTED in PENDING and FOREGROUND is None:
  FOREGROUND=SELECTED
  ACTIVE[SELECTED]=FG.submit(process,SELECTED,'gpu','browse'+str(SELECTED),False,True);PENDING.remove(SELECTED)
 for slot in sorted(PENDING,key=lambda i:abs(i-SELECTED)):
  if len(ACTIVE)-(FOREGROUND is not None)>=LANES:break
  if slot in ACTIVE or slot in DONE:continue
  ACTIVE[slot]=POOL.submit(process,slot,'gpu','browse'+str(slot),False,True);PENDING.remove(slot)
def start(lanes,indices,batch=False):
 global POOL,ACTIVE,PENDING,DONE,SELECTED,LANES,FOREGROUND
 if POOL:POOL.shutdown(wait=True,cancel_futures=True)
 for f in ACTIVE.values():f.result()
 ACTIVE={};DONE={};FOREGROUND=None;PENDING=list(indices);SELECTED=-1 if batch else indices[0];LANES=lanes;DATA.clear()
 os.environ['M9_THREADS']='1';POOL=ProcessPoolExecutor(max_workers=lanes,initializer=background_init)
 # Start each worker before starting the reported batch clock.
 futures=[POOL.submit(ping) for _ in range(lanes)];[f.result() for f in futures]
 if batch:
  ACTIVE={i:POOL.submit(process,i,'gpu','batch'+str(i),False,True) for i in indices};PENDING=[]
 else:pump()
 return {'workers':lanes,'ready':True}
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*a):pass
 def send(self,b,kind='application/json',meta=None):
  if not isinstance(b,bytes):b=json.dumps(b).encode()
  self.send_response(200);self.send_header('Content-Type',kind);self.send_header('Access-Control-Allow-Origin','*')
  if meta:
   for k,v in {'X-Image-Width':meta['width'],'X-Image-Height':meta['height'],'X-Bytes-Per-Row':meta['stride'],'X-Working-Space':'ACEScg'}.items():self.send_header(k,str(v))
   self.send_header('Access-Control-Expose-Headers','X-Image-Width,X-Image-Height,X-Bytes-Per-Row,X-Working-Space')
  self.end_headers();self.wfile.write(b)
 def do_GET(self):
  from urllib.parse import urlparse,parse_qs
  u=urlparse(self.path);q={k:v[0] for k,v in parse_qs(u.query).items()}
  if u.path=='/health':return self.send({'ok':True,'paths':list(map(str,paths()))})
  b,m=DATA[q['key']];return self.send(b,'application/octet-stream',m)
 def do_POST(self):
  global SELECTED,PENDING
  a=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
  try:
   if self.path=='/start':
    with LOCK:return self.send(start(**a))
   if self.path=='/select':
    with LOCK:
     SELECTED=a['index'];PENDING=[i for i in PENDING if i>=SELECTED];pump();return self.send({'ok':True})
   if self.path=='/status':
    with LOCK:
     pump();return self.send({'ready':list(DONE.values()),'active':list(ACTIVE)})
   if self.path=='/prepare':return self.send(process(**a,keep=True))
   if self.path=='/baseline':
    p=paths()[a['index']];pixels,_,facts=lp.decode_picture(p,a.get('edge',2160),'quick');grade=lp.default_look(pixels,None,True,p.suffix.lower()).model_dump(mode='json');h,w=pixels.shape[:2];stride=(w*8+255)//256*256;v=np.zeros((h,stride//2),np.float16);r=v[:,:w*4].reshape(h,w,4);r[:,:,:3]=pixels;r[:,:,3]=1;m={'key':a['key'],'width':w,'height':h,'stride':stride,'adjustments':grade,'edge':max(w,h),'white':203,'has_reference':False};DATA[m['key']]=(v.tobytes(),m);return self.send(m)
   if self.path=='/release':DATA.clear();return self.send({'ok':True})
  except Exception as e:self.send_error(500,repr(e))
if __name__=='__main__':
 mode=sys.argv[1]
 if mode=='init':init()
 if mode=='floor':
  rows=[]
  for repeat in range(2):
   for i in range(6):rows.append(dict(floor(i),repeat=repeat));print('floor',THREADS,repeat,i,flush=True)
  batches=[]
  for lanes in (1,2,3,6):
   for repeat in range(2):
    t=time.perf_counter()
    with ThreadPoolExecutor(max_workers=lanes) as pool:r=list(pool.map(lambda p:cold(p)[1],paths()[:6]))
    batches.append({'lanes':lanes,'repeat':repeat,'wall_ms':(time.perf_counter()-t)*1000,'read_ms':r})
  write(f'floor-{THREADS}.json',{'rows':rows,'parallel_reads':batches})
 if mode=='cpu':
  rows=[]
  for repeat in range(2):
   for i in range(6):rows.append(dict(process(i),repeat=repeat));print('cpu',repeat,i,flush=True)
  write('cpu.json',rows)
 if mode=='serve':ThreadingHTTPServer(('127.0.0.1',8809),Handler).serve_forever()
