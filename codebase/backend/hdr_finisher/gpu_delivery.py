"""Memory pixel handoff between workers and the hidden Electron renderer.

Only the backend creates the spool. HTTP clients get opaque job IDs, never
filesystem paths. A worker publishes complete inputs atomically; both lanes
succeed together or the ordinary CPU graph renders both.
"""
from __future__ import annotations
import atexit
import json
import os
from pathlib import Path
import shutil
import tempfile
import time
from types import SimpleNamespace
from uuid import uuid4
from threading import RLock
import numpy as np
from fastapi import APIRouter, HTTPException, Request, Response
from .color_context import RenderColorContext
from .models import AdjustmentState, DenoiseDocumentSettings, LocalAdjustment
from .render_cache import SessionRenderCache
from .delivery_memory import DeliveryMemory

ROOT_ENV = "HDR_FINISHER_GPU_DELIVERY_SPOOL"
_sessions = {}
_lock = RLock()
_clients = {}
_activity = {"until": 0., "bytes": 0, "budget": 536870912}


# One priority step per this many seconds of waiting. Visible Library pictures
# (15) still go before export (20), but an export waits at most about 25 s.
AGING_SECONDS_PER_STEP = 5.
# A claimed job that the renderer has not finished by then falls back to the CPU.
RENDER_DEADLINE_SECONDS = 180.
# A finished job's directory is read within moments; an unclaimed one belongs
# to a worker that may have died. Both are removed after these ages.
FINISHED_SPOOL_SECONDS = 120.
ABANDONED_SPOOL_SECONDS = 1800.


# The renderer's messages when it gives the GPU up to Grade or to a more
# urgent delivery. Those jobs go back in the queue; they are not GPU failures.
PREEMPTED_REASONS = {
    "A higher-priority delivery needs the GPU.",
    "GPU delivery released the shared memory budget for Grade.",
    "Grade needs the shared GPU memory budget.",
}


def _effective_priority(value, now=None):
    now = time.time() if now is None else now
    return value["priority"] - max(0., now - value["created"]) / AGING_SECONDS_PER_STEP


def _age(path):
    try: return time.time() - path.stat().st_mtime
    except OSError: return 0.


def _sweep(root, active):
    for directory in root.glob("delivery-*"):
        if directory.name in active:
            continue
        finished = (directory / "result.json").exists() or (directory / "cancelled").exists()
        if (finished and _age(directory / ("result.json" if (directory / "result.json").exists() else "cancelled")) > FINISHED_SPOOL_SECONDS) \
                or _age(directory) > ABANDONED_SPOOL_SECONDS:
            with _lock: _sessions.pop(directory.name, None)
            shutil.rmtree(directory, ignore_errors=True)


def _remove_stale_roots(current):
    # Spools from earlier launches lose their heartbeat when that app exits.
    for other in current.parent.glob("hdr-gpu-delivery-*"):
        if other == current or not other.is_dir():
            continue
        beat = other / "heartbeat"
        if _age(beat if beat.exists() else other) > 300:
            shutil.rmtree(other, ignore_errors=True)


def session(identity):
    with _lock:
        return _sessions.get(identity)


def _atomic(path, value):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value), encoding="utf-8")
    temporary.replace(path)


def render_pair(frame, settings, adjustments):
    owner = getattr(frame, "delivery_owner", frame)
    with _lock:
        if not hasattr(owner, "_delivery_lock"): owner._delivery_lock = RLock()
    # Proof and export may arrive concurrently. One render and one decision
    # belong to this source/grade/finishing, including a failed GPU attempt.
    with owner._delivery_lock:
        return _render_pair(frame, owner, settings, adjustments)


def _render_pair(frame, owner, settings, adjustments):
    from .delivery import preferences, renderer_record
    try:
        policy = preferences()
    except (OSError, ValueError, AttributeError):
        frame._delivery_record = renderer_record()
        return None
    signature = (id(frame.image), id(getattr(frame, "sdr_reference_image", None)),
        adjustments.model_dump_json(), repr(getattr(frame, "local_adjustments", None)),
        repr(getattr(frame, "denoise", None)), getattr(frame, "hdr_reference_white_nits", 203),
        settings.output_finishing.model_dump_json(), policy["effective_force_cpu"])
    cached = getattr(owner, "_delivery_cache", None)
    if cached and cached[0] == signature:
        frame._delivery_record = cached[2]
        return cached[1]
    result = None
    record = renderer_record()
    root = Path(os.environ[ROOT_ENV]) if os.environ.get(ROOT_ENV) else None
    directory = None
    memory = DeliveryMemory()
    try:
        if policy["effective_force_cpu"]:
            return None
        if root is None or not (root / "heartbeat").exists() or time.time() - (root / "heartbeat").stat().st_mtime > 5:
            raise RuntimeError("The GPU delivery renderer is unavailable.")
        identity = "delivery-" + uuid4().hex
        directory = root / identity
        directory.mkdir()
        raw = getattr(frame, "raw_development", None)
        source_memory, _ = memory.allocate(frame.image.shape, None if raw else frame.image)
        raw_memory = None
        if raw:
            sensor_body = raw["body"]
            raw_memory, data = memory.allocate((len(sensor_body) // 4,))
            data.view(np.uint8)[:] = np.frombuffer(sensor_body, dtype=np.uint8)
        reference = getattr(frame, "sdr_reference_image", None)
        reference_memory = memory.allocate(reference.shape, reference)[0] if reference is not None else None
        from .finishing import geometry_output_dimensions, resolve_output_dimensions
        height, width = frame.image.shape[:2]
        output = resolve_output_dimensions(*geometry_output_dimensions(width, height, adjustments.shared.geometry), settings.output_finishing)
        lane_memory = {lane: memory.allocate((output[1], output[0], 4))[0] for lane in ("hdr", "sdr")}
        _atomic(directory / "request.json", {
            "memory": {"source": source_memory, "reference": reference_memory, "raw": raw_memory, **lane_memory},
            "raw": {key: value for key, value in raw.items() if key != "body"} if raw else None,
            "id": identity, "width": width, "height": height, "output": output,
            "white": getattr(frame, "hdr_reference_white_nits", 203), "adjustments": adjustments.model_dump(mode="json"),
            "locals": [v.model_dump(mode="json") for v in adjustments.enabled_locals(getattr(frame, "local_adjustments", []))],
            "denoise": (getattr(frame, "denoise", None) or DenoiseDocumentSettings()).model_dump(mode="json"),
            "finishing": settings.output_finishing.model_dump(mode="json"),
            "priority": getattr(frame, "delivery_priority", 20), "created": time.time()})
        reply = _wait_for_result(directory, root, frame)
        while reply.get("error") in PREEMPTED_REASONS:
            # Give the GPU back, then wait for another turn with the same
            # request (and its original queue time).
            for name in ("result.json", "claimed"):
                (directory / name).unlink(missing_ok=True)
            reply = _wait_for_result(directory, root, frame)
        if reply.get("error"):
            raise RuntimeError(reply["error"])
        result = {}
        for lane in ("hdr", "sdr"):
            image = memory.attach(lane_memory[lane])[..., :3].copy()
            if not np.isfinite(image).all():
                raise ValueError("GPU delivery returned invalid pixels.")
            result[lane] = image
        frame._delivery_timings = reply.get("timings_ms", {})
        frame._raw_measurements = reply.get("raw_measurements")
        record = {"renderer": "gpu", "fallback_reason": None}
        from .library_diagnostics import log
        log("gpu_delivery_rendered", width=output[0], height=output[1], priority=getattr(frame, "delivery_priority", 20),
            total_ms=reply.get("total_ms"), **{k: round(v, 1) for k, v in reply.get("timings_ms", {}).items()})
    except (OSError, ValueError, RuntimeError) as error:
        record = {"renderer": "cpu", "fallback_reason": str(error)}
    finally:
        if directory is not None:
            with _lock:
                _sessions.pop(directory.name, None)
            try: (directory / "cancelled").touch()
            except OSError: pass
            shutil.rmtree(directory, ignore_errors=True)
        memory.close()
        frame._delivery_record = record
        owner._delivery_record = record
        frame._delivery_cache = owner._delivery_cache = (signature, result, record)
    return result



def render_raw_picture(path, document, edge, priority=15, cancelled=None):
    """Full sensor development followed by saved-grade delivery, with no CPU decode.

    Reduced scene pixels also reach the backend in RAM for Grade's geometry,
    Denoise and local-mask source readers. Full sensor pixels never leave the GPU.
    Failure returns a reason to the caller, which retains the ordinary CPU path.
    """
    from . import library_gpu_raw
    from .delivery import preferences
    from .library_kept import render_source_edge
    from .library_diagnostics import log
    from .models import ExportSettings, OutputFinishingSettings, SourceInterpretationOverride
    from .sessions import _sha256_file
    started = time.perf_counter()
    try:
        if preferences()["effective_force_cpu"]:
            raise library_gpu_raw.NotEligible("CPU delivery was requested.")
        root = Path(os.environ[ROOT_ENV]) if os.environ.get(ROOT_ENV) else None
        if root is None or not (root / "heartbeat").exists() or _age(root / "heartbeat") > 5:
            raise library_gpu_raw.NotEligible("The GPU delivery renderer is unavailable.")
        if document.interpretation_override != SourceInterpretationOverride():
            raise library_gpu_raw.NotEligible("The saved source has a custom interpretation.")
        source_identity = library_gpu_raw._identity(Path(path))
        fingerprint = _sha256_file(Path(path))
        if document.source.fingerprint_sha256 and fingerprint != document.source.fingerprint_sha256:
            raise ValueError("The source photo changed; its Library picture was left unavailable.")
        header, parts = library_gpu_raw.sensor(Path(path), document.source.raw_import_settings)
        if header["identity"] != source_identity:
            raise ValueError("Photo changed while its Library picture was being developed.")
        full_height, full_width = (header["width"], header["height"]) if header["flip"] in (5, 6) else (header["height"], header["width"])
        reduced_edge = render_source_edge(full_width, full_height, document.global_adjustments.shared.geometry, edge)
        scale = min(1., reduced_edge / max(full_width, full_height))
        width, height = max(1, round(full_width * scale)), max(1, round(full_height * scale))
        settings = ExportSettings(output_finishing=OutputFinishingSettings(resize_mode="long_edge", long_edge=edge))
        adjustments = document.global_adjustments.model_copy(deep=True)
        adjustments.shared.overlay_mode = "off"
        for lane in ("hdr", "sdr"):
            getattr(adjustments, lane).film_look.halation_view_map = False
            getattr(adjustments, lane).film_look.grain_view_map = False
        source_ms = (time.perf_counter() - started) * 1000
        frame = SimpleNamespace(image=np.empty((height, width, 3), dtype=np.float32),
            adjustments=adjustments, local_adjustments=document.local_adjustments, denoise=document.denoise,
            hdr_reference_white_nits=document.hdr_reference_white_nits, delivery_priority=priority,
            delivery_cancelled=cancelled or (lambda: False),
            raw_development={"body": library_gpu_raw.frame(header, *parts), "edge": reduced_edge,
                "flip": header["flip"], "width": header["width"], "height": header["height"]})
        del parts
        rendered = render_pair(frame, settings, adjustments)
        if rendered is None:
            raise library_gpu_raw.NotEligible(frame._delivery_record["fallback_reason"])
        if library_gpu_raw._identity(Path(path)) != header["identity"]:
            raise ValueError("Photo changed while its Library picture was being developed.")
        return {"lanes": rendered, "source_width": full_width, "source_height": full_height,
            "source_ms": source_ms, "render_ms": (time.perf_counter()-started)*1000-source_ms,
            "measurements": frame._raw_measurements, "timings_ms": frame._delivery_timings}
    except (library_gpu_raw.NotEligible, OSError, RuntimeError) as error:
        log("kept_gpu_raw_fallback", path=str(path), reason=str(error))
        return None


def _wait_for_result(directory, root, frame):
    # Queue time is not render time: a job waiting behind Library pictures
    # or another export keeps waiting while the renderer is alive. Only a
    # claimed job has a render deadline.
    deadline = None
    while not (directory / "result.json").exists():
        if getattr(frame, "delivery_cancelled", lambda: False)():
            from concurrent.futures import CancelledError
            raise CancelledError("Delivery cancelled.")
        if deadline is None and (directory / "claimed").exists():
            deadline = time.monotonic() + RENDER_DEADLINE_SECONDS
        if (deadline is not None and time.monotonic() > deadline) or not (root / "heartbeat").exists() or time.time() - (root / "heartbeat").stat().st_mtime > 10:
            raise RuntimeError("The GPU delivery renderer stopped or timed out.")
        time.sleep(.03)
    return json.loads((directory / "result.json").read_text(encoding="utf-8"))


def create_gpu_delivery_router():
    # Set before any Library/batch children are spawned; they inherit this one
    # app-owned spool, including in frozen builds.
    root = Path(tempfile.mkdtemp(prefix="hdr-gpu-delivery-"))
    os.environ[ROOT_ENV] = str(root)
    _remove_stale_roots(root)
    atexit.register(shutil.rmtree, root, ignore_errors=True)
    router = APIRouter(prefix="/api/delivery/gpu")
    active = {}

    def accounting():
        now = time.monotonic()
        for key in list(_clients):
            if _clients[key]["expires"] < now: _clients.pop(key, None)
        values = list(_clients.values())
        _activity.update(until=max((v["until"] for v in values), default=0.),
            bytes=sum(v["bytes"] for v in values),
            budget=min((v["budget"] for v in values), default=536870912))
        # Cancelled workers remove their spool. Never retain its session/mmap.
        for key, (directory, value) in list(active.items()):
            if not directory.exists() or (directory / "cancelled").exists():
                active.pop(key, None)
                with _lock: _sessions.pop(key, None)
        _sweep(root, active)

    @router.post("/activity")
    async def activity(request: Request):
        value = await request.json()
        key = str(value.get("id", "grade"))[:80]
        _clients[key] = {"expires": time.monotonic() + 2,
            "until": time.monotonic() + .25 if value.get("active") else 0.,
            "bytes": max(0, int(value.get("bytes", 0))),
            "budget": max(0, int(value.get("budget", 536870912)))}
        accounting()
        reserved = sum(v[1].get("reservation", 0) for v in active.values())
        return {"reserved": reserved,
            "budget": max(0, _activity["budget"] - _activity["bytes"] + _clients[key]["bytes"] - reserved)}

    @router.get("/permit")
    def permit(identity: str | None = None):
        (root / "heartbeat").touch()
        accounting()
        higher = False
        priority_reason = None
        if identity in active:
            # Compare waiting-adjusted priorities, so a job that waited its
            # turn is not interrupted by each newly queued Library picture.
            now = time.time()
            current_priority = _effective_priority(active[identity][1], now)
            for path in root.glob("delivery-*/request.json"):
                if (path.parent / "claimed").exists() or (path.parent / "cancelled").exists(): continue
                try:
                    if _effective_priority(json.loads(path.read_text(encoding="utf-8")), now) < current_priority:
                        higher = True
                        priority_reason = "A higher-priority delivery needs the GPU."
                        break
                except (OSError, ValueError, KeyError): continue
        preempt = time.monotonic() < _activity["until"] or higher
        return {"cancelled": bool(identity and identity not in active),
            "reason": priority_reason if higher else "GPU delivery released the shared memory budget for Grade.",
            "preempt": preempt, "ready": not preempt,
            "idle": not active and not any(root.glob("delivery-*/request.json")),
            "budget": max(0, _activity["budget"] - _activity["bytes"])}

    @router.get("/next")
    def next_job():
        (root / "heartbeat").touch()
        accounting()
        if time.monotonic() < _activity["until"] or active:
            return None
        candidates = []
        for path in root.glob("delivery-*/request.json"):
            if not (path.parent / "claimed").exists() and not (path.parent / "cancelled").exists():
                try: candidates.append((json.loads(path.read_text(encoding="utf-8")), path.parent))
                except (OSError, ValueError): continue
        if not candidates:
            return None
        now = time.time()
        value, directory = min(candidates, key=lambda pair: (_effective_priority(pair[0], now), pair[0]["created"]))
        (directory / "claimed").touch()
        memory = DeliveryMemory()
        image = memory.attach(value["memory"]["source"])
        reference = memory.attach(value["memory"]["reference"]) if value["memory"]["reference"] else None
        context = RenderColorContext(value["white"])
        frame = SimpleNamespace(_delivery_memory=memory, session_id=value["id"], image=image, sdr_reference_image=reference,
            source=SimpleNamespace(width=value["width"], height=value["height"]),
            adjustments=AdjustmentState.model_validate(value["adjustments"]),
            local_adjustments=[LocalAdjustment.model_validate(v) for v in value["locals"]],
            denoise=DenoiseDocumentSettings.model_validate(value["denoise"]),
            hdr_reference_white_nits=value["white"], color_context=context, edit_revision=0,
            render_cache=SessionRenderCache(image, reference, color_context=context))
        with _lock: _sessions[value["id"]] = frame
        active[value["id"]] = (directory, value)
        value["budget"] = max(0, _activity["budget"] - _activity["bytes"])
        return {key: item for key, item in value.items() if key != "memory"}

    @router.get("/{identity}/raw-sensor")
    def raw_sensor(identity: str):
        item = active.get(identity)
        if item is None or not item[1].get("raw"):
            raise HTTPException(404, "GPU RAW job expired.")
        with DeliveryMemory() as memory:
            body = memory.attach(item[1]["memory"]["raw"]).tobytes()
        return Response(body, media_type="application/octet-stream")

    @router.post("/{identity}/raw-developed")
    async def raw_developed(identity: str, request: Request):
        item = active.get(identity)
        frame = session(identity)
        if item is None or frame is None or not item[1].get("raw"):
            raise HTTPException(404, "GPU RAW job expired.")
        from .library_gpu_raw import unframe, _orient
        header, body = unframe(await request.body())
        height, width = item[1]["height"], item[1]["width"]
        flip = item[1]["raw"]["flip"]
        sensor_shape = (width, height) if flip in (5, 6) else (height, width)
        if len(body) != height * width * 12:
            raise HTTPException(400, "Incorrect developed RAW size.")
        planes = np.frombuffer(body, dtype="<f4").reshape(3, *sensor_shape)
        pixels = _orient(planes.transpose(1, 2, 0), flip)
        if not np.isfinite(pixels).all():
            raise HTTPException(400, "Invalid developed RAW pixels.")
        np.copyto(frame.image, pixels)
        item[1]["raw_measurements"] = header
        return Response(status_code=204)

    @router.post("/{identity}/reserve")
    async def reserve(identity: str, request: Request):
        accounting()
        if identity not in active: raise HTTPException(404, "GPU delivery job expired.")
        requested = max(0, int((await request.json())["bytes"]))
        if requested > max(0, _activity["budget"] - _activity["bytes"]):
            raise HTTPException(409, "Grade needs the shared GPU budget.")
        active[identity][1]["reservation"] = requested
        return {}

    @router.post("/{identity}/pixels/{lane}")
    async def pixels(identity: str, lane: str, request: Request):
        if identity not in active or lane not in {"hdr", "sdr"}:
            raise HTTPException(404, "GPU delivery job expired.")
        directory, value = active[identity]
        with DeliveryMemory() as memory:
            pixels = memory.attach(value["memory"][lane]).view(np.uint8).reshape(-1)
            offset = 0
            async for body in request.stream():
                if offset + len(body) > pixels.size:
                    raise HTTPException(400, "Incorrect delivery pixel size.")
                pixels[offset:offset + len(body)] = np.frombuffer(body, dtype=np.uint8)
                offset += len(body)
            if offset != pixels.size:
                raise HTTPException(400, "Incorrect delivery pixel size.")
        value.setdefault("received", []).append(lane)
        return Response(status_code=204)

    @router.post("/{identity}/complete")
    async def complete(identity: str, request: Request):
        item = active.pop(identity, None)
        if item:
            with _lock: _sessions.pop(identity, None)
            directory, value = item
            reply = await request.json()
            if value.get("raw") and not reply.get("error"):
                if not value.get("raw_measurements"):
                    reply = {"error": "GPU RAW development was incomplete."}
                else:
                    reply["raw_measurements"] = value["raw_measurements"]
            if not reply.get("error") and set(value.get("received", [])) != {"hdr", "sdr"}:
                reply = {"error": "GPU delivery returned incomplete lanes."}
            if directory.exists(): _atomic(directory / "result.json", reply)
        return {}
    return router
