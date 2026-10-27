"""Explicit screen-preview preparation; never modifies sources or settings."""
import shutil
from pathlib import Path
from fastapi import HTTPException, Request
from .library_screen_previews import StoredScreenPreviews
from .library_diagnostics import log

# Conservative planning allowance for both JPEG XL lanes at the current screen
# size; encoding still checks actual capacity before publishing each file.
ESTIMATE_BYTES = 6 * 1024**2

def add_build_preview_routes(router, live, index, store, worker):
    cache=StoredScreenPreviews(live.root,live.document)
    def paths(value):
        if value.get('folder'):
            from .library_folder_stream import indexed_snapshot
            return [p['path'] for p in indexed_snapshot(index,store,value['folder'])[1]]
        items=value.get('paths',[])
        if not isinstance(items,list) or len(items)>1000000 or any(not isinstance(p,str) or len(p)>4096 for p in items):
            raise HTTPException(400,'Choose photos or a folder.')
        return list(dict.fromkeys(items))

    @router.get('/built-previews')
    def usage(): return cache.usage()

    @router.post('/built-previews/plan')
    async def plan(request: Request):
        from starlette.concurrency import run_in_threadpool
        value=await request.json()
        def prepare():
            chosen=paths(value)
            root=cache.cache.prepare()
            used=cache.usage()
            available=max(0,min(shutil.disk_usage(root).free,used['limit_bytes']-used['protected_bytes']))
            fit=min(len(chosen),available//ESTIMATE_BYTES)
            log('built_previews_plan',count=len(chosen),estimated_bytes=len(chosen)*ESTIMATE_BYTES,available_bytes=available,fits=fit)
            return dict(paths=chosen,count=len(chosen),fits=fit,estimated_bytes=len(chosen)*ESTIMATE_BYTES,free_bytes=shutil.disk_usage(root).free,**used)
        return await run_in_threadpool(prepare)

    @router.post('/built-previews/discard')
    async def discard(request: Request):
        from starlette.concurrency import run_in_threadpool
        value=await request.json()
        return await run_in_threadpool(lambda:cache.discard(paths(value)))

    @router.post('/built-previews/cpu')
    async def cpu(request: Request):
        import asyncio
        value=await request.json()
        path=value['path']; document=live.document(path)
        job,future=worker.submit_library('stored-screen-build',priority=99,background=True,path=path,document=document,
            display_width=value['display_width'],display_height=value['display_height'])
        try: return await asyncio.wrap_future(future)
        finally: worker.cancel(job)


def build_cpu(root,path,document,width,height,cancelled):
    """Fallback only; same development/finishing maths as visible CPU pictures."""
    import numpy as np
    from .library_live import LivePictures,develop_cpu
    from .models import PreviewKind
    from .adjustments import apply_adjustments,apply_hdr_output_highlight_compression,apply_sdr_output_highlight_compression
    from .exporters import _denoised_export_source
    service=LivePictures(root,None);service.document=lambda _:document
    scene=develop_cpu(root,path,document,2560,cancelled)
    service.cache.accept_transient(scene)
    frame=service.frame(service.describe(path,scene))
    adjustments=frame.adjustments.model_copy(deep=True)
    adjustments.hdr.highlight_compression_target_nits=1000
    cache=StoredScreenPreviews(root,lambda _:document)
    for kind in (PreviewKind.HDR,PreviewKind.SDR):
        if cancelled(): return dict(saved=False)
        pixels=apply_adjustments(_denoised_export_source(frame,kind),adjustments,kind,sdr_reference_image=frame.sdr_reference_image,
            include_grain=True,include_output_highlight_compression=False,local_adjustments=adjustments.enabled_locals(frame.local_adjustments),color_context=frame.color_context)
        pixels=(apply_hdr_output_highlight_compression(pixels,adjustments,color_context=frame.color_context) if kind==PreviewKind.HDR else apply_sdr_output_highlight_compression(pixels,adjustments))
        h,w=pixels.shape[:2];stride=((w*8+255)//256)*256
        packed=np.zeros((h,stride//2),dtype='<f2');rgba=packed[:,:w*4].reshape(h,w,4);rgba[:,:,:3]=pixels;rgba[:,:,3]=1
        if not cache.write(cache.identity(path,width,height,kind.value),packed.tobytes(),w,h,stride,cancelled,protected=True):
            return dict(saved=False)
    return dict(saved=True)
