"""Library focus peaking only; no Grade or export filters are involved."""
import numpy as np
from .library_pictures import check_cancelled
from .library_overlays import pool_max

def gaussian_filter(values,sigma,cancelled=None):
    sigma=float(sigma[0] if isinstance(sigma,tuple) else sigma)
    if sigma<.01:return values
    radius=max(1,int(np.ceil(3*sigma)));x=np.arange(-radius,radius+1,dtype=np.float32)
    weights=np.exp(-x*x/(2*sigma*sigma));weights/=weights.sum();result=values
    for axis in (0,1):
        check_cancelled(cancelled)
        pad=[(0,0)]*values.ndim;pad[axis]=(radius,radius);padded=np.pad(result,pad,mode="reflect");result=np.zeros_like(result)
        for i,weight in enumerate(weights):
            region=[slice(None)]*values.ndim;region[axis]=slice(i,i+values.shape[axis]);result+=weight*padded[tuple(region)]
    return result

def magnitude(gray,sigma,cancelled=None):
    smooth=gaussian_filter(gray,sigma,cancelled);gy,gx=np.gradient(smooth);return np.hypot(gx,gy)

def focus_map(pixels,cancelled=None):
    check_cancelled(cancelled)
    gray=np.maximum(pixels[...,:3]@np.asarray([.2722,.6741,.0537],dtype=np.float32),0)
    scale=max(float(np.percentile(gray[::4,::4],99)),1e-6);gray=np.sqrt(np.minimum(gray/scale,4))
    smooth=gaussian_filter(gray,.7,cancelled)
    noise=float(np.median(np.abs(gray[::4,::4]-smooth[::4,::4])))*1.4826
    fine=magnitude(gray,.7,cancelled)
    coarse=magnitude(gray,1.5,cancelled)
    ratio=np.maximum(fine-coarse,0)/(coarse+.005)
    confidence=np.clip((ratio-.08)/.45,0,1)*np.clip((fine-coarse-max(2*noise,.012))/.12,0,1)
    check_cancelled(cancelled)
    return (pool_max(confidence)*255).astype(np.uint8),noise

