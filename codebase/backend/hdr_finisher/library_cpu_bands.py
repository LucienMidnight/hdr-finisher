"""Full resolution Bayer development with bounded resident bands.

The full scene lives in disposable planar files, never a resident RGB image.
Signed AHD receives overlapping sensor bands; only their interior is retained.
"""
from pathlib import Path
from tempfile import TemporaryDirectory
import numpy as np
def _bilinear(plane, y, x):
    import ctypes as C
    from .lens_correction import _library
    plane=np.ascontiguousarray(plane,dtype=np.float32)
    x,y=np.broadcast_arrays(x,y)
    x=np.ascontiguousarray(x,dtype=np.float32); y=np.ascontiguousarray(y,dtype=np.float32)
    output=np.empty(x.shape,dtype=np.float32)
    sample=_library().lens_sample_plane
    floats=np.ctypeslib.ndpointer(dtype=np.float32,flags='C_CONTIGUOUS')
    sample.argtypes=[floats,C.c_int,C.c_int,floats,floats,C.c_size_t,floats]
    sample.restype=None
    sample(plane,plane.shape[1],plane.shape[0],x,y,x.size,output)
    return output



def _weights(source, destination):
    scale=source/destination; radius=max(1.,scale); result=[]
    for row in range(destination):
        center=(row+.5)*scale-.5
        indices=np.arange(max(0,int(np.ceil(center-radius))),min(source,int(np.floor(center+radius))+1))
        weights=np.maximum(0.,1.-np.abs(indices-center)/radius); weights/=weights.sum()
        result.append((indices,weights.astype(np.float32)))
    return result


class _Reduction:
    def __init__(self,width,height,edge):
        scale=min(1.,edge/max(width,height))
        self.width,self.height=max(1,round(width*scale)),max(1,round(height*scale))
        self.y=_weights(height,self.height)
        self.pixels=np.zeros((self.height,self.width,3),dtype=np.float32)

    def add(self,start,pixels):
        from PIL import Image
        # Same float triangle filter as reduce_picture, without thousands of
        # Python/NumPy gathers per source band. Keep only this resident band.
        horizontal=np.stack([np.asarray(Image.fromarray(pixels[:,:,c]).resize(
            (self.width,len(pixels)),Image.Resampling.BILINEAR)) for c in range(3)],axis=2)
        for row,(indices,weights) in enumerate(self.y):
            if indices[-1] < start or indices[0] >= start+len(pixels): continue
            keep=(indices>=start)&(indices<start+len(pixels))
            self.pixels[row]+=np.sum(horizontal[indices[keep]-start]*weights[keep,None,None],axis=0)



def develop(root, path, document, edge, cancelled, cache, progress, draw_first, prepared=None):
    import rawpy
    from . import raw_import as raw
    from .library_live import quality, recipe
    from .library_pictures import check_cancelled
    from .library_gpu_raw import _lens_grid, _identity, developed
    from .models import RawImportSettings
    from .color import acescg_to_linear_bt2020
    from .signed_raw import demosaic
    from .import_defaults import calibrate_camera_raw
    cache_epoch = cache.managed.publication_epoch(path)
    if prepared is not None:
        cache_epoch = prepared.setdefault('cache_epoch', cache_epoch)
    settings = RawImportSettings.model_validate(recipe(document)['raw_import_settings'])
    if settings.highlight_reconstruction.enabled and settings.highlight_reconstruction.method == raw.EDGE_COLOUR_METHOD:
        raise ValueError('CPU band edge-colour development is not yet qualified.')
    if edge > 2560 or recipe(document).get('repairs'):
        raise ValueError('CPU Library band development does not yet support native inspection or saved repairs.')
    check = lambda: check_cancelled(cancelled)
    if prepared is not None and edge in prepared:
        return cache.build(path, edge, quality(document), cancelled, prepared[edge], defer_store=draw_first, cache_epoch=cache_epoch)
    with TemporaryDirectory(prefix='hdr-library-bands-') as directory:
        folder = Path(directory)
        if progress: progress('unpack','Reading RAW sensor samples')
        exif, _ = raw._read_raw_exif(Path(path))
        with rawpy.imread(str(path)) as source:
            metadata = raw._camera_linear_metadata_from_libraw(source)
            if metadata.raw_pattern.shape != (2,2):
                raise ValueError('CPU band development requires a Bayer RAW.')
            exif = raw._merge_missing_metadata(exif,raw._read_libraw_metadata(source))
            flip = int(source.sizes.flip)
            lab_matrix = raw._ahd_lab_matrix(source)
            cfa = metadata.raw_pattern
            pattern = metadata.raw_channel_to_rgb[cfa]
            black = metadata.raw_black_level[cfa]
            # Highlight reconstruction runs once, so every band shares its global
            # opposed-colour estimate and identical repaired sensor samples.
            from .raw_pixel_cleanup import apply_raw
            apply_raw(source, metadata, settings, cancelled=cancelled)
            raw._apply_raw_highlight_reconstruction(source,metadata,settings,cancelled=cancelled)
            mosaic = source.raw_image_visible
            height,width = mosaic.shape
            sensor = folder/'sensor.bin'
            with sensor.open('wb') as handle: mosaic.tofile(handle)
        del source, mosaic
        check()
        planes = [folder/f'plane-{c}.bin' for c in range(3)]
        handles = [p.open('wb') for p in planes]
        try:
            if progress: progress('demosaic','Developing RAW in bands')
            # Eight rows retain every AHD homogeneity neighbour at a strip seam.
            for start in range(0,height,256):
                check(); stop=min(height,start+256)
                if progress: progress('demosaic','Developing RAW in bands')
                lo=max(0,start-8); hi=min(height,stop+8)
                band=np.fromfile(sensor,dtype=np.uint16,count=(hi-lo)*width,offset=lo*width*2).reshape(hi-lo,width)
                rgb=demosaic(band,pattern,black,lab_matrix,cancelled=cancelled)[start-lo:stop-lo]
                pixels=raw._normalize_camera_rgb_float32(rgb,metadata,cancelled=cancelled)
                pixels=raw._camera_rgb_to_acescg_float32(pixels,metadata,cancelled=cancelled)
                for c,handle in enumerate(handles): np.ascontiguousarray(pixels[:,:,c]).tofile(handle)
                del rgb,pixels,band
        finally:
            for handle in handles: handle.close()
        sensor.unlink(); check()
        out_h,out_w=(width,height) if flip in (5,6) else (height,width)
        lens=_lens_grid(exif,width,height,flip,settings.lens)
        gain=coordinates=None
        if lens:
            info,data=lens; n=info['gain_width']*info['gain_height']
            if n: gain=data[:n].reshape(info['gain_height'],info['gain_width'])
            if info['coordinate_width']: coordinates=data[n:].reshape(info['coordinate_height'],info['coordinate_width'],3,2)
        reductions={size:_Reduction(out_w,out_h,size) for size in ([640, 2560] if prepared is not None and edge != 100000 else [edge])}
        stride=max(1,int(np.ceil(np.sqrt(out_w*out_h/2_000_000))))
        samples=[]; peaks=dict(peak=0.,peak_luma=0.,peak_bt2020=0.)
        if progress: progress('reduction','Correcting and reducing RAW bands')
        for start in range(0,out_h,64):
            check(); stop=min(out_h,start+64)
            if progress: progress('reduction','Correcting and reducing RAW bands')
            y,x=np.mgrid[start:stop,0:out_w].astype(np.float32)
            pixels=np.empty((stop-start,out_w,3),dtype=np.float32)
            for c,p in enumerate(planes):
                if coordinates is not None:
                    gy=y*(coordinates.shape[0]-1)/max(1,out_h-1); gx=x*(coordinates.shape[1]-1)/max(1,out_w-1)
                    sx=_bilinear(coordinates[:,:,c,0],gy,gx)
                    sy=_bilinear(coordinates[:,:,c,1],gy,gx)
                else: sx,sy=x,y
                # Lensfun coordinates are in the oriented picture.
                if flip==3: rx,ry=width-1-sx,height-1-sy
                elif flip==6: rx,ry=sy,height-1-sx
                elif flip==5: rx,ry=width-1-sy,sx
                else: rx,ry=sx,sy
                # Reopening each plane releases mapped resident pages at each
                # band boundary, including portrait images with long columns.
                plane=np.memmap(p,dtype=np.float32,mode='r',shape=(height,width))
                pixels[:,:,c]=_bilinear(plane,ry,rx)
                plane._mmap.close(); del plane
                if gain is not None:
                    field=_bilinear(gain,sy*(gain.shape[0]-1)/max(1,out_h-1),sx*(gain.shape[1]-1)/max(1,out_w-1))
                    pixels[:,:,c]*=field
            brightness=calibrate_camera_raw(pixels,path)
            peaks['peak']=max(peaks['peak'],float(pixels.max()))
            peaks['peak_luma']=max(peaks['peak_luma'],float((pixels@np.array([.2722287,.6740818,.0536895],dtype=np.float32)).max()))
            peaks['peak_bt2020']=max(peaks['peak_bt2020'],float(acescg_to_linear_bt2020(pixels).max()))
            samples.append(pixels[(-start)%stride::stride,::stride].copy())
            for reduction in reductions.values(): reduction.add(start,pixels)
        sample=np.concatenate(samples,axis=0)
        robust={'channel':float(np.quantile(np.maximum(0,sample.max(axis=-1)),.9999)),
            'luma':float(np.quantile(np.maximum(0,sample@np.array([.2722287,.6740818,.0536895],dtype=np.float32)),.9999)),
            'bt2020':float(np.quantile(np.maximum(0,acescg_to_linear_bt2020(sample).max(axis=-1)),.9999))}
        # Reuse the source descriptor and starting-look contract, while publishing
        # CPU scenes under the same live-scene identity as the GPU route.
        class Destination:
            def build(self,source,size,unused,decoded):
                pixels,reference,meta=decoded
                fingerprint=meta['default_document']['source']['fingerprint_sha256']
                wanted=(document or {}).get('source',{}).get('fingerprint_sha256')
                if wanted and wanted!=fingerprint: raise ValueError('The source photo changed; its saved grade cannot be shown.')
                meta.update(route='library-live',renderer='cpu',raw_start_brightness=brightness,source_fingerprint_sha256=fingerprint)
                if prepared is not None: prepared[size] = (pixels,reference,meta)
                if size != edge: return None
                return cache.build(source,size,quality(document),cancelled,(pixels,reference,meta),defer_store=draw_first, cache_epoch=cache_epoch)
        result=None
        for size,reduction in reductions.items():
            header=dict(identity=_identity(Path(path)),width=reduction.width,height=reduction.height,edge=size,flip=0,
                source_width=out_w,source_height=out_h,peaks=peaks,robust=robust,
                raw_import_settings=settings.model_dump(mode='json'),lens_corrected=bool(lens))
            item=developed(Destination(),path,header,np.ascontiguousarray(reduction.pixels.transpose(2,0,1)).tobytes())
            if size==edge: result=item
        return result
