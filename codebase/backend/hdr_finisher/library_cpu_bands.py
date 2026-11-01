"""Full resolution Bayer development with bounded resident bands.

The full scene lives in disposable planar files, never a resident RGB image.
LibRaw AHD receives overlapping sensor bands; only their interior is retained.
"""
from pathlib import Path
from tempfile import TemporaryDirectory
import numpy as np
def _bilinear(plane, y, x):
    x=np.clip(x,0,plane.shape[1]-1); y=np.clip(y,0,plane.shape[0]-1)
    x0=x.astype(np.int32); y0=y.astype(np.int32)
    x1=np.minimum(x0+1,plane.shape[1]-1); y1=np.minimum(y0+1,plane.shape[0]-1)
    fx=x-x0; fy=y-y0
    return (plane[y0,x0]*(1-fx)*(1-fy)+plane[y0,x1]*fx*(1-fy)+plane[y1,x0]*(1-fx)*fy+plane[y1,x1]*fx*fy).astype(np.float32)


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
        self.x=_weights(width,self.width); self.y=_weights(height,self.height)
        self.pixels=np.zeros((self.height,self.width,3),dtype=np.float32)

    def add(self,start,pixels):
        horizontal=np.empty((len(pixels),self.width,3),dtype=np.float32)
        for column,(indices,weights) in enumerate(self.x):
            horizontal[:,column]=np.sum(pixels[:,indices]*weights[None,:,None],axis=1)
        for row,(indices,weights) in enumerate(self.y):
            keep=(indices>=start)&(indices<start+len(pixels))
            if np.any(keep): self.pixels[row]+=np.sum(horizontal[indices[keep]-start]*weights[keep,None,None],axis=0)


def develop(root, path, document, edge, cancelled, cache, progress, draw_first):
    import rawpy, tifffile
    from . import raw_import as raw
    from .library_live import quality, recipe
    from .library_pictures import check_cancelled
    from .library_gpu_raw import _lens_grid, _identity, developed
    from .models import RawImportSettings
    from .color import map_negative_acescg, acescg_to_linear_bt2020
    from .import_defaults import calibrate_camera_raw
    settings = RawImportSettings.model_validate(recipe(document)['raw_import_settings'])
    if settings.highlight_reconstruction.enabled and settings.highlight_reconstruction.method == raw.EDGE_COLOUR_METHOD:
        raise ValueError('CPU band edge-colour development is not yet qualified.')
    if edge > 2560 or recipe(document).get('repairs'):
        raise ValueError('CPU Library band development does not yet support native inspection or saved repairs.')
    check = lambda: check_cancelled(cancelled)
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
            # Highlight reconstruction runs once, so every band shares its global
            # opposed-colour estimate and identical repaired sensor samples.
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
            # AHD's neighbourhood and tile decisions have a 32-row halo.
            for start in range(0,height,256):
                check(); stop=min(height,start+256)
                lo=max(0,start-32); hi=min(height,stop+32)
                band=np.fromfile(sensor,dtype=np.uint16,count=(hi-lo)*width,offset=lo*width*2).reshape(hi-lo,width)
                pattern = metadata.raw_channel_to_rgb[metadata.raw_pattern]
                tags=[(50706,'B',4,(1,4,0,0),False),(50707,'B',4,(1,1,0,0),False),
                    (50708,'s',0,'HDR Finisher sensor band',False),(33421,'H',2,(2,2),False),
                    (33422,'B',4,tuple(int(x) for x in pattern.flat),False),
                    (50713,'H',2,(2,2),False),
                    (50714,'I',4,tuple(int(metadata.raw_black_level[c]) for c in metadata.raw_pattern.flat),False),
                    (50717,'I',1,int(max(metadata.raw_white_level)),False)]
                dng=folder/'band.dng'
                tifffile.imwrite(dng,band,photometric=32803,metadata=None,extratags=tags)
                with rawpy.imread(str(dng)) as decoder:
                    rgb=raw._develop_libraw_camera_rgb(decoder,rawpy)[start-lo:stop-lo]
                pixels=raw._normalize_camera_rgb_float32(rgb,metadata,cancelled=cancelled)
                pixels=raw._camera_rgb_to_acescg_float32(pixels,metadata,cancelled=cancelled)
                for c,handle in enumerate(handles): np.ascontiguousarray(pixels[:,:,c]).tofile(handle)
                del rgb,pixels,band,decoder
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
        reductions={size:_Reduction(out_w,out_h,size) for size in [edge]}
        stride=max(1,int(np.ceil(np.sqrt(out_w*out_h/2_000_000))))
        samples=[]; peaks=dict(peak=0.,peak_luma=0.,peak_bt2020=0.)
        if progress: progress('reduction','Correcting and reducing RAW bands')
        for start in range(0,out_h,64):
            check(); stop=min(out_h,start+64)
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
            pixels=map_negative_acescg(pixels)
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
                return cache.build(source,size,quality(document),cancelled,(pixels,reference,meta),defer_store=draw_first)
        result=None
        for size,reduction in reductions.items():
            header=dict(identity=_identity(Path(path)),width=reduction.width,height=reduction.height,edge=size,flip=0,
                source_width=out_w,source_height=out_h,peaks=peaks,robust=robust,
                raw_import_settings=settings.model_dump(mode='json'),lens_corrected=bool(lens))
            item=developed(Destination(),path,header,np.ascontiguousarray(reduction.pixels.transpose(2,0,1)).tobytes())
            if size==edge: result=item
        return result
