"""Request-local cooperative mask cancellation and disjoint phase timings."""
from contextlib import contextmanager
from contextvars import ContextVar
from time import perf_counter


_check = ContextVar("mask_work_check", default=None)
_timing = ContextVar("mask_work_timing", default=None)


def checkpoint():
    check = _check.get()
    if check is not None:
        check()


@contextmanager
def request_work(check, timing):
    parent_check = _check.get()
    def combined_check():
        if parent_check is not None:
            parent_check()
        if check is not None:
            check()
    check_token = _check.set(combined_check)
    timing_token = _timing.set(timing)
    try:
        checkpoint()
        yield
        checkpoint()
    finally:
        _check.reset(check_token)
        _timing.reset(timing_token)


@contextmanager
def phase(name):
    started = perf_counter()
    try:
        yield
    finally:
        timing = _timing.get()
        if timing is not None:
            timing[name] = timing.get(name, 0.0) + (perf_counter() - started) * 1000


@contextmanager
def cache_lock(lock):
    with phase("lock_wait"):
        lock.acquire()
    try:
        checkpoint()
        yield
    finally:
        lock.release()
