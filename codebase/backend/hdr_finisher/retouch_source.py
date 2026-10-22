"""Reconstruct ordered native repairs, then publish one immutable render source.

Solves and masks stay bounded. Rendering currently consumes a contiguous NumPy
frame, so publication needs one additional native frame while repairs exist.
It is copied in cancellable bands; no full-frame grading or inpainting occurs.
"""
import json

import numpy as np

from .retouch_jobs import RepairRevision, RepairWorker
from .retouch_recipe import compose_repairs, prepare_repair, stroke_mask


def repair_identity(records):
    return json.dumps([r.model_dump(mode="json") for r in records], sort_keys=True, separators=(",", ":"))


def build_repaired_source(session, records, checkpoint=lambda: None):
    base = session.retouch_original
    active = [record for record in records if record.enabled]
    if not active:
        checkpoint()
        return base
    for record in records:
        if record.recipe.source_size != (base.shape[1], base.shape[0]):
            raise ValueError("Repair source dimensions changed; remove or redraw this repair")
    # Use the established host reserve. Fail before allocating another native
    # owner; originals, last valid pixels and the document remain untouched.
    from .resource_preflight import detect_memory_resources, GIB
    resources = detect_memory_resources()
    if resources.total_ram_bytes is not None and resources.available_ram_bytes is not None:
        safe = max(0, resources.available_ram_bytes - max(2 * GIB, int(resources.total_ram_bytes * .15)))
        if base.nbytes + 64 * 1024**2 > safe:
            raise ValueError("Not enough memory to publish this repair; free memory and try again")
    masks = [(r.recipe.search_rect, stroke_mask(r.recipe, checkpoint) > 0) for r in active]
    worker = session.retouch_worker
    if worker is None:
        worker = session.retouch_worker = RepairWorker()
    token = RepairRevision(session.session_id,
        json.dumps([session.source_fingerprint_sha256, session.interpretation_override.model_dump(mode="json"),
                    session.raw_import_settings.model_dump(mode="json")], sort_keys=True),
        session.edit_revision)
    worker.set_current(token)
    patches = []
    for index, record in enumerate(active):
        checkpoint()

        def read(t, l, b, r):
            return compose_repairs(base[t:b, l:r], (l, t), patches)

        def excluded(t, l, b, r):
            result = np.zeros((b - t, r - l), dtype=bool)
            # Completed earlier repairs are valid donors. Current and future
            # known defects are excluded, including across search rectangles.
            for (ml, mt, mr, mb), mask in masks[index:]:
                x0, y0, x1, y1 = max(l, ml), max(t, mt), min(r, mr), min(b, mb)
                if x0 < x1 and y0 < y1:
                    result[y0-t:y1-t, x0-l:x1-l] |= mask[y0-mt:y1-mt, x0-ml:x1-ml]
            return result

        request = prepare_repair(record.recipe, read, read_excluded=excluded, checkpoint=checkpoint)
        future, cancel = worker.submit(request, record.recipe.settings, token=token)
        # Waiting outside the session lock lets edits/cancel supersede work.
        from concurrent.futures import TimeoutError
        try:
            while True:
                checkpoint()
                try:
                    completion = future.result(timeout=.05)
                    break
                except TimeoutError:
                    pass
            patches.append(worker.accept(completion))
        except BaseException:
            cancel.set()
            raise
    result = np.empty_like(base)
    for top in range(0, base.shape[0], 128):
        checkpoint()
        bottom = min(top + 128, base.shape[0])
        result[top:bottom] = compose_repairs(base[top:bottom], (0, top), patches)
    checkpoint()
    result.setflags(write=False)
    return result


def install_repaired_source(session, pixels, identity):
    session.image = pixels
    session.render_cache.replace_source(pixels, session.sdr_reference_image,
        identity=identity, sdr_identity=session.render_cache.sdr_identity)


def restore_repairs(session, identity, checkpoint=lambda: None):
    """Project/Library restore, before any consumer can see this session."""
    if session.repairs or session.image is not session.retouch_original:
        install_repaired_source(session, build_repaired_source(session, session.repairs, checkpoint), identity)
