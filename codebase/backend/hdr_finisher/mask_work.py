"""Request-local cooperative mask cancellation and disjoint phase timings."""
from contextlib import contextmanager
from contextvars import ContextVar, copy_context
from time import perf_counter


_check = ContextVar("mask_work_check", default=None)
_abandon = ContextVar("mask_work_abandon", default=None)
_wanted = ContextVar("mask_work_wanted", default=None)
_timing = ContextVar("mask_work_timing", default=None)


def in_request_context(function):
    """Bind ``function`` to this request's checks for use on a worker thread.

    Context variables do not follow work into a thread pool, and one Context
    cannot be entered by two threads at once, so every call gets its own copy.
    """
    context = copy_context()
    return lambda *args: context.copy().run(function, *args)


def obsolete_checkpoint():
    """Stop only when the work itself is obsolete, even if its requester left."""
    check = _check.get()
    if check is not None:
        check()


def checkpoint():
    obsolete_checkpoint()
    abandon = _abandon.get()
    if abandon is not None:
        wanted = _wanted.get()
        if wanted is None or not wanted():
            abandon()


def _combined(parent, check):
    if parent is None or check is None:
        return parent if check is None else check
    def combined_check():
        parent()
        check()
    return combined_check


@contextmanager
def request_work(check, timing, *, abandon=None):
    """Scope one request's mask work.

    ``check`` raises when the work is obsolete: the mask it describes was
    edited away, so nobody can use the result. ``abandon`` raises when the
    requester left, typically to ask for the same mask under a newer request;
    that stops only work no other request is waiting on (see ``shared_work``).
    """
    check_token = _check.set(_combined(_check.get(), check))
    abandon_token = _abandon.set(_combined(_abandon.get(), abandon))
    timing_token = _timing.set(timing)
    try:
        checkpoint()
        yield
        checkpoint()
    finally:
        _check.reset(check_token)
        _abandon.reset(abandon_token)
        _timing.reset(timing_token)


@contextmanager
def shared_work(wanted):
    """Run work other requests may join; ``wanted()`` is true while one waits.

    A shared flight's owner computes on its own request's thread. If that
    client leaves while another request waits for the same result, abandoning
    the work would only make the waiter start it again from nothing.
    """
    token = _wanted.set(wanted)
    try:
        yield
    finally:
        _wanted.reset(token)


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
