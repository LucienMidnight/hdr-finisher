"""Retouch CPU lanes: deterministic partitions, below-normal native worker threads.

The coordinator never runs in this team, so a repair already running in the
shared CPU executor cannot serialize nested work or deadlock its own workers.
Lane results are consumed in input order; scheduling never changes donors.
"""
from concurrent.futures import ThreadPoolExecutor
import atexit
import numpy as np
from .cpu_budget import logical_cpus, lower_thread_priority

_pool = ThreadPoolExecutor(max_workers=logical_cpus(),
    thread_name_prefix="hdr-retouch", initializer=lower_thread_priority)
atexit.register(_pool.shutdown, wait=True, cancel_futures=True)


def bands(length):
    edges = np.linspace(0, length, min(length, logical_cpus()) + 1, dtype=int)
    return [slice(int(a), int(b)) for a, b in zip(edges[:-1], edges[1:])]


def ordered(function, values):
    futures = [_pool.submit(function, value) for value in values]
    try:
        return [future.result() for future in futures]
    finally:
        # Join every lane even on cancellation: none can outlive its ROI owner.
        for future in futures:
            if not future.done():
                future.cancel()
        for future in futures:
            if not future.cancelled():
                try:
                    future.result()
                except BaseException:
                    pass


def transfer_groups(records):
    """Limit simultaneous transfer scratch using the size of the saved ROIs."""
    group = []
    used = 0
    for record in records:
        left, top, right, bottom = record.recipe.search_rect
        # Includes donor sampling intermediates, the float64 Heal field,
        # output, and mask. Large jobs keep the existing single-repair route.
        cost = (right-left) * (bottom-top) * 384
        if group and (used + cost > 64 * 1024**2 or len(group) == logical_cpus()):
            yield group
            group, used = [], 0
        group.append(record)
        used += cost
    if group:
        yield group


def ordered_transfers(function, records, checkpoint):
    from contextvars import copy_context
    for group in transfer_groups(records):
        checkpoint()
        if len(group) == 1:
            yield function(group[0])
        else:
            # Each lane owns its copy of the source priority/cancellation context.
            inputs = [(copy_context(), record) for record in group]
            yield from ordered(lambda item: item[0].run(function, item[1]), inputs)


def score(candidate, target, source, source_mean, offsets, confidence, align_tone, checkpoint):
    def lane(part):
        checkpoint()
        positions = candidate[part]
        sy = positions[:, 0, None] + offsets[:, 0]
        sx = positions[:, 1, None] + offsets[:, 1]
        diff = source[sy, sx] - target[part]
        if align_tone:
            diff -= source_mean[positions[:, 0], positions[:, 1]][:, None, :]
        return np.sum(diff * diff * confidence[part, :, None], axis=(1, 2))
    return np.concatenate(ordered(lane, bands(len(candidate))))
