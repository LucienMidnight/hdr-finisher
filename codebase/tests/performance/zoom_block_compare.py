"""Area-average 8x8 screen-pixel blocks at any zoom (PRD 4.4).
Default mapping uses normalized frame bounds. For geometry-changing extents,
supply lowToNativePixels; near-axis mapped rectangles are diagnostic only.
Readbacks stay bounded.
"""
from __future__ import annotations
import json
from pathlib import Path
import sys
import numpy as np
from preview_export_compare import srgb_decode, presentation_space, tone_statistics


def area_blocks(image, x, y):
    """Exact rectangle integrals of piecewise-constant linear-light pixels."""
    integral = np.pad(image.cumsum(0).cumsum(1), ((1,0),(1,0),(0,0)))
    x, y = np.asarray(x), np.asarray(y)
    if x.min() < -1e-7 or y.min() < -1e-7 or x.max() > image.shape[1]+1e-7 or y.max() > image.shape[0]+1e-7:
        raise ValueError("Block extends beyond captured pixels")
    x, y = np.clip(x,0,image.shape[1]), np.clip(y,0,image.shape[0])
    ix, iy = np.floor(x).astype(int), np.floor(y).astype(int)
    jx, jy = np.minimum(ix+1,image.shape[1]), np.minimum(iy+1,image.shape[0])
    fx, fy = (x-ix)[None,:,None], (y-iy)[:,None,None]
    values = ((1-fy)*((1-fx)*integral[iy[:,None],ix]+fx*integral[iy[:,None],jx])
              +fy*((1-fx)*integral[jy[:,None],ix]+fx*integral[jy[:,None],jx]))
    sums = values[1:,1:]-values[:-1,1:]-values[1:,:-1]+values[:-1,:-1]
    return sums / (np.diff(y)[:,None,None]*np.diff(x)[None,:,None])


def compare_frames(data):
    a,b = data['frames']
    if a['zoom'] != 100 or b['zoom'] >= 100:
        raise ValueError("Expected 100% reference and below-100% comparison")
    if a['format'] != b['format'] or any(f['screenScale']['dpr'] != 1 for f in (a,b)):
        raise ValueError("Incompatible presentation formats or DPR")
    if a['laneAdjustments'] != b['laneAdjustments'] or a.get('denoise') != b.get('denoise'):
        raise ValueError("Grade or denoise settings changed between captures")
    # Map the two frame bounds onto the native output rectangle. A screen block
    # uses the actual canvas CSS scale, not the processing step or zoom label.
    ratio = np.array([a['width']/b['width'],a['height']/b['height']])
    step = 8*ratio/np.array([b['screenScale']['x'],b['screenScale']['y']])
    ra,rb = a['rect'],b['rect']
    low = np.maximum([ra['x'],ra['y']],np.array([rb['x'],rb['y']])*ratio)
    high = np.minimum([ra['x']+ra['width'],ra['y']+ra['height']],np.array([rb['x']+rb['width'],rb['y']+rb['height']])*ratio)
    first,last = np.ceil(low/step).astype(int),np.floor(high/step).astype(int)
    count=last-first
    if min(count)<8 or count.prod()<64:
        raise ValueError("Too few common visible blocks")
    x,y = [np.arange(first[i],last[i]+1)*step[i] for i in range(2)]
    def blocks(frame,rect,scale):
        image=np.fromfile(frame['file'],dtype=np.float32).reshape(rect['height'],rect['width'],4)[...,:3]
        image=srgb_decode(image.astype(np.float64))
        return area_blocks(image,x/scale[0]-rect['x'],y/scale[1]-rect['y'])
    reference,preview=blocks(a,ra,[1,1]),blocks(b,rb,ratio)
    alignment = "normalized frame bounds; exact area integration; actual CSS pixel scale"
    cross_axis = None
    if data.get('lowToNativePixels') is not None:
        matrix = np.asarray(data['lowToNativePixels'],dtype=float).reshape(3,3)
        xx,yy=np.meshgrid(x/ratio[0],y/ratio[1])
        points=np.stack((xx,yy,np.ones_like(xx)),axis=-1)@matrix.T
        nx,ny=points[...,0]/points[...,2],points[...,1]/points[...,2]
        cross_axis=float(max(np.abs(np.diff(nx,axis=0)).max(),np.abs(np.diff(ny,axis=1)).max()))
        if cross_axis > .01:
            raise ValueError("Source-aligned blocks require polygon integration")
        # Each mapped block is axis aligned to within the reported tolerance.
        # Use its mean opposing edge locations, preserving its scene position.
        left=(nx[:-1,:-1]+nx[1:,:-1])/2-ra['x']
        right=(nx[:-1,1:]+nx[1:,1:])/2-ra['x']
        top=(ny[:-1,:-1]+ny[:-1,1:])/2-ra['y']
        bottom=(ny[1:,:-1]+ny[1:,1:])/2-ra['y']
        raw=np.fromfile(a['file'],dtype=np.float32).reshape(ra['height'],ra['width'],4)[...,:3]
        raw=srgb_decode(raw.astype(np.float64))
        integral=np.pad(raw.cumsum(0).cumsum(1),((1,0),(1,0),(0,0)))
        def value(px,py):
            if px.min()<0 or py.min()<0 or px.max()>raw.shape[1] or py.max()>raw.shape[0]:
                raise ValueError("Source-aligned block exceeds captured reference")
            ix,iy=np.floor(px).astype(int),np.floor(py).astype(int)
            jx,jy=np.minimum(ix+1,raw.shape[1]),np.minimum(iy+1,raw.shape[0])
            fx,fy=(px-ix)[...,None],(py-iy)[...,None]
            return ((1-fy)*((1-fx)*integral[iy,ix]+fx*integral[iy,jx])
                    +fy*((1-fx)*integral[jy,ix]+fx*integral[jy,jx]))
        valid=(left>=0)&(top>=0)&(right<=raw.shape[1])&(bottom<=raw.shape[0])
        # Existing bounded readbacks can lose a boundary block after alignment.
        left,right,top,bottom=[v[valid] for v in (left,right,top,bottom)]
        reference=(value(right,bottom)-value(left,bottom)-value(right,top)+value(left,top))/((right-left)*(bottom-top))[...,None]
        preview=preview[valid][:,None,:]
        reference=reference[:,None,:]
        count=np.array([int(valid.sum()),1])
        alignment="actual geometry source homographies; area-integrated near-axis rectangles"

    space=presentation_space(data['lane'],data['lane']=='hdr' and '16float' in a['format'],a['white'])
    tone=tone_statistics(preview,reference,space,eight_bit_target=False)
    tone={k:v for k,v in tone.items() if not k.startswith('_')}
    return dict(commonNativeRect=dict(x=x[0],y=y[0],width=x[-1]-x[0],height=y[-1]-y[0]),
        blocks=int(count.prod()),zoomedOutScreenBlock=8,referenceNativeBlock=step.tolist(),
        alignment=alignment,maxCrossAxisBlockDriftPixels=cross_axis,
        frameScale=ratio.tolist(),tone=tone,
        passed=tone['luminance']['p99']<=.02 and tone['oklab']['p99']<=.01)


if __name__=='__main__':
    print(json.dumps(compare_frames(json.loads(Path(sys.argv[1]).read_text(encoding='utf-8')))))
