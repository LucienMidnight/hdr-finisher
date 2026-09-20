"""Authored denoise has to reach the export, and reach it the same way.

Denoise is authored beside the grade rather than inside it: ``LoadedSession``
holds it directly, an ``EditDocument`` one level down, and neither is an
``AdjustmentState``. The export graph grades ``session.image`` through
``apply_adjustments``, which is handed an ``AdjustmentState`` -- so the
settings were simply not reachable from where export ran, and an export
silently discarded the denoise the user had authored and was looking at.

The preview replaces its source proxy with the reconstruction and grades that,
so export denoises before grading too. Otherwise the two would differ by *where
in the graph* the noise was removed, which no resolution parity could excuse.

These are the claims:

  1. An enabled denoise changes the exported pixels at all. Without this the
     rest could pass against a no-op.
  2. What export produces is exactly the reference reconstruction -- the same
     routine, the same preset, the same controls -- rather than something
     merely similar.
  3. Tiled and whole-image reconstruction agree, so the bounded route export
     takes is not a different answer from the one the contract describes.
  4. Denoise that contributes nothing is skipped rather than run: disabled,
     zero amount, or neither channel weighted.
  5. The lanes are independent. HDR denoise must not leak into an SDR export.
"""
from __future__ import annotations

import numpy as np
import pytest

from hdr_finisher.denoise_reference import (
    AnalysisPreset,
    ResolveControls,
    analyze_denoise,
    resolve_denoise,
)
from hdr_finisher.denoise_tiles import analyze_denoise_tiled, resolve_denoise_tiled
from hdr_finisher.exporters import _denoised_export_source, denoise_settings_for_export
from hdr_finisher.models import (
    AdjustmentState,
    DenoiseDocumentSettings,
    EditDocument,
    PreviewKind,
)


def test_both_shapes_that_carry_denoise_are_read() -> None:
    """The two objects export can be handed, and where each keeps the settings.

    ``LoadedSession`` holds ``denoise`` directly; ``EditDocument`` holds it one
    level down. Reading only one of them is how the denoise got dropped in the
    first place, so this pins both -- and would fail loudly if either moved.
    """
    from hdr_finisher.sessions import LoadedSession

    assert "denoise" in LoadedSession.__dataclass_fields__
    assert LoadedSession.__dataclass_fields__["denoise"].type in (
        "DenoiseDocumentSettings", DenoiseDocumentSettings,
    )
    assert EditDocument.model_fields["denoise"].annotation is DenoiseDocumentSettings
    for lane in ("hdr", "sdr"):
        assert lane in DenoiseDocumentSettings.model_fields

    image = _noisy(8, 8)
    settings = DenoiseDocumentSettings()
    settings.hdr.enabled = True
    settings.hdr.controls.amount = 0.8

    on_session = type("Session", (), {"image": image, "denoise": settings})()
    on_document = type(
        "Session", (), {"image": image, "document": _Document(settings)},
    )()
    assert denoise_settings_for_export(on_session, PreviewKind.HDR) is not None
    assert denoise_settings_for_export(on_document, PreviewKind.HDR) is not None


def _noisy(height: int = 48, width: int = 64, seed: int = 7) -> np.ndarray:
    """Scene-linear ACEScg with enough grain for denoise to have work to do."""
    generator = np.random.default_rng(seed)
    base = np.linspace(0.02, 1.4, height * width, dtype=np.float32).reshape(height, width, 1)
    base = np.repeat(base, 3, axis=2)
    noise = generator.normal(0.0, 0.05, size=(height, width, 3)).astype(np.float32)
    return np.clip(base + noise, 0.0, None).astype(np.float32)


def _session(document: EditDocument, image: np.ndarray) -> object:
    return type(
        "Session",
        (),
        {
            "session_id": "denoise-export",
            "image": image,
            "sdr_reference_image": None,
            "adjustments": AdjustmentState(),
            "local_adjustments": [],
            # A real LoadedSession holds these directly, so the fixture does too.
            "denoise": document.denoise,
        },
    )()


class _Document:
    """Only the attribute the export graph reads.

    EditDocument requires a source description and a reference white that
    have nothing to do with denoise, and coupling this to them would make it
    fail for reasons it is not about. test_the_document_really_carries_these
    keeps the stand-in honest about the real schema.
    """

    def __init__(self, denoise: DenoiseDocumentSettings) -> None:
        self.denoise = denoise


def _document(lane: str = "hdr", **overrides) -> _Document:
    document = _Document(DenoiseDocumentSettings())
    settings = getattr(document.denoise, lane)
    settings.enabled = overrides.pop("enabled", True)
    settings.analysis.levels = overrides.pop("levels", 2)
    settings.controls.amount = overrides.pop("amount", 0.8)
    settings.controls.luminance = overrides.pop("luminance", 0.7)
    settings.controls.color_noise = overrides.pop("color_noise", 0.6)
    settings.controls.detail_recovery = overrides.pop("detail_recovery", 0.3)
    assert not overrides, f"unused overrides: {overrides}"
    return document


def test_enabled_denoise_changes_the_exported_source() -> None:
    """Without this the parity checks below could pass against a no-op."""
    image = _noisy()
    denoised = _denoised_export_source(_session(_document(), image), PreviewKind.HDR)

    assert denoised.shape == image.shape
    assert not np.array_equal(denoised, image), "the export source was not denoised at all"
    # It should be removing noise, not adding energy.
    assert float(np.std(denoised - image)) > 0.0
    assert float(np.std(denoised)) < float(np.std(image))


def test_export_source_is_exactly_the_reference_reconstruction() -> None:
    image = _noisy()
    document = _document()
    lane = document.denoise.hdr

    preset = AnalysisPreset(
        levels=lane.analysis.levels,
        noise_threshold=lane.analysis.noise_threshold,
        luma_sigma=lane.analysis.luma_sigma,
        chroma_sigma=lane.analysis.chroma_sigma,
    )
    controls = ResolveControls(
        amount=lane.controls.amount,
        luminance=lane.controls.luminance,
        color_noise=lane.controls.color_noise,
        detail_recovery=lane.controls.detail_recovery,
    )
    expected = resolve_denoise_tiled(image, analyze_denoise_tiled(image, preset), controls)

    produced = _denoised_export_source(_session(document, image), PreviewKind.HDR)
    np.testing.assert_array_equal(produced, expected)


def test_the_bounded_route_equals_the_whole_image_one() -> None:
    """Export takes the tiled route; the contract is written against the whole."""
    image = _noisy()
    preset = AnalysisPreset(levels=2)
    controls = ResolveControls(amount=0.8, luminance=0.7, color_noise=0.6, detail_recovery=0.3)

    whole = resolve_denoise(image, analyze_denoise(image, preset), controls)
    tiled = resolve_denoise_tiled(image, analyze_denoise_tiled(image, preset), controls)

    np.testing.assert_array_equal(tiled, whole)


@pytest.mark.parametrize(
    ("overrides", "reason"),
    [
        ({"enabled": False}, "the lane is disabled"),
        ({"amount": 0.0}, "amount removes nothing"),
        ({"luminance": 0.0, "color_noise": 0.0}, "neither channel is weighted"),
    ],
)
def test_denoise_that_contributes_nothing_is_skipped(overrides, reason) -> None:
    """Skipped, not run to a no-op: analysis on a 42 MP frame is not free."""
    image = _noisy()
    document = _document(**overrides)
    session = _session(document, image)

    assert denoise_settings_for_export(session, PreviewKind.HDR) is None, reason
    assert _denoised_export_source(session, PreviewKind.HDR) is image, reason


def test_the_lanes_are_independent() -> None:
    image = _noisy()
    session = _session(_document("hdr"), image)

    assert denoise_settings_for_export(session, PreviewKind.HDR) is not None
    assert denoise_settings_for_export(session, PreviewKind.SDR) is None
    assert _denoised_export_source(session, PreviewKind.SDR) is image


def test_a_session_without_a_document_exports_undenoised() -> None:
    """Older sessions and test doubles carry no document; that is not an error."""
    image = _noisy()
    session = type("Session", (), {"image": image})()

    assert denoise_settings_for_export(session, PreviewKind.HDR) is None
    assert _denoised_export_source(session, PreviewKind.HDR) is image


def test_analysis_settings_reach_the_reconstruction() -> None:
    """A different level count must produce a different picture, or the
    authored analysis is being ignored and a default silently substituted."""
    image = _noisy()
    two = _denoised_export_source(_session(_document(levels=2), image), PreviewKind.HDR)
    four = _denoised_export_source(_session(_document(levels=4), image), PreviewKind.HDR)

    assert not np.array_equal(two, four)


def test_the_export_branch_actually_renders_the_denoised_source() -> None:
    """The helper above is only useful if the export graph calls it.

    This goes through ``_render_export_branch``, the function the backends
    call, so it fails if the denoise is computed and then not used -- which is
    a different bug from not computing it, and the one a unit test of the
    helper alone would miss.
    """
    from hdr_finisher.exporters import _render_export_branch
    from hdr_finisher.models import ExportSettings

    image = _noisy()
    settings = ExportSettings()

    plain = _render_export_branch(
        _session(_document(enabled=False), image), settings, PreviewKind.HDR, AdjustmentState(),
    )
    denoised = _render_export_branch(
        _session(_document(), image), settings, PreviewKind.HDR, AdjustmentState(),
    )

    assert plain.shape == denoised.shape
    assert not np.array_equal(plain, denoised), (
        "the export branch rendered identical pixels with denoise on and off, "
        "so the denoised source is being computed and discarded"
    )
