"""GPU noise-measurement transport. No finishing grade enters the identity.

The browser measures bounded source windows on its own GPU, so Grade and a
running delivery never wait for another turn on the hidden delivery renderer.
"""
from collections import OrderedDict
from dataclasses import asdict, dataclass
from hashlib import sha256
import json
import struct
from threading import RLock, Timer
from pathlib import Path
from tempfile import NamedTemporaryFile
from time import perf_counter
from uuid import uuid4

import numpy as np
from fastapi import APIRouter, HTTPException, Query, Body, Request
from fastapi.responses import Response
from .models import DenoiseLiveControls, PreviewKind
from .library_diagnostics import log
from .denoise_adaptive import CALIBRATION_RULES, MEASUREMENT_VERSION

VERSION = MEASUREMENT_VERSION
_models = OrderedDict()
_lock = RLock()


@dataclass
class _GrainPreparation:
    signature: tuple
    fit_signature: tuple
    rgb_signature: tuple
    authored_sdr: bool
    has_colour: bool
    token: str
    fit: tuple[tuple[float, float], ...] | None
    corrections: object | None

    def close(self):
        if self.corrections is not None:
            self.corrections.close()


def _uses_authored_sdr(frame, kind):
    return (
        kind == PreviewKind.SDR
        and frame.sdr_reference_image is not None
        and frame.adjustments.sdr.use_authored_base
    )


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
        authored = _uses_authored_sdr(frame, kind)
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


def cpu_delivery_model(frame, *, authored_image=None, geometry=None):
    """No usable GPU: retain the native source measurement for later delivery."""
    from .denoise_adaptive import AdaptiveNoiseModel, estimate_adaptive_model, measurement_usage
    started = perf_counter()
    image = frame.image if authored_image is None else authored_image
    if authored_image is None:
        identity = {"version": VERSION, "source": source_identity(frame),
            "pixels": "scene", "size": "native", "geometry": None}
        key = sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
    else:
        native_edge = max(frame.image.shape[:2])
        geometry = (geometry if geometry is not None else frame.adjustments.shared.geometry).model_dump(mode="json")
        identity = {"version": VERSION, "source": source_identity(frame),
            "pixels": "authored-sdr", "size": max(256, native_edge), "geometry": geometry}
        key = sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
    cached = _get(key)
    if cached is None:
        with measurement_usage("export/Proof"):
            model = estimate_adaptive_model(image)
        height, width = image.shape[:2]
        _put(key, {"model": model.as_dict(), "measurement": {
            "width": width, "height": height, "measured_pixels": min(width*height,4*1024*1024)}})
        return model
    log("denoise_measurement", usage="export/Proof", route="reused", measurement_key=key,
        duration_ms=(perf_counter()-started)*1000, **cached["measurement"])
    value = cached["model"]
    return AdaptiveNoiseModel(a=value["a"], b=value["b"], c=value["c"],
        band_sigmas=tuple(tuple(row) for row in value["band_sigmas"]))


def create_router(store):
    from .instrument_work import InstrumentWork
    from .render_cache import StaleRender

    router = APIRouter()
    work = InstrumentWork(background=False)
    library_draws = {}
    micro_work = InstrumentWork(background=False)

    @router.get("/api/session/{session_id}/denoise-micro")
    async def prepare_micro(request: Request, session_id: str):
        from .denoise_micro_grain import MicroGrainUnavailable, prepare_source

        def build(current):
            frame = store.get(session_id)
            if frame.metadata.get("lens_correction", {}).get("applied"):
                raise MicroGrainUnavailable("Micro Grain uses the CPU with lens correction.")
            source = prepare_source(frame, cancelled=lambda: not current())
            height, width = source.shape
            return {"width": width, "height": height, "gain": float(source.gain), "model": source.model.as_dict()}

        try:
            return await micro_work.run(session_id, request, build)
        except KeyError as error:
            raise HTTPException(404, str(error)) from error
        except (StaleRender, InterruptedError) as error:
            raise HTTPException(409, str(error)) from error
        except MicroGrainUnavailable as error:
            raise HTTPException(422, str(error)) from error

    @router.post("/api/session/{session_id}/denoise-micro/region")
    async def micro_region(request: Request, session_id: str, controls: DenoiseLiveControls,
                           x: int, y: int, width: int, height: int, revision: int, retain: bool = True):
        from .denoise_micro_grain import MicroGrainControls, MicroGrainUnavailable, prepare_source

        if min(x, y) < 0 or min(width, height) < 1 or width * height > 4 * 1024 * 1024:
            raise HTTPException(400, "Invalid Micro Grain region size.")

        def build(current):
            frame = store.get(session_id)
            if frame.edit_revision != revision:
                raise StaleRender("A newer edit replaced Micro Grain.")
            source = prepare_source(frame, cancelled=lambda: not current())
            right, bottom = x+width, y+height
            if bottom > source.shape[0] or right > source.shape[1]:
                raise HTTPException(400, "Micro Grain region exceeds the Bayer source.")
            with _lock:
                return source.gpu_region((x, y, right, bottom), MicroGrainControls.from_settings(controls), retain=retain)

        try:
            body = await micro_work.run(session_id, request, build)
            return Response(body, media_type="application/octet-stream")
        except KeyError as error:
            raise HTTPException(404, str(error)) from error
        except (StaleRender, InterruptedError) as error:
            raise HTTPException(409, str(error)) from error
        except MicroGrainUnavailable as error:
            raise HTTPException(422, str(error)) from error

    def release_draw(key, owner=None):
        with _lock:
            held = library_draws.get(key)
            if held is None or (owner is not None and held[1] is not owner):
                return
            preparation, timer = library_draws.pop(key)
            timer.cancel()
        preparation.close()

    def hold_draw(key, preparation):
        timer = Timer(30, lambda: release_draw(key, timer))
        timer.daemon = True
        with _lock:
            previous = library_draws.get(key)
            if previous is not None:
                previous[1].cancel()
            library_draws[key] = preparation, timer
        timer.start()

    @router.post("/api/session/{session_id}/denoise-grain/{kind}")
    async def prepare_grain(request: Request, session_id: str, kind: PreviewKind, controls: DenoiseLiveControls,
                      long_edge: int = Query(ge=256, le=16384), edit_revision: int | None = None,
                      geometry_signature: str | None = None, refresh: int = 0):
        draw_key = None

        def build(current):
            nonlocal draw_key
            preparation = _prepare_grain(session_id, kind, controls, long_edge, edit_revision,
                                         geometry_signature, refresh, current)
            if session_id.startswith("live-") and preparation.corrections is not None:
                draw_key = session_id, kind, preparation.token
                hold_draw(draw_key, preparation)
            return {"fit": preparation.fit, "token": preparation.token if preparation.corrections else None}

        try:
            return await work.run((session_id, kind), request, build)
        except StaleRender as error:
            release_draw(draw_key)
            raise HTTPException(409, str(error)) from error
        except BaseException:
            release_draw(draw_key)
            raise

    def _prepare_grain(session_id, kind, controls, long_edge, edit_revision, geometry_signature, refresh, current):
        from .denoise_adaptive import AdaptiveControls, AdaptiveNoiseModel
        from .denoise_grain import GrainPreparation, fit_grain
        from .library_live import session as library_session

        started = perf_counter()
        _, frame, meta, _ = _context(store, session_id, kind, long_edge, edit_revision, geometry_signature)
        frame = frame if frame is not None else library_session(session_id)
        if frame is None:
            raise HTTPException(404, "The Denoise source is unavailable.")
        authored_sdr = _uses_authored_sdr(frame, kind)
        image = frame.sdr_reference_image if authored_sdr else frame.image
        native_edge = max(256, *image.shape[:2])
        key, _, _, fields = _context(store, session_id, kind, native_edge, edit_revision, geometry_signature)
        cached_model = _get(key)
        cache = frame.render_cache
        epoch = cache.source_epoch
        geometry = frame.adjustments.shared.geometry

        def is_current():
            if not current() or cache.source_epoch != epoch or frame.adjustments.shared.geometry != geometry:
                return False
            if _uses_authored_sdr(frame, kind) != authored_sdr:
                return False
            if meta is not None:
                return True
            if session_id.startswith("delivery-"):
                from .gpu_delivery import session as delivery_session
                return delivery_session(session_id) is frame
            return store.current() is frame

        options = controls.model_dump(exclude={"color_splotches"})
        model_signature = json.dumps(cached_model["model"], sort_keys=True) if cached_model else None
        base_signature = (key, epoch, geometry.model_dump_json(), refresh, model_signature)
        signature = (*base_signature, tuple(options.items()))
        rgb_signature = (*base_signature, tuple((k, v) for k, v in options.items()
                                               if k not in {"method", "splotch_size"}))
        fit_signature = (*base_signature, tuple((k, v) for k, v in options.items()
                                               if k not in {"method", "grain_evenness", "splotch_size"}))
        with cache.grain_preparation_lock:
            if not is_current():
                raise HTTPException(409, "A newer edit replaced the Denoise preparation.")
            previous = cache.grain_preparation
            if previous is not None and previous.signature == signature:
                return previous
            request = (kind, native_edge, frame.adjustments)
            direct = cache.native_source_stream(*request)
            if direct is not None:
                pixels = direct[0]
                height, width = pixels.shape[:2]
                read = lambda y, x, b, r: pixels[y:b, x:r]
            else:
                windows = cache.geometry_source_windows(*request, is_current=is_current, native=True)
                height, width, read = windows
            if cached_model is None:
                from .denoise_adaptive import estimate_adaptive_model_from_windows
                model = estimate_adaptive_model_from_windows(height, width, read)
            else:
                value = cached_model["model"]
                model = AdaptiveNoiseModel(value["a"], value["b"], value["c"],
                                           tuple(tuple(row) for row in value["band_sigmas"]))
            settings = AdaptiveControls(**controls.model_dump())
            has_colour = settings.method == "clean_grain"
            reuse_rgb = (has_colour and previous is not None and not previous.has_colour
                         and previous.rgb_signature == rgb_signature and previous.corrections is not None)
            fit = None
            fit_started = perf_counter()
            if settings.grain_evenness and settings.amount and settings.luminance:
                if previous is not None and previous.fit_signature == fit_signature and previous.fit is not None:
                    fit = previous.fit
                else:
                    if not is_current():
                        raise HTTPException(409, "A newer edit replaced the Denoise preparation.")
                    fit = fit_grain(height, width, read, model, settings)
            if not is_current():
                raise HTTPException(409, "A newer edit replaced the Denoise preparation.")
            fitted = perf_counter()
            corrections = None
            tile_timings = {}
            try:
                if reuse_rgb:
                    corrections = previous.corrections
                    tile_timings = corrections.add_colour(settings, is_current)
                else:
                    cache.discard_grain_preparation()
                    if settings.amount and (settings.luminance or settings.color_noise):
                        source_path = (fields["path"] or "") if fields["usage"] == "Grade" else None
                        corrections = GrainPreparation(height, width, read, model, settings, fit,
                                                       is_current, _cache(), source_path=source_path)
                        tile_timings = corrections.tile_timing_ms
            except InterruptedError as error:
                raise HTTPException(409, str(error)) from error
            except OSError as error:
                raise HTTPException(507, str(error)) from error
            if not is_current():
                if corrections is not None and not reuse_rgb:
                    corrections.close()
                raise HTTPException(409, "A newer edit replaced the Denoise preparation.")
            preparation = _GrainPreparation(signature, fit_signature, rgb_signature, authored_sdr, has_colour,
                                            uuid4().hex, fit, corrections)
            if meta is None:
                cache.grain_preparation = preparation
                if not is_current():
                    cache.discard_grain_preparation()
                    raise HTTPException(409, "A newer edit replaced the Denoise preparation.")
        finished = perf_counter()
        log("denoise_grain_prepared", **fields, method=settings.method, width=width, height=height,
            duration_ms=(finished-started)*1000, fit_ms=(fitted-fit_started)*1000,
            filter_ms=(finished-fitted)*1000, tile_worker_ms=tile_timings, reused_rgb=reuse_rgb,
            disk_bytes=width * height * 16 if corrections else 0)
        return preparation

    @router.get("/api/session/{session_id}/denoise-grain/{kind}/{token}")
    def grain_region(session_id: str, kind: PreviewKind, token: str, x: int, y: int,
                     width: int, height: int, frame_width: int = Query(gt=0, le=32768),
                     frame_height: int = Query(gt=0, le=32768)):
        if min(width, height) < 1 or width*height > 1024*1024:
            raise HTTPException(400, "Invalid Clean Grain region size.")
        if session_id.startswith("live-"):
            draw_key = session_id, kind, token
            with _lock:
                held = library_draws.get(draw_key)
                preparation = held[0] if held is not None else None
                if preparation is not None:
                    hold_draw(draw_key, preparation)
        else:
            _, frame, _, _ = _context(store, session_id, kind, 1600, None, None)
            preparation = frame.render_cache.grain_preparation
            if preparation is not None and preparation.authored_sdr != _uses_authored_sdr(frame, kind):
                preparation = None
        if preparation is None or preparation.token != token or preparation.corrections is None:
            raise HTTPException(409, "The Clean Grain preparation was replaced.")
        try:
            body = preparation.corrections.region(y, x, height, width, frame_height, frame_width,
                                                 colour=preparation.has_colour)
        except ValueError as error:
            raise HTTPException(400, str(error)) from error
        except InterruptedError as error:
            raise HTTPException(409, str(error)) from error
        return Response(body, media_type="application/octet-stream")

    @router.delete("/api/session/{session_id}/denoise-grain/{kind}/{token}", status_code=204)
    def release_grain(session_id: str, kind: PreviewKind, token: str):
        release_draw((session_id, kind, token))
        return Response(status_code=204)

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
            "windows":descriptions,"source_width":width,"source_height":height,"version":VERSION,
            "calibration":CALIBRATION_RULES}
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
