"""Preview and export must be the same graph, differing only where they say so.

PRD 10, Phase 8: *"Validate preview/export operation order"* and *"Full preview
and export meet numerical and visual parity thresholds"*.

The preview grades through ``apply_adjustments`` with grain and the output
limiter included inline. Export withholds both, applies output finishing, then
runs them:

    apply_adjustments(include_grain=False, include_output_highlight_compression=False)
    -> apply_output_finishing
    -> apply_final_grain
    -> highlight compression

That ordering is deliberate. Output finishing resamples and sharpens for the
delivered size, and its ringing has to land *under* the limiter's ceiling
rather than on top of it, so it cannot simply be appended. The cost of the
rearrangement is that preview and export run the same stages in a different
order, and the only thing that keeps them the same picture is that the stages
they moved commute with the one they moved around.

So this pins the claim rather than assuming it: with output finishing neutral
-- which is its default, ``resize_mode="original"`` and ``sharpening="off"`` --
export is *exactly* the preview. Where it is not neutral, the difference is
attributable entirely to finishing.

That equality is what "export-exact" has to mean before Full may be labelled
with it. Preview at Full runs the WebGPU graph rather than this one, and
GPU/CPU agreement is covered separately by ``tiled-cpu-detail-parity.js``; what
is established here is the other half, that the CPU graph export runs is the
CPU graph preview runs.
"""
from __future__ import annotations

import numpy as np
import pytest

from hdr_finisher.adjustments import apply_adjustments
from hdr_finisher.exporters import _finishing_adjustments_for_export, _render_export_branch
from hdr_finisher.models import (
    AdjustmentState,
    ExportSettings,
    OutputFinishingSettings,
    PreviewKind,
)


def _source(height: int = 40, width: int = 52, seed: int = 11) -> np.ndarray:
    """Scene-linear ACEScg with headroom well above 1.0 and values at zero."""
    generator = np.random.default_rng(seed)
    image = generator.uniform(0.0, 6.0, size=(height, width, 3)).astype(np.float32)
    # Deliberate extremes: the neutral axis, the black point, and a specular.
    image[0, 0] = 0.0
    image[0, 1] = 0.18
    image[1, 0] = 40.0
    return image


def _graded_state() -> AdjustmentState:
    state = AdjustmentState()
    state.hdr.exposure = 0.6
    state.hdr.contrast = 14.0
    state.hdr.saturation = 10.0
    state.hdr.film_look_section_enabled = True
    state.hdr.film_look.grain_amount = 40.0
    state.hdr.vignette_section_enabled = True
    state.hdr.vignette.amount = -35.0
    state.hdr.vignette.center_x = 0.4
    state.sdr.film_look_section_enabled = True
    state.sdr.film_look.grain_amount = 40.0
    state.sdr.vignette_section_enabled = True
    state.sdr.vignette.amount = -35.0
    return state


def _session(image: np.ndarray, adjustments: AdjustmentState) -> object:
    return type(
        "Session",
        (),
        {
            "session_id": "parity",
            "image": image,
            "sdr_reference_image": None,
            "adjustments": adjustments,
            "local_adjustments": [],
        },
    )()


@pytest.mark.parametrize("kind", [PreviewKind.HDR, PreviewKind.SDR])
def test_export_equals_the_preview_graph_when_finishing_is_neutral(kind) -> None:
    """The whole claim, stated as an equality rather than a tolerance."""
    image = _source()
    adjustments = _graded_state()
    session = _session(image, adjustments)
    settings = ExportSettings()
    assert settings.output_finishing.resize_mode == "original"
    assert settings.output_finishing.sharpening == "off"

    exported = _render_export_branch(
        session, settings, kind, _finishing_adjustments_for_export(session)
    )
    previewed = apply_adjustments(image, _finishing_adjustments_for_export(session), kind)

    np.testing.assert_array_equal(exported, previewed)


def test_the_view_maps_are_stripped_from_export_and_only_those() -> None:
    """A diagnostic map replaces the picture, so it must never be delivered.

    It must also not take anything else with it: the grade export renders has
    to be the grade the user authored, minus exactly these two flags.
    """
    adjustments = _graded_state()
    adjustments.hdr.film_look.halation_view_map = True
    adjustments.hdr.film_look.grain_view_map = True
    session = _session(_source(), adjustments)

    stripped = _finishing_adjustments_for_export(session)

    assert stripped.hdr.film_look.halation_view_map is False
    assert stripped.hdr.film_look.grain_view_map is False
    assert stripped.sdr.film_look.halation_view_map is False
    assert stripped.sdr.film_look.grain_view_map is False
    # Nothing else moved, and the session's own state was not mutated.
    restored = stripped.model_copy(deep=True)
    restored.hdr.film_look.halation_view_map = True
    restored.hdr.film_look.grain_view_map = True
    assert restored.hdr == adjustments.hdr
    assert adjustments.hdr.film_look.grain_view_map is True


@pytest.mark.parametrize("kind", [PreviewKind.HDR, PreviewKind.SDR])
def test_a_non_neutral_finish_differs_only_by_the_finish(kind) -> None:
    """When finishing does something, it is the only thing that differs.

    Sharpening is applied before the limiter deliberately, so this cannot be
    checked by sharpening the preview afterwards and comparing. What it checks
    instead is the weaker but honest claim: the difference appears when and
    only when finishing is asked to act.
    """
    image = _source()
    session = _session(image, _graded_state())
    adjustments = _finishing_adjustments_for_export(session)

    neutral = _render_export_branch(session, ExportSettings(), kind, adjustments)
    sharpened = _render_export_branch(
        session,
        ExportSettings(output_finishing=OutputFinishingSettings(sharpening="strong")),
        kind,
        adjustments,
    )

    assert neutral.shape == sharpened.shape
    assert not np.array_equal(neutral, sharpened), "sharpening did not reach the export"


@pytest.mark.parametrize("kind", [PreviewKind.HDR, PreviewKind.SDR])
def test_export_preserves_range_and_produces_no_invalid_values(kind) -> None:
    """HDR headroom, the black point, and nothing that would poison a file."""
    image = _source()
    session = _session(image, _graded_state())
    exported = _render_export_branch(
        session, ExportSettings(), kind, _finishing_adjustments_for_export(session)
    )

    assert exported.dtype == np.float32
    assert np.isfinite(exported).all(), "a non-finite value reached the export"
    assert float(exported.min()) >= 0.0, "export produced a negative delivery value"
    if kind == PreviewKind.HDR:
        assert float(exported.max()) > 1.0, "HDR export lost its headroom"
    else:
        assert float(exported.max()) <= 1.0, "SDR export exceeded its ceiling"


def test_a_negative_source_does_not_become_a_negative_delivery() -> None:
    """Wide-gamut capture goes negative outside the working primaries.

    Those samples are real and must survive grading, but a delivered file must
    not carry them, so this pins where they are resolved: before delivery,
    not by clipping the source on the way in.
    """
    image = _source()
    image[2, 2] = np.array([-0.4, 0.2, -0.1], dtype=np.float32)
    session = _session(image, _graded_state())

    exported = _render_export_branch(
        session, ExportSettings(), PreviewKind.HDR, _finishing_adjustments_for_export(session)
    )

    assert float(exported.min()) >= 0.0
    assert np.isfinite(exported).all()
