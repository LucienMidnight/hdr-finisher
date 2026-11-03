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
from time import perf_counter
from threading import RLock, Condition
from types import SimpleNamespace
from weakref import WeakValueDictionary

import numpy as np

from .color_context import RenderColorContext
from .library_pictures import LibraryPictureCache, reduce_picture, picture_key
from .models import AdjustmentState, DenoiseDocumentSettings, LocalAdjustment, RawImportSettings, SourceInterpretationOverride
from .projects import validate_saved
from .render_cache import SessionRenderCache, encode_rgba_proxy_rows

_UNSET = object()
_registry = OrderedDict()
_registry_lock = RLock()


def recipe(document):
    if document is not None:
        from .models import EditDocument
        document = validate_saved(EditDocument, document).model_dump(mode="json")
    document = document or {}
    return {
        "raw_import_settings": document.get("source", {}).get("raw_import_settings") or RawImportSettings().model_dump(mode="json"),
        "interpretation_override": document.get("interpretation_override") or SourceInterpretationOverride().model_dump(mode="json"),
        "hdr_reference_white_nits": document.get("hdr_reference_white_nits", 203),
        "repairs": document.get("repairs", []),
    }


def _quality(inputs):
    from .loader import SOURCE_DECODER_VERSION, SOURCE_COLOR_TRANSFORM_VERSION
    identity = {"recipe": inputs, "decoder": SOURCE_DECODER_VERSION,
                "colour": SOURCE_COLOR_TRANSFORM_VERSION, "rgb_adapter": "library-rgb-reduced-v4"}
    return "live-scene-v2:" + sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()


_quality_aliases = OrderedDict()


def equivalent_qualities(value):
    with _registry_lock:
        return _quality_aliases.get(value, (value,))


def quality(document):
    inputs = recipe(document)
    canonical = deepcopy(inputs)
    highlights = canonical["raw_import_settings"]["highlight_reconstruction"]
    # Opposed colour never reads this Edge colour-only control. Use the
    # established pre-prototype encoding for its default in every recipe.
    if highlights["method"] != "edge_colour_v1" or highlights["edge_colour_expand_percent"] == 0.5:
        highlights.pop("edge_colour_expand_percent", None)
    if not highlights["enabled"]:
        canonical["raw_import_settings"]["highlight_reconstruction"] = {"enabled": False}
    lens = canonical["raw_import_settings"]["lens"]
    if lens["mode"] == "off":
        canonical["raw_import_settings"]["lens"] = {"mode": "off"}
    # Record labels and disabled strokes never alter the reconstructed source.
    canonical["repairs"] = [{"recipe": r["recipe"]} for r in inputs["repairs"] if r["enabled"]]
    value = _quality(canonical)
    variants = [value, _quality(inputs)]
    # Exact historical encodings of the SAME developed pixels, never a broad
    # cache search or fallback to a different recipe/decoder/file version.
    old = deepcopy(inputs)
    h = old["raw_import_settings"]["highlight_reconstruction"]
    if h["method"] != "edge_colour_v1" or h["edge_colour_expand_percent"] == 0.5:
        h.pop("edge_colour_expand_percent", None)
        variants.append(_quality(old))
    with _registry_lock:
        previous = _quality_aliases.pop(value, ())
        _quality_aliases[value] = tuple(dict.fromkeys((*variants, *previous)))[:16]
        while len(_quality_aliases) > 1024:
            _quality_aliases.popitem(last=False)
    return value


def _develop_cpu(root, path, document, edge, cancelled=None, cache=None, progress=None, draw_first=False, prepared=None):
    """Develop only the requested scene size; no CPU finishing."""
    from .sessions import SessionStore
    from .models import EditDocument
    cache = cache or LibraryPictureCache(root)
    source_quality = quality(document)
    cached = cache.cached(path, edge, source_quality)
    if cached:
        return cached
    inputs = recipe(document)
    highlights = inputs["raw_import_settings"].get("highlight_reconstruction", {})
    if (Path(path).suffix.lower() == ".arw" and edge <= 2560 and not inputs.get("repairs")
            and highlights.get("method", "opposed_color_v1") == "opposed_color_v1"):
        from .library_cpu_bands import develop
        return develop(root, path, document, edge, cancelled, cache, progress, draw_first, prepared)
    from .highlight_edge_gpu import source_work
    prepared_at = perf_counter()
    from .library_gpu_raw import xtrans_cpu
    from .cpu_budget import raw_threads, logical_cpus, native_threads
    xtrans = xtrans_cpu(path)
    # Untagged colour gets the Library's starting assumption (Steve, Nov 2);
    # the assumption is never written into the photo's document.
    from .library_rgb import assumed_interpretation
    assumed = assumed_interpretation(path, inputs["interpretation_override"])
    interpretation = dict(inputs["interpretation_override"])
    if assumed:
        interpretation.update(color_space=assumed["color_space"],
            transfer_function=interpretation.get("transfer_function") or assumed["transfer_function"])
    source = prepared.get("source") if prepared is not None else None
    saved = validate_saved(EditDocument, document) if document else None
    if source is None:
        if xtrans: raw_threads(logical_cpus())
        try:
            from .library_edge_fallback import _active as rejected_gpu_pixels
            with source_work(priority=15, cancelled=cancelled, cpu_only=True):
                source = SessionStore().prepare_session(Path(path), owns_source_path=False, cancelled=cancelled, progress=progress,
                    raw_import_settings=RawImportSettings.model_validate(inputs["raw_import_settings"]),
                    interpretation_override=SourceInterpretationOverride.model_validate(interpretation),
                    hdr_reference_white_nits=inputs["hdr_reference_white_nits"],
                    library_edge=5120 if edge <= 2560 and not inputs.get("repairs") else None,
                    **({"eager_peak_candidates":False} if rejected_gpu_pixels.get() and not inputs.get("repairs") else {}))
        finally:
            if xtrans:
                raw_threads(native_threads())
        if document:
            wanted = saved.source.fingerprint_sha256
            if wanted and wanted != source.source_fingerprint_sha256:
                raise ValueError("The source photo changed; its saved grade cannot be shown.")
            if saved.repairs:
                from .retouch_source import install_repaired_source
                from .saved_grades import recover_repairs
                from .sessions import _source_mip_identity
                source.repairs = saved.repairs
                from concurrent.futures import CancelledError
                def checkpoint():
                    if cancelled is not None and cancelled():
                        raise CancelledError("Library repair cancelled")
                try:
                    pixels = recover_repairs(saved, source, checkpoint)
                    source.repairs = saved.repairs
                    install_repaired_source(source, pixels, _source_mip_identity(source))
                finally:
                    if source.retouch_worker is not None:
                        source.retouch_worker.close()
                        source.retouch_worker = None
        if prepared is not None: prepared["source"] = source
    preparation_ms = (perf_counter() - prepared_at) * 1000
    if progress: progress("reduction", "Preparing thumbnail and screen preview")
    result = None
    reduction_at = perf_counter()
    # X-Trans uses the same filtered source level as Grade, including its
    # overshoot guard. Other Library routes retain their existing pixels.
    reduce = reduce_picture
    if xtrans:
        from .preview import downsample_image
        def reduce(image, size):
            return downsample_image(image, size, is_current=lambda: not (cancelled and cancelled()))
    for size in [edge]:
        metadata = {"route": "library-live", "renderer": "cpu", "raw_input": True,
            "starting_look": source.starting_adjustments().model_dump(mode="json"),
            "source_width": source.source.width, "source_height": source.source.height,
            "source_fingerprint_sha256": source.source_fingerprint_sha256,
            "source_timings_ms": source.metadata.get("import_timings_ms")}
        from .retouch_routes import records, notice
        metadata["repair_rendering"] = records(source)
        metadata["repair_fallback_reason"] = notice(source)
        if document and getattr(saved, "_saved_grade_notice", None):
            metadata["grade_notice"] = saved._saved_grade_notice
        if assumed:
            metadata["assumed_interpretation"] = assumed["label"]
            if assumed.get("unsupported"):
                metadata["unsupported_colour"] = assumed["unsupported"]
        if not document:
            default = source.edit_document()
            if assumed:
                default.interpretation_override = SourceInterpretationOverride.model_validate(inputs["interpretation_override"])
            metadata["default_document"] = default.model_dump(mode="json")
        item = cache.build(path, size, source_quality, cancelled,
            (reduce(source.image, size),
             reduce(source.sdr_reference_image, size) if source.sdr_reference_image is not None else None, metadata), defer_store=draw_first)
        if size == edge:
            result = item
    from .library_diagnostics import log
    log("picture_cpu_stages", path=str(path), prepare_session_ms=preparation_ms,
        import_ms=source.metadata.get("import_timings_ms"),
        reduction_pack_ms=(perf_counter()-reduction_at)*1000)
    return result


_cpu_flights = {}
_cpu_condition = Condition()


def develop_cpu(root, path, document, edge, cancelled=None, progress=None, draw_first=False, edges=None):
    """Share a preparation across active scene tiers, with independent cancellation."""
    from .library_pictures import picture_key, check_cancelled
    key = (str(root), picture_key(path, 100000 if edge == 100000 else 0, quality(document)))
    demand = cancelled or (lambda: False)
    with _cpu_condition:
        flight = _cpu_flights.get(key)
        owner = flight is None or (flight["done"] and edge not in flight["results"])
        if owner:
            flight = {"users": [], "edges": [], "results": {}, "prepared": {}, "done": False, "cache": LibraryPictureCache(root)}
            _cpu_flights[key] = flight
        flight["users"].append(demand)
        if edge not in flight["edges"]: flight["edges"].append(edge)
    try:
        if owner:
            try:
                def all_cancelled():
                    with _cpu_condition:
                        return all(user() for user in flight["users"])
                while True:
                    with _cpu_condition:
                        for size in edges or []:
                            if size not in flight["edges"]: flight["edges"].append(size)
                        pending = [size for size in flight["edges"] if size not in flight["results"]]
                        if not pending:
                            flight["done"] = True
                            break
                    size = pending[0]
                    flight["results"][size] = _develop_cpu(root, path, document, size, all_cancelled,
                        flight["cache"], progress, draw_first, flight["prepared"])
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
        result = dict(flight["results"][edge])
        if not result:
            raise ValueError("Source changed during Library preparation.")
        if draw_first:
            cache = flight["cache"]
            scenes = []
            with cache.transient_lock:
                pending = list(cache.pending_stores.items())
            for key, (source, size, source_quality, default, _) in pending:
                if source == str(Path(path).resolve()):
                    item = cache.cached(source, size, source_quality)
                    if item:
                        scenes.append(dict(item, _default_document=default))
            result["_pending_scenes"] = scenes
        return result
    finally:
        with _cpu_condition:
            flight["users"].remove(demand)
            if not flight["users"] and _cpu_flights.get(key) is flight:
                del _cpu_flights[key]


class _NativeFrame(SimpleNamespace):
    """Weakly shared while drawing requests own the scene."""


class LivePictures:
    def __init__(self, root, marks, documents=None):
        self.cache = LibraryPictureCache(root)
        self.root, self.marks, self.documents = root, marks, documents
        self._native_frames = WeakValueDictionary()
        self._native_frames_lock = RLock()

    def document(self, path):
        raw = self.documents.request(path)["grade"] if self.documents else None
        if raw is None:
            return None
        from .models import EditDocument
        from .saved_grades import notice
        saved = validate_saved(EditDocument, raw)
        errors = getattr(self.marks, "picture_errors", None)
        if errors: errors.observe_grade(path, notice(saved))
        result = saved.model_dump(mode="json")
        from .saved_grades import whole_grade_fallback
        if whole_grade_fallback(notice(saved)): result.pop("global_adjustments", None)
        return result

    def describe(self, path, metadata, *, document=_UNSET, source_identity=None):
        document = (self.document(path) if document is _UNSET else document) or {}
        if metadata["quality"] != quality(document):
            raise ValueError("The source settings changed while the preview was prepared.")
        if metadata.get("grade_notice"):
            errors = getattr(self.marks, "picture_errors", None)
            if errors:
                old = errors.get(path)
                report = deepcopy(metadata["grade_notice"])
                if old and old.get("notice"):
                    report["issues"] = list({json.dumps(i, sort_keys=True):i for i in old["notice"]["issues"] + report["issues"]}.values())
                    report["sections"] = list(dict.fromkeys(i["section"] for i in report["issues"]))
                    report["reason"] = " ".join(dict.fromkeys(i["reason"] for i in report["issues"]))
                errors.observe_grade(path, report)
        # Transport/draw identity includes the finishing pixels, not document
        # versions, filenames, source measurements or materialised RAW defaults.
        # Source development already has its own identity in metadata["key"].
        finishing = {"global_adjustments": document.get("global_adjustments") or metadata["adjustments"],
            "local_adjustments": document.get("local_adjustments", []),
            "denoise": document.get("denoise", {}), "framing": document.get("framing"),
            "hdr_reference_white_nits": document.get("hdr_reference_white_nits", 203)}
        from .library_grades import grade_key
        grade_id = sha256(json.dumps(grade_key(finishing), sort_keys=True).encode()).hexdigest()
        source_identity = source_identity or picture_key(metadata["path"], metadata["edge"], quality(document))
        identity = "live-" + sha256((source_identity + grade_id).encode()).hexdigest()[:59]
        result = dict(metadata, route="library-live", source_key=metadata["key"], key=identity,
            path=str(path), adjustments=document.get("global_adjustments") or metadata["adjustments"],
            locals=document.get("local_adjustments", []), denoise=document.get("denoise", {}),
            framing=document.get("framing"),
            white=document.get("hdr_reference_white_nits", 203), grade_identity=grade_id)
        from .finishing import geometry_output_dimensions
        adjustments = validate_saved(AdjustmentState, result["adjustments"])
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
            raise ValueError("Preview data belongs to another Library.")
        from .models import GeometryAdjustments
        adjustments = validate_saved(AdjustmentState, metadata["adjustments"])
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
        if metadata["edge"] != 100000:
            return self._frame(metadata)
        # Native proxy/peak/tile requests overlap. Share their one source read,
        # with no resident pool: the last request dropping it frees the pixels.
        with self._native_frames_lock:
            frame = self._native_frames.get(metadata["key"])
            if frame is None:
                frame = self._frame(metadata)
                self._native_frames[metadata["key"]] = frame
            return frame

    def _frame(self, metadata):
        with np.load(self.cache.open(metadata["source_key"]), allow_pickle=False) as stored:
            pixels = stored["pixels"].astype(np.float32)
            reference = stored["reference"].astype(np.float32) if "reference" in stored else None
        context = RenderColorContext(metadata["white"])
        return _NativeFrame(session_id=metadata["key"], image=pixels, sdr_reference_image=reference,
            source=SimpleNamespace(width=pixels.shape[1], height=pixels.shape[0]),
            adjustments=validate_saved(AdjustmentState, metadata["adjustments"]),
            local_adjustments=[validate_saved(LocalAdjustment, item) for item in metadata["locals"]],
            denoise=validate_saved(DenoiseDocumentSettings, metadata["denoise"]),
            hdr_reference_white_nits=metadata["white"], color_context=context, edit_revision=0,
            render_cache=SessionRenderCache(pixels, reference, color_context=context))


def metadata(identity):
    with _registry_lock:
        entry = _registry.get(identity)
        return deepcopy(entry[1]) if entry else None


def native_denoise_pixels(identity):
    """Read stored native scene pixels without unrelated peak/grade setup."""
    with _registry_lock:
        entry = _registry.get(identity)
    if entry is None:
        raise ValueError("Stored Library scene is unavailable.")
    owner, meta = entry
    with np.load(owner.cache.open(meta["source_key"]), allow_pickle=False) as stored:
        return stored["pixels"]


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
    return {"url":"data:image/jpeg;base64," + base64.b64encode(body).decode(),
        "repair_fallback_reason": metadata.get("repair_fallback_reason")}
