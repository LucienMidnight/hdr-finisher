"""Cooperative grain cancellation and single allocation ownership.

Grain chunks stay on their request thread: background chunks cannot fill the
shared CPU pool with waiters in front of the visible preview. An export is
the exception: its Film Grain chunks run on a bounded number of pool workers
(``adjustments._apply_density_grain``).
"""
from contextlib import contextmanager
from contextvars import ContextVar
from threading import Condition

_current = ContextVar("grain_current", default=None)
_background = ContextVar("grain_background", default=False)
_gate = Condition()
_holders = 0
_foreground_waiters = 0
_narrow_waiters = 0


def background_fill_allowed():
    from . import app_memory

    try:
        memory = app_memory.snapshot(cached_only=True)
    except OSError:
        return False
    return (memory["gradePressure"] == "none"
            and memory["totalBytes"] + memory["reservedBytes"] <= memory["targetBytes"])


def background_work():
    return _background.get()


def checkpoint():
    current = _current.get()
    if (current is not None and not current()) or (_background.get() and _foreground_waiters):
        from .render_cache import StaleRender
        raise StaleRender("Obsolete grain work cancelled.")


def current_check():
    return _current.get()


@contextmanager
def render_work(current=None, *, background=None, shared=False):
    # Shared preparation supplies a check for all its callers.
    parent = None if shared else _current.get()
    combined = lambda: (parent is None or parent()) and (current is None or current())
    token = _current.set(combined)
    priority = _background.set(_background.get() if background is None else background)
    try:
        checkpoint()
        yield
    finally:
        _background.reset(priority)
        _current.reset(token)


@contextmanager
def grain_allocation(slots: int = 1):
    """Hold one grain chunk's scratch; foreground wins the next free slot.

    Ordinary callers take the only slot, one chunk at a time. An export can
    ask for ``slots`` concurrent chunks of its own; it waits while any
    foreground single-slot request is queued, so Grade still goes first.
    This bounds overlapping grain scratch, not the whole application's RAM.
    No cache, memory setting, chunk geometry or sample arithmetic changes.
    """
    global _holders, _foreground_waiters, _narrow_waiters
    foreground = not _background.get()
    narrow = slots <= 1
    with _gate:
        if foreground:
            _foreground_waiters += 1
            if narrow:
                _narrow_waiters += 1
        try:
            while (_holders >= max(1, slots) or (not foreground and _foreground_waiters)
                   or (not narrow and _narrow_waiters)):
                checkpoint()
                _gate.wait(.05)
            checkpoint()
            _holders += 1
        finally:
            if foreground:
                _foreground_waiters -= 1
                if narrow:
                    _narrow_waiters -= 1
            _gate.notify_all()
    try:
        yield
    finally:
        with _gate:
            _holders -= 1
            _gate.notify_all()
