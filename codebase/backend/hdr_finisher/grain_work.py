"""Cooperative grain cancellation and single allocation ownership.

Grain chunks stay on their request thread: background chunks cannot fill the
shared CPU pool with waiters in front of the visible preview.
"""
from contextlib import contextmanager
from contextvars import ContextVar
from threading import Condition

_current = ContextVar("grain_current", default=None)
_background = ContextVar("grain_background", default=False)
_gate = Condition()
_busy = False
_foreground_waiters = 0


def background_work():
    return _background.get()


def checkpoint():
    current = _current.get()
    if (current is not None and not current()) or (_background.get() and _foreground_waiters):
        from .render_cache import StaleRender
        raise StaleRender("Obsolete grain work cancelled.")


@contextmanager
def render_work(current=None, *, background=None):
    parent = _current.get()
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
def grain_allocation():
    """One existing row chunk at a time; foreground wins the next free slot.

    This bounds overlapping grain scratch, not the whole application's RAM.
    No cache, memory setting, chunk geometry or sample arithmetic changes.
    """
    global _busy, _foreground_waiters
    foreground = not _background.get()
    with _gate:
        if foreground:
            _foreground_waiters += 1
        try:
            while _busy or (not foreground and _foreground_waiters):
                checkpoint()
                _gate.wait(.05)
            checkpoint()
            _busy = True
        finally:
            if foreground:
                _foreground_waiters -= 1
            _gate.notify_all()
    try:
        yield
    finally:
        with _gate:
            _busy = False
            _gate.notify_all()
