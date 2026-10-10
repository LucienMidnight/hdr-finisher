"""Test-only quick-open service. Originals read-only; no disk pixels/cache/encoder.
Run only with the matching Electron driver. Production code remains untouched.
"""
from __future__ import annotations
import os
for name in ('OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS','NUMEXPR_NUM_THREADS'):
    os.environ[name] = '1'
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'output/library-quick-open-trial'
os.environ['HDR_FINISHER_APP_DATA_DIR'] = str(OUT / 'app-data')
os.environ['HDR_FINISHER_SOURCE_CACHE_DISABLE'] = '1'
import sys, json, time, threading, importlib.util
from io import BytesIO
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
sys.path.insert(0, str(ROOT / 'backend'))
import numpy as np
import rawpy
from PIL import Image, ImageOps
from hdr_finisher import loader, raw_import
from hdr_finisher.color import normalize_to_acescg, map_negative_acescg
from hdr_finisher.analysis import classify_hdr
from hdr_finisher.models import AdjustmentState
from hdr_finisher.preview import downsample_image as grade_downsample
from hdr_finisher.render_cache import encode_rgba_proxy_rows

CORPUS = json.loads((ROOT / 'output/library-measurements/corpus.json').read_text())
ROWS = [r for r in CORPUS['rows'] if not r.get('error') and not r.get('excluded')]
PATHS = [Path(r['path']) for r in ROWS]
CAMERA = [i for i,r in enumerate(ROWS) if r.get('mosaiced')]
assert len(PATHS)==29 and len(CAMERA)==19
NAMES = ['DJI_0071-2.DNG','DSC02767.ARW','DSC06615.ARW','DSC00264_DxO-optical-corr-only.dng','2L1B8631.CR2','Fujifilm_X-E2S_DSCF6495.RAF','Nikon_D7500_DSC_3931.NEF']
TEN = [PATHS.index(next(p for p in PATHS if p.name==n)) for n in NAMES]
for extra in ['DJI Samples/DJI_0071.JPG','Test Suite Images/iphone_16_pro_IMG_3324.HEIC','DSC04375_DxO_clipped_target.tif']:
    TEN.append(len(PATHS)); PATHS.append(Path(CORPUS['source']) / extra)
PREPARED = {}
POOL = None
FUTURES = {}
LOCK = threading.Lock()

def timed(fn):
    start=time.perf_counter(); result=fn(); return result,(time.perf_counter()-start)*1000

def downsample_image(image,edge):
    # Trial-only bilinear reduction: no costly Grade local-range filtering.
    h,w=image.shape[:2]
    if max(h,w)<=edge:return image
    size=(max(1,round(w*edge/max(h,w))),max(1,round(h*edge/max(h,w))))
    return np.stack([np.asarray(Image.fromarray(image[:,:,c].astype(np.float32)).resize(size,Image.Resampling.BILINEAR)) for c in range(3)],axis=2)

def embedded(path,edge):
    # open_file reads header without unpacking sensor pixels.
    with rawpy.RawPy() as raw:
        raw.open_file(str(path)); thumb=raw.extract_thumb()
        image=Image.open(BytesIO(thumb.data)) if thumb.format==rawpy.ThumbFormat.JPEG else Image.fromarray(thumb.data)
        image.draft('RGB',(edge,edge)); image.thumbnail((edge,edge))
        return np.asarray(ImageOps.exif_transpose(image).convert('RGB'),dtype=np.float32)/255

def pack(image):
    return encode_rgba_proxy_rows(image,0,image.shape[0],prefer_half=True,pixel_format='rgba16float')

def reduced_jpeg(path,edge):
    from PIL import ImageCms
    with Image.open(path) as source:
        profile=source.info.get('icc_profile')
        source.draft('RGB',(edge,edge))
        image=ImageOps.exif_transpose(source)
        image.thumbnail((edge,edge))
        if profile:
            image=ImageCms.profileToProfile(image,ImageCms.ImageCmsProfile(BytesIO(profile)),ImageCms.createProfile('sRGB'),outputMode='RGB')
        return np.asarray(image.convert('RGB'),dtype=np.float32)/255,{'color_space':'sRGB','transfer_function':'sRGB'}

def open_quick(index,edge=1600,kind='quick'):
    path=PATHS[index]; stages={}; started=time.perf_counter(); raw_input=index<29
    matrix=None; eotf=False; reference_image=None
    if raw_input and (kind=='embedded' or not ROWS[index].get('mosaiced')):
        pixels,stages['decode_ms']=timed(lambda:embedded(path,edge))
        space='sRGB'; eotf=True; route='embedded-jpeg' if kind=='embedded' else 'linear-dng-embedded-jpeg'
        raw_input=False # authored camera rendition: preserve its brightness
    elif raw_input:
        raw,stages['unpack_ms']=timed(lambda:rawpy.imread(str(path)))
        with raw:
            try:
                meta=raw_import._camera_linear_metadata_from_libraw(raw)
            except raw_import._CameraLinearUnsupported:
                meta=None
            transport,stages['demosaic_ms']=timed(lambda:raw.postprocess(half_size=True,
                demosaic_algorithm=rawpy.DemosaicAlgorithm.LINEAR,use_camera_wb=meta is None,use_auto_wb=False,
                **({'user_wb':[1.]*4,'no_auto_scale':True} if meta else {}),
                no_auto_bright=True,output_color=rawpy.ColorSpace.raw if meta else rawpy.ColorSpace.sRGB,
                gamma=(1.,1.),output_bps=16,highlight_mode=rawpy.HighlightMode.Clip))
            pixels,stages['reduce_ms']=timed(lambda:downsample_image(transport,edge)*np.float32(1/65535))
            if meta:
                matrix=meta.camera_to_acescg * (meta.as_shot_wb * 65535/(meta.white_level-meta.black_level))[None,:]
            space='sRGB'; route='half-camera-linear' if meta else 'half-libraw-linear-srgb'
    else:
        decode=loader._load_heif if path.suffix.lower() in {'.heic','.heif'} else loader._load_tiff if path.suffix.lower() in {'.tif','.tiff'} else loader._load_with_pillow
        (image,metadata),stages['decode_ms']=timed(lambda:reduced_jpeg(path,edge) if path.suffix.lower() in {'.jpg','.jpeg'} else decode(path))
        pixels,stages['reduce_ms']=timed(lambda:downsample_image(image,edge))
        space=loader.detect_color_space(metadata,path.suffix.lower())
        transfer=metadata.get('transfer_function') or loader.detect_transfer_function(metadata,path.suffix.lower())
        # Mirror Grade's unresolved-source behavior without inventing primaries.
        # This TIFF remains interpretation-unconfirmed in the report.
        if space is None:matrix=np.eye(3,dtype=np.float32)
        eotf=space is not None and (transfer=='sRGB' or transfer is None and space in {'sRGB','Display P3'})
        if metadata.get('sdr_reference_image') is not None:
            reference_image=downsample_image(metadata['sdr_reference_image'],edge)
        route='processed-'+path.suffix.lower()[1:]
    if matrix is None:
        basis=normalize_to_acescg(np.eye(3,dtype=np.float32).reshape(1,3,3),space,'LINEAR')
        matrix=basis[0].T
    matrix=np.asarray(matrix,dtype=np.float32)
    # Meter only a 256-edge sample on CPU; full color/WB/gamut conversion is GPU.
    sample=pixels[::max(1,int(np.ceil(max(pixels.shape[:2])/256)))].copy()
    if eotf:sample=np.where(sample<=.04045,sample/12.92,((sample+.055)/1.055)**2.4)
    sample=map_negative_acescg(sample @ matrix.T)
    exposure,stages['auto_exposure_ms']=timed(lambda:loader._recommended_raw_exposure_ev(sample) if raw_input else 0.)
    analysis,stages['classification_ms']=timed(lambda:classify_hdr(sample,{},path.suffix.lower()))
    grade=AdjustmentState(); grade.hdr.exposure=exposure; grade.sdr.exposure=exposure
    if reference_image is not None:grade.sdr.highlight_section_enabled=False
    from hdr_finisher.sessions import LoadedSession
    from types import SimpleNamespace
    proxy=SimpleNamespace(analysis=analysis,sdr_reference_image=reference_image,hdr_reference_white_nits=203,adjustments=grade)
    LoadedSession._sync_highlight_source_peaks(proxy)
    grade.hdr.exposure+=.25; grade.sdr.exposure+=.25
    (body,stride),stages['pack_ms']=timed(lambda:pack(pixels))
    result={'index':index,'path':str(path),'route':route,'edge':edge,'width':pixels.shape[1],'height':pixels.shape[0],
        'adjustments':grade.model_dump(mode='json'),'white':203,'stages':stages,'quick_ms':(time.perf_counter()-started)*1000,
        'bytes':len(body),'stride':stride,'body':body,'image':sample,'working_space':'acescg',
        'matrix':matrix.tolist(),'eotf':eotf,'has_reference':reference_image is not None}
    if reference_image is not None:result['body_sdr']=pack(reference_image)[0]
    return result

def reference(index,edge):
    # Import the earlier instrument without running its command-line main.
    saved=sys.argv; sys.argv=['photo-library-speed-trial.py','serve','--threads','one']
    try:
        spec=importlib.util.spec_from_file_location('previous_trial',Path(__file__).with_name('photo-library-speed-trial.py'))
        module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    finally: sys.argv=saved
    session,pair,timing=module.open_session(PATHS[index],'full')
    image=grade_downsample(pair[0],edge)
    body,stride=pack(image)
    grade=session.adjustments.model_copy(deep=True); grade.hdr.exposure+=.25; grade.sdr.exposure+=.25
    return {'index':index,'path':str(PATHS[index]),'route':'Grade-full','edge':edge,'width':image.shape[1],'height':image.shape[0],
        'adjustments':grade.model_dump(mode='json'),'white':session.hdr_reference_white_nits,'quick_ms':timing['total_ms'],
        'stages':timing,'bytes':len(body),'stride':stride,'body':body,'image':image,'working_space':'acescg','has_reference':pair[1] is not None,
        **({'body_sdr':pack(grade_downsample(pair[1],edge))[0]} if pair[1] is not None else {})}

def public(value,key): return {k:v for k,v in value.items() if k not in {'body','body_sdr','image'}} | {'key':key}

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def respond(self,data,headers=None,status=200):
        body=data if isinstance(data,bytes) else json.dumps(data).encode()
        self.send_response(status); self.send_header('Content-Length',str(len(body)))
        self.send_header('Content-Type','application/octet-stream' if isinstance(data,bytes) else 'application/json')
        self.send_header('Access-Control-Allow-Origin','*');self.send_header('Access-Control-Expose-Headers','*')
        for k,v in (headers or {}).items():self.send_header(k,str(v))
        self.end_headers(); self.wfile.write(body)
    def do_OPTIONS(self):
        self.send_response(204)
        for k,v in {'Content-Length':'0','Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'*','Access-Control-Allow-Private-Network':'true'}.items():self.send_header(k,v)
        self.end_headers()
    def do_GET(self):
        try:
            url=urlparse(self.path); q=parse_qs(url.query)
            if url.path=='/health':return self.respond({'ready':True})
            if url.path=='/paths':return self.respond({'paths':list(map(str,PATHS)),'camera':CAMERA,'all':list(range(29)),'ten':TEN,'grid':list(range(29))+[29]})
            p=PREPARED[q['key'][0]]
            is_reference=q.get('lane',['hdr'])[0]=='sdr' and p.get('has_reference')
            self.respond(p['body_sdr'] if is_reference else p['body'],{'X-Image-Width':p['width'],'X-Image-Height':p['height'],'X-Bytes-Per-Row':p['stride'],
                'X-Pixel-Format':'rgba16float','X-Working-Space':'linear-srgb' if is_reference else p['working_space'],'X-Geometry-Signature':q.get('geometry_signature',['{}'])[0],'X-Edit-Revision':0})
        except Exception as exc:self.respond({'error':str(exc)},status=500)
    def do_POST(self):
        global POOL,FUTURES
        try:
            url=urlparse(self.path); request=json.loads(self.rfile.read(int(self.headers['Content-Length']))); q=parse_qs(url.query)
            if url.path=='/start':
                if POOL:POOL.shutdown(wait=True)
                PREPARED.clear(); POOL=ThreadPoolExecutor(max_workers=request['workers'])
                FUTURES={i:POOL.submit(open_quick,i,request['edge'],request.get('kind','quick')) for i in request['indices']}
                return self.respond({'started':len(FUTURES)})
            if url.path=='/wait':
                wait(list(FUTURES.values())); return self.respond({'ready':len(FUTURES)})
            if url.path=='/next':
                done,_=wait(list(FUTURES.values()),return_when=FIRST_COMPLETED)
                index=next(i for i,f in FUTURES.items() if f in done); value=FUTURES.pop(index).result()
            elif url.path=='/open':value=open_quick(request['index'],request['edge'],request.get('kind','quick'))
            elif url.path=='/reference':value=reference(request['index'],request['edge'])
            elif url.path=='/release':PREPARED.clear(); return self.respond({'released':True})
            else:raise ValueError('Unknown operation')
            key=request['key']; PREPARED[key]=value
            self.respond(public(value,key))
        except Exception as exc:
            import traceback; traceback.print_exc(); self.respond({'error':str(exc)},status=500)

if __name__=='__main__':
    OUT.mkdir(parents=True,exist_ok=True)
    print('quick-open ready',flush=True)
    ThreadingHTTPServer(('127.0.0.1',8801),Handler).serve_forever()

