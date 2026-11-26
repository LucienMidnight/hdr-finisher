"""Small CPU adapter interface. See README before adding candidates."""
from __future__ import annotations
from dataclasses import asdict
import importlib
import numpy as np
from hdr_finisher.denoise_adaptive import AdaptiveControls, estimate_adaptive_model, resolve_adaptive


class Off:
    input_kind = 'rgb'
    margin = 0
    supports_alpha = True
    supports_bypass = True

    def prepare(self, image, metadata):
        return None

    def process(self, image, metadata, state, *, bypass=False):
        return image.copy()

    def description(self):
        return {'algorithm':'identity', 'input_kind':self.input_kind}


class DenoiseV2(Off):
    margin = 66

    def __init__(self, controls=None):
        self.controls = AdaptiveControls(**(controls or {}))

    def prepare(self, image, metadata):
        return estimate_adaptive_model(image,workers=1)

    def process(self, image, metadata, state, *, bypass=False):
        return image.copy() if bypass else resolve_adaptive(image,state,self.controls)

    def description(self):
        return dict(algorithm='adaptive-atrous-v1',input_kind=self.input_kind,controls=asdict(self.controls))


def load_adapter(name,controls=None):
    if name=='off':
        return Off()
    if name=='denoise_v2':
        return DenoiseV2()
    if name=='denoise_v2_custom':
        return DenoiseV2(controls)
    # Offline plugin: importable module:factory, never installs or downloads anything.
    module,factory=name.split(':',1)
    adapter=getattr(importlib.import_module(module),factory)()
    if adapter.input_kind not in ('rgb','bayer'):
        raise ValueError('Adapter input_kind must be rgb or bayer')
    return adapter


def tiled(adapter,image,metadata,state,shift=0,tile=128):
    """Same global preparation, same halo; move only the inner tile boundaries."""
    h,w=image.shape[:2]; result=None; margin=adapter.margin
    for y in range(-shift,h,tile):
        for x in range(-shift,w,tile):
            y0,x0=max(0,y),max(0,x); y1,x1=min(h,y+tile),min(w,x+tile)
            sy,sx=max(0,y0-margin),max(0,x0-margin)
            ey,ex=min(h,y1+margin),min(w,x1+margin)
            md={**metadata,'tile_origin':[sy,sx],'frame_shape':[h,w]}
            value=adapter.process(image[sy:ey,sx:ex],md,state)
            if result is None:
                result=np.empty((h,w,value.shape[-1]),dtype=value.dtype)
            result[y0:y1,x0:x1]=value[y0-sy:y1-sy,x0-sx:x1-sx]
    return result
