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
