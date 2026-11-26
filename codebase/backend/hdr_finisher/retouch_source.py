"""Reconstruct ordered native repairs, then publish one immutable render source.

Solves and masks stay bounded. Rendering currently consumes a contiguous NumPy
frame, so publication needs one additional native frame while repairs exist.
It is copied in cancellable bands; no full-frame grading or inpainting occurs.
"""
import json
from itertools import groupby
from time import perf_counter

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
    from .retouch_routes import solve_record
    from .retouch_parallel import ordered_transfers
    from .library_diagnostics import log
    if not hasattr(session, '_repair_routes'):
        session._repair_routes = {}

    def solve(record):
        started = perf_counter()
        patch = solve_record(session, record, worker, token, base, checkpoint)
        alpha = stroke_mask(record.recipe, checkpoint)
        ox = patch.origin[0] - record.recipe.search_rect[0]
        oy = patch.origin[1] - record.recipe.search_rect[1]
        ph, pw = patch.pixels.shape[:2]
        return patch, alpha[oy:oy+ph, ox:ox+pw] > 0, (perf_counter()-started)*1000

    from .delivery_frames import batch_source_buffers, empty_source_array
    started = perf_counter()
    if session.file_back_sources:
        with batch_source_buffers():
            result = empty_source_array(base.shape, base.dtype)
    else:
        result = np.empty_like(base)
    incremental = dirty_rects is not None
    source = session.image if incremental else base
    for top in range(0, base.shape[0], 128):
        checkpoint()
        result[top:top+128] = source[top:top+128]
    if incremental:
        for left, top, right, bottom in dirty:
            checkpoint()
            result[top:bottom, left:right] = base[top:bottom, left:right]
    copied_ms = (perf_counter()-started)*1000
    started = perf_counter()
    scatter_ms = solve_sum_ms = solve_max_ms = 0
    # Every patch reads the immutable original. Consume bounded groups in
    # saved order so overlapping targets retain their precedence.
    for is_transfer, group in groupby(needed, key=lambda r: r.recipe.mode != 'inpaint'):
        patches = ordered_transfers(solve, group, checkpoint) if is_transfer else map(solve, group)
        for patch, mask, elapsed in patches:
            checkpoint()
            solve_sum_ms += elapsed
            solve_max_ms = max(solve_max_ms, elapsed)
            scatter_start = perf_counter()
            px, py = patch.origin
            ph, pw = mask.shape
            for left, top, right, bottom in dirty:
                x0, y0 = max(left, px), max(top, py)
                x1, y1 = min(right, px+pw), min(bottom, py+ph)
                if x0 < x1 and y0 < y1:
                    patch_region = np.s_[y0-py:y1-py, x0-px:x1-px]
                    np.copyto(result[y0:y1, x0:x1], patch.pixels[patch_region],
                        where=mask[patch_region][..., None])
            scatter_ms += (perf_counter()-scatter_start)*1000
    checkpoint()
    duration_ms = (perf_counter()-started)*1000
    log('retouch_replay_timing', path=str(getattr(session, 'source_path', '')), repairs=len(needed),
        duration_ms=duration_ms+copied_ms, copy_ms=copied_ms, solve_wall_ms=duration_ms-scatter_ms,
        solve_sum_ms=solve_sum_ms, solve_max_ms=solve_max_ms, scatter_ms=scatter_ms)
    result.setflags(write=False)
    return result


def install_repaired_source(session, pixels, identity, *, dirty_rects=None):
    pixels = session.retain_source_pixels(pixels)
    session.image = pixels
    session.render_cache.replace_source(pixels, session.sdr_reference_image,
        identity=identity, sdr_identity=session.render_cache.sdr_identity,
        repair_dirty_rects=dirty_rects)


def restore_repairs(session, identity, checkpoint=lambda: None):
    """Project/Library restore, before any consumer can see this session."""
    if session.repairs or session.image is not session.retouch_original:
        install_repaired_source(session, build_repaired_source(session, session.repairs, checkpoint), identity)
