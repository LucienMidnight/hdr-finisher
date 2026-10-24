"""Normative, dependency-free implementation of bordermuse-geometry-v1.

See docs/GEOMETRY_SPEC.md. Inputs describe already oriented/resized content.
Use integer arithmetic: rounding each margin is part of the public contract.
"""

from __future__ import annotations

from dataclasses import dataclass


SPEC_ID = "bordermuse-geometry-v1"


@dataclass(frozen=True)
class Geometry:
    width: int
    height: int
    left: int
    right: int
    top: int
    bottom: int


def calculate(width: int, height: int, thickness: int, ratio: tuple[int, int] | None) -> Geometry:
    """Return final canvas dimensions and four symmetric integer margins.

    None means Original, defined for our tools as ratio=(width, height).
    Mobile's Original mode remains unmeasured; explicit-ratio cases are measured.
    """
    if type(width) is not int or type(height) is not int or min(width, height) <= 0:
        raise ValueError("content width and height must be positive integers")
    if type(thickness) is not int or not 0 <= thickness <= 50:
        raise ValueError("thickness must be an integer between 0 and 50")
    if ratio is None:
        ratio = (width, height)
    if not isinstance(ratio, (tuple, list)) or len(ratio) != 2:
        raise ValueError("ratio must contain two positive integers, or be None")
    rw, rh = ratio
    if type(rw) is not int or type(rh) is not int or min(rw, rh) <= 0:
        raise ValueError("ratio must contain two positive integers")

    # Equivalent to fitting a continuous canvas, scaling by (100+t)/100,
    # then flooring each half-margin. No intermediate dimension is rounded.
    if width * rh >= height * rw:
        mx = width * thickness // 200
        my = (width * (100 + thickness) * rh - 100 * height * rw) // (200 * rw)
    else:
        mx = (height * (100 + thickness) * rw - 100 * width * rh) // (200 * rh)
        my = height * thickness // 200
    return Geometry(width + 2 * mx, height + 2 * my, mx, mx, my, my)
