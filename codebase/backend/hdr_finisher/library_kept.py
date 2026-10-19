"""Saved document helpers and readers pending removal of the old file APIs."""
from copy import deepcopy
from hashlib import sha256
import json, os
from pathlib import Path
from tempfile import NamedTemporaryFile
from threading import RLock
from PIL import Image
import numpy as np
from .gainmap_decoders import GainMapDecodeError
from .library_grades import grade_key
from .library_pictures import LibraryPictureCache
from .library_diagnostics import log

_LOCK=RLock()
EDGES=(512,1024,1920)
PICTURE_VERSION="saved-screen-gpu-raw-v7"
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

def jpeg_renditions(path, hdr=False):
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
        self.root=Path(root);self.marks=marks;self.cache=LibraryPictureCache(root)
        self._lock=RLock()

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

    @staticmethod
    def source_stat(path):
        s=self_source(path).stat();return [s.st_size,s.st_mtime_ns]

    def quick_meta(self,path,grade_id):
        path=str(self.marks._path(path));key=kept_picture_key(path,grade_id,THUMBNAIL_EDGE)
        try:
            meta=json.loads((self.cache.root/(key+".json")).read_text())
            if (meta.get("grade_identity")!=grade_id or meta.get("source_stat")!=self.source_stat(path)
                    or meta.get("picture_version")!=PICTURE_VERSION or meta.get("edge")!=THUMBNAIL_EDGE): return None
            if not (self.cache.root/(key+"."+meta["extension"])).is_file(): return None
            return meta|{"key":key,"kept":True,"cache_hit":True}
        except (OSError,ValueError,KeyError): return None

    def cached(self,path,edge=None):
        request=self.request(path)
        if not request["edited"]: return None
        quick=self.quick_meta(path,request["grade_identity"]) if edge is not None else None
        if quick and edge<=512: return quick
        key=self.key(request["path"],request["grade_identity"])
        try:
            meta=json.loads((self.cache.root/(key+".json")).read_text());picture=self.cache.root/(key+"."+meta["extension"])
            if (not picture.is_file() or meta["grade_identity"]!=request["grade_identity"]
                    or meta.get("picture_version")!=PICTURE_VERSION or meta.get("edge")!=request["edited_edge"]): return quick
            if meta.get("source_stat")!=self.source_stat(path): return quick
            os.utime(picture,None);os.utime(self.cache.root/(key+".json"),None)
            return meta|{"key":key,"kept":True,"cache_hit":True}
        except (OSError,ValueError,KeyError): return quick

    def pixels(self,key,lane):
        from .exporters import ExportProcessError
        self.cache.file(key);metadata=self.cache.root/(key+".json")
        with self._lock:
            path=None
            try:
                meta=json.loads(metadata.read_text());path=self.cache.root/(key+"."+meta["extension"])
                if meta["extension"] == "jpg": image = jpeg_renditions(path, lane == "hdr")
                elif meta["extension"] == "avif":
                    from . import loader
                    image, reference, _ = loader.decode_avif(path)
                    if lane == "sdr": image = reference
                else: raise ValueError("Unsupported kept picture format.")
            except (OSError, ValueError, EOFError, KeyError, GainMapDecodeError, ExportProcessError) as error:
                metadata.unlink(missing_ok=True);self.cache.managed.record(metadata)
                if path is not None: path.unlink(missing_ok=True);self.cache.managed.record(path)
                log("kept_picture_unreadable",key=key,reason=str(error),action="damaged entry removed")
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
