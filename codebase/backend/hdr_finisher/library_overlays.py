"""Disposable source-data maps; never Grade, export or Proof rendering."""
from hashlib import sha256
from io import BytesIO
import json, os
from pathlib import Path
from tempfile import NamedTemporaryFile
from time import perf_counter
import numpy as np
from PIL import Image, ImageOps
from .library_pictures import LibraryPictureCache, check_cancelled
from .library_diagnostics import log
from .raw_import import RAW_EXTENSIONS

VERSION="library-overlay-v3"
REGISTER_EDGE=640


def map_key(path,kind,quality="half"):
    path=Path(path).resolve(strict=True);s=path.stat()
    return sha256(f"{VERSION}:{path}:{s.st_size}:{s.st_mtime_ns}:{kind}:{quality}".encode()).hexdigest()


def pool_cell(h,w,edge=512):
    return max(1,int(np.ceil(max(h,w)/edge)))


def pool_max(values,edge=512):
    """Retain isolated warnings/detail within every small map cell."""
    h,w=values.shape[:2];sy=sx=pool_cell(h,w,edge)
    shape=(int(np.ceil(h/sy))*sy,int(np.ceil(w/sx))*sx)
    padded=np.pad(values,((0,shape[0]-h),(0,shape[1]-w)),mode="constant")
    return padded.reshape(shape[0]//sy,sy,shape[1]//sx,sx).max(axis=(1,3))


def exposure_regions(samples,black,white,pattern=None):
    samples=np.asarray(samples);black=np.asarray(black);white=np.asarray(white)
    blown=samples>=white
    unit=1 if samples.dtype.kind in "ui" else 1e-6
    blocked=samples<=black+np.maximum(unit,(white-black)*.001)
    if samples.ndim==3: blown=blown.any(axis=2);blocked=blocked.all(axis=2)
    elif pattern is not None:
        # A dark colour channel in a bright coloured subject is not a blocked shadow.
        sy,sx=pattern.shape;h,w=blocked.shape;ph=int(np.ceil(h/sy))*sy;pw=int(np.ceil(w/sx))*sx
        padded=np.pad(blocked,((0,ph-h),(0,pw-w)),constant_values=False)
        cells=padded.reshape(ph//sy,sy,pw//sx,sx).all(axis=(1,3))
        blocked=np.repeat(np.repeat(cells,sy,axis=0),sx,axis=1)[:h,:w]
    return blown,blocked


def raw_exposure_regions(samples,colors,black,white,pattern):
    """Use scalar channel levels on verified repeating visible sensor slices.

    The visible origin need not match raw_pattern (sensor margins can shift it).
    Non-repeating colour maps retain the general per-pixel calculation.
    """
    samples=np.asarray(samples);colors=np.asarray(colors)
    black=np.asarray(black);white=np.asarray(white)
    if pattern is not None and np.ndim(pattern)==2 and all(pattern.shape):
        sy,sx=pattern.shape
        tile=colors[:sy,:sx]
        if colors.shape==samples.shape and all(
                np.all(colors[y::sy,x::sx]==tile[y,x])
                for y in range(tile.shape[0]) for x in range(tile.shape[1])):
            h,w=samples.shape
            blown=np.empty(samples.shape,dtype=bool)
            # Keep one all-channels-dark answer per CFA group. Incomplete
            # edge groups stay false, as with the former false-padded plane.
            cells=np.ones(((h+sy-1)//sy,(w+sx-1)//sx),dtype=bool)
            if h%sy:cells[-1,:]=False
            if w%sx:cells[:,-1]=False
            for y in range(tile.shape[0]):
                for x in range(tile.shape[1]):
                    channel=tile[y,x]
                    # One-element arrays preserve NumPy's array promotion and
                    # threshold arithmetic, including floating-point sources.
                    hi,lo=exposure_regions(samples[y::sy,x::sx],black[channel:channel+1],white[channel:channel+1])
                    blown[y::sy,x::sx]=hi
                    cells[:lo.shape[0],:lo.shape[1]]&=lo
            return blown,np.repeat(np.repeat(cells,sy,axis=0),sx,axis=1)[:h,:w]
    return exposure_regions(samples,black[colors],white[colors],pattern)


def orient_samples(values,orientation):
    if orientation==2:return np.fliplr(values)
    if orientation==3:return np.rot90(values,2)
    if orientation==4:return np.flipud(values)
    if orientation==5:return values.swapaxes(0,1)
    if orientation==6:return np.rot90(values,3)
    if orientation==7:return np.flipud(np.fliplr(values.swapaxes(0,1)))
    if orientation==8:return np.rot90(values)
    return values


def small_luminance(values,edge=REGISTER_EDGE):
    """A small linear brightness picture of a measured frame, for lining up the camera preview."""
    import cv2
    values=np.asarray(values)
    h,w=values.shape[:2];scale=min(1.,edge/max(h,w))
    size=(max(1,round(w*scale)),max(1,round(h*scale)))
    if values.ndim==3:values=values[...,:3]
    small=cv2.resize(np.ascontiguousarray(values,dtype=np.float32),size,interpolation=cv2.INTER_AREA)
    return (small.mean(axis=2) if small.ndim==3 else small).astype(np.float32)


def camera_preview_image(path):
    """The camera's embedded preview, oriented exactly as the Library shows it."""
    import rawpy
    with rawpy.RawPy() as raw:
        raw.open_file(str(path))
        thumb=raw.extract_thumb()
        if thumb.format==rawpy.ThumbFormat.JPEG:
            image=Image.open(BytesIO(thumb.data));image.draft("RGB",(1024,1024))
        else:image=Image.fromarray(thumb.data)
        return ImageOps.exif_transpose(image).convert("L")


class PreviewNotAligned(ValueError):
    pass


def register_preview(luminance,preview):
    """Where the camera preview sits in the measured frame, as fractions [x, y, width, height].

    The embedded JPEG is usually a slightly inset crop of the sensor area
    (Canon: the camera's 5184 x 3456 inside LibRaw's 5202 x 3464), so the map is
    lined up by image registration (scale and offset), checked before use."""
    import cv2
    def prepared(values):
        values=np.maximum(np.asarray(values,dtype=np.float32),0)
        top=float(np.percentile(values,99))
        if top<=0:raise PreviewNotAligned("The camera preview could not be lined up with the sensor data: the picture is blank.")
        return np.log(values/top+1e-3).astype(np.float32)
    signal=np.asarray(preview,dtype=np.float32)/255
    signal=np.where(signal<=.04045,signal/12.92,((signal+.055)/1.055)**2.4)
    width=REGISTER_EDGE;ph=max(8,round(width*signal.shape[0]/signal.shape[1]))
    template=prepared(cv2.resize(signal.astype(np.float32),(width,ph),interpolation=cv2.INTER_AREA))
    sh=max(8,round(width*luminance.shape[0]/luminance.shape[1]))
    measured=prepared(cv2.resize(np.asarray(luminance,dtype=np.float32),(width,sh),interpolation=cv2.INTER_AREA))
    preview_aspect=signal.shape[1]/signal.shape[0];sensor_aspect=luminance.shape[1]/luminance.shape[0]
    if abs(np.log(preview_aspect/sensor_aspect))>np.log(1.02):
        # A different picture shape (for example an in-camera 16:9 crop): start from a centred crop.
        fw,fh=(min(1.,preview_aspect/sensor_aspect),min(1.,sensor_aspect/preview_aspect))
    else:fw=fh=1.
    warp=np.asarray([[fw,0,(1-fw)/2*width],[0,fh*sh/ph,(1-fh)/2*sh]],dtype=np.float32)
    try:
        score,warp=cv2.findTransformECC(template,measured,warp,cv2.MOTION_AFFINE,
            (cv2.TERM_CRITERIA_EPS|cv2.TERM_CRITERIA_COUNT,200,1e-6),None,5)
    except cv2.error as error:
        raise PreviewNotAligned("The camera preview could not be lined up with the sensor data.") from error
    (a,b,tx),(c,d,ty)=warp
    frame=[float(tx/width),float(ty/sh),float(a),float(d*ph/sh)]
    x,y,w,h=frame
    shape_error=abs(np.log((w*luminance.shape[1])/(h*luminance.shape[0])/preview_aspect))
    if (score<.8 or abs(b)>.005 or abs(c)>.005 or w<.3 or h<.3 or x<-.02 or y<-.02
            or x+w>1.02 or y+h>1.02 or shape_error>.015):
        raise PreviewNotAligned("The camera preview could not be lined up with the sensor data.")
    return frame


def camera_frame(path,luminance,preview=None):
    """Return metadata placing the map under the camera preview, or the reason it cannot."""
    try:
        preview=camera_preview_image(path) if preview is None else preview
        return {"camera_frame":register_preview(luminance,preview)}
    except PreviewNotAligned as error:return {"camera_frame_error":str(error)}
    except Exception as error:return {"camera_frame_error":f"The camera preview could not be read: {error}"}


def exposure_source(path,cancelled=None,probe=None):
    """Return blown and blocked masks. `probe`, when given, receives a small
    luminance picture of the same frame for camera-preview registration."""
    path=Path(path);check_cancelled(cancelled)
    if path.suffix.lower() in RAW_EXTENSIONS:
        if path.suffix.lower()==".dng":
            from .linear_dng import inspect_dng,DngRoute
            inspection=inspect_dng(path)
            if inspection.route==DngRoute.LINEAR_DNG:
                import tifffile
                from .linear_dng import _normalize_layout,crop_and_orient,color_metadata_from_mapping
                from .dng_color import normalize_camera_samples
                with tifffile.TiffFile(path) as tif:
                    series=tif.series[inspection.primary_series_index]
                    samples=_normalize_layout(series.asarray(),getattr(series,"axes",None))
                samples=crop_and_orient(normalize_camera_samples(samples,color_metadata_from_mapping(inspection.metadata)),inspection.metadata)
                if probe is not None:probe["luminance"]=small_luminance(samples)
                return exposure_regions(samples,0.,1.)
        import rawpy
        with rawpy.imread(str(path)) as raw:
            samples=raw.raw_image_visible
            if samples.ndim==2:
                colors=raw.raw_colors_visible
                black=np.asarray(raw.black_level_per_channel)
                levels=raw.camera_white_level_per_channel
                levels=np.asarray(levels if levels and all(v>0 for v in levels) else [raw.white_level]*4)
                white=levels
            else:
                black=np.asarray(raw.black_level_per_channel)[:samples.shape[2]]
                levels=raw.camera_white_level_per_channel
                white=np.asarray(levels if levels and all(v>0 for v in levels) else [raw.white_level]*4)[:samples.shape[2]]
            blown,blocked=(raw_exposure_regions(samples,colors,black,white,raw.raw_pattern)
                if samples.ndim==2 else exposure_regions(samples,black,white))
            # LibRaw flip values correspond to its default output orientation.
            rotations={3:2,5:1,6:3};turns=rotations.get(raw.sizes.flip,0)
            if turns: blown=np.rot90(blown,turns);blocked=np.rot90(blocked,turns)
            if probe is not None:probe["luminance"]=np.rot90(small_luminance(samples)-float(np.mean(raw.black_level_per_channel)),turns)
            return blown.copy(),blocked.copy()
    if path.suffix.lower() in {".png",".jpg",".jpeg"}:
        from .loader import is_ultrahdr_jpeg
        if path.suffix.lower() in {".jpg",".jpeg"} and is_ultrahdr_jpeg(path):
            raise ValueError("Exposure warnings unavailable: this HDR file has no recorded sensor clipping limit.")
        with path.open("rb") as source: header=source.read(26)
        if path.suffix.lower()==".png" and len(header)>24 and header[24]==16:
            # Pillow reduces RGB16 PNG to RGB8; that would falsely clip near-white.
            import imagecodecs
            samples=imagecodecs.png_decode(path.read_bytes())
            if samples.ndim==3:samples=samples[:,:,:3] if samples.shape[2]>=3 else samples[:,:,0]
            with Image.open(path) as image:orientation=int(image.getexif().get(274,1))
            samples=orient_samples(samples,orientation)
            return exposure_regions(samples,0,65535)
        with Image.open(path) as image:samples=np.asarray(ImageOps.exif_transpose(image).convert("RGB"))
        return exposure_regions(samples,0,255)
    if path.suffix.lower() in {".tif",".tiff"}:
        import tifffile
        with tifffile.TiffFile(path) as tif:
            samples=tif.asarray();orientation=int(tif.pages[0].tags.get('Orientation').value) if tif.pages[0].tags.get('Orientation') else 1
        if samples.dtype.kind not in 'ui': raise ValueError("Exposure warnings unavailable: no recorded clipping limit for floating-point pixels.")
        if samples.ndim==3 and samples.shape[0] in (3,4): samples=np.moveaxis(samples,0,-1)
        if samples.ndim==3:samples=samples[...,:3]
        blown,blocked=exposure_regions(samples,0,np.iinfo(samples.dtype).max)
        # Apply the same EXIF orientation as bitmap presentation.
        def orient(a):
            if orientation==2:return np.fliplr(a)
            if orientation==3:return np.rot90(a,2)
            if orientation==4:return np.flipud(a)
            if orientation==5:return a.T
            if orientation==6:return np.rot90(a,3)
            if orientation==7:return np.flipud(np.fliplr(a.T))
            if orientation==8:return np.rot90(a)
            return a
        return orient(blown),orient(blocked)
    raise ValueError("Exposure warnings unavailable: this file has no recorded clipping limit.")


class CameraFocusUnavailable(ValueError):
    """No useful embedded picture; caller may request RAW precision."""


def camera_focus_source(path, cancelled=None):
    """Return (float32 linear ACEScg RGB, metadata), at most 2560 long edge.

    Uses open_file/extract_thumb only. EXIF orientation matches camera display.
    Raises CameraFocusUnavailable, never silently develops sensor pixels.
    """
    import rawpy
    from .color import normalize_to_acescg
    check_cancelled(cancelled)
    try:
        with rawpy.RawPy() as raw:
            raw.open_file(str(path))
            check_cancelled(cancelled)
            thumb=raw.extract_thumb()
            image=Image.open(BytesIO(thumb.data)) if thumb.format==rawpy.ThumbFormat.JPEG else Image.fromarray(thumb.data)
            original_size=image.size
            if min(original_size)<512:
                raise CameraFocusUnavailable("Camera preview is too small for provisional Focus.")
            if thumb.format==rawpy.ThumbFormat.JPEG:image.draft("RGB",(2560,2560))
            image=ImageOps.exif_transpose(image)
            image.thumbnail((2560,2560))
            check_cancelled(cancelled)
            signal=np.asarray(image.convert("RGB"),dtype=np.float32)/np.float32(255)
        pixels=normalize_to_acescg(signal,"sRGB","sRGB").astype(np.float32,copy=False)
        check_cancelled(cancelled)
        return pixels,{"source_provenance":"embedded-camera-preview","provisional":True,
            "camera_source_width":original_size[0],"camera_source_height":original_size[1],
            "analysis_width":pixels.shape[1],"analysis_height":pixels.shape[0]}
    except CameraFocusUnavailable:raise
    except Exception as error:
        check_cancelled(cancelled)
        raise CameraFocusUnavailable(f"Camera preview unavailable: {error}") from error


def full_focus_source(path, cancelled=None):
    """Load native RAW source pixels without creating a Grade document.

    Linear DNG retains its existing Library decode; native camera RAW uses
    the same default loader as SessionStore, including lens and orientation.
    """
    from .cpu_budget import library_bands
    from .library_pictures import decode_picture
    from .loader import load_image
    path=Path(path)
    check_cancelled(cancelled)
    with library_bands():
        if path.suffix.lower()==".dng":
            from .linear_dng import inspect_dng,DngRoute
            if inspect_dng(path).route is not DngRoute.MOSAICED_RAW_DNG:
                return decode_picture(path,100000,"native")[0]
        pixels,_,_,_,_=load_image(path,cancelled=cancelled,analyze_hdr=False)
        check_cancelled(cancelled)
        return pixels


class OverlayMaps:
    def __init__(self,root): self.cache=LibraryPictureCache(root)
    def file(self,key):
        self.cache.file(key) # Validate key through the established cache guard.
        return self.cache.root/(key+".map.npz")
    def cached(self,path,kind,quality="half"):
        key=map_key(path,kind,quality);file=self.file(key)
        try:
            with np.load(self.cache.open(key,file),allow_pickle=False) as data: meta=json.loads(str(data['metadata']))
            if file.exists(): os.utime(file,None)
            return meta|{"key":key,"cache_hit":True,"stored_bytes":file.stat().st_size if file.exists() else 0}
        except FileNotFoundError:return None
        except (OSError,ValueError,EOFError):
            file.unlink(missing_ok=True);self.cache.managed.record(file);return None
    def build(self,path,kind="exposure",quality="half",cancelled=None):
        existing=self.cached(path,kind,quality)
        if existing:return existing
        start=perf_counter();key=map_key(path,kind,quality);check_cancelled(cancelled)
        raw=Path(path).suffix.lower() in RAW_EXTENSIONS;probe={} if raw else None
        provenance={}
        if kind=="exposure":
            try: blown,blocked=exposure_source(path,cancelled,probe)
            except ValueError as error: return {"unavailable":str(error)}
            check_cancelled(cancelled)
            source=blown.shape[:2]
            data=np.stack([pool_max(blown),pool_max(blocked)],axis=2).astype(np.uint8)*255
        elif kind=="focus":
            from .library_focus import focus_map
            from .library_pictures import decode_picture
            if quality=="camera":
                if not raw:return {"unavailable":"Camera Focus requires a RAW camera preview."}
                try:pixels,provenance=camera_focus_source(path,cancelled)
                except CameraFocusUnavailable as error:return {"unavailable":str(error),"quality":"camera"}
                info={}
            elif raw and quality=="full":
                pixels=full_focus_source(path,cancelled)
                info={}
            else:
                pixels,_,info=decode_picture(Path(path),100000,"native" if quality=="full" else "quick")
            check_cancelled(cancelled)
            if quality=="half" and info["route"]!="quick-half-raw":pixels=pixels[::2,::2]
            source=pixels.shape[:2]
            if raw and quality!="camera":probe["luminance"]=small_luminance(pixels)
            values,_noise=focus_map(pixels,cancelled)
            data=values[:,:,None]
            del pixels
        else:raise ValueError("Unknown Library overlay.")
        # `frame` is the measured picture inside the map (pooling pads the last
        # cells); `camera_frame` is the camera preview's area, both in map pixels.
        cell=pool_cell(*source);frame=[0.,0.,source[1]/cell,source[0]/cell]
        placed={"camera_frame":list(frame)} if quality=="camera" else {}
        if raw and probe.get("luminance") is not None:
            check_cancelled(cancelled);placed=camera_frame(path,probe.pop("luminance"))
            if "camera_frame" in placed:
                x,y,w,h=placed["camera_frame"];placed["camera_frame"]=[x*frame[2],y*frame[3],w*frame[2],h*frame[3]]
        meta={"kind":kind,"quality":quality,"path":str(path),"width":data.shape[1],"height":data.shape[0],"frame":frame,**placed,**provenance,"make_ms":round((perf_counter()-start)*1000,2)}
        check_cancelled(cancelled)
        if map_key(path,kind,quality)!=key:raise ValueError("The source photo changed; overlay was not published.")
        if not self.cache.managed.preferences()['enabled']:
            return self.cache.transient_result(key, {'values':data,'metadata':np.asarray(json.dumps(meta))},meta)
        self.cache.managed.prepare()
        self.cache.root.mkdir(parents=True,exist_ok=True)
        with NamedTemporaryFile(dir=self.cache.root,suffix='.tmp',delete=False) as f:
            temp=Path(f.name);np.savez_compressed(f,values=data,metadata=np.asarray(json.dumps(meta)))
        try:
            check_cancelled(cancelled)
            if map_key(path,kind,quality)!=key:raise ValueError("The source photo changed; overlay was not published.")
            os.replace(temp,self.file(key))
            self.cache.managed.record(self.file(key))
        finally:temp.unlink(missing_ok=True)
        self.cache.trim();log("overlay_map_saved",**meta)
        return meta|{"key":key,"cache_hit":False,"stored_bytes":self.file(key).stat().st_size}
    def png(self,key):
        with np.load(self.cache.open(key,self.file(key)),allow_pickle=False) as stored:
            data=stored['values'];meta=json.loads(str(stored['metadata']))
        if map_key(meta['path'],meta['kind'],meta['quality'])!=key:
            raise ValueError("The source photo changed; request its current overlay map.")
        if data.ndim!=3 or data.shape[2] not in (1,2):raise ValueError("Overlay map could not be read.")
        channels=np.zeros((*data.shape[:2],3),dtype=np.uint8);channels[:,:,:data.shape[2]]=data
        out=BytesIO();Image.fromarray(channels).save(out,format='PNG');return out.getvalue()
