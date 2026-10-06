"""Softness and Microcontrast moved from Film Look to Detail (NEXT-01 #2).

Only the controls moved: they still run in the film stage, but answer to
Detail's switch, ignore Look Strength and Film Look's switch, and old
projects carry their Image Structure over so they look the same.
"""

from __future__ import annotations

import numpy as np
import pytest
from pydantic import ValidationError

from hdr_finisher.adjustments import apply_adjustments
from hdr_finisher.models import (
    AdjustmentState,
    FilmLookAdjustments,
    HDRAdjustments,
    LocalGrade,
    PreviewKind,
    SDRAdjustments,
)


def _textured(seed: int = 3) -> np.ndarray:
    rng = np.random.default_rng(seed)
    return (0.05 + 0.3 * rng.random((48, 64, 3))).astype(np.float32)


def test_film_look_no_longer_accepts_image_structure_fields() -> None:
    with pytest.raises(ValidationError):
        FilmLookAdjustments(image_softness=10)


def test_local_grades_do_not_gain_softness_or_microcontrast() -> None:
    with pytest.raises(ValidationError):
        LocalGrade(detail={"softness": 10})


@pytest.mark.parametrize("kind", [PreviewKind.HDR, PreviewKind.SDR])
def test_softness_runs_with_film_look_off_and_ignores_look_strength(kind: PreviewKind) -> None:
    image = _textured()
    reference = AdjustmentState()
    getattr(reference, kind.value).detail.softness = 60
    expected = apply_adjustments(image, reference, kind, include_grain=False)
    neutral = apply_adjustments(image, AdjustmentState(), kind, include_grain=False)
    assert not np.allclose(expected, neutral)

    film_off = AdjustmentState()
    branch = getattr(film_off, kind.value)
    branch.detail.softness = 60
    branch.film_look_section_enabled = False
    np.testing.assert_array_equal(apply_adjustments(image, film_off, kind, include_grain=False), expected)

    weak_look = AdjustmentState()
    branch = getattr(weak_look, kind.value)
    branch.detail.softness = 60
    branch.film_look.look_strength = 0
    np.testing.assert_array_equal(apply_adjustments(image, weak_look, kind, include_grain=False), expected)


@pytest.mark.parametrize("kind", [PreviewKind.HDR, PreviewKind.SDR])
def test_detail_switch_turns_softness_and_microcontrast_off(kind: PreviewKind) -> None:
    image = _textured()
    state = AdjustmentState()
    branch = getattr(state, kind.value)
    branch.detail.softness = 40
    branch.detail.microcontrast = 50
    branch.detail_section_enabled = False
    neutral = apply_adjustments(image, AdjustmentState(), kind, include_grain=False)
    np.testing.assert_array_equal(apply_adjustments(image, state, kind, include_grain=False), neutral)

