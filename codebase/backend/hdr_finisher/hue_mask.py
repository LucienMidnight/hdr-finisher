"""Local hue-mask leaves from the shared colour selection (``hsl_selection.py``).

A hue leaf selects from the picture as it looks just before Global HSL, in the
lane being rendered, with the same maths as Global HSL. A render hands that
picture to mask evaluation through ``stage``; mask compiles outside a render
(transport to the GPU, overlays) capture it with ``hsl_sampling``. Combining,
inverting and opacity remain the mask expression's job.
"""
from contextlib import contextmanager
from contextvars import ContextVar
import numpy as np

_stage = ContextVar("hue_mask_stage", default=None)


@contextmanager
def stage(prepared):
    """Make ``prepared`` the selection every hue leaf of this frame reads."""
    if prepared is None:
        yield
        return
    token = _stage.set(prepared)
    try:
        yield
    finally:
        _stage.reset(token)


def prepare_stage_input(pixels, kind, scale=1.0):
    """Prepare the shared selection from an HSL stage input in the lane's space."""
    from .color import acescg_to_linear_srgb
    from .hsl_selection import prepare
    rgb = np.asarray(pixels)[..., :3]
    if str(getattr(kind, "value", kind)) == "hdr":
        rgb = acescg_to_linear_srgb(rgb)
    return prepare(np.asarray(rgb, dtype=np.float32), scale)


def select_hue(leaf, image):
    """Coverage of one hue leaf over ``image``'s frame.

    Inside a render the frame's stage selection is used. Without one (direct
    library use, tests) ``image`` itself, a fixed ACEScg source, is taken as the
    stage input.
    """
    from .hsl_selection import select_hue as shared
    if leaf.hue_center is None:
        return np.zeros(image.shape[:2], np.float32)
    prepared = _stage.get()
    if prepared is None or prepared.shape != image.shape[:2]:
        prepared = prepare_stage_input(image, "hdr")
    return shared(prepared, leaf)
