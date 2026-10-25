"""Stored scene transport shared by live Library and batch Export pictures.

Finishing edits never enter the scene identity. Grade's ordinary mask and
Denoise endpoints see a read-only view of the stored scene, not another RAW
import or a finished-picture file.
"""
from collections import OrderedDict
from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path
from threading import RLock, Condition
from types import SimpleNamespace

import numpy as np

from .color_context import RenderColorContext
from .library_pictures import LibraryPictureCache, reduce_picture
from .models import AdjustmentState, DenoiseDocumentSettings, LocalAdjustment, RawImportSettings, SourceInterpretationOverride
from .render_cache import SessionRenderCache, encode_rgba_proxy_rows

_registry = OrderedDict()
_registry_lock = RLock()


def recipe(document):
    document = document or {}
    return {
        "raw_import_settings": document.get("source", {}).get("raw_import_settings") or RawImportSettings().model_dump(mode="json"),
        "interpretation_override": document.get("interpretation_override") or SourceInterpretationOverride().model_dump(mode="json"),
        "hdr_reference_white_nits": document.get("hdr_reference_white_nits", 203),
        "repairs": document.get("repairs", []),
    }


def quality(document):
    from .loader import SOURCE_DECODER_VERSION, SOURCE_COLOR_TRANSFORM_VERSION
    identity = {"recipe": recipe(document), "decoder": SOURCE_DECODER_VERSION,
                "colour": SOURCE_COLOR_TRANSFORM_VERSION, "rgb_adapter": "library-rgb-v3"}
    return "live-scene-v2:" + sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()


def _develop_cpu(root, path, document, edge, cancelled=None, cache=None, progress=None):
    """One existing full development produces both stored sizes; no CPU finishing."""
    from .sessions import SessionStore
    from .models import EditDocument
    cache = cache or LibraryPictureCache(root)
    source_quality = quality(document)
    cached = cache.cached(path, edge, source_quality)
    if cached:
        return cached
    inputs = recipe(document)
    from .highlight_edge_gpu import source_work
    with source_work(priority=15, cancelled=cancelled):
        source = SessionStore().prepare_session(Path(path), owns_source_path=False, cancelled=cancelled, progress=progress,
            raw_import_settings=RawImportSettings.model_validate(inputs["raw_import_settings"]),
            interpretation_override=SourceInterpretationOverride.model_validate(inputs["interpretation_override"]),
            hdr_reference_white_nits=inputs["hdr_reference_white_nits"])
    if document:
        saved = EditDocument.model_validate(document)
        wanted = saved.source.fingerprint_sha256
        if wanted and wanted != source.source_fingerprint_sha256:
            raise ValueError("The source photo changed; its saved grade cannot be shown.")
        if saved.repairs:
            from .retouch_source import restore_repairs
            from .sessions import _source_mip_identity
            source.repairs = saved.repairs
            from concurrent.futures import CancelledError
            def checkpoint():
                if cancelled is not None and cancelled():
                    raise CancelledError("Library repair cancelled")
            try:
                restore_repairs(source, _source_mip_identity(source), checkpoint)
            finally:
                if source.retouch_worker is not None:
                    source.retouch_worker.close()
                    source.retouch_worker = None
    if progress: progress("reduction", "Reducing and storing Library pictures")
    result = None
    for size in sorted({640, 2560, edge}, reverse=True):
        metadata = {"route": "library-live", "renderer": "cpu", "raw_input": True,
            "starting_look": source.starting_adjustments().model_dump(mode="json"),
            "source_width": source.image.shape[1], "source_height": source.image.shape[0],
            "source_fingerprint_sha256": source.source_fingerprint_sha256,
            "source_timings_ms": source.metadata.get("import_timings_ms")}
        if not document:
            metadata["default_document"] = source.edit_document().model_dump(mode="json")
        item = cache.build(path, size, source_quality, cancelled,
            (reduce_picture(source.image, size),
             reduce_picture(source.sdr_reference_image, size) if source.sdr_reference_image is not None else None, metadata))
        if size == edge:
            result = item
    return result


_cpu_flights = {}
_cpu_condition = Condition()


def develop_cpu(root, path, document, edge, cancelled=None, progress=None):
    """Coalesce helper calls before allocating a decoder, across scene tiers."""
    from .library_pictures import picture_key, check_cancelled
    key = (str(root), picture_key(path, 100000 if edge == 100000 else 0, quality(document)))
    demand = cancelled or (lambda: False)
    with _cpu_condition:
        flight = _cpu_flights.get(key)
        owner = flight is None
        if owner:
            flight = {"users": [], "done": False, "cache": LibraryPictureCache(root)}
            _cpu_flights[key] = flight
        flight["users"].append(demand)
    try:
        if owner:
            try:
                def all_cancelled():
                    with _cpu_condition:
                        return all(user() for user in flight["users"])
                flight["result"] = _develop_cpu(root, path, document, edge, all_cancelled, flight["cache"], progress)
            except BaseException as error:
                flight["error"] = error
            finally:
                with _cpu_condition:
                    flight["done"] = True
                    _cpu_condition.notify_all()
        else:
            with _cpu_condition:
                while not flight["done"]:
                    check_cancelled(cancelled)
                    _cpu_condition.wait(.05)
        check_cancelled(cancelled)
        if "error" in flight:
            raise flight["error"]
        result = dict(flight["result"]) if owner else flight["cache"].cached(path, edge, quality(document))
        if not result:
            raise ValueError("Source changed during Library preparation.")
        return result
    finally:
        with _cpu_condition:
            flight["users"].remove(demand)
            if not flight["users"] and _cpu_flights.get(key) is flight:
                del _cpu_flights[key]


class LivePictures:
    def __init__(self, root, marks, documents=None):
        self.cache = LibraryPictureCache(root)
        self.root, self.marks, self.documents = root, marks, documents

    def document(self, path):
        return self.documents.request(path)["grade"] if self.documents else None

    def describe(self, path, metadata):
        document = self.document(path) or {}
        if metadata["quality"] != quality(document):
            raise ValueError("The source settings changed while its scene was prepared.")
        grade_id = sha256(json.dumps(document, sort_keys=True).encode()).hexdigest()
        identity = "live-" + sha256((metadata["key"] + grade_id).encode()).hexdigest()[:59]
        result = dict(metadata, route="library-live", source_key=metadata["key"], key=identity,
            path=str(path), adjustments=document.get("global_adjustments") or metadata["adjustments"],
            locals=document.get("local_adjustments", []), denoise=document.get("denoise", {}),
            framing=document.get("framing"),
            white=document.get("hdr_reference_white_nits", 203), grade_identity=grade_id)
        from .finishing import geometry_output_dimensions
        adjustments = AdjustmentState.model_validate(result["adjustments"])
        result["scene_width"], result["scene_height"] = metadata["width"], metadata["height"]
        result["width"], result["height"] = geometry_output_dimensions(metadata["width"], metadata["height"], adjustments.shared.geometry)
        result["source_width"], result["source_height"] = geometry_output_dimensions(metadata["source_width"], metadata["source_height"], adjustments.shared.geometry)
        with _registry_lock:
            _registry[identity] = (self, deepcopy(result))
            _registry.move_to_end(identity)
            while len(_registry) > 512:
                _registry.popitem(last=False)
        return result

    def pixels(self, identity, lane):
        with _registry_lock:
            owner, metadata = _registry[identity]
        if owner is not self:
            raise ValueError("Scene belongs to another Library.")
        from .models import GeometryAdjustments
        adjustments = AdjustmentState.model_validate(metadata["adjustments"])
        if adjustments.shared.geometry == GeometryAdjustments():
            # Stored scenes already have this edge. Pack the chosen half-float lane
            # directly; avoid float32 expansion and loading an unused SDR reference.
            with np.load(self.cache.open(metadata["source_key"]), allow_pickle=False) as stored:
                authored = lane == "sdr" and adjustments.sdr.use_authored_base and "reference" in stored
                pixels = stored["reference" if authored else "pixels"]
            if max(pixels.shape[:2]) <= max(256, metadata["edge"]) and pixels.dtype == np.float16:
                height, width = pixels.shape[:2]
                stride = ((width * 8 + 255) // 256) * 256
                packed = np.zeros((height, stride // 2), dtype="<f2")
                rgba = packed[:, :width * 4].reshape(height, width, 4)
                rgba[..., :3] = pixels[..., :3]
                rgba[..., 3] = 1
                return packed.tobytes(), width, height, stride, "linear-srgb" if authored else "acescg"
        frame = self.frame(metadata)
        from .models import PreviewKind
        pixels, space, _ = frame.render_cache.geometry_source_proxy(PreviewKind(lane), metadata["edge"], frame.adjustments)
        body, stride = encode_rgba_proxy_rows(pixels, 0, pixels.shape[0], prefer_half=True, pixel_format="rgba16float")
        return body, pixels.shape[1], pixels.shape[0], stride, space

    def frame(self, metadata):
        # No resident decoded scene pool in the backend: each endpoint owns its
        # arrays for the duration of that request. Finished tiles retain pixels.
        with np.load(self.cache.open(metadata["source_key"]), allow_pickle=False) as stored:
            pixels = stored["pixels"].astype(np.float32)
            reference = stored["reference"].astype(np.float32) if "reference" in stored else None
        context = RenderColorContext(metadata["white"])
        return SimpleNamespace(session_id=metadata["key"], image=pixels, sdr_reference_image=reference,
            source=SimpleNamespace(width=pixels.shape[1], height=pixels.shape[0]),
            adjustments=AdjustmentState.model_validate(metadata["adjustments"]),
            local_adjustments=[LocalAdjustment.model_validate(item) for item in metadata["locals"]],
            denoise=DenoiseDocumentSettings.model_validate(metadata["denoise"]),
            hdr_reference_white_nits=metadata["white"], color_context=context, edit_revision=0,
            render_cache=SessionRenderCache(pixels, reference, color_context=context))


def metadata(identity):
    with _registry_lock:
        entry = _registry.get(identity)
        return deepcopy(entry[1]) if entry else None


def session(identity):
    if not identity.startswith("live-"):
        return None
    with _registry_lock:
        entry = _registry.get(identity)
    return entry[0].frame(entry[1]) if entry else None


def fallback_picture(root, path, document, edge, cancelled=None, progress=None):
    """Visible request only: the existing numerical renderer and JPEG codec.

    Return the CPU picture to its requester; no durable work or output queue.
    """
    import base64
    from .library_pictures import check_cancelled
    from .library_thumbnail_codec import encode
    from .adjustments import apply_adjustments, apply_hdr_output_highlight_compression, apply_sdr_output_highlight_compression
    from .exporters import _denoised_export_source
    from .models import PreviewKind
    cache = LibraryPictureCache(root)
    metadata = develop_cpu(root, path, document, edge, cancelled, progress=progress)
    cache.accept_transient(metadata)
    service = LivePictures(root, None)
    service.cache = cache
    service.document = lambda _: document
    frame = service.frame(service.describe(path, metadata))
    adjustments = frame.adjustments.model_copy(deep=True)
    adjustments.hdr.highlight_compression_target_nits = 1000
    def render(kind):
        check_cancelled(cancelled)
        image = apply_adjustments(_denoised_export_source(frame, kind), adjustments, kind,
            sdr_reference_image=frame.sdr_reference_image, include_grain=True,
            include_output_highlight_compression=False,
            local_adjustments=adjustments.enabled_locals(frame.local_adjustments), color_context=frame.color_context)
        check_cancelled(cancelled)
        return (apply_hdr_output_highlight_compression(image, adjustments, color_context=frame.color_context)
            if kind == PreviewKind.HDR else apply_sdr_output_highlight_compression(image, adjustments))
    body = encode(render(PreviewKind.HDR), render(PreviewKind.SDR), frame.hdr_reference_white_nits)
    check_cancelled(cancelled)
    return {"url":"data:image/jpeg;base64," + base64.b64encode(body).decode()}
