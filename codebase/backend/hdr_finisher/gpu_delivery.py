"""Private spool between delivery workers and the hidden Electron renderer.

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

ROOT_ENV = "HDR_FINISHER_GPU_DELIVERY_SPOOL"
_sessions = {}
_lock = RLock()
_clients = {}
_activity = {"until": 0., "bytes": 0, "budget": 536870912}


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
    try:
        if policy["effective_force_cpu"]:
            return None
        if root is None or not (root / "heartbeat").exists() or time.time() - (root / "heartbeat").stat().st_mtime > 5:
            raise RuntimeError("The GPU delivery renderer is unavailable.")
        identity = "delivery-" + uuid4().hex
        directory = root / identity
        directory.mkdir()
        np.save(directory / "source.npy", frame.image, allow_pickle=False)
        reference = getattr(frame, "sdr_reference_image", None)
        if reference is not None:
            np.save(directory / "reference.npy", reference, allow_pickle=False)
        from .finishing import geometry_output_dimensions, resolve_output_dimensions
        height, width = frame.image.shape[:2]
        output = resolve_output_dimensions(*geometry_output_dimensions(width, height, adjustments.shared.geometry), settings.output_finishing)
        _atomic(directory / "request.json", {
            "id": identity, "width": width, "height": height, "output": output,
            "white": getattr(frame, "hdr_reference_white_nits", 203), "adjustments": adjustments.model_dump(mode="json"),
            "locals": [v.model_dump(mode="json") for v in adjustments.enabled_locals(getattr(frame, "local_adjustments", []))],
            "denoise": (getattr(frame, "denoise", None) or DenoiseDocumentSettings()).model_dump(mode="json"),
            "finishing": settings.output_finishing.model_dump(mode="json"),
            "priority": getattr(frame, "delivery_priority", 20), "created": time.time()})
        deadline = time.monotonic() + 180
        while not (directory / "result.json").exists():
            if getattr(frame, "delivery_cancelled", lambda: False)():
                from concurrent.futures import CancelledError
                raise CancelledError("Delivery cancelled.")
            if time.monotonic() > deadline or not (root / "heartbeat").exists() or time.time() - (root / "heartbeat").stat().st_mtime > 10:
                raise RuntimeError("The GPU delivery renderer stopped or timed out.")
            time.sleep(.03)
        reply = json.loads((directory / "result.json").read_text(encoding="utf-8"))
        if reply.get("error"):
            raise RuntimeError(reply["error"])
        result = {}
        for lane in ("hdr", "sdr"):
            image = np.fromfile(directory / (lane + ".bin"), dtype="<f4").reshape(output[1], output[0], 4)[..., :3].copy()
            if not np.isfinite(image).all():
                raise ValueError("GPU delivery returned invalid pixels.")
            result[lane] = image
        record = {"renderer": "gpu", "fallback_reason": None}
    except (OSError, ValueError, RuntimeError) as error:
        record = {"renderer": "cpu", "fallback_reason": str(error)}
    finally:
        if directory is not None:
            with _lock:
                _sessions.pop(directory.name, None)
            try: (directory / "cancelled").touch()
            except OSError: pass
            shutil.rmtree(directory, ignore_errors=True)
        frame._delivery_record = record
        owner._delivery_record = record
        frame._delivery_cache = owner._delivery_cache = (signature, result, record)
    return result


def create_gpu_delivery_router():
    # Set before any Library/batch children are spawned; they inherit this one
    # app-owned spool, including in frozen builds.
    root = Path(tempfile.mkdtemp(prefix="hdr-gpu-delivery-"))
    os.environ[ROOT_ENV] = str(root)
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
        return {"cancelled": bool(identity and identity not in active),
            "preempt": time.monotonic() < _activity["until"], "ready": time.monotonic() >= _activity["until"],
            "budget": max(0, _activity["budget"] - _activity["bytes"])}

    @router.get("/next")
    def next_job():
        (root / "heartbeat").touch()
        accounting()
        if time.monotonic() < _activity["until"] or active:
            return None
        candidates = []
        for path in root.glob("delivery-*/request.json"):
            if not (path.parent / "claimed").exists():
                try: candidates.append((json.loads(path.read_text(encoding="utf-8")), path.parent))
                except (OSError, ValueError): continue
        if not candidates:
            return None
        value, directory = min(candidates, key=lambda pair: (pair[0]["priority"], pair[0]["created"]))
        (directory / "claimed").touch()
        image = np.load(directory / "source.npy", mmap_mode="r", allow_pickle=False)
        reference = np.load(directory / "reference.npy", mmap_mode="r", allow_pickle=False) if (directory / "reference.npy").exists() else None
        context = RenderColorContext(value["white"])
        frame = SimpleNamespace(session_id=value["id"], image=image, sdr_reference_image=reference,
            source=SimpleNamespace(width=value["width"], height=value["height"]),
            adjustments=AdjustmentState.model_validate(value["adjustments"]),
            local_adjustments=[LocalAdjustment.model_validate(v) for v in value["locals"]],
            denoise=DenoiseDocumentSettings.model_validate(value["denoise"]),
            hdr_reference_white_nits=value["white"], color_context=context, edit_revision=0,
            render_cache=SessionRenderCache(image, reference, color_context=context))
        with _lock: _sessions[value["id"]] = frame
        active[value["id"]] = (directory, value)
        value["budget"] = max(0, _activity["budget"] - _activity["bytes"])
        return value

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
        body = await request.body()
        if len(body) != value["output"][0] * value["output"][1] * 16:
            raise HTTPException(400, "Incorrect delivery pixel size.")
        (directory / (lane + ".bin")).write_bytes(body)
        return Response(status_code=204)

    @router.post("/{identity}/complete")
    async def complete(identity: str, request: Request):
        item = active.pop(identity, None)
        if item:
            with _lock: _sessions.pop(identity, None)
            directory, _ = item
            if directory.exists(): _atomic(directory / "result.json", await request.json())
        return {}
    return router
