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

VERSION="library-overlay-v1"


def map_key(path,kind,quality="half"):
    path=Path(path).resolve(strict=True);s=path.stat()
    return sha256(f"{VERSION}:{path}:{s.st_size}:{s.st_mtime_ns}:{kind}:{quality}".encode()).hexdigest()


def pool_max(values,edge=512):
    """Retain isolated warnings/detail within every small map cell."""
    h,w=values.shape[:2];sy=sx=max(1,int(np.ceil(max(h,w)/edge)))
    shape=(int(np.ceil(h/sy))*sy,int(np.ceil(w/sx))*sx)
    padded=np.pad(values,((0,shape[0]-h),(0,shape[1]-w)),mode="constant")
    return padded.reshape(shape[0]//sy,sy,shape[1]//sx,sx).max(axis=(1,3))


def exposure_regions(samples,black,white):
    samples=np.asarray(samples);black=np.asarray(black);white=np.asarray(white)
    blown=samples>=white
    unit=1 if samples.dtype.kind in "ui" else 1e-6
    blocked=samples<=black+np.maximum(unit,(white-black)*.001)
    if samples.ndim==3: blown=blown.any(axis=2);blocked=blocked.all(axis=2)
    return blown,blocked


def exposure_source(path,cancelled=None):
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
                return exposure_regions(samples,0.,1.)
        import rawpy
        with rawpy.imread(str(path)) as raw:
            samples=raw.raw_image_visible
            if samples.ndim==2:
                colors=raw.raw_colors_visible
                black=np.asarray(raw.black_level_per_channel)[colors]
                levels=raw.camera_white_level_per_channel
                levels=np.asarray(levels if levels and all(v>0 for v in levels) else [raw.white_level]*4)
                white=levels[colors]
            else:
                black=np.asarray(raw.black_level_per_channel)[:samples.shape[2]]
                levels=raw.camera_white_level_per_channel
                white=np.asarray(levels if levels and all(v>0 for v in levels) else [raw.white_level]*4)[:samples.shape[2]]
            blown,blocked=exposure_regions(samples,black,white)
            # LibRaw flip values correspond to its default output orientation.
            rotations={3:2,5:1,6:3};turns=rotations.get(raw.sizes.flip,0)
            if turns: blown=np.rot90(blown,turns);blocked=np.rot90(blocked,turns)
            return blown.copy(),blocked.copy()
    if path.suffix.lower() in {".png",".jpg",".jpeg"}:
        from .loader import is_ultrahdr_jpeg
        if path.suffix.lower() in {".jpg",".jpeg"} and is_ultrahdr_jpeg(path):
            raise ValueError("Exposure warnings unavailable: this HDR file has no recorded sensor clipping limit.")
        with Image.open(path) as image:
            image=ImageOps.exif_transpose(image)
            samples=np.asarray(image) if image.mode in {"I","I;16","I;16B","I;16L"} else np.asarray(image.convert("RGB"))
        white=65535 if samples.dtype.itemsize>1 else 255
        return exposure_regions(samples,0,white)
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


class OverlayMaps:
    def __init__(self,root): self.cache=LibraryPictureCache(root)
    def file(self,key):
        self.cache.file(key) # Validate key through the established cache guard.
        return self.cache.root/(key+".map.npz")
    def cached(self,path,kind,quality="half"):
        key=map_key(path,kind,quality);file=self.file(key)
        try:
            with np.load(file,allow_pickle=False) as data: meta=json.loads(str(data['metadata']))
            os.utime(file,None)
            return meta|{"key":key,"cache_hit":True,"stored_bytes":file.stat().st_size}
        except FileNotFoundError:return None
        except (OSError,ValueError,EOFError):file.unlink(missing_ok=True);return None
    def build(self,path,kind="exposure",quality="half",cancelled=None):
        existing=self.cached(path,kind,quality)
        if existing:return existing
        start=perf_counter();key=map_key(path,kind,quality);check_cancelled(cancelled)
        if kind=="exposure":
            try: blown,blocked=exposure_source(path,cancelled)
            except ValueError as error: return {"unavailable":str(error)}
            check_cancelled(cancelled)
            data=np.stack([pool_max(blown),pool_max(blocked)],axis=2).astype(np.uint8)*255
        elif kind=="focus":
            from .library_focus import focus_map
            from .library_pictures import decode_picture
            pixels,_,info=decode_picture(Path(path),100000,"native" if quality=="full" else "quick")
            check_cancelled(cancelled)
            if quality=="half" and info["route"]!="quick-half-raw":pixels=pixels[::2,::2]
            values,_noise=focus_map(pixels,cancelled)
            data=values[:,:,None]
            del pixels
        else:raise ValueError("Unknown Library overlay.")
        meta={"kind":kind,"quality":quality,"path":str(path),"width":data.shape[1],"height":data.shape[0],"make_ms":round((perf_counter()-start)*1000,2)}
        self.cache.root.mkdir(parents=True,exist_ok=True)
        with NamedTemporaryFile(dir=self.cache.root,suffix='.tmp',delete=False) as f:
            temp=Path(f.name);np.savez_compressed(f,values=data,metadata=np.asarray(json.dumps(meta)))
        try:
            check_cancelled(cancelled)
            if map_key(path,kind,quality)!=key:raise ValueError("The source photo changed; overlay was not published.")
            os.replace(temp,self.file(key))
        finally:temp.unlink(missing_ok=True)
        from .library_kept import preferences
        self.cache.limit=preferences(self.cache.root.parent)["limit_bytes"]
        self.cache.trim();log("overlay_map_saved",**meta)
        return meta|{"key":key,"cache_hit":False,"stored_bytes":self.file(key).stat().st_size}
    def png(self,key):
        with np.load(self.file(key),allow_pickle=False) as stored:
            data=stored['values'];meta=json.loads(str(stored['metadata']))
        if map_key(meta['path'],meta['kind'],meta['quality'])!=key:
            raise ValueError("The source photo changed; request its current overlay map.")
        if data.ndim!=3 or data.shape[2] not in (1,2):raise ValueError("Overlay map could not be read.")
        channels=np.zeros((*data.shape[:2],3),dtype=np.uint8);channels[:,:,:data.shape[2]]=data
        out=BytesIO();Image.fromarray(channels).save(out,format='PNG');return out.getvalue()
