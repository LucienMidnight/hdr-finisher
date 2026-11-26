"""Bounded native Retouch replay for Library GPU-developed scenes."""
from itertools import groupby
from time import perf_counter

import numpy as np

from .library_diagnostics import log
from .retouch import NativeRepairInput
from .retouch_gpu import BoundedSource, context_rectangles, inpaint_packet
from .retouch_parallel import ordered_transfers
from .retouch_transfer import transfer_repair

# Limit one gather/upload window. The original scene and its edited copy
# already occupy the bulk of the Library development lease.
BATCH_BYTES = 16 * 1024**2
MAX_UPLOAD_BYTES = max(BATCH_BYTES, NativeRepairInput.region_edge**2 * 12) + 4096


def plan(records, source_size):
    batches, batch = [], []
    used = 0
    for record in records:
        if not record.enabled:
            continue
        if record.recipe.source_size != source_size:
            raise ValueError("Repair source dimensions changed; remove or redraw this repair")
        rectangles = context_rectangles(record.recipe)
        pixels = [(r-l)*(b-t) for l,t,r,b in rectangles]
        cost = max(sum(pixels)*12, pixels[0]*16)
        if cost > BATCH_BYTES and record.recipe.mode != 'inpaint':
            raise ValueError("Repair exceeds the bounded Library GPU development route")
        if batch and (used+cost > BATCH_BYTES or record.recipe.mode == 'inpaint'):
            batches.append(batch)
            batch, used = [], 0
        batch.append((record, rectangles))
        used += cost
        if record.recipe.mode == 'inpaint':
            batches.append(batch)
            batch, used = [], 0
    if batch:
        batches.append(batch)
    return batches


def replay(batch, source_size, body, path, checkpoint):
    width, height = source_size
    started = perf_counter()
    regions = {}
    values = np.frombuffer(body, dtype='<f4')
    offset = 0
    for record, rectangles in batch:
        count = sum((r-l)*(b-t)*3 for l,t,r,b in rectangles)
        if offset+count > values.size:
            raise ValueError("Incomplete bounded repair source")
        source = BoundedSource(rectangles, values[offset:offset+count])
        source.shape = (height, width, 3)
        regions[id(record)] = source
        offset += count
    if offset != values.size:
        raise ValueError("Unexpected bounded repair source data")
    validation_ms = (perf_counter()-started)*1000

    def solve(record):
        at = perf_counter()
        checkpoint()
        source = regions[id(record)]
        if record.recipe.mode == 'inpaint':
            (meta, data), _ = inpaint_packet(record.recipe, source, checkpoint)
            stage = 'packet'
        else:
            patch, mask = transfer_repair(record.recipe, source, checkpoint, replay=True)
            h, w = mask.shape
            data = np.empty((h, w, 4), dtype='<f4')
            data[..., :3] = patch.pixels
            data[..., 3] = mask
            meta = dict(mode=record.recipe.mode, origin=patch.origin, pw=w, ph=h)
            stage = 'solve'
        return meta, memoryview(data).cast('B'), stage, (perf_counter()-at)*1000

    started = perf_counter()
    result, parts = [], []
    size = 0
    stats = dict(validation_ms=validation_ms, packet_ms=0, packet_max_ms=0,
                 solve_ms=0, solve_max_ms=0)
    for transfer, records in groupby((r for r, _ in batch), key=lambda r:r.recipe.mode!='inpaint'):
        results = ordered_transfers(solve, records, checkpoint) if transfer else map(solve, records)
        for meta, data, stage, elapsed in results:
            stats[stage+'_ms'] += elapsed
            stats[stage+'_max_ms'] = max(stats[stage+'_max_ms'], elapsed)
            result.append(dict(meta, offset=size, bytes=data.nbytes))
            size += data.nbytes
            parts.append(data)
    stats['backend_wall_ms'] = (perf_counter()-started)*1000+validation_ms
    checkpoint()
    log('retouch_replay_batch', path=path, repairs=len(batch), **stats)
    return dict(repairs=result, timings=stats), parts
