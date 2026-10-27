"""Test-process instrumentation only; preserves encoder inputs without changing pixels.
Import from an isolated profile's sitecustomize with HDR_EXPORT_AGREEMENT_OUT set.
"""
from pathlib import Path
import os, shutil, threading
import numpy as np
from hdr_finisher import exporters
out=Path(os.environ['HDR_EXPORT_AGREEMENT_OUT']);out.mkdir(parents=True,exist_ok=True)
context=threading.local()
render=exporters._render_export_branch
def capture_render(session,settings,kind,adjustments):
    context.stem=Path(settings.output_path).stem if settings.output_path else 'proof'
    result=render(session,settings,kind,adjustments)
    np.save(out/(context.stem+'-'+kind.value+'-preencode.npy'),result)
    return result
exporters._render_export_branch=capture_render
filter_gain=exporters._denoise_ultrahdr_gain_map
def capture_filter(source,target,*args,**kwargs):
    stem=getattr(context,'stem','proof')
    shutil.copy2(source,out/(stem+'-unfiltered.jpg'))
    primary=Path(source).parent/'sdr_primary.jpg'
    if primary.exists():shutil.copy2(primary,out/(stem+'-primary.jpg'))
    return filter_gain(source,target,*args,**kwargs)
exporters._denoise_ultrahdr_gain_map=capture_filter
