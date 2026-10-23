"""Reconstruct ordered native repairs, then publish one immutable render source.

Solves and masks stay bounded. Rendering currently consumes a contiguous NumPy
frame, so publication needs one additional native frame while repairs exist.
It is copied in cancellable bands; no full-frame grading or inpainting occurs.
"""
import json

import numpy as np

from .retouch_jobs import RepairRevision, RepairWorker
from .retouch_recipe import prepare_repair, stroke_mask
from .retouch_methods import finish_repair


def repair_identity(records):
    return json.dumps([r.model_dump(mode="json") for r in records], sort_keys=True, separators=(",", ":"))


def build_repaired_source(session, records, checkpoint=lambda: None, *, previous_records=None):
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
    def signature(record):
        return (record.enabled, record.recipe.model_dump_json())

    def footprint(record):
        recipe = record.recipe
        width, height = recipe.source_size
        radius = recipe.radius_px
        xs = [p.x * width for p in recipe.points]
        ys = [p.y * height for p in recipe.points]
        return (max(0, int(np.floor(min(xs)-radius))), max(0, int(np.floor(min(ys)-radius))),
                min(width, int(np.ceil(max(xs)+radius))), min(height, int(np.ceil(max(ys)+radius))))

    incremental = previous_records is not None
    if incremental:
        old = {r.id: r for r in previous_records}
        new = {r.id: r for r in records}
        dirty = [footprint(r) for r in previous_records
                 if r.enabled and (r.id not in new or signature(r) != signature(new[r.id]))]
        dirty += [footprint(r) for r in records
                  if r.enabled and (r.id not in old or signature(r) != signature(old[r.id]))]
        # Reordering changes precedence in overlapping painted areas.
        old_ids = {r.id for r in previous_records if r.enabled}
        new_ids = {r.id for r in active}
        if ([r.id for r in previous_records if r.enabled and r.id in new_ids] !=
                [r.id for r in active if r.id in old_ids]):
            dirty = [footprint(r) for r in (*previous_records, *records) if r.enabled]
    else:
        dirty = [(0, 0, base.shape[1], base.shape[0])]
    dirty = list(dict.fromkeys(dirty))
    if not dirty:
        checkpoint()
        return session.image

    def intersects(a, b):
        return a[0] < b[2] and a[2] > b[0] and a[1] < b[3] and a[3] > b[1]

    needed = [r for r in active if any(intersects(footprint(r), rect) for rect in dirty)]
    worker = session.retouch_worker
    if worker is None:
        worker = session.retouch_worker = RepairWorker()
    token = RepairRevision(session.session_id,
        json.dumps([session.source_fingerprint_sha256, session.interpretation_override.model_dump(mode="json"),
                    session.raw_import_settings.model_dump(mode="json")], sort_keys=True),
        session.edit_revision)
    worker.set_current(token)
    patches = []
    for record in needed:
        checkpoint()
        # Immutable original pixels and frozen donor footprints keep every
        # completed correction independent of later additions/removals.
        request = prepare_repair(record.recipe, lambda t, l, b, r: base[t:b, l:r], checkpoint=checkpoint)
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
            patch = worker.accept(completion)
            alpha = stroke_mask(record.recipe, checkpoint)
            patch = finish_repair(record.recipe, request, patch, alpha, checkpoint)
            mask = alpha > 0
            ox = patch.origin[0] - record.recipe.search_rect[0]
            oy = patch.origin[1] - record.recipe.search_rect[1]
            ph, pw = patch.pixels.shape[:2]
            patches.append((patch, mask[oy:oy+ph, ox:ox+pw]))
        except BaseException:
            cancel.set()
            raise
    result = np.empty_like(base)
    source = session.image if incremental else base
    for top in range(0, base.shape[0], 128):
        checkpoint()
        result[top:top+128] = source[top:top+128]
    for left, top, right, bottom in dirty:
        checkpoint()
        window = result[top:bottom, left:right]
        window[:] = base[top:bottom, left:right]
        for patch, mask in patches:
            px, py = patch.origin
            ph, pw = mask.shape
            x0, y0 = max(left, px), max(top, py)
            x1, y1 = min(right, px+pw), min(bottom, py+ph)
            if x0 < x1 and y0 < y1:
                target = window[y0-top:y1-top, x0-left:x1-left]
                patch_region = np.s_[y0-py:y1-py, x0-px:x1-px]
                np.copyto(target, patch.pixels[patch_region], where=mask[patch_region][..., None])
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
