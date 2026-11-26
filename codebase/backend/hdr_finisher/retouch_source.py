"""Reconstruct ordered native repairs, then publish one immutable render source.

Solves and masks stay bounded. Rendering currently consumes a contiguous NumPy
frame, so publication needs one additional native frame while repairs exist.
It is copied in cancellable bands; no full-frame grading or inpainting occurs.
"""
import json

import numpy as np

from .retouch_jobs import RepairRevision, RepairWorker
from .retouch_recipe import stroke_mask


REPAIR_PUBLICATION_SCRATCH_BYTES = 64 * 1024**2


def repair_identity(records):
    return json.dumps([r.model_dump(mode="json") for r in records], sort_keys=True, separators=(",", ":"))


def repair_footprint(record):
    recipe = record.recipe
    width, height = recipe.source_size
    radius = recipe.radius_px
    xs = [p.x * width for p in recipe.points]
    ys = [p.y * height for p in recipe.points]
    return (max(0, int(np.floor(min(xs)-radius))), max(0, int(np.floor(min(ys)-radius))),
            min(width, int(np.ceil(max(xs)+radius))), min(height, int(np.ceil(max(ys)+radius))))


def repair_dirty_rectangles(previous_records, records):
    """Native footprints whose composite can change between two documents."""
    old = {r.id: r.recipe for r in previous_records if r.enabled}
    new = {r.id: r.recipe for r in records if r.enabled}
    reordered = ([key for key in old if key in new] != [key for key in new if key in old])
    dirty = [repair_footprint(r) for r in previous_records
             if r.enabled and (reordered or r.recipe != new.get(r.id))]
    dirty += [repair_footprint(r) for r in records
              if r.enabled and (reordered or r.recipe != old.get(r.id))]
    return tuple(dict.fromkeys(dirty))


def build_repaired_source(session, records, checkpoint=lambda: None, *, dirty_rects=None):
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
        if base.nbytes + REPAIR_PUBLICATION_SCRATCH_BYTES > safe:
            raise ValueError("Not enough memory to publish this repair; free memory and try again")
    if dirty_rects is None:
        dirty = [(0, 0, base.shape[1], base.shape[0])]
    else:
        dirty = dirty_rects
    if not dirty:
        checkpoint()
        return session.image

    def intersects(a, b):
        return a[0] < b[2] and a[2] > b[0] and a[1] < b[3] and a[3] > b[1]

    needed = [r for r in active if any(intersects(repair_footprint(r), rect) for rect in dirty)]
    worker = session.retouch_worker
    if worker is None:
        worker = session.retouch_worker = RepairWorker()
    token = RepairRevision(session.session_id,
        json.dumps([session.source_fingerprint_sha256, session.interpretation_override.model_dump(mode="json"),
                    session.raw_import_settings.model_dump(mode="json")], sort_keys=True),
        session.edit_revision)
    worker.set_current(token)
    patches = []
    from .retouch_routes import solve_record
    for record in needed:
        checkpoint()
        # Immutable original pixels and frozen donor footprints keep every
        # completed correction independent of later additions/removals.
        patch = solve_record(session, record, worker, token, base, checkpoint)
        alpha = stroke_mask(record.recipe, checkpoint)
        ox = patch.origin[0] - record.recipe.search_rect[0]
        oy = patch.origin[1] - record.recipe.search_rect[1]
        ph, pw = patch.pixels.shape[:2]
        patches.append((patch, alpha[oy:oy+ph, ox:ox+pw] > 0))
    result = np.empty_like(base)
    source = session.image if dirty_rects is not None else base
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


def install_repaired_source(session, pixels, identity, *, dirty_rects=None):
    session.image = pixels
    session.render_cache.replace_source(pixels, session.sdr_reference_image,
        identity=identity, sdr_identity=session.render_cache.sdr_identity,
        repair_dirty_rects=dirty_rects)


def restore_repairs(session, identity, checkpoint=lambda: None):
    """Project/Library restore, before any consumer can see this session."""
    if session.repairs or session.image is not session.retouch_original:
        install_repaired_source(session, build_repaired_source(session, session.repairs, checkpoint), identity)
