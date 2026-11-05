"""Grade-owned pixels and developed-source loans; never opens/develops a photo."""
import numpy as np
from fastapi import BackgroundTasks, HTTPException, Request
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool

from .library_documents import identity
from .library_copies import source
from .library_live import quality
from .library_pictures import picture_key, reduce_picture
from .library_finished_thumbnails import FinishedThumbnails
from .library_screen_previews import StoredScreenPreviews


class GradePictures:
    def __init__(self, live, store):
        self.live, self.store = live, store
        self.thumbnails = FinishedThumbnails(live)
        self.screens = StoredScreenPreviews(live.root, live.document)

    def current(self, path, grade):
        # The local indexed saved/pending grade is the publication authority,
        # as for finished-thumbnail reads. Do not reread the source sidecar at
        # every encoder/cancellation checkpoint.
        current = self.thumbnails.current(path, "sdr", "rgba8unorm")
        return current is not None and current[0]["grade"] == grade

    def owner(self, session_id, grade, revision=None):
        with self.store._lock:
            session = self.store.get(session_id)
            path = self.store.library_grades.path(session_id)
            if revision is not None and session.edit_revision != revision:
                raise HTTPException(409, "Grade changed before picture capture.")
            document = self.live.document(path)
            if not self.current(path, grade) or identity(document) != grade:
                raise HTTPException(409, "The Library has a newer grade.")
            if quality(session.edit_document().model_dump(mode="json")) != quality(document):
                raise HTTPException(409, "The developed source changed.")
            return path, document, session

    def thumbnail_meta(self, path, document, session):
        # Publication identity is the same as an ordinary Library finishing draw.
        physical = source(path)
        return self.live.describe(path, dict(path=physical, edge=640,
            quality=quality(document), key=picture_key(physical, 640, quality(document)),
            width=session.source.width, height=session.source.height,
            source_width=session.source.width, source_height=session.source.height,
            adjustments=document["global_adjustments"]), document=document)

    def write(self, session_id, grade, revision, lane, body, width, height, stride, defer_screen=None):
        path, document, session = self.owner(session_id, grade, revision)
        if identity(session.edit_document().model_dump(mode="json")) != grade:
            raise HTTPException(409, "Captured picture does not match the saved grade.")
        hdr = document["global_adjustments"]["hdr"]
        if lane == "hdr" and hdr["highlight_section_enabled"] and hdr["highlight_compression_target_nits"] != 1000:
            raise HTTPException(409, "Library output target requires a finishing redraw.")
        valid = lambda: self.current(path, grade)
        current = self.screens.identity(path, 2560, 2560, lane)
        pixels = np.frombuffer(body, dtype="<f2").reshape(height, stride//2)[:, :width*4].reshape(height, width, 4)
        if not np.isfinite(pixels).all():
            raise HTTPException(400, "Invalid Grade picture pixels.")
        from concurrent.futures import ThreadPoolExecutor
        from .finishing import geometry_output_dimensions
        from .models import GeometryAdjustments
        geometry = GeometryAdjustments.model_validate(document["global_adjustments"]["shared"]["geometry"])
        source_width, source_height = geometry_output_dimensions(session.source.width, session.source.height, geometry)
        def save_screen():
            return self.screens.write(current, body, width, height, stride,
                lambda: not valid(), source_width=source_width,
                source_height=source_height, grade_picture=True)
        # Visible thumbnails do not wait for the compressed screen encoding.
        # The response task keeps the existing upload slot until it finishes,
        # bounding body ownership without a new queue or cache allowance.
        if defer_screen is not None:
            self.write_thumbnails(path, document, session, lane, pixels[..., :3])
            defer_screen(save_screen)
        else:
            with ThreadPoolExecutor(max_workers=1) as encoding:
                screen = encoding.submit(save_screen)
                self.write_thumbnails(path, document, session, lane, pixels[..., :3])
                if not screen.result():
                    raise HTTPException(409, "Grade picture could not be stored.")
        if not valid(): raise HTTPException(409, "The Library has a newer grade.")
        return dict(path=path, grade_identity=grade, lane=lane, source="Grade picture")

    def write_thumbnails(self, path, document, session, lane, pixels):
        from .color import acescg_to_linear_bt2020, acescg_to_linear_srgb
        from .jpegxl import _srgb_oetf
        # Resize the finished picture, never a source to be graded again.
        pixels = reduce_picture(pixels, 640)
        white = document.get("hdr_reference_white_nits", 203)
        formats = {}
        if lane == "hdr":
            nits = np.clip(acescg_to_linear_bt2020(pixels)*(white/.18), 0, 10000)
            if document["global_adjustments"]["hdr"]["highlight_section_enabled"]:
                np.minimum(nits, 1000, out=nits)
            # Same BT.2020 -> Display P3 canvas transform as stored screen previews.
            matrix = np.array([[1.3435782526,-.2821796705,-.0613985821],
                [-.0652974528,1.0757879158,-.0104904631],
                [.0028217873,-.0195984945,1.0167767073]], dtype=np.float32)
            linear = nits @ matrix.T / 203
            encoded = np.sign(linear)*_srgb_oetf(np.abs(linear))
            formats["rgba16float"] = encoded.astype("<f2")
            display = np.maximum(acescg_to_linear_srgb(pixels), 0)
            encoded = _srgb_oetf(display/(1+display))
        else:
            encoded = _srgb_oetf(np.clip(pixels, 0, 1))
        formats["rgba8unorm"] = np.round(np.clip(encoded, 0, 1)*255).astype("u1")
        formats["bgra8unorm"] = formats["rgba8unorm"][..., [2,1,0]]
        meta = self.thumbnail_meta(path, document, session)
        validation = {}
        for format, rgb in formats.items():
            h, w = rgb.shape[:2]
            stride = ((w*4*rgb.dtype.itemsize+255)//256)*256
            rows = np.zeros((h, stride//rgb.dtype.itemsize), dtype=rgb.dtype)
            rgba = rows[:, :w*4].reshape(h, w, 4)
            rgba[..., :3] = rgb
            rgba[..., 3] = 1 if format == "rgba16float" else 255
            if not self.thumbnails.write(path, lane, format, meta, rows.tobytes(), w, h, stride, validation=validation):
                raise HTTPException(409, "Grade changed while storing its thumbnail.")

    def sources(self, session_id, grade):
        path, document, session = self.owner(session_id, grade)
        from .library_live import _develop_cpu
        # `prepared` supplies Grade's existing developed planes. This function
        # only reduces/stores them; its import branch is never entered.
        scenes = []
        for edge in (640, 2560):
            meta = _develop_cpu(self.live.root, source(path), document, edge,
                cancelled=lambda: not self.current(path, grade), cache=self.live.cache,
                prepared={"source": session})
            scene = self.live.describe(path, meta, document=document)
            scene["screen_grade_identity"] = self.screens.identity(path, 2560, 2560, "hdr")["grade_identity"]
            scenes.append(scene)
        if not self.current(path, grade): raise HTTPException(409, "The Library has a newer grade.")
        return dict(path=path, grade_identity=grade, scenes=scenes)


def add_grade_picture_routes(router, live, store, slots):
    pictures = GradePictures(live, store)

    @router.post("/grade-picture/{session_id}")
    async def write(session_id: str, request: Request, background_tasks: BackgroundTasks, grade: str, revision: int,
                    lane: str, width: int, height: int, stride: int):
        if lane not in ("hdr", "sdr") or not 1 <= width <= 2560 or not 1 <= height <= 2560 or stride != ((width*8+255)//256)*256:
            raise HTTPException(400, "Invalid Grade picture dimensions.")
        if not slots.acquire(blocking=False): return Response(status_code=503)
        transferred = False
        def finish(screen):
            from .library_diagnostics import log
            try:
                if not screen(): log("grade_screen_picture_skipped", reason="saved grade changed or cache disabled")
            except Exception as error:
                log("grade_screen_picture_failed", reason=str(error))
            finally:
                slots.release()
        try:
            if int(request.headers.get("content-length", 0)) != stride*height:
                raise HTTPException(400, "Invalid Grade picture byte count.")
            body = await request.body()
            if len(body) != stride*height: raise HTTPException(400, "Invalid Grade picture byte count.")
            screens = []
            result = await run_in_threadpool(pictures.write, session_id, grade, revision, lane, body, width, height, stride, screens.append)
            background_tasks.add_task(finish, screens[0])
            transferred = True
            return result
        finally:
            if not transferred: slots.release()

    @router.post("/grade-picture-source/{session_id}")
    async def sources(session_id: str, grade: str, request: Request):
        import asyncio
        while not slots.acquire(blocking=False):
            if await request.is_disconnected(): return Response(status_code=499)
            await asyncio.sleep(.05)
        try:
            return await run_in_threadpool(pictures.sources, session_id, grade)
        finally:
            slots.release()
