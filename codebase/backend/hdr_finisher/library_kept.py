"""Saved-grade reminders: one backend producer, independent of the open Grade."""
from copy import deepcopy
from hashlib import sha256
import json, os
from pathlib import Path
from tempfile import NamedTemporaryFile
from time import perf_counter
from types import SimpleNamespace
from threading import Event, RLock, Thread
from concurrent.futures import CancelledError, ThreadPoolExecutor
import time
from PIL import Image
import numpy as np
from .gainmap_decoders import GainMapDecodeError
from .library_grades import grade_key
from .library_pictures import LibraryPictureCache, reduce_picture
from .models import EditDocument, ExportSettings, OutputFinishingSettings, PreviewKind
from .projects import validate_saved_document
from .library_diagnostics import log

_LOCK=RLock()
EDGES=(512,1024,1920)
PICTURE_VERSION="saved-screen-gpu-v2"
RETRY_SECONDS=30
THUMBNAIL_EDGE=256

def identity(grade):
    return sha256(json.dumps(grade_key(grade),sort_keys=True,separators=(",",":")).encode()).hexdigest()

def kept_picture_key(path, grade_id, edge):
    return sha256((PICTURE_VERSION+":"+str(edge)+":"+str(path)+":"+grade_id).encode()).hexdigest()


def atomic_json(path, value):
    path=Path(path); path.parent.mkdir(parents=True,exist_ok=True)
    with NamedTemporaryFile(dir=path.parent,suffix=".tmp",delete=False) as f:
        temp=Path(f.name);f.write(json.dumps(value,ensure_ascii=False).encode());f.flush();os.fsync(f.fileno())
    try: os.replace(temp,path)
    finally: temp.unlink(missing_ok=True)

def preferences(root, change=None):
    path=Path(root)/"library-picture-preferences.json"
    with _LOCK:
        try: value=json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError: value={}
        if not isinstance(value,dict): raise ValueError("Library picture settings could not be read; nothing was changed.")
        if change is not None:
            if set(change)-{"edited_resolution","screen_edge"}: raise ValueError("Unknown Library picture setting.")
            candidate=value|change
            if candidate.get("edited_resolution","screen") not in (*EDGES,"screen"): raise ValueError("Choose Screen size, 512, 1024 or 1920 pixels.")
            if not isinstance(candidate.get("screen_edge",2560),int) or not 1280<=candidate.get("screen_edge",2560)<=2560:
                raise ValueError("Screen picture size must be between 1280 and 2560 pixels.")
            value=candidate;atomic_json(path,value)
        resolution=value.get("edited_resolution","screen")
        screen_edge=value.get("screen_edge",2560)
        return {"edited_resolution":resolution,"screen_edge":screen_edge,
            "edited_edge":screen_edge if resolution=="screen" else resolution}

def capture_source(session):
    """Capture source references, never the mutable Grade or a full-size copy.

    Grade replaces its corrected source on interpretation changes; edits render
    from it without modifying it. The saved document supplies all adjustments.
    """
    # The source cache identity retains decode-time white/interpretation/RAW
    # settings even when Grade changes its current rendering context. Reusing
    # pixels is safe only while those decode inputs still match. Otherwise keep
    # the established reopened route, including its normalization behavior.
    from .sessions import _source_mip_identity
    cache = session.render_cache
    if (cache.source_identity != _source_mip_identity(session)
            or cache.image is not session.image
            or cache.sdr_reference_image is not session.sdr_reference_image):
        log("kept_source_fallback", path=str(session.source_path), reason="open source decode identity differs from saved grade")
        return None
    return {"image": session.image, "sdr_reference_image": session.sdr_reference_image,
        "color_context": session.color_context,
        "source_fingerprint_sha256": session.source_fingerprint_sha256}


def render_source_edge(width, height, geometry, target):
    """Smallest source long edge whose actual cropped geometry fills target.

    Resolve dimensions only: no full-size geometry render or image allocation.
    Checking reduced dimensions includes roll's safety margin and crop rounding.
    """
    from .finishing import geometry_output_dimensions
    full_edge = max(width, height)
    if max(geometry_output_dimensions(width, height, geometry)) <= target:
        return full_edge
    low, high = 1, full_edge
    while low < high:
        candidate = (low + high) // 2
        scale = candidate / full_edge
        w, h = max(1, round(width * scale)), max(1, round(height * scale))
        if max(geometry_output_dimensions(w, h, geometry)) >= target:
            high = candidate
        else:
            low = candidate + 1
    return low


def produce(root, path, grade, edge=2560, format="jpeg", cancelled=None, source=None, priority=15):
    """One read-only corrected decode + reduced renditions via the export graph.

    Shared renderer calls only; export/Proof, their source and budgets are unchanged.
    The helper owns this session, so opening another photo cannot replace it.
    """
    from .sessions import SessionStore
    from . import exporters
    from .library_pictures import check_cancelled
    from .delivery import renderer_record
    rendering = renderer_record()
    started=perf_counter();document=validate_saved_document(grade)
    def check(): check_cancelled(cancelled)
    check()
    source_started=perf_counter()
    source_route="open-photo" if source is not None else "reopened-photo"
    if source is None:
        session=SessionStore().prepare_session(Path(path),owns_source_path=False,
            raw_import_settings=document.source.raw_import_settings,
            interpretation_override=document.interpretation_override,
            hdr_reference_white_nits=document.hdr_reference_white_nits,cancelled=cancelled)
    else:
        # Retain the reopened route's fingerprint protection without decoding.
        # This small sequential read also catches a source changed before save.
        from .sessions import _sha256_file
        if _sha256_file(Path(path))!=source["source_fingerprint_sha256"]:
            raise ValueError("The source photo changed; its Library picture was left unavailable.")
        session=SimpleNamespace(**source)
        source.clear()  # The request/queue no longer owns full-size arrays.
    check()
    if document.source.fingerprint_sha256 and session.source_fingerprint_sha256!=document.source.fingerprint_sha256:
        raise ValueError("The source photo changed; its Library picture was left unavailable.")
    source_height,source_width=session.image.shape[:2]
    geometry=document.global_adjustments.shared.geometry
    reduced_edge=render_source_edge(source_width,source_height,geometry,edge)
    frame=SimpleNamespace(image=reduce_picture(session.image,reduced_edge),
        sdr_reference_image=(reduce_picture(session.sdr_reference_image,reduced_edge)
            if session.sdr_reference_image is not None else None),
        adjustments=document.global_adjustments,local_adjustments=document.local_adjustments,denoise=document.denoise,
        color_context=session.color_context,hdr_reference_white_nits=document.hdr_reference_white_nits,
        delivery_priority=priority,delivery_cancelled=cancelled or (lambda: False))
    # Drop the private session/cache and its full-size references before rendering.
    del session
    source_ms=(perf_counter()-source_started)*1000
    log("kept_source_ready", path=str(path), grade_identity=identity(grade), route=source_route, duration_ms=source_ms)
    render_started=perf_counter()
    settings=ExportSettings(quality=95,jpeg_chroma_subsampling="444",
        jpeg_gain_map_quality=95,jpeg_gain_map_scale="full",
        avif_bit_depth=8,avif_gain_map_quality=95,avif_gain_map_scale="full",dithering="off",
        output_finishing=OutputFinishingSettings(resize_mode="long_edge",long_edge=edge))
    adjustments=exporters._finishing_adjustments_for_export(frame)
    adjustments.shared.overlay_mode="off"
    check();hdr=exporters._render_export_branch(frame,settings,PreviewKind.HDR,adjustments)
    check();sdr=exporters._render_export_branch(frame,settings,PreviewKind.SDR,adjustments)
    check()
    from .finishing import geometry_output_dimensions
    source_width,source_height=geometry_output_dimensions(source_width,source_height,geometry)
    rendering=getattr(frame,"_delivery_record",rendering)
    render_ms=(perf_counter()-render_started)*1000
    log("kept_rendered", path=str(path), grade_identity=identity(grade), duration_ms=render_ms)
    from .library_cache import LibraryCache
    managed=LibraryCache(root)
    if not managed.preferences()["enabled"]: raise CancelledError("Library cache disabled.")
    managed.prepare()
    directory=managed.directory("library-pictures");directory.mkdir(parents=True,exist_ok=True)
    extension="jpg" if format=="jpeg" else "avif"
    with NamedTemporaryFile(dir=directory,prefix="kept-",suffix="."+extension,delete=False) as f: temp=Path(f.name)
    try:
        writer=exporters.write_jpeg_gainmap_renditions if format=="jpeg" else exporters.write_avif_gainmap_renditions
        encode_started=perf_counter()
        writer(temp,hdr,sdr,settings,document.hdr_reference_white_nits);check()  # Library pictures skip the HDR peak check (Steve, October 18)
        encode_ms=(perf_counter()-encode_started)*1000
        log("kept_encoded", path=str(path), grade_identity=identity(grade), duration_ms=encode_ms)
        return {**rendering,"temporary":str(temp),"extension":extension,"grade_identity":identity(grade),
            "width":hdr.shape[1],"height":hdr.shape[0],"source_width":source_width,"source_height":source_height,"edge":edge,"white":203,
            "source_route":source_route,"source_ms":source_ms,"render_ms":render_ms,"encode_ms":encode_ms,
            "picture_version":PICTURE_VERSION,"stored_bytes":temp.stat().st_size,
            "make_ms":round((perf_counter()-started)*1000,2),"route":"saved-gain-map"}
    except BaseException:
        temp.unlink(missing_ok=True);raise

def jpeg_renditions(path, hdr=False):
    """Reconstruct our writer's SDR-first scalar gain map without a CLI.

    File reconstruction only; source, export and Proof decoders are unchanged.
    """
    from io import BytesIO
    import re
    from xml.etree import ElementTree
    from .exporters import _split_ultrahdr_jpegs
    from .gainmap_decoders import _srgb_eotf
    from .color import linear_srgb_to_acescg
    primary, gain = _split_ultrahdr_jpegs(Path(path).read_bytes())
    with Image.open(BytesIO(primary)) as im:
        base = _srgb_eotf(np.asarray(im.convert("RGB"), dtype=np.float32) / 255)
    if not hdr: return base
    xmp = re.findall(rb'<x:xmpmeta.*?</x:xmpmeta>', gain, re.S)
    namespace = "{http://ns.adobe.com/hdr-gain-map/1.0/}"
    fields = next((element.attrib for packet in xmp for element in ElementTree.fromstring(packet).iter()
                   if namespace + "GainMapMax" in element.attrib), None)
    if fields is None: raise ValueError("The kept picture's gain map could not be read.")
    def scalar(name, default): return float(fields.get(namespace + name, default))
    with Image.open(BytesIO(gain)) as im:
        values = np.asarray(im.convert("RGB").resize((base.shape[1], base.shape[0]), Image.Resampling.BILINEAR), dtype=np.float32) / 255
    boost = scalar("GainMapMin", 0) + values ** (1 / scalar("Gamma", 1)) * (scalar("GainMapMax", 0) - scalar("GainMapMin", 0))
    reconstructed = (base + scalar("OffsetSDR", 1 / 64)) * np.exp2(boost) - scalar("OffsetHDR", 1 / 64)
    return linear_srgb_to_acescg(np.maximum(reconstructed, 0) * .18)

def self_source(path):
    from .library_copies import source
    return Path(source(path))

class KeptPictures:
    def __init__(self,root,marks,worker):
        self.root=Path(root);self.marks=marks;self.worker=worker;self.cache=LibraryPictureCache(root)
        self.jobs={};self._lock=RLock();self._closed=False
        self._requested=set();self._retry_after={};self._refreshing=False
        self._quick_producer=ThreadPoolExecutor(max_workers=1,thread_name_prefix="hdr-kept-thumbnail")
        self._open_producer=ThreadPoolExecutor(max_workers=1,thread_name_prefix="hdr-kept-open")
        from .library_picture_queue import PictureQueue
        self.queue=PictureQueue(self)
    def request(self,path):
        path=str(self.marks._path(path))
        with self.marks._lock:
            state=self.marks.grades._get(path);doc=self.marks._document(Path(path)) or {}
            grade=state.get("desired") if state.get("pending") else doc.get("grade")
            default=doc.get("grade_default") or state.get("default")
            return {"path":path,"grade":deepcopy(grade),"grade_identity":identity(grade),
                "edited":grade is not None and grade_key(grade)!=grade_key(default),**preferences(self.root)}
    def key(self,path,grade_id):
        return kept_picture_key(path,grade_id,preferences(self.root)["edited_edge"])
    def remake_missing(self):
        """Refresh known edited photos in the background, without another save."""
        with self._lock:
            if self._closed or self._refreshing: return
            self._refreshing=True
        def refresh():
            try:
                with self.marks._lock:
                    paths=[row[0] for row in self.marks._query("SELECT path FROM photo_grades")]
                for path in paths:
                    while True:
                        with self._lock:
                            if self._closed: return
                            ready=len(self.jobs)+len(self._requested)<2
                        if ready: break
                        time.sleep(.1)
                    try:
                        if self.cached(path) is None: self.ensure(path)
                    except (OSError,ValueError):
                        continue  # Disconnected photos are retried on Library use.
            finally:
                with self._lock: self._refreshing=False
        Thread(target=refresh,name="hdr-kept-refresh",daemon=True).start()
    def cached(self,path,edge=None):
        request=self.request(path)
        if not request["edited"]: return None
        quick=self.quick_meta(path,request["grade_identity"]) if edge is not None else None
        if quick and edge<=512: return quick
        key=self.key(request["path"],request["grade_identity"])
        try:
            meta=json.loads((self.cache.root/(key+".json")).read_text())
            picture=self.cache.root/(key+"."+meta["extension"])
            if (not picture.is_file() or meta["grade_identity"]!=request["grade_identity"]
                    or meta.get("picture_version")!=PICTURE_VERSION or meta.get("edge")!=request["edited_edge"]): return quick
            if meta.get("source_stat")!=self.source_stat(path): return quick
            os.utime(picture,None);os.utime(self.cache.root/(key+".json"),None)
            return meta|{"key":key,"kept":True,"cache_hit":True}
        except (OSError,ValueError,KeyError): return quick
    def quick_meta(self,path,grade_id):
        path=str(self.marks._path(path))
        key=kept_picture_key(path,grade_id,THUMBNAIL_EDGE)
        try:
            meta=json.loads((self.cache.root/(key+".json")).read_text())
            if (meta.get("grade_identity")!=grade_id or meta.get("source_stat")!=self.source_stat(path)
                    or meta.get("picture_version")!=PICTURE_VERSION or meta.get("edge")!=THUMBNAIL_EDGE): return None
            if not (self.cache.root/(key+"."+meta["extension"])).is_file(): return None
            return meta|{"key":key,"kept":True,"cache_hit":True}
        except (OSError,ValueError,KeyError): return None

    def make_quick(self,path,request,source,job,stat,saved_at):
        result=None
        try:
            result=produce(self.root,str(self_source(path)),request["grade"],THUMBNAIL_EDGE,cancelled=job.is_set,source=source)
            with self.marks._lock,self._lock:
                if (self._closed or job.is_set() or self.request(path)["grade_identity"]!=request["grade_identity"]
                        or self.source_stat(path)!=stat or not self.cache.managed.preferences()["enabled"]): return
                key=kept_picture_key(request["path"],request["grade_identity"],THUMBNAIL_EDGE)
                Path(result["temporary"]).replace(self.cache.root/(key+"."+result["extension"]))
                atomic_json(self.cache.root/(key+".json"),{k:v for k,v in result.items() if k!="temporary"}|{"source_stat":stat,"saved_at":saved_at})
            log("kept_thumbnail_saved",photo=path,key=key,save_to_written_ms=(time.time()-saved_at)*1000)
        except CancelledError: pass
        except Exception as error: log("kept_thumbnail_failed",photo=path,reason=str(error))
        finally:
            source.clear()
            if result: Path(result["temporary"]).unlink(missing_ok=True)

    def current_meta(self, path, grade_id):
        quick=self.quick_meta(path,grade_id)
        key = self.key(path, grade_id)
        try:
            meta = json.loads((self.cache.root / (key + ".json")).read_text())
            if (meta.get("grade_identity") != grade_id or meta.get("source_stat") != self.source_stat(path)
                    or meta.get("picture_version") != PICTURE_VERSION or meta.get("edge") != preferences(self.root)["edited_edge"]): return quick
            return meta|{"key":key} if (self.cache.root / (key + "." + meta["extension"])).is_file() else quick
        except (OSError, ValueError, KeyError): return quick
    @staticmethod
    def source_stat(path):
        s=self_source(path).stat();return [s.st_size,s.st_mtime_ns]
    def ensure(self,path):
        """Retry missing edited pictures on use, with one job and a cooldown."""
        path=str(path)
        with self._lock:
            if (self._closed or path in self.jobs or path in self._requested
                    or time.monotonic()<self._retry_after.get(path,0)):
                return
            self._requested.add(path)
        self.schedule(path,priority=15)

    def enqueue(self,path,grade=None):
        request=self.request(path)
        if request["edited"]:
            self.queue.enqueue(str(path),request["grade_identity"])
        else:
            self.queue.write("DELETE FROM picture_jobs WHERE path=?",(str(path),))
        with self._lock:
            old=self.jobs.pop(str(path),None)
            if isinstance(old,Event): old.set()
            elif old is not None: self.worker.cancel(old)

    def queue_status(self): return self.queue.status()
    def queue_command(self,request): return self.queue.command(request)

    def schedule(self,path,grade=None,source=None,priority=80,_queued=False):
        saved_at=time.time()
        path=str(path)
        if not _queued:
            request=self.request(path)
            if not request["edited"]: return
            self.queue.enqueue(path,request["grade_identity"])
        if self.queue.paused:
            if source is not None: source.clear()
            return
        with self._lock: self._requested.add(path)
        # No decode and no worker startup on the save request thread.
        def launch():
            try:
                request=self.request(path)
                if not request["edited"] or not self.cache.managed.preferences()["enabled"]: return
                if grade is not None and identity(grade)!=request["grade_identity"]: return
                if self.cached(path):
                    self.queue.done(path,request["grade_identity"])
                    return
                with self._lock:
                    if self._closed: return
                    old=self.jobs.get(path)
                    if old:
                        self.jobs.pop(path,None)
                        if isinstance(old,Event): old.set()
                        else: self.worker.cancel(old)
                    stat=self.source_stat(path)
                    if source is not None:
                        job=Event()
                        quick_future=None
                        if request["edited_edge"]>THUMBNAIL_EDGE and max(source["image"].shape[:2])>THUMBNAIL_EDGE:
                            quick_future=self._quick_producer.submit(self.make_quick,path,request,dict(source),job,stat,saved_at)
                        def check_open():
                            while self.worker.status()["paused"] and not job.is_set():
                                time.sleep(.05)
                            return job.is_set()
                        def build_open():
                            try:
                                if quick_future is not None:
                                    quick_future.result()
                                return produce(self.root,str(self_source(path)),request["grade"],request["edited_edge"],cancelled=check_open,source=source,priority=priority)
                            finally:
                                source.clear()
                        future=self._open_producer.submit(build_open)
                    else:
                        job,future=self.worker.submit_library("kept",priority=priority,path=str(self_source(path)),grade=request["grade"],edge=request["edited_edge"])
                    self.jobs[path]=job
                def finish(f):
                    result=None
                    try:
                        result=f.result()
                        temporary=Path(result["temporary"])
                        with self.marks._lock,self._lock:
                            if (not self.cache.managed.preferences()["enabled"] or temporary.parent != self.cache.root or self.jobs.get(path)!=job or self.request(path)["grade_identity"]!=request["grade_identity"]
                                    or preferences(self.root)["edited_edge"]!=request["edited_edge"] or self.source_stat(path)!=stat):
                                log("kept_picture_replaced",photo=path,reason="saved grade or source changed while picture was being made",action="stale picture discarded")
                                return
                            temp=Path(result["temporary"]);key=self.key(path,request["grade_identity"])
                            os.replace(temp,self.cache.root/(key+"."+result["extension"]))
                            atomic_json(self.cache.root/(key+".json"),{k:v for k,v in result.items() if k!="temporary"}|{"source_stat":stat,"saved_at":saved_at})
                            self.jobs.pop(path,None)
                            self._retry_after.pop(path,None)
                        self.queue.done(path,request["grade_identity"])
                        self.cache.trim();log("kept_picture_saved",photo=path,key=key,save_to_written_ms=(time.time()-saved_at)*1000,**result)
                    except Exception as error:
                        with self._lock:
                            replaced=self.jobs.get(path)!=job
                            closing=self._closed
                            if not replaced and not closing and not isinstance(error,CancelledError):
                                self._retry_after[path]=time.monotonic()+RETRY_SECONDS
                        if not replaced and not closing and not isinstance(error,CancelledError):
                            self.queue.write("UPDATE picture_jobs SET reason=? WHERE path=?",(str(error),path))
                        if replaced or closing or isinstance(error,CancelledError):
                            reason="app closing" if closing else "replaced by a newer saved grade" if replaced else str(error) or "job cancelled"
                            log("kept_picture_cancelled" if closing else "kept_picture_replaced",photo=path,reason=reason,action="grade safe; cancelled job discarded")
                        else:
                            log("kept_picture_failed",photo=path,reason=str(error) or repr(error),action="grade safe; retry on Library use after cooldown")
                    finally:
                        with self._lock:
                            if self.jobs.get(path)==job: self.jobs.pop(path,None)
                        if result and result.get("temporary"): Path(result["temporary"]).unlink(missing_ok=True)
                if source is not None: future.add_done_callback(lambda f: source.clear())
                future.add_done_callback(finish)
            except Exception as error:
                with self._lock: self._retry_after[path]=time.monotonic()+RETRY_SECONDS
                log("kept_picture_failed",photo=path,reason=str(error) or repr(error),action="grade safe; retry on Library use after cooldown")
            finally:
                with self._lock: self._requested.discard(path)
                if source is not None and not locals().get("future"): source.clear()
        Thread(target=launch,name="hdr-kept-request",daemon=True).start()
    def close(self):
        with self._lock:
            self._closed=True
            for job in list(self.jobs.values()):
                if isinstance(job,Event): job.set()
                else: self.worker.cancel(job)
            self.jobs.clear()
        self.queue.stop.set()
        self._quick_producer.shutdown(wait=False,cancel_futures=True)
        self._open_producer.shutdown(wait=False,cancel_futures=True)

    def pixels(self,key,lane):
        from .exporters import ExportProcessError
        self.cache.file(key)
        metadata=self.cache.root/(key+".json")
        # Publication uses this lock too: never discard a newly replaced picture.
        with self._lock:
            path=None
            try:
                meta=json.loads(metadata.read_text())
                path=self.cache.root/(key+"."+meta["extension"])
                if meta["extension"] == "jpg": image = jpeg_renditions(path, lane == "hdr")
                elif meta["extension"] == "avif":
                    from . import loader
                    image, reference, _ = loader.decode_avif(path)
                    if lane == "sdr": image = reference
                else: raise ValueError("Unsupported kept picture format.")
            except (OSError, ValueError, EOFError, KeyError, GainMapDecodeError, ExportProcessError) as error:
                metadata.unlink(missing_ok=True)
                if path is not None: path.unlink(missing_ok=True)
                log("kept_picture_unreadable",key=key,reason=str(error),
                    action="damaged entry removed; retry on Library use")
                raise ValueError("Saved Library picture is unavailable; request it again.") from error
        if lane == "hdr":
            peak = np.maximum(np.max(image, axis=2, keepdims=True), 1e-6)
            image = image * np.minimum(1, (1000 * .18 / 203) / peak)
        from .render_cache import encode_rgba_proxy_rows
        body,stride=encode_rgba_proxy_rows(image,0,image.shape[0],prefer_half=True,pixel_format="rgba16float")
        os.utime(path,None);os.utime(self.cache.root/(key+".json"),None)
        return body,image.shape[1],image.shape[0],stride
    def usage(self):
        return preferences(self.root)|{"used_bytes":sum(p.stat().st_size for p in self.cache.root.glob("*") if p.is_file())}
