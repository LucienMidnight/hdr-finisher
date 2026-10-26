"""GPU noise-measurement transport. No finishing grade enters the identity.

The browser measures bounded source windows on its own GPU, so Grade and a
running delivery never wait for another turn on the hidden delivery renderer.
"""
from collections import OrderedDict
from dataclasses import asdict
from hashlib import sha256
import json
import struct
from threading import RLock
from pathlib import Path
from tempfile import NamedTemporaryFile
from time import perf_counter

import numpy as np
from fastapi import APIRouter, HTTPException, Query, Body
from fastapi.responses import Response
from .models import PreviewKind
from .library_diagnostics import log

VERSION = "adaptive-measure-gpu-v1"
_models = OrderedDict()
_lock = RLock()


def source_identity(frame):
    explicit = getattr(frame, "denoise_source_identity", None)
    if explicit is not None:
        return explicit
    owner = getattr(frame, "delivery_owner", None)
    if owner is not None and owner is not frame:
        parent = source_identity(owner)
        if frame.image is owner.image:
            return parent
        return {"parent": parent, "proof_size": list(frame.image.shape[:2])}
    render_cache = getattr(frame, "render_cache", None)
    if render_cache is None:
        # Lightweight callers have neither a source identity nor an epoch.
        # A session label alone must not let different arrays share a model.
        image = np.ascontiguousarray(frame.image)
        return {"pixels": sha256(image.view(np.uint8)).hexdigest(), "shape": list(image.shape)}
    epoch = getattr(render_cache, "source_epoch", 0)
    identity = getattr(render_cache, "source_identity", None)
    if identity is not None:
        return {"identity":asdict(identity),"epoch":epoch}
    return {"session": getattr(frame, "session_id", str(id(frame.image))), "epoch": epoch}


def _context(store, session_id, kind, long_edge, edit_revision, geometry_signature):
    from .library_live import metadata, session
    meta = metadata(session_id) if session_id.startswith("live-") else None
    if session_id.startswith("live-") and meta is None:
        raise HTTPException(404, "Stored Library scene is unavailable.")
    frame = None
    if meta:
        geometry = meta["adjustments"].get("shared", {}).get("geometry", {})
        revision = 0
        authored = kind == PreviewKind.SDR and meta.get("has_reference", False) and meta["adjustments"].get("sdr", {}).get("use_authored_base", True)
        native = long_edge >= max(meta["scene_width"], meta["scene_height"]) and not authored
        source = {"scene": meta["source_key"]}
        path = meta.get("path")
        usage = "Library"
    else:
        try:
            from .gpu_delivery import session as delivery_session
            frame = delivery_session(session_id) or store.get(session_id)
        except KeyError as exc:
            raise HTTPException(404, str(exc)) from exc
        geometry = frame.adjustments.shared.geometry.model_dump(mode="json")
        revision = frame.edit_revision
        authored = kind == PreviewKind.SDR and frame.sdr_reference_image is not None and frame.adjustments.sdr.use_authored_base
        native = long_edge >= max(frame.image.shape[:2]) and not authored
        source = source_identity(frame)
        path = str(getattr(frame, "source_path", ""))
        usage = "export/Proof" if session_id.startswith("delivery-") else "Grade"
    if edit_revision is not None and edit_revision != revision:
        raise HTTPException(409, "Stale Denoise revision dropped.")
    if geometry_signature is not None:
        try:
            requested = json.loads(geometry_signature)
        except ValueError as exc:
            raise HTTPException(400, "Invalid geometry signature.") from exc
        if requested != geometry:
            raise HTTPException(409, "Stale geometry Denoise request dropped.")
    identity = {"version": VERSION, "source": source,
        "pixels": "authored-sdr" if authored else "scene", "size": "native" if native else long_edge,
        "geometry": None if native else geometry}
    key = sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
    return key, frame, meta, dict(path=path, usage=usage, rendition=kind.value, edge=long_edge)


def _cache():
    from .config import APP_DATA_DIR
    from .library_cache import LibraryCache
    return LibraryCache(APP_DATA_DIR)


def _file(cache, key):
    return cache.directory("library-pictures") / (key + ".denoise.json")


def _get(key):
    with _lock:
        value = _models.get(key)
        if value is None:
            try:
                cache = _cache()
                if cache.preferences()["enabled"]:
                    candidate = json.loads(_file(cache,key).read_text(encoding="utf-8"))
                    _validate(candidate["model"])
                    value = candidate
                    _models[key] = value
                    while len(_models) > 512:
                        _models.popitem(last=False)
            except (OSError, ValueError, KeyError, HTTPException):
                pass
        if value is not None:
            _models.move_to_end(key)
        return value


def _put(key, model):
    with _lock:
        _models[key] = model
        _models.move_to_end(key)
        while len(_models) > 512:
            _models.popitem(last=False)
    cache = _cache()
    if not cache.preferences()["enabled"]:
        return
    temporary = None
    try:
        cache.prepare()
        target = _file(cache,key)
        target.parent.mkdir(parents=True, exist_ok=True)
        with NamedTemporaryFile(dir=target.parent,suffix=".tmp",delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(json.dumps(model,allow_nan=False).encode("utf-8"))
        temporary.replace(target)
        cache.record(target)
    except (OSError, ValueError) as error:
        log("denoise_measurement_store_failed", reason=str(error))
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def _validate(model):
    from .denoise_adaptive import ALGORITHM_VERSION
    try:
        values = [float(model[name]) for name in ("a", "b", "c")]
        bands = np.asarray(model["band_sigmas"], dtype=float)
        if model["algorithm_version"] != ALGORITHM_VERSION or bands.shape != (3, 5):
            raise ValueError("Invalid noise model.")
        if not np.isfinite(values).all() or not np.isfinite(bands).all() or min(values) < 0 or np.any(bands < 0):
            raise ValueError("Invalid noise model.")
    except (ValueError, TypeError, KeyError) as exc:
        raise HTTPException(400, "Invalid GPU noise model.") from exc
    return model


def cpu_delivery_model(frame):
    """No usable GPU: retain the native source measurement for later delivery."""
    from .denoise_adaptive import AdaptiveNoiseModel, estimate_adaptive_model, measurement_usage
    started = perf_counter()
    identity = {"version": VERSION, "source": source_identity(frame),
        "pixels": "scene", "size": "native", "geometry": None}
    key = sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
    cached = _get(key)
    if cached is None:
        with measurement_usage("export/Proof"):
            model = estimate_adaptive_model(frame.image)
        height, width = frame.image.shape[:2]
        _put(key, {"model": model.as_dict(), "measurement": {
            "width": width, "height": height, "measured_pixels": min(width*height,4*1024*1024)}})
        return model
    log("denoise_measurement", usage="export/Proof", route="reused", measurement_key=key,
        duration_ms=(perf_counter()-started)*1000, **cached["measurement"])
    value = cached["model"]
    return AdaptiveNoiseModel(a=value["a"], b=value["b"], c=value["c"],
        band_sigmas=tuple(tuple(row) for row in value["band_sigmas"]))


def create_router(store):
    router = APIRouter()

    @router.get("/api/session/{session_id}/denoise-measurement/{kind}")
    def measurement(session_id: str, kind: PreviewKind,
                    long_edge: int = Query(default=1600, ge=256, le=16384),
                    edit_revision: int | None = None, geometry_signature: str | None = None,
                    source: bool = False):
        started = perf_counter()
        key, frame, meta, fields = _context(store, session_id, kind, long_edge, edit_revision, geometry_signature)
        cached = _get(key)
        if cached is not None:
            log("denoise_measurement", **fields, route="reused", measurement_key=key,
                duration_ms=(perf_counter()-started)*1000, **cached["measurement"])
            return cached["model"]
        if not source:
            return Response(status_code=204,headers={"X-Denoise-Measurement-Key":key})
        native = None
        if frame is None:
            authored = kind == PreviewKind.SDR and meta.get("has_reference", False) and meta["adjustments"].get("sdr", {}).get("use_authored_base", True)
            if not authored and long_edge >= max(meta["scene_width"],meta["scene_height"]):
                from .library_live import native_denoise_pixels
                native = (native_denoise_pixels(session_id), 0)
            else:
                from .library_live import session
                frame = session(session_id)
        if frame is not None:
            request = (kind, long_edge, frame.adjustments)
            native = frame.render_cache.native_denoise_source(*request)
        if native is not None:
            image = native[0]
            height, width = image.shape[:2]
            read = lambda y0,x0,y1,x1: image[y0:y1,x0:x1,:3]
        else:
            windows = frame.render_cache.geometry_source_windows(*request)
            if windows is not None:
                height, width, read = windows
            else:
                image, _, _ = frame.render_cache.geometry_source_proxy(*request)
                height, width = image.shape[:2]
                read = lambda y0,x0,y1,x1: image[y0:y1,x0:x1,:3]
        # At most 1 MP of original samples, without resizing/noise smoothing.
        # Small pictures use every pixel; larger ones use an even 4x4 grid.
        if height*width <= 1024*1024:
            rectangles = [(0,0,height,width)]
        else:
            th, tw = min(height,256), min(width,256)
            ys=np.linspace(0,height-th,4).astype(int);xs=np.linspace(0,width-tw,4).astype(int)
            rectangles=[(int(y),int(x),int(y)+th,int(x)+tw) for y in ys for x in xs]
        packed=[]; descriptions=[]
        for y0,x0,y1,x1 in rectangles:
            rgb=np.asarray(read(y0,x0,y1,x1),dtype=np.float32)
            rgba=np.ones((*rgb.shape[:2],4),dtype="<f4");rgba[...,:3]=rgb[...,:3]
            packed.append(rgba.tobytes())
            descriptions.append({"edges":[y0==0,y1==height,x0==0,x1==width]})
        description={"key":key,"width":rectangles[0][3]-rectangles[0][1],"height":rectangles[0][2]-rectangles[0][0],
            "windows":descriptions,"source_width":width,"source_height":height,"version":VERSION}
        header=json.dumps(description).encode();header+=b" "*((-len(header))%4)
        return Response(struct.pack("<I",len(header))+header+b"".join(packed),media_type="application/octet-stream")

    @router.post("/api/session/{session_id}/denoise-measurement/{kind}")
    def accept(session_id: str, kind: PreviewKind, value: dict = Body(...),
               long_edge: int = Query(default=1600,ge=256,le=16384),
               edit_revision: int | None = None, geometry_signature: str | None = None):
        key, frame, meta, fields = _context(store, session_id, kind, long_edge, edit_revision, geometry_signature)
        if value.get("key") != key or value.get("version") != VERSION:
            raise HTTPException(409,"Stale GPU Denoise measurement dropped.")
        model=_validate(value.get("model",{}))
        measurement={name:int(value[name]) for name in ("width","height","measured_pixels")}
        if min(measurement.values())<1 or measurement["measured_pixels"]>4*1024*1024:
            raise HTTPException(400,"Invalid measurement size.")
        _put(key,{"model":model,"measurement":measurement})
        log("denoise_measurement",**fields,route="CPU fallback" if value.get("route")=="CPU fallback" else "GPU",measurement_key=key,**measurement,
            duration_ms=value.get("duration_ms"),gpu_ms=value.get("gpu_ms"),reason=value.get("reason"))
        return model

    return router
