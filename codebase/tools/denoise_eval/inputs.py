"""Crop-only sensor inputs, empirical calibration and deterministic charts."""
from __future__ import annotations
from dataclasses import dataclass
from types import SimpleNamespace
import io
import json
from pathlib import Path
import subprocess
import cv2
import numpy as np
import rawpy
import tifffile
from PIL import Image, ImageDraw
from tools.lib.test_photos import photo_root, manifest_files
from hdr_finisher.export_metadata import command as exiftool_command
from hdr_finisher.raw_import import (_camera_linear_metadata_from_libraw,
    _camera_rgb_to_acescg_float32)

SEED = 16112026
RAW_EXT = {'.arw', '.cr2', '.cr3', '.nef', '.orf', '.rw2', '.raf', '.dng'}


@dataclass
class Sample:
    name: str
    rgb: np.ndarray
    bayer: np.ndarray | None
    metadata: dict
    clean: np.ndarray | None
    masks: dict
    clean_bayer: np.ndarray | None = None


def fit_noise(means, variances):
    """Nonnegative least-squares variance = a*signal+b, no hidden parameter floor."""
    x, y = np.asarray(means, float), np.asarray(variances, float)
    design = np.column_stack((x, np.ones_like(x)))
    a, b = np.linalg.lstsq(design, y, rcond=None)[0]
    choices = [(max(0., float(a)), max(0., float(b))),
               (max(0., float(x@y/max(x@x, 1e-30))), 0.), (0., max(0., float(np.mean(y))))]
    a,b = min(choices, key=lambda ab: float(np.sum((y-design@ab)**2)))
    residual = y-(a*x+b)
    return dict(a=a, b=b, r2=float(1-np.sum(residual**2)/max(np.sum((y-y.mean())**2),1e-30)),
                samples=len(x), signal_min=float(x.min()), signal_max=float(x.max()))


def normalise_crop(raw, y, x, size):
    """Only this bounded sensor window is converted to float, never the whole RAW."""
    mosaic = raw.raw_image_visible[y:y+size, x:x+size].astype(np.float32)
    pattern = raw.raw_pattern
    black = raw.black_level_per_channel
    white = raw.camera_white_level_per_channel or [raw.white_level]*4
    for py in range(pattern.shape[0]):
        for px in range(pattern.shape[1]):
            ch = int(pattern[(y+py)%pattern.shape[0], (x+px)%pattern.shape[1]])
            w = white[ch] or raw.white_level
            mosaic[py::pattern.shape[0], px::pattern.shape[1]] -= black[ch]
            mosaic[py::pattern.shape[0], px::pattern.shape[1]] /= w-black[ch]
    return mosaic


def flat_observations(mosaic, block=16):
    """Plane-detrended Bayer sub-channel blocks; reject structured blocks per signal bin."""
    y,x = np.indices((block,block)); design = np.column_stack((np.ones(block*block),x.ravel(),y.ravel()))
    pinv = np.linalg.pinv(design)
    observations = []
    for y0 in range(0,mosaic.shape[0]-block+1,block):
        for x0 in range(0,mosaic.shape[1]-block+1,block):
            p = mosaic[y0:y0+block,x0:x0+block].ravel().astype(float)
            coeff = pinv@p; residual = (p-design@coeff).reshape(block,block)
            # Structure score uses correlation (white sensor noise is uncorrelated).
            var = np.sum(residual**2)/(block*block-3)
            corr = abs(np.mean(residual[:,1:]*residual[:,:-1]))+abs(np.mean(residual[1:]*residual[:-1]))
            if 0.0001 < p.mean() < .85 and var > 0:
                observations.append((float(p.mean()),float(var),float(corr/var)))
    return observations


def fit_observations(observations):
    arr = np.asarray(observations)
    if len(arr) < 12:
        return None
    selected=[]
    # Local lower-quartile variance reduces scene contamination, but cannot replace dark/flat pairs.
    for group in np.array_split(arr[np.argsort(arr[:,0])], min(12,len(arr)//8)):
        quiet = group[group[:,2] <= np.quantile(group[:,2], .5)]
        selected.append((float(np.median(quiet[:,0])),float(np.quantile(quiet[:,1], .25))))
    result = fit_noise(*np.asarray(selected).T)
    result['raw_blocks'] = len(arr)
    result['confidence'] = 'single-frame estimate; texture and undocumented in-camera processing may bias the fit'
    return result


def optical_black(raw):
    """Report accessible top/left masked sensor samples as diagnostics, not a trusted dark frame."""
    a=raw.raw_image; s=raw.sizes
    patches=[]
    if s.top_margin >= 8:
        patches.append(a[:min(s.top_margin,64),:min(a.shape[1],2048)])
    if s.left_margin >= 8:
        patches.append(a[:min(a.shape[0],2048),:min(s.left_margin,64)])
    if not patches:
        return {'available':False}
    values=np.concatenate([p.ravel() for p in patches]).astype(float)
    return dict(available=True, samples=len(values), mean_dn=float(values.mean()), std_dn=float(values.std()),
                used_for_fit=False, reason='mask may contain padding or sensor processing; not a calibrated dark frame')


def inventory():
    root=photo_root()
    files=[root/e['name'] for e in manifest_files() if Path(e['name']).suffix.lower() in RAW_EXT]
    tags=json.loads(subprocess.check_output([*exiftool_command(),'-json','-ISO','-Make','-Model',*map(str,files)],text=True))
    by_path={Path(t['SourceFile']).resolve():t for t in tags}
    result=[]
    for path in files:
        tag=by_path[path.resolve()]
        entry=dict(file=path.name,iso=tag.get('ISO'),camera=f"{tag.get('Make','')} {tag.get('Model','')}".strip())
        try:
            with rawpy.imread(str(path)) as raw:
                shape=raw.raw_image_visible.shape
                entry.update(shape=list(shape),cfa=None if raw.raw_pattern is None else raw.raw_pattern.tolist())
                if raw.raw_pattern is not None:
                    try:
                        _camera_linear_metadata_from_libraw(raw)
                        entry['camera_linear_supported']=True
                    except ValueError as error:
                        entry['camera_linear_supported']=False
                        entry['camera_linear_reason']=str(error)
                    p=raw.raw_pattern.shape[0]; size=min(512,*shape)//p*p
                    observations=[[] for _ in range(p*p)]
                    means=[]
                    for fy in (.15,.5,.85):
                        for fx in (.15,.5,.85):
                            y=int((shape[0]-size)*fy)//p*p; x=int((shape[1]-size)*fx)//p*p
                            crop=normalise_crop(raw,y,x,size); means.append(float(np.median(crop)))
                            if p==2:
                                for c in range(4):
                                    observations[c].extend(flat_observations(crop[c//2::2,c%2::2]))
                    entry['shadow_fraction_proxy']=float(np.mean(np.array(means)<.025))
                    entry['noise_fit_positions']= [fit_observations(v) for v in observations] if p==2 else None
                    entry['optical_black']=optical_black(raw)
        except (rawpy.LibRawError,ValueError) as error:
            entry['error']=str(error)
        result.append(entry)
    return result


def metadata_from_raw(raw, entry):
    meta=_camera_linear_metadata_from_libraw(raw)
    # All crops start at even coordinates. Keep the two green positions separate for noise calibration.
    return dict(iso=entry.get('iso'),camera=entry['camera'], source=entry['file'],
                cfa=meta.raw_channel_to_rgb[meta.raw_pattern].tolist(),
                raw_cfa=meta.raw_pattern.tolist(),white_balance=meta.as_shot_wb.tolist(),
                camera_to_acescg=meta.camera_to_acescg.tolist(),
                black_levels=meta.raw_black_level.tolist(),white_levels=meta.raw_white_level.tolist(),
                noise_fit_positions=entry['noise_fit_positions'], exposure_stops=0.)


def unsigned_ahd_control(raw, rawpy):
    """Frozen unsigned research control, not a production RAW decoder."""
    return raw.postprocess(
        demosaic_algorithm=rawpy.DemosaicAlgorithm.AHD,
        use_camera_wb=False, use_auto_wb=False, user_wb=[1., 1., 1., 1.],
        no_auto_bright=True, no_auto_scale=True, output_color=rawpy.ColorSpace.raw,
        gamma=(1., 1.), output_bps=16, highlight_mode=rawpy.HighlightMode.Clip,
    )


def develop(mosaic, metadata):
    """Bounded in-memory DNG -> the app's LibRaw AHD unity-WB -> app camera/ACEScg conversion.

    Same demosaic and colour bridge as the app, without full-sensor development,
    geometry, lens correction or highlight reconstruction. Sensor readout clips 0..1.
    """
    pattern=np.asarray(metadata['cfa'],np.uint8)
    buffer=io.BytesIO()
    identity=tuple(v for i in range(9) for v in (int(i%4==0),1))
    tags=[(50706,'B',4,(1,4,0,0),False),(50707,'B',4,(1,1,0,0),False),
          (271,'s',0,'DenoiseEval',False),(272,'s',0,'Bayer',False),(50708,'s',0,'DenoiseEval Bayer',False),
          (33421,'H',2,(2,2),False),(33422,'B',4,tuple(pattern.ravel()),False),
          (50714,'I',1,0,False),(50717,'I',1,65535,False),
          (50721,'2i',9,identity,False),(50728,'2I',3,(1,1,1,1,1,1),False),(50778,'H',1,21,False)]
    tifffile.imwrite(buffer,np.rint(np.clip(mosaic,0,1)*65535).astype('uint16'),photometric=32803,metadata=None,extratags=tags)
    buffer.seek(0)
    with rawpy.imread(buffer) as raw:
        transport=unsigned_ahd_control(raw,rawpy)
    meta=SimpleNamespace(as_shot_wb=np.asarray(metadata['white_balance']),camera_to_acescg=np.asarray(metadata['camera_to_acescg']))
    rgb=_camera_rgb_to_acescg_float32(transport.astype('float32')/65535,meta)
    return rgb*np.float32(2**metadata.get('exposure_stops',0))


def masks_for(rgb):
    y=rgb[...,:3].mean(-1); smooth=cv2.GaussianBlur(y,(0,0),2)
    structure=np.abs(cv2.Laplacian(smooth,cv2.CV_32F))
    border=np.zeros(y.shape,bool); border[12:-12,12:-12]=True
    flat=(structure<=np.percentile(structure[border],25))&border
    texture=(structure>=np.percentile(structure[border],60))&border
    return dict(flat=flat,texture=texture)


def bayer_bin2(mosaic):
    """Average 2x2 SAME-CFA samples (4x4 sensor footprint), remosaic at half dimensions."""
    h,w=(np.array(mosaic.shape)//4)*4; m=mosaic[:h,:w]
    result=np.empty((h//2,w//2),'float32')
    for py in range(2):
        for px in range(2):
            plane=m[py::2,px::2]
            result[py::2,px::2]=plane.reshape(h//4,2,w//4,2).mean((1,3))
    return result


def crop_choices(raw,size):
    h,w=raw.raw_image_visible.shape; candidates=[]
    for fy in (.15,.5,.85):
        for fx in (.15,.5,.85):
            y=int((h-size)*fy)//2*2; x=int((w-size)*fx)//2*2
            m=normalise_crop(raw,y,x,size)
            low=cv2.GaussianBlur(m,(0,0),4)
            energy=float(np.std(cv2.Laplacian(low,cv2.CV_32F)))
            edge=float(np.percentile(np.abs(cv2.Sobel(low,cv2.CV_32F,1,0)),95))
            candidates.append(dict(y=y,x=x,energy=energy,edge=edge,mean=float(np.median(low))))
    remaining=candidates.copy(); selected={}
    for role,key in [('flat',lambda c:c['energy']),('shadow',lambda c:c['mean']),
                     ('texture',lambda c:-c['energy']),('edge',lambda c:-c['edge'])]:
        c=min(remaining,key=key); remaining.remove(c); selected[role]=c
    return selected


def real_samples(entries,quick):
    usable=[e for e in entries if e.get('cfa') and len(e['cfa'])==2 and e.get('camera_linear_supported') and not e.get('error') and e.get('iso')]
    high=max(usable,key=lambda e:(float(e['iso']),e['file']))
    shadow=max((e for e in usable if e!=high),key=lambda e:(e.get('shadow_fraction_proxy',0),float(e['iso']),e['file']))
    for entry,roles in [(high,('flat',) if quick else ('flat','texture','edge','shadow')),
                        (shadow,('shadow',) if quick else ('flat','texture','edge','shadow'))]:
        with rawpy.imread(str(photo_root()/entry['file'])) as raw:
            size=512 if quick else 640
            meta=metadata_from_raw(raw,entry)
            choices=crop_choices(raw,size)
            for role in roles:
                c=choices[role]; m=normalise_crop(raw,c['y'],c['x'],size)
                unlifted=develop(m,meta)
                median=float(np.median(np.maximum(unlifted,0)))
                lift=float(np.clip(np.log2(.18/max(median,1e-6)),0,6))
                md={**meta,'crop':dict(x=c['x'],y=c['y'],size=size,role=role),'exposure_stops':lift}
                rgb=unlifted*np.float32(2**lift)
                yield Sample(f"real-{entry['file']}-{role}",rgb,m,md,None,masks_for(rgb))


def clean_raw_samples(entries,size):
    usable=sorted((e for e in entries if e.get('cfa') and len(e['cfa'])==2 and e.get('camera_linear_supported') and e.get('iso') and not e.get('error')),key=lambda e:(float(e['iso']),e['file']))
    for entry in usable[:2]:
        with rawpy.imread(str(photo_root()/entry['file'])) as raw:
            h,w=raw.raw_image_visible.shape; y=(h-size*2)//4*2; x=(w-size*2)//4*2
            m=bayer_bin2(normalise_crop(raw,y,x,size*2))
            meta=metadata_from_raw(raw,entry)
            meta['clean_source_crop']=dict(x=x,y=y,size=size*2,binning='2x2 within each CFA plane; remosaic')
        yield entry['file'],m,meta


def targets(size):
    y,x=np.indices((size,size),dtype=float); xx=(x-(size-1)/2); yy=y-(size-1)/2
    slope=np.tan(np.deg2rad(5))
    # Slight optical blur ensures clean MTF50 is measurable below Nyquist.
    edge=cv2.GaussianBlur(np.where(xx-slope*yy>0,.65,.04),(0,0),.9)
    yield 'slanted-edge',np.repeat(edge[...,None],3,-1)
    star=.3+.25*np.cos(32*np.arctan2(yy,xx)); star[np.hypot(xx,yy)<3]=.3
    yield 'siemens-star',np.repeat(star[...,None],3,-1)
    im=Image.new('L',(size,size),20); draw=ImageDraw.Draw(im)
    for pos in range(12,size-12,20):
        draw.text((12,pos),'HDR fine text 0123456789',fill=180)
    yield 'fine-text',np.repeat((np.asarray(im)/255)[...,None],3,-1)
    colors=np.array([[.65,.05,.04],[.04,.6,.06],[.04,.05,.7],[.6,.55,.04],[.6,.04,.5],[.04,.55,.55],[.4,.4,.4],[.03,.03,.03]])
    yield 'colour-patches',colors[((y//(size/2)).astype(int)*4+(x//(size/4)).astype(int)).clip(0,7)]
    gradient=.003+.75*(x/(size-1))**2
    yield 'smooth-gradient',np.repeat(gradient[...,None],3,-1)
    rng=np.random.default_rng(SEED); field=np.full((size,size),.002)
    for cy,cx,amp in zip(rng.integers(4,size-4,80),rng.integers(4,size-4,80),rng.uniform(.05,.8,80)):
        field+=amp*np.exp(-((x-cx)**2+(y-cy)**2)/(2*.65**2))
    yield 'star-field',np.repeat(field[...,None],3,-1)
    fabric=.25+.1*np.sin(2*np.pi*x/4.7)*np.sin(2*np.pi*y/6.3)+.04*np.sin(2*np.pi*(x+y)/23)
    yield 'fabric',np.repeat(fabric[...,None],3,-1)


def remosaic(camera_rgb,cfa):
    m=np.empty(camera_rgb.shape[:2],'float32')
    for py in range(2):
        for px in range(2):
            m[py::2,px::2]=camera_rgb[py::2,px::2,int(cfa[py][px])]
    return m


def noise_parameters(entry,iso):
    fits=entry['noise_fit_positions']
    if not fits or any(f is None or f['a']+f['b']<=0 for f in fits):
        raise ValueError(f"No usable empirical Bayer noise fit for {entry['file']}")
    scale=iso/float(entry['iso'])
    return [dict(a=f['a']*scale,b=f['b']*scale**2) for f in fits]


def add_noise(mosaic,parameters,seed,banding=0.):
    rng=np.random.default_rng(seed); result=np.empty_like(mosaic)
    for c,p in enumerate(parameters):
        clean=mosaic[c//2::2,c%2::2]
        a,b=p['a'],p['b']
        shot=rng.poisson(np.maximum(clean,0)/a)*a if a>0 else np.maximum(clean,0)
        result[c//2::2,c%2::2]=shot+np.minimum(clean,0)+rng.normal(0,np.sqrt(b),clean.shape)
    if banding:
        result+=rng.normal(0,banding,(len(result),1))+rng.normal(0,banding,(1,result.shape[1]))
    return result


def synthetic_samples(entries,quick,banding=0.):
    size=192 if quick else 512
    # Use the best-supported high-ISO Bayer fit for the generated chart camera response.
    candidates=[e for e in entries if e.get('camera_linear_supported') and e.get('noise_fit_positions') and all(e['noise_fit_positions']) and float(e['iso'] or 0)>=1600]
    # Prefer an independently identifiable shot/read fit; high ISO alone does not establish calibration.
    reference=max(candidates,key=lambda e:(all(p['a']>0 and p['b']>0 for p in e['noise_fit_positions']),min(p['r2'] for p in e['noise_fit_positions']),float(e['iso'])))
    with rawpy.imread(str(photo_root()/reference['file'])) as raw:
        default_meta=metadata_from_raw(raw,reference)
    sources=[]
    for name,rgb in targets(size):
        camera=rgb@np.linalg.inv(np.asarray(default_meta['camera_to_acescg'])).T/np.asarray(default_meta['white_balance'])
        sources.append((name,remosaic(np.clip(camera,0,1),default_meta['cfa']),{**default_meta,'generated':name}))
    if not quick:
        sources.extend(clean_raw_samples(entries,size))
    for index,(name,clean_mosaic,meta) in enumerate(sources):
        clean_mosaic=np.clip(clean_mosaic,0,1)
        clean=develop(clean_mosaic,meta)
        masks=masks_for(clean)
        if name=='slanted-edge':
            masks['flat'][:]=False; masks['flat'][:,12:size//4]=True
            masks['texture'][:]=False
        elif name in ('smooth-gradient','colour-patches'):
            masks['texture'][:]=False
        camera_entry=max((e for e in entries if e['camera']==meta['camera'] and e.get('noise_fit_positions') and all(e['noise_fit_positions'])),key=lambda e:float(e['iso'] or 0))
        for iso in (1600,6400,25600):
            params=noise_parameters(camera_entry,iso)
            noisy_mosaic=add_noise(clean_mosaic,params,SEED+index*30000+iso,banding)
            md={**meta,'iso':iso,'noise_parameters':params,'noise_model':'variance=a*signal+b; per CFA position',
                'noise_source_file':camera_entry['file'],'noise_source_iso':camera_entry['iso'],'iso_extrapolation':iso/float(camera_entry['iso']),
                'banding_sigma':banding,'seed':SEED+index*30000+iso,
                'sensor_clipped_fraction':float(np.mean((noisy_mosaic<0)|(noisy_mosaic>1)))}
            # Match the Bayer and RGB sensor readouts exactly, including 16-bit transport quantisation.
            noisy_mosaic=(np.rint(np.clip(noisy_mosaic,0,1)*65535)/65535).astype('float32')
            yield Sample(f'synthetic-{name}-iso{iso}',develop(noisy_mosaic,md),noisy_mosaic,md,clean,masks,clean_mosaic)


def paired_samples(folder):
    """Approved aligned pairs: RGB .npy files or bounded Bayer/RGB/mask .npz bundles."""
    folder=Path(folder).resolve()
    for item in json.loads((folder/'pairs.json').read_text()):
        def load(name):
            p=(folder/name).resolve()
            if not p.is_relative_to(folder):
                raise ValueError('Pair path leaves its folder')
            a=np.load(p,mmap_mode='r',allow_pickle=False)
            if a.ndim!=3 or a.shape[-1] not in (3,4) or max(a.shape[:2])>1024 or min(a.shape[:2])<32 or not np.issubdtype(a.dtype,np.floating):
                raise ValueError('Pairs must be aligned 32..1024 px floating linear ACEScg RGB(A) .npy crops')
            if not np.isfinite(a).all():
                raise ValueError('Pair input contains nonfinite values')
            return np.asarray(a,dtype='float32')
        if 'bundle' in item:
            path = (folder / item['bundle']).resolve()
            if not path.is_relative_to(folder.resolve()):
                raise ValueError('Pair bundle leaves its folder')
            with np.load(path, allow_pickle=False) as bundle:
                noisy, clean = np.asarray(bundle['rgb']), np.asarray(bundle['clean'])
                if noisy.shape != clean.shape or noisy.ndim != 3 or noisy.shape[-1] != 3 or not 32 <= min(noisy.shape[:2]) <= max(noisy.shape[:2]) <= 1024:
                    raise ValueError('Invalid bounded pair RGB shapes')
                bayer, clean_bayer = bundle['bayer'], bundle['clean_bayer']
                masks = {key: bundle[key] for key in ('flat', 'texture', 'edge', 'valid')}
                if bayer.shape != noisy.shape[:2] or clean_bayer.shape != bayer.shape:
                    raise ValueError('Invalid pair Bayer shapes')
                if any(mask.shape != bayer.shape or mask.dtype != np.bool_ for mask in masks.values()):
                    raise ValueError('Invalid pair metric masks')
                if not masks['valid'].any() or any((mask & ~masks['valid']).any() for key, mask in masks.items() if key != 'valid'):
                    raise ValueError('Pair metric masks include invalid pixels')
                if any(not np.issubdtype(image.dtype, np.floating) or not np.isfinite(image).all()
                       for image in (noisy, clean, bayer, clean_bayer)):
                    raise ValueError('Pair contains nonfinite/nonfloating input')
                yield Sample(f"pair-{item['name']}", noisy, bayer, item.get('metadata', {}), clean, masks, clean_bayer)
            continue
        noisy,clean=load(item['noisy']),load(item['clean'])
        if noisy.shape!=clean.shape:
            raise ValueError('Pair shapes differ')
        yield Sample(f"pair-{item['name']}",noisy,None,item.get('metadata',{}),clean,masks_for(clean))
