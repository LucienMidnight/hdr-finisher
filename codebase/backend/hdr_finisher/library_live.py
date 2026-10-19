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
from threading import RLock
from types import SimpleNamespace

import numpy as np

from .color_context import RenderColorContext
from .library_pictures import LibraryPictureCache, reduce_picture
from .models import AdjustmentState, DenoiseDocumentSettings, LocalAdjustment, RawImportSettings, SourceInterpretationOverride
from .render_cache import SessionRenderCache

_registry = OrderedDict()
_registry_lock = RLock()


def recipe(document):
    document = document or {}
    return {
        "raw_import_settings": document.get("source", {}).get("raw_import_settings") or RawImportSettings().model_dump(mode="json"),
        "interpretation_override": document.get("interpretation_override") or SourceInterpretationOverride().model_dump(mode="json"),
        "hdr_reference_white_nits": document.get("hdr_reference_white_nits", 203),
    }


def quality(document):
    return "live-scene-v1:" + sha256(json.dumps(recipe(document), sort_keys=True).encode()).hexdigest()


def develop_cpu(root, path, document, edge, cancelled=None):
    """One existing full development produces both stored sizes; no CPU finishing."""
    from .sessions import SessionStore
    from .models import EditDocument
    cache = LibraryPictureCache(root)
    source_quality = quality(document)
    cached = cache.cached(path, edge, source_quality)
    if cached:
        return cached
    inputs = recipe(document)
    source = SessionStore().prepare_session(Path(path), owns_source_path=False, cancelled=cancelled,
        raw_import_settings=RawImportSettings.model_validate(inputs["raw_import_settings"]),
        interpretation_override=SourceInterpretationOverride.model_validate(inputs["interpretation_override"]),
        hdr_reference_white_nits=inputs["hdr_reference_white_nits"])
    if document:
        wanted = EditDocument.model_validate(document).source.fingerprint_sha256
        if wanted and wanted != source.source_fingerprint_sha256:
            raise ValueError("The source photo changed; its saved grade cannot be shown.")
    result = None
    for size in sorted({640, 2560, edge}, reverse=True):
        metadata = {"route": "library-live", "renderer": "cpu", "raw_input": True,
            "starting_look": source.starting_adjustments().model_dump(mode="json"),
            "source_width": source.image.shape[1], "source_height": source.image.shape[0],
            "source_fingerprint_sha256": source.source_fingerprint_sha256}
        if not document:
            metadata["default_document"] = source.edit_document().model_dump(mode="json")
        item = cache.build(path, size, source_quality, cancelled,
            (reduce_picture(source.image, size),
             reduce_picture(source.sdr_reference_image, size) if source.sdr_reference_image is not None else None, metadata))
        if size == edge:
            result = item
    return result


class LivePictures:
    def __init__(self, root, marks, kept=None):
        self.cache = LibraryPictureCache(root)
        self.root, self.marks, self.kept = root, marks, kept

    def document(self, path):
        return self.kept.request(path)["grade"] if self.kept else None

    def describe(self, path, metadata):
        document = self.document(path) or {}
        if metadata["quality"] != quality(document):
            raise ValueError("The source settings changed while its scene was prepared.")
        grade_id = sha256(json.dumps(document, sort_keys=True).encode()).hexdigest()
        identity = "live-" + sha256((metadata["key"] + grade_id).encode()).hexdigest()[:59]
        result = dict(metadata, route="library-live", source_key=metadata["key"], key=identity,
            path=str(path), adjustments=document.get("global_adjustments") or metadata["adjustments"],
            locals=document.get("local_adjustments", []), denoise=document.get("denoise", {}),
            white=document.get("hdr_reference_white_nits", 203), grade_identity=grade_id)
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
        return self.cache.pixels(metadata["source_key"], lane)

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


def session(identity):
    if not identity.startswith("live-"):
        return None
    with _registry_lock:
        entry = _registry.get(identity)
    return entry[0].frame(entry[1]) if entry else None
