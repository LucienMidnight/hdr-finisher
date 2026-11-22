"""Memory pixel handoff between workers and the hidden Electron renderer.

Only the backend creates the spool. HTTP clients get opaque job IDs, never
filesystem paths. A worker publishes complete inputs atomically; both lanes
succeed together or the ordinary CPU graph renders both.
"""
from __future__ import annotations
import atexit
import asyncio
import json
import os
from pathlib import Path
import shutil
import tempfile
import time
from types import SimpleNamespace
from uuid import uuid4
from threading import RLock
from functools import wraps
from weakref import finalize
import numpy as np
from fastapi import APIRouter, HTTPException, Request, Response, WebSocket, WebSocketDisconnect
from .color_context import RenderColorContext
from .desktop_security import secret_matches
from .models import AdjustmentState, DenoiseDocumentSettings, LocalAdjustment
from .projects import validate_saved
from .render_cache import SessionRenderCache
from .delivery_memory import DeliveryMemory

ROOT_ENV = "HDR_FINISHER_GPU_DELIVERY_SPOOL"
GRAIN_TRIAL_ENV = "HDR_FINISHER_GPU_GRAIN_DELIVERY"
STREAMED_TRIAL_ENV = "HDR_FINISHER_GPU_STREAMED_DELIVERY"
STREAMED_HOST_BYTES = 160 * 1024**2
STREAMED_WRITE_ROWS = 32
CLEAN_LARGE_SDR_DEFAULT_MAX_PIXELS = 5202 * 3464
_sessions = {}
_borrowed_sources = {}
_router_pid = None
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
    if value.get("background"):
        return float("inf")
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


def grain_delivery_enabled(frame):
    return os.environ.get(GRAIN_TRIAL_ENV) == "1" and _uses_grain_reconstruction(frame)


def streamed_delivery_enabled(frame, settings, adjustments):
    from .exporters import denoise_settings_for_export
    from .finishing import resolve_output_dimensions
    from .models import GeometryAdjustments, PreviewKind
    from .photo_framing import delivery_layout

    if (settings.format not in {"jpeg_ultrahdr", "sdr_jpeg"} or
            adjustments.shared.geometry != GeometryAdjustments() or
            settings.output_finishing.sharpening != "off" or getattr(frame, "raw_development", None)):
        return False
    watermark = settings.watermark
    if watermark.mode != "off" and watermark.opacity and (watermark.text.strip() or watermark.mode == "rendition_test"):
        return False
    height, width = frame.image.shape[:2]
    if os.environ.get(STREAMED_TRIAL_ENV) != "1":
        if settings.format != "sdr_jpeg" or width * height > CLEAN_LARGE_SDR_DEFAULT_MAX_PIXELS:
            return False
        lane = denoise_settings_for_export(frame, PreviewKind.SDR)
        if (lane is None or lane.controls.method != "clean_grain" or not lane.controls.clean_color
                or lane.controls.splotch_size != "large"):
            return False
    reference = getattr(frame, "sdr_reference_image", None)
    return (frame.image.dtype == np.float32
            and (reference is None or reference.dtype == np.float32)
            and getattr(frame, "framing_source_size", None) in (None, (width, height))
            and max(width, height) <= 16384
            and resolve_output_dimensions(width, height, settings.output_finishing) == (width, height)
            and delivery_layout(frame, settings, adjustments) is None)


def _open_delivery_file(shape):
    from .config import APP_DATA_DIR
    from .library_cache import LibraryCache

    handle, release = LibraryCache(APP_DATA_DIR).open_grade_scratch(int(np.prod(shape)) * 4)
    return {"file": str(handle.name), "shape": shape}, handle, release


def _stage_delivery_source(image, resources):
    if image is None:
        return None
    description, handle, release = _open_delivery_file(image.shape)
    resources.append(release)
    for top in range(0, image.shape[0], STREAMED_WRITE_ROWS):
        band = np.ascontiguousarray(image[top:top + STREAMED_WRITE_ROWS], dtype="<f4")
        if handle.write(memoryview(band).cast("B")) != band.nbytes:
            raise OSError("Incomplete GPU source staging write.")
    return description


def _map_delivery_output(description, release):
    pixels = np.memmap(description["file"], mode="r", dtype="<f4", shape=tuple(description["shape"]))
    mapping = pixels._mmap

    def cleanup():
        mapping.close()
        release()

    finalize(pixels, cleanup)
    return pixels


def _uses_grain_reconstruction(frame):
    from .exporters import denoise_settings_for_export
    from .models import PreviewKind

    for kind in (PreviewKind.HDR, PreviewKind.SDR):
        lane = denoise_settings_for_export(frame, kind)
        if lane is not None and lane.controls.method == "clean_grain":
            return True
    return False


def _render_pair(frame, owner, settings, adjustments):
    from .delivery import log_delivery, preferences, renderer_record
    from .diagnostics import current_action
    from .exporters import denoise_settings_for_export
    from .models import PreviewKind

    if any((lane := denoise_settings_for_export(frame, kind)) is not None and lane.controls.method == "micro_grain"
           for kind in (PreviewKind.HDR, PreviewKind.SDR)):
        frame._delivery_record = {"renderer": "cpu", "fallback_reason": "Micro Grain uses the CPU delivery source."}
        return None
    try:
        policy = preferences()
    except (OSError, ValueError, AttributeError):
        log_delivery("delivery_route", route="cpu", reason="delivery_policy_unreadable", level="warn", format=settings.format)
        frame._delivery_record = renderer_record()
        return None
    from .finishing import geometry_output_dimensions
    native_size = getattr(frame, "framing_source_size", None) or geometry_output_dimensions(
        frame.image.shape[1], frame.image.shape[0], adjustments.shared.geometry)
    grain_reconstruction = _uses_grain_reconstruction(frame)
    streamed = streamed_delivery_enabled(frame, settings, adjustments)
    grain_trial = grain_reconstruction and (streamed or os.environ.get(GRAIN_TRIAL_ENV) == "1")
    lanes = ("sdr",) if streamed and settings.format == "sdr_jpeg" else ("hdr", "sdr")
    # Full-size Proof states this size and passes only enabled locals; export
    # derives the same size and passes all locals. Key on what is rendered so
    # both share one finished pair and one CPU fallback decision.
    from .exporters import denoise_delivery_key
    signature = (id(frame.image), id(getattr(frame, "sdr_reference_image", None)),
        adjustments.model_dump_json(), repr(adjustments.enabled_locals(getattr(frame, "local_adjustments", None))),
        denoise_delivery_key(frame), getattr(frame, "hdr_reference_white_nits", 203),
        settings.output_finishing.model_dump_json(), policy["effective_force_cpu"],
        settings.export_with_frame, repr(getattr(frame, "framing", None)),
        native_size, getattr(frame, "framing_output_limit", None), grain_trial, streamed, lanes)
    cached = getattr(owner, "_delivery_cache", None)
    if cached and cached[0] == signature:
        frame._delivery_cache = cached
        frame._delivery_record = cached[2]
        log_delivery("delivery_route", route=cached[2]["renderer"], reason="delivery_cache_hit", format=settings.format)
        return cached[1]
    result = None
    record = renderer_record()
    reason = "gpu_delivery_unavailable"
    root = Path(os.environ[ROOT_ENV]) if os.environ.get(ROOT_ENV) else None
    directory = None
    cacheable = True
    memory = DeliveryMemory()
    resources = []
    try:
        if policy["effective_force_cpu"]:
            reason = "cpu_delivery_policy"
            return None
        if getattr(settings, "_bounded_cpu_delivery", False):
            reason = "app_memory_ceiling"
            record = {"renderer": "cpu", "fallback_reason":
                "Native GPU delivery working set does not fit the existing app memory ceiling; using bounded CPU strips."}
            return None
        if grain_reconstruction and not grain_trial:
            # The log keeps the reason code; the export result says it in plain words.
            reason = "cpu_delivery_policy"
            record = {"renderer": "cpu", "fallback_reason":
                "Exported on the CPU. Graphics-card export for Clean Grain is still being tested."}
            return None
        if root is None or not (root / "heartbeat").exists() or time.time() - (root / "heartbeat").stat().st_mtime > 5:
            cacheable = False
            raise RuntimeError("The GPU delivery renderer is unavailable.")
        reference = getattr(frame, "sdr_reference_image", None)
        from .finishing import geometry_output_dimensions, resolve_output_dimensions
        height, width = frame.image.shape[:2]
        output = resolve_output_dimensions(*geometry_output_dimensions(width, height, adjustments.shared.geometry), settings.output_finishing)
        from .photo_framing import delivery_layout, layer_colors
        from .hdr_ceiling import delivery_ceiling_nits
        layout = delivery_layout(frame, settings, adjustments)
        photo_output = list(layout.photo[2:]) if layout else list(output)
        if layout:
            output = (layout.width, layout.height)
        raw = getattr(frame, "raw_development", None)
        if grain_trial and not streamed:
            from . import app_memory

            census = app_memory.snapshot()
            starting = max(app_memory.STARTING, census["totalBytes"] + census["reservedBytes"])
            required = (frame.image.nbytes + 288 * 1024**2
                        + 76 * max(width * height, output[0] * output[1])
                        + (reference.nbytes if reference is not None else 0)
                        + (len(raw["body"]) if raw else 0))
            if starting + required > app_memory.CEILING:
                record = {"renderer": "cpu", "fallback_reason":
                    "GPU Grain delivery working set does not fit the app memory ceiling."}
                return None
        reason = "gpu_delivery_failed"
        identity = "delivery-" + uuid4().hex
        directory = root / identity
        directory.mkdir()
        output_releases = {}
        file_sources = None
        if streamed:
            if _router_pid == os.getpid():
                with _lock: _borrowed_sources[identity] = (frame.image, reference)
            else:
                file_sources = [_stage_delivery_source(image, resources) for image in (frame.image, reference)]
            source_memory = reference_memory = None
            lane_memory = {}
            for lane in lanes:
                lane_memory[lane], _, release = _open_delivery_file((output[1], output[0], 3))
                resources.append(release)
                output_releases[lane] = release
        else:
            source_memory, _ = memory.allocate(frame.image.shape, None if raw else frame.image)
            reference_memory = memory.allocate(reference.shape, reference)[0] if reference is not None else None
            lane_memory = {lane: memory.allocate((output[1], output[0], 4))[0] for lane in lanes}
        raw_memory = None
        if raw:
            sensor_body = raw["body"]
            raw_memory, data = memory.allocate((len(sensor_body) // 4,))
            data.view(np.uint8)[:] = np.frombuffer(sensor_body, dtype=np.uint8)
        framing = None if layout is None else dict(layout.as_dict(), colors={
            lane: [color.tolist() for color in layer_colors(frame.framing, lane,
                getattr(frame, "hdr_reference_white_nits", 203), delivery_ceiling_nits(adjustments))]
            for lane in ("hdr", "sdr")})
        denoise = getattr(frame, "denoise", None) or DenoiseDocumentSettings()
        from .denoise_measurement import source_identity
        _atomic(directory / "request.json", {
            "memory": {"source": source_memory, "reference": reference_memory, "raw": raw_memory, **lane_memory},
            "file_sources": file_sources, "streamed": streamed, "lanes": lanes,
            "raw": {key: value for key, value in raw.items() if key != "body"} if raw else None,
            "id": identity, "action": current_action(), "width": width, "height": height, "output": output,
            "photo_output": photo_output, "framing": framing,
            # With an authored SDR base the SDR lane has its own source pixels.
            "authored_sdr": reference is not None,
            "white": getattr(frame, "hdr_reference_white_nits", 203), "adjustments": adjustments.model_dump(mode="json"),
            "locals": [v.model_dump(mode="json") for v in adjustments.enabled_locals(getattr(frame, "local_adjustments", []))],
            "denoise": denoise.model_dump(mode="json"), "denoise_source_identity": source_identity(frame),
            "grain_reconstruction": grain_trial,
            "finishing": settings.output_finishing.model_dump(mode="json"),
            "priority": getattr(frame, "delivery_priority", 20), "created": time.time()})
        reply = _wait_for_result(directory, root, frame)
        if reply.get("error") in PREEMPTED_REASONS:
            log_delivery("delivery_retry", level="warn", route="gpu", reason="gpu_preempted", retry_count=1)
            # Give the GPU back, then wait for another turn with the same
            # request (and its original queue time).
            for name in ("result.json", "claimed"):
                (directory / name).unlink(missing_ok=True)
            reply = _wait_for_result(directory, root, frame)
        if reply.get("error"):
            if reply["error"] in PREEMPTED_REASONS:
                reason = "gpu_preempted"
            raise RuntimeError(reply["error"])
        images = {}
        for lane in lanes:
            if streamed:
                release = output_releases[lane]
                image = _map_delivery_output(lane_memory[lane], release)
                resources.remove(release)
            else:
                image = memory.attach(lane_memory[lane])[..., :3].copy()
                if not np.isfinite(image).all():
                    raise ValueError("GPU delivery returned invalid pixels.")
            images[lane] = image
        result = images
        frame._delivery_timings = reply.get("timings_ms", {})
        frame._raw_measurements = reply.get("raw_measurements")
        record = {"renderer": "gpu", "fallback_reason": None}
        reason = "gpu_delivery_succeeded"
        from .library_diagnostics import log
        log("gpu_delivery_rendered", width=output[0], height=output[1], priority=getattr(frame, "delivery_priority", 20),
            total_ms=reply.get("total_ms"), **{k: round(v, 1) for k, v in reply.get("timings_ms", {}).items()})
    except (OSError, ValueError, RuntimeError) as error:
        record = {"renderer": "cpu", "fallback_reason": str(error)}
    finally:
        if directory is not None:
            with _lock:
                _sessions.pop(directory.name, None)
                _borrowed_sources.pop(directory.name, None)
            try: (directory / "cancelled").touch()
            except OSError: pass
            shutil.rmtree(directory, ignore_errors=True)
        memory.close()
        for release in resources:
            release()
        log_delivery("delivery_route", route=record["renderer"], reason=reason, format=settings.format,
                   level="warn" if reason in {"gpu_delivery_unavailable", "gpu_delivery_failed", "gpu_preempted"} else "info",
                   width_px=native_size[0], height_px=native_size[1])
        frame._delivery_record = record
        owner._delivery_record = record
        frame._delivery_cache = owner._delivery_cache = (signature, result, record) if cacheable else None
    return result



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
    global _router_pid
    _router_pid = os.getpid()
    root = Path(tempfile.mkdtemp(prefix="hdr-gpu-delivery-"))
    os.environ[ROOT_ENV] = str(root)
    _remove_stale_roots(root)
    atexit.register(shutil.rmtree, root, ignore_errors=True)
    router = APIRouter(prefix="/api/delivery/gpu")
    active = {}
    raw_jobs = {}
    from . import app_memory
    from .library_scheduler import scheduler
    budget_lock = scheduler.lock
    scheduler.gpu_draw_room = 640*640*64 + 64*1024*1024

    def budget_locked(function):
        @wraps(function)
        def call(*args, **kwargs):
            with budget_lock: return function(*args, **kwargs)
        return call

    def waiting_deliveries():
        for path in root.glob("delivery-*/request.json"):
            if (path.parent / "claimed").exists() or (path.parent / "cancelled").exists(): continue
            try: yield json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError): continue

    def raw_reserved():
        return sum(v["bytes"] for v in raw_jobs.values() if v["granted"])

    def accounting():
        now = time.monotonic()
        for key, value in list(raw_jobs.items()):
            if value["expires"] < now: raw_jobs.pop(key, None)
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
                if value.get("streamed"):
                    app_memory.admit(key, 0, release=True)
        _sweep(root, active)
        deliveries = list(waiting_deliveries())
        if deliveries or active or time.monotonic() < _activity["until"]:
            scheduler.preempt_gpu()
        scheduler.update_gpu(_activity["budget"], _activity["bytes"] + raw_reserved()
                             + sum(v[1].get("reservation", 0) for v in active.values()),
                             bool(deliveries or active or time.monotonic() < _activity["until"]))

    @router.post("/activity")
    async def activity(request: Request):
        value = await request.json()
        with budget_lock:
            key = str(value.get("id", "grade"))[:80]
            _clients[key] = {"expires": time.monotonic() + 2,
                "until": time.monotonic() + .25 if value.get("active") else 0.,
                "bytes": max(0, int(value.get("bytes", 0))),
                "budget": max(0, int(value.get("budget", 536870912)))}
            accounting()
            reserved = scheduler.gpu_reserved() + raw_reserved() + sum(v[1].get("reservation", 0) for v in active.values())
            return {"reserved": reserved,
                "budget": max(0, _activity["budget"] - _activity["bytes"] + _clients[key]["bytes"] - reserved)}

    @router.post("/raw-budget/{identity}")
    async def raw_budget(identity: str, request: Request):
        payload = await request.json()
        with budget_lock:
            accounting()
            now = time.time()
            if payload.get("grant"):
                amount = max(0, int(payload["bytes"]))
                job = scheduler.jobs.get(str(payload["grant"]))
                if job is None or job.granted is None or not job.gpu_bytes:
                    return {"granted": False, "preempt": True, "retry": True}
                if payload.get("retain"):
                    # Transfer ownership of the one selected scene, without a
                    # second reservation or any change to the approved estimate.
                    if amount > job.gpu_bytes:
                        return {"granted": False, "preempt": True}
                    raw_jobs[identity] = {"priority": 15, "created": now,
                        "granted": True, "bytes": amount, "background": True,
                        "library_priority": 0, "concurrent": True, "draw": True, "retained": True,
                        "expires": time.monotonic() + 30}
                    job.gpu_bytes = 0
                    accounting()
                    return {"granted": True, "budget": scheduler.gpu_budget}
                if job is None or not scheduler.gpu_refine(job.id, amount):
                    return {"granted": False, "preempt": True,
                            "fallback": "GPU descriptor exceeded or lost its atomic reservation"}
                waiting = bool(list(waiting_deliveries()) or active or time.monotonic() < _activity["until"]
                               or scheduler.gpu_reserved()+scheduler.gpu_external > scheduler.gpu_budget)
                if waiting and not hasattr(job, "gpu_preempted_at"):
                    job.gpu_preempted_at = time.monotonic()
                return {"granted": True, "preempt": waiting, "budget": scheduler.gpu_budget,
                        "reason": "Grade or export needs the GPU" if waiting else None}
            value = raw_jobs.setdefault(identity, {"priority": 15, "created": now,
                "granted": False, "bytes": 0})
            value.update(expires=time.monotonic() + 30, bytes=max(0, int(payload["bytes"])),
                background=bool(payload.get("background")),
                library_priority=max(0, min(100, int(payload.get('priority', 15)))),
                concurrent=bool(payload.get('concurrent') and payload.get('background')), draw=bool(payload.get("draw")))
            if payload.get("release"): value["granted"] = False
            available = max(0, _activity["budget"] - _activity["bytes"])
            if value["bytes"] > available:
                # Resident Grade resources count even when its controls are idle.
                return {"granted": False, "preempt": True, "budget": available, "waiting": "memory"}
            priority = _effective_priority(value, now)
            higher = any(_effective_priority(v, now) < priority for v in waiting_deliveries())
            order = lambda job: (_effective_priority(job, now), job['library_priority'], job['created'])
            reserved = raw_reserved() + scheduler.gpu_reserved()
            # Only Library developments share spare memory. Selected work gets
            # the next reservation when sharing cannot fit; draws stay exclusive.
            for other in raw_jobs.values():
                # A development that cannot fit owns no reservation and must
                # not block a smaller cached draw that can fit now.
                if not other['granted'] and other['bytes'] > available: continue
                if other is value or order(other) >= order(value): continue
                can_share = value['draw'] or (value['concurrent'] and (other['concurrent'] or other.get('draw')))
                if not can_share or (not other['granted'] and (not value['granted'] or reserved + other['bytes'] > available)):
                    higher = True
            preempt = (time.monotonic() < _activity["until"] or higher
                       or (value.get("retained") and (list(waiting_deliveries())
                           or reserved > available)))
            sharing = value['draw'] or (value['concurrent'] and all(v['concurrent'] or v.get('draw') for v in raw_jobs.values() if v['granted']))
            if not value["granted"] and not payload.get("release") and not preempt and not active and value['bytes'] + reserved <= available and (not reserved or sharing):
                value["granted"] = True
            return {"granted": value["granted"], "preempt": preempt or bool(active), "budget": available,
                    "available": max(0, available - reserved + (value["bytes"] if value["granted"] else 0))}

    @router.delete("/raw-budget/{identity}")
    @budget_locked
    def raw_release(identity: str):
        raw_jobs.pop(identity, None)
        return {}

    @router.get("/permit")
    @budget_locked
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
            if any(_effective_priority(v, now) < current_priority for v in raw_jobs.values()):
                higher = True
                priority_reason = "A higher-priority delivery needs the GPU."
            for path in root.glob("delivery-*/request.json"):
                if (path.parent / "claimed").exists() or (path.parent / "cancelled").exists(): continue
                try:
                    if _effective_priority(json.loads(path.read_text(encoding="utf-8")), now) < current_priority:
                        higher = True
                        priority_reason = "A higher-priority delivery needs the GPU."
                        break
                except (OSError, ValueError, KeyError): continue
        preempt = time.monotonic() < _activity["until"] or higher
        if identity in active and active[identity][1].get("streamed") and active[identity][1].get("reservation"):
            app_memory.admit(identity, active[identity][1]["reservation"] + STREAMED_HOST_BYTES)
        return {"cancelled": bool(identity and identity not in active),
            "reason": priority_reason if higher else "GPU delivery released the shared memory budget for Grade.",
            "preempt": preempt, "ready": not preempt,
            # The selected photo's retained scene is the Library's own picture,
            # not other GPU work. Counting it kept the Library dropping and
            # redrawing its picture in a loop while zoomed.
            "idle": not active and not any(not job.get("retained") for job in raw_jobs.values())
                and not any(root.glob("delivery-*/request.json")),
            "budget": max(0, _activity["budget"] - _activity["bytes"])}

    @router.get("/next")
    @budget_locked
    def next_job():
        (root / "heartbeat").touch()
        accounting()
        if time.monotonic() < _activity["until"] or active or raw_reserved() or scheduler.gpu_reserved():
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
        if value.get("operation") in {"edge_colour", "dng_correction", "retouch"}:
            active[value["id"]] = (directory, value)
            value["budget"] = max(0, _activity["budget"] - _activity["bytes"])
            return {key: item for key, item in value.items() if key != "memory"}
        memory = DeliveryMemory()
        if value.get("streamed"):
            with _lock: borrowed = _borrowed_sources.get(value["id"])
            if borrowed is not None:
                image, reference = borrowed
            else:
                image, reference = (np.memmap(source["file"], mode="r", dtype="<f4", shape=tuple(source["shape"]))
                                    if source else None for source in value["file_sources"])
        else:
            image = memory.attach(value["memory"]["source"])
            reference = memory.attach(value["memory"]["reference"]) if value["memory"]["reference"] else None
        context = RenderColorContext(value["white"])
        from .models import EditDocument
        saved = validate_saved(EditDocument, {
            "source": {"filename": "Queued photo", "luminance": {"luminance_semantics": "scene_relative", "transfer_function": "linear"}},
            "hdr_reference_white_nits": value["white"], "global_adjustments": value["adjustments"],
            "local_adjustments": value["locals"], "denoise": value["denoise"]})
        if getattr(saved, "_saved_grade_notice", None):
            value["grade_notice"] = saved._saved_grade_notice
        value.update(adjustments=saved.global_adjustments.model_dump(mode="json"),
                     locals=[item.model_dump(mode="json") for item in saved.local_adjustments],
                     denoise=saved.denoise.model_dump(mode="json"))
        frame = SimpleNamespace(_delivery_memory=memory, session_id=value["id"], image=image, sdr_reference_image=reference,
            source=SimpleNamespace(width=value["width"], height=value["height"]),
            adjustments=validate_saved(AdjustmentState, value["adjustments"]),
            local_adjustments=[validate_saved(LocalAdjustment, v) for v in value["locals"]],
            denoise=validate_saved(DenoiseDocumentSettings, value["denoise"]),
            hdr_reference_white_nits=value["white"], color_context=context, edit_revision=0,
            denoise_source_identity=value.get("denoise_source_identity"),
            render_cache=SessionRenderCache(image, reference, color_context=context))
        with _lock: _sessions[value["id"]] = frame
        active[value["id"]] = (directory, value)
        value["budget"] = max(0, _activity["budget"] - _activity["bytes"])
        if value.get("streamed"):
            census = app_memory.snapshot()
            starting = max(app_memory.STARTING, census["totalBytes"] + census["reservedBytes"])
            value["budget"] = min(value["budget"], max(0, app_memory.CEILING - starting - STREAMED_HOST_BYTES))
            from .library_diagnostics import log
            log("gpu_delivery_streamed_admission", starting_bytes=starting, host_transfer_bytes=STREAMED_HOST_BYTES,
                gpu_budget_bytes=value["budget"], ceiling_bytes=app_memory.CEILING)
        return {key: item for key, item in value.items() if key not in {"memory", "file_sources"}}

    @router.get("/{identity}/dng-source")
    def dng_source(identity: str):
        item = active.get(identity)
        if item is None or item[1].get("operation") != "dng_correction":
            raise HTTPException(404, "GPU DNG job expired.")
        with DeliveryMemory() as memory:
            body = memory.attach(item[1]["memory"]["dng_input"]).tobytes()
        return Response(body, media_type="application/octet-stream")

    @router.get("/{identity}/retouch-source")
    def retouch_source(identity: str):
        item = active.get(identity)
        if item is None or item[1].get("operation") != "retouch":
            raise HTTPException(404, "GPU repair job expired.")
        with DeliveryMemory() as memory:
            body = memory.attach(item[1]["memory"]["retouch_input"]).tobytes()
        return Response(body, media_type="application/octet-stream")

    @router.get("/{identity}/edge-source")
    def edge_source(identity: str):
        item = active.get(identity)
        if item is None or item[1].get("operation") != "edge_colour":
            raise HTTPException(404, "GPU edge-colour job expired.")
        with DeliveryMemory() as memory:
            body = memory.attach(item[1]["memory"]["edge_input"]).tobytes()
        return Response(body, media_type="application/octet-stream")

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
        requested = max(0, int((await request.json())["bytes"]))
        with budget_lock:
            accounting()
            if identity not in active: raise HTTPException(404, "GPU delivery job expired.")
            if requested > max(0, _activity["budget"] - _activity["bytes"]):
                raise HTTPException(409, "Grade needs the shared GPU budget.")
            value = active[identity][1]
            if value.get("streamed") and (requested > value["budget"] or
                    not app_memory.admit(identity, requested + STREAMED_HOST_BYTES)["granted"]):
                raise HTTPException(507, "GPU delivery working set does not fit the app memory ceiling.")
            value["reservation"] = requested
            return {}

    @router.websocket("/{identity}/rows/{lane}")
    async def stream_pixels(identity: str, lane: str, socket: WebSocket):
        from .adjustments import _enforce_exact_hdr_output_target
        from .hdr_ceiling import delivery_ceiling_nits

        secret = os.environ.get("HDR_FINISHER_DESKTOP_SECRET")
        origin = socket.headers.get("origin")
        item = active.get(identity)
        frame = session(identity)
        if ((secret and not secret_matches(socket.headers.get("x-hdr-finisher-token"), secret))
                or (origin and origin.split("://", 1)[-1] != socket.headers.get("host"))
                or not item or frame is None or not item[1].get("streamed") or lane not in item[1]["lanes"]):
            await socket.close(code=1008)
            return
        _, value = item
        received = value.setdefault("received", [])
        if value.get("uploading") or value["lanes"][len(received):len(received) + 1] != [lane]:
            await socket.close(code=1008)
            return
        value["uploading"] = lane
        try:
            await socket.accept()
            width, height = value["output"]
            next_row = 0
            ceiling = delivery_ceiling_nits(frame.adjustments) if lane == "hdr" else None
            with open(value["memory"][lane]["file"], "r+b", buffering=0) as stream:
                while next_row < height:
                    body = await asyncio.wait_for(socket.receive_bytes(), timeout=20)
                    rows, remainder = divmod(len(body) - 4, width * 16)
                    row = int.from_bytes(body[:4], "little")
                    if (identity not in active or remainder or row != next_row
                            or not 1 <= rows <= STREAMED_WRITE_ROWS or row + rows > height):
                        raise ValueError("Incorrect delivery pixel rows.")
                    rgb = np.ascontiguousarray(np.frombuffer(body, dtype="<f4", offset=4).reshape(rows, width, 4)[..., :3])
                    if not np.isfinite(rgb).all():
                        raise ValueError("GPU delivery returned invalid pixels.")
                    if ceiling is not None:
                        rgb = _enforce_exact_hdr_output_target(rgb, ceiling, value["white"])
                    if stream.write(memoryview(rgb).cast("B")) != rgb.nbytes:
                        raise OSError("Incomplete GPU encoder input write.")
                    next_row += rows
                    if next_row == height:
                        received.append(lane)
                        value["uploading"] = None
                    await socket.send_text("")
            await socket.close()
        except WebSocketDisconnect:
            pass
        except (KeyError, OSError, ValueError):
            await socket.close(code=1008)
        finally:
            if value.get("uploading") == lane:
                value["uploading"] = None

    @router.post("/{identity}/pixels/{lane}")
    async def pixels(identity: str, lane: str, request: Request, row: int | None = None, rows: int | None = None):
        if identity not in active or lane not in {"hdr", "sdr", "edge", "dng", "retouch"}:
            raise HTTPException(404, "GPU delivery job expired.")
        _, value = active[identity]
        if value.get("streamed") or lane not in value["memory"]:
            raise HTTPException(400, "Unexpected delivery lane.")
        if (row is not None or rows is not None) != bool(value.get("grain_reconstruction")):
            raise HTTPException(400, "Incorrect delivery pixel transport.")
        if row is not None or rows is not None:
            width, height = value["output"]
            next_rows = value.setdefault("next_rows", {})
            if (lane not in {"hdr", "sdr"} or row is None or rows is None
                or row != next_rows.get(lane, 0) or not (1 <= rows <= 32) or row + rows > height):
                raise HTTPException(400, "Incorrect delivery pixel rows.")
            start, stop = row * width * 16, (row + rows) * width * 16
        else:
            start, stop = 0, None
        with DeliveryMemory() as memory:
            pixels = memory.attach(value["memory"][lane]).view(np.uint8).reshape(-1)[start:stop]
            offset = 0
            async for body in request.stream():
                if offset + len(body) > pixels.size:
                    raise HTTPException(400, "Incorrect delivery pixel size.")
                pixels[offset:offset + len(body)] = np.frombuffer(body, dtype=np.uint8)
                offset += len(body)
            if offset != pixels.size:
                raise HTTPException(400, "Incorrect delivery pixel size.")
        if row is not None:
            next_rows[lane] = row + rows
        if row is None or next_rows[lane] == height:
            value.setdefault("received", []).append(lane)
        return Response(status_code=204)

    @router.post("/{identity}/complete")
    async def complete(identity: str, request: Request):
        item = active.pop(identity, None)
        if item:
            with _lock: _sessions.pop(identity, None)
            directory, value = item
            if value.get("streamed"):
                app_memory.admit(identity, 0, release=True)
            reply = await request.json()
            if value.get("raw") and not reply.get("error"):
                if not value.get("raw_measurements"):
                    reply = {"error": "GPU RAW development was incomplete."}
                else:
                    reply["raw_measurements"] = value["raw_measurements"]
            expected = {"retouch"} if value.get("operation") == "retouch" else {"dng"} if value.get("operation") == "dng_correction" else {"edge"} if value.get("operation") == "edge_colour" else set(value.get("lanes", ("hdr", "sdr")))
            if not reply.get("error") and set(value.get("received", [])) != expected:
                reply = {"error": "GPU delivery returned incomplete lanes."}
            # Batch workers are separate processes whose log lines don't reach
            # backend.log, so the GPU turn of every job is recorded here.
            from .library_diagnostics import log
            log("gpu_delivery_turn", priority=value.get("priority"), error=reply.get("error"),
                total_ms=reply.get("total_ms"), **{k: round(v, 1) for k, v in (reply.get("timings_ms") or {}).items()
                    if isinstance(v, (int, float))})
            if directory.exists(): _atomic(directory / "result.json", reply)
        return {}
    return router
