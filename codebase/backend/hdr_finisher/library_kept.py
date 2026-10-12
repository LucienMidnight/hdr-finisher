"""Saved-grade reminders: one backend producer, independent of the open Grade."""
from copy import deepcopy
from hashlib import sha256
import json, os
from pathlib import Path
from tempfile import NamedTemporaryFile
from time import perf_counter
import time
from types import SimpleNamespace
from threading import RLock, Thread
from PIL import Image
import numpy as np
from .library_grades import grade_key
from .library_pictures import LibraryPictureCache, reduce_picture
from .models import EditDocument, ExportSettings, PreviewKind
from .library_diagnostics import log

_LOCK=RLock()
EDGES=(512,1024,1920)

def identity(grade):
    return sha256(json.dumps(grade_key(grade),sort_keys=True,separators=(",",":")).encode()).hexdigest()

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
            if set(change)-{"edited_edge","limit_bytes"}: raise ValueError("Unknown Library picture setting.")
            candidate=value|change
            if candidate.get("edited_edge",1024) not in EDGES: raise ValueError("Choose 512, 1024 or 1920 pixels.")
            if not isinstance(candidate.get("limit_bytes",2*1024**3),int) or candidate.get("limit_bytes",2*1024**3)<1024**3: raise ValueError("Choose a storage limit of at least 1 GB.")
            value=candidate;atomic_json(path,value)
        return {"edited_edge":value.get("edited_edge",1024),"limit_bytes":value.get("limit_bytes",2*1024**3)}

def produce(root, path, grade, edge=1024, format="jpeg", cancelled=None):
    """One read-only corrected decode + reduced renditions via the export graph.

    Shared renderer calls only; export/Proof, their source and budgets are unchanged.
    The helper owns this session, so opening another photo cannot replace it.
    """
    from .sessions import SessionStore
    from . import exporters
    from .library_pictures import check_cancelled
    started=perf_counter();document=EditDocument.model_validate(grade)
    def check(): check_cancelled(cancelled)
    check()
    source_started=perf_counter()
    session=SessionStore().prepare_session(Path(path),owns_source_path=False,
        raw_import_settings=document.source.raw_import_settings,
        interpretation_override=document.interpretation_override,
        hdr_reference_white_nits=document.hdr_reference_white_nits,cancelled=cancelled)
    check()
    if document.source.fingerprint_sha256 and session.source_fingerprint_sha256!=document.source.fingerprint_sha256:
        raise ValueError("The source photo changed; its Library picture was left unavailable.")
    source_height,source_width=session.image.shape[:2]
    frame=SimpleNamespace(image=reduce_picture(session.image,edge),
        sdr_reference_image=reduce_picture(session.sdr_reference_image,edge) if session.sdr_reference_image is not None else None,
        adjustments=document.global_adjustments,local_adjustments=document.local_adjustments,denoise=document.denoise,
        color_context=session.color_context,hdr_reference_white_nits=document.hdr_reference_white_nits)
    # Release the full decoded source before grading the small reminder.
    del session
    source_ms=(perf_counter()-source_started)*1000
    log("kept_source_ready", path=str(path), grade_identity=identity(grade), route="reopened-photo", duration_ms=source_ms)
    render_started=perf_counter()
    settings=ExportSettings(quality=75,jpeg_gain_map_quality=75,jpeg_gain_map_scale="half",
        avif_bit_depth=8,avif_gain_map_quality=75,avif_gain_map_scale="half",dithering="off")
    adjustments=exporters._finishing_adjustments_for_export(frame)
    adjustments.shared.overlay_mode="off"
    check();hdr=exporters._render_export_branch(frame,settings,PreviewKind.HDR,adjustments)
    check();sdr=exporters._render_export_branch(frame,settings,PreviewKind.SDR,adjustments)
    check();hdr=reduce_picture(hdr,edge);sdr=reduce_picture(sdr,edge)
    render_ms=(perf_counter()-render_started)*1000
    log("kept_rendered", path=str(path), grade_identity=identity(grade), duration_ms=render_ms)
    directory=Path(root)/"library-pictures";directory.mkdir(parents=True,exist_ok=True)
    extension="jpg" if format=="jpeg" else "avif"
    with NamedTemporaryFile(dir=directory,prefix="kept-",suffix="."+extension,delete=False) as f: temp=Path(f.name)
    try:
        writer=exporters.write_jpeg_gainmap_renditions if format=="jpeg" else exporters.write_avif_gainmap_renditions
        encode_started=perf_counter()
        writer(temp,hdr,sdr,settings,document.hdr_reference_white_nits);check()
        encode_ms=(perf_counter()-encode_started)*1000
        log("kept_encoded", path=str(path), grade_identity=identity(grade), duration_ms=encode_ms)
        return {"temporary":str(temp),"extension":extension,"grade_identity":identity(grade),
            "width":hdr.shape[1],"height":hdr.shape[0],"source_width":round(source_width*hdr.shape[1]/frame.image.shape[1]),
            "source_height":round(source_height*hdr.shape[0]/frame.image.shape[0]),"edge":edge,"white":203,
            "source_route":"reopened-photo","source_ms":source_ms,"render_ms":render_ms,"encode_ms":encode_ms,
            "stored_bytes":temp.stat().st_size,"make_ms":round((perf_counter()-started)*1000,2),"route":"saved-gain-map"}
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
        self.jobs={};self._lock=RLock()
    def request(self,path):
        path=str(self.marks._path(path))
        with self.marks._lock:
            state=self.marks.grades._get(path);doc=self.marks._document(Path(path)) or {}
            grade=state.get("desired") if state.get("pending") else doc.get("grade")
            default=doc.get("grade_default") or state.get("default")
            return {"path":path,"grade":deepcopy(grade),"grade_identity":identity(grade),
                "edited":grade is not None and grade_key(grade)!=grade_key(default),**preferences(self.root)}
    def key(self,path,grade_id): return sha256((str(path)+":"+grade_id).encode()).hexdigest()
    def cached(self,path):
        request=self.request(path)
        if not request["edited"]: return None
        key=self.key(request["path"],request["grade_identity"])
        try:
            meta=json.loads((self.cache.root/(key+".json")).read_text())
            picture=self.cache.root/(key+"."+meta["extension"])
            if not picture.is_file() or meta["grade_identity"]!=request["grade_identity"]: return None
            if meta.get("source_stat")!=self.source_stat(path): return None
            os.utime(picture,None);os.utime(self.cache.root/(key+".json"),None)
            return meta|{"key":key,"kept":True,"cache_hit":True}
        except (OSError,ValueError,KeyError): return None
    def current_meta(self, path, grade_id):
        key = self.key(path, grade_id)
        try:
            meta = json.loads((self.cache.root / (key + ".json")).read_text())
            if meta.get("grade_identity") != grade_id or meta.get("source_stat") != self.source_stat(path): return None
            return meta if (self.cache.root / (key + "." + meta["extension"])).is_file() else None
        except (OSError, ValueError, KeyError): return None
    @staticmethod
    def source_stat(path):
        s=self_source(path).stat();return [s.st_size,s.st_mtime_ns]
    def schedule(self,path,grade=None):
        saved_at=time.time()
        # No decode and no worker startup on the save request thread.
        def launch():
            try:
                request=self.request(path)
                if not request["edited"]: return
                if grade is not None and identity(grade)!=request["grade_identity"]: return
                with self._lock:
                    old=self.jobs.get(path)
                    if old: self.worker.cancel(old)
                    stat=self.source_stat(path)
                    job,future=self.worker.submit_library("kept",priority=80,path=str(self_source(path)),grade=request["grade"],edge=request["edited_edge"])
                    self.jobs[path]=job
                def finish(f):
                    result=None
                    try:
                        result=f.result()
                        temporary=Path(result["temporary"])
                        with self.marks._lock,self._lock:
                            if self.jobs.get(path)!=job or self.request(path)["grade_identity"]!=request["grade_identity"] or self.source_stat(path)!=stat: return
                            temp=Path(result["temporary"]);key=self.key(path,request["grade_identity"])
                            os.replace(temp,self.cache.root/(key+"."+result["extension"]))
                            atomic_json(self.cache.root/(key+".json"),{k:v for k,v in result.items() if k!="temporary"}|{"source_stat":stat,"saved_at":saved_at})
                            self.jobs.pop(path,None)
                        self.cache.trim();log("kept_picture_saved",photo=path,key=key,save_to_written_ms=(time.time()-saved_at)*1000,**result)
                    except Exception as error:
                        log("kept_picture_failed",photo=path,reason=str(error),action="grade safe; default look with not-current mark")
                    finally:
                        if result and result.get("temporary"): Path(result["temporary"]).unlink(missing_ok=True)
                future.add_done_callback(finish)
            except Exception as error: log("kept_picture_failed",photo=path,reason=str(error),action="grade safe; retry at next save")
        Thread(target=launch,name="hdr-kept-request",daemon=True).start()
    def pixels(self,key,lane):
        self.cache.file(key)
        meta=json.loads((self.cache.root/(key+".json")).read_text())
        path=self.cache.root/(key+"."+meta["extension"])
        if meta["extension"] == "jpg": image = jpeg_renditions(path, lane == "hdr")
        else:
            from . import loader
            image, reference, _ = loader.decode_avif(path)
            if lane == "sdr": image = reference
        if lane == "hdr":
            peak = np.maximum(np.max(image, axis=2, keepdims=True), 1e-6)
            image = image * np.minimum(1, (1000 * .18 / 203) / peak)
        from .render_cache import encode_rgba_proxy_rows
        body,stride=encode_rgba_proxy_rows(image,0,image.shape[0],prefer_half=True,pixel_format="rgba16float")
        os.utime(path,None);os.utime(self.cache.root/(key+".json"),None)
        return body,image.shape[1],image.shape[0],stride
    def usage(self):
        return preferences(self.root)|{"used_bytes":sum(p.stat().st_size for p in self.cache.root.glob("*") if p.is_file())}
