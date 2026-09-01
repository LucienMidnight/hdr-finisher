from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from conftest import fixture_path

from hdr_finisher.color import linear_bt2020_to_acescg
from hdr_finisher.loader import load_image
from hdr_finisher.models import AdjustmentState, HDRAdjustments, PreviewKind, ScopeMode, ToneEqualizerNode
from hdr_finisher.scopes import _waveform_grid, build_scope, build_scope_from_processed


def _channel(scope, name: str):
    return next(channel for channel in scope.channels if channel.name == name)


def test_hdr_rgb_parade_measures_rec2020_transport_primaries() -> None:
    rec2020 = np.array(
        [[[0.18, 0.0, 0.0], [0.0, 0.18, 0.0], [0.0, 0.0, 0.18]]],
        dtype=np.float32,
    )
    acescg = linear_bt2020_to_acescg(rec2020)

    scope = build_scope_from_processed(
        acescg,
        PreviewKind.HDR,
        ScopeMode.WAVEFORM,
        bins=128,
        waveform_columns=3,
    )
    edges = np.asarray(scope.bin_edges, dtype=np.float32)
    for index, name in enumerate(("R", "G", "B")):
        channel_nits = np.clip(rec2020[..., index] / np.float32(0.18) * np.float32(203.0), 1.0, 4000.0)
        assert _channel(scope, name).grid == _waveform_grid(channel_nits, edges, 3)

    # Rec.2020 red contributes 26.27% of luminance, so the luma trace remains
    # physically separate from the 203-nit red-primary trace.
    assert scope.peak_value == pytest.approx(203.0 * 0.6780, rel=2e-5)


def test_blender_rec2020_exr_parade_round_trips_source_channels() -> None:
    import OpenEXR

    path = fixture_path("blender_linear_rec2020.exr")
    raw_rec2020 = np.asarray(OpenEXR.File(str(path)).channels()["RGB"].pixels, dtype=np.float32)[..., :3]
    normalized_acescg, *_ = load_image(path)
    scope = build_scope_from_processed(
        normalized_acescg,
        PreviewKind.HDR,
        ScopeMode.WAVEFORM,
        bins=64,
        waveform_columns=8,
    )
    edges = np.asarray(scope.bin_edges, dtype=np.float32)
    for index, name in enumerate(("R", "G", "B")):
        expected_nits = np.clip(raw_rec2020[..., index], 0.0, None) / np.float32(0.18) * np.float32(203.0)
        expected = _waveform_grid(np.clip(expected_nits, 1.0, 4000.0), edges, 8)
        assert _channel(scope, name).grid == expected


def test_sdr_waveform_is_output_signal_and_flags_primary_clipping() -> None:
    image = np.array([[[1.0, 0.0, 0.0], [0.18, 0.18, 0.18]]], dtype=np.float32)
    scope = build_scope_from_processed(
        image,
        PreviewKind.SDR,
        ScopeMode.WAVEFORM,
        bins=100,
        waveform_columns=2,
    )

    red_grid = np.asarray(_channel(scope, "R").grid)
    # A conventional SDR waveform measures the nonlinear output signal, so an
    # 18% linear-light patch lands at about 46% signal.
    assert red_grid[18, 1] == 0
    assert red_grid[46, 1] == 1
    assert [guide.label for guide in scope.guides] == ["18% signal", "50% signal", "100% signal"]
    expected_signal = 1.055 * 0.18 ** (1.0 / 2.4) - 0.055
    assert scope.peak_value == pytest.approx(expected_signal, rel=1e-6)
    assert scope.clipped is True


def test_hdr_scope_peak_hits_peak_fit_target_when_compression_is_final_tonal_operation() -> None:
    source_peak_nits = 4000.0
    image = np.full((4, 4, 3), source_peak_nits * 0.18 / 203.0, dtype=np.float32)
    adjustments = AdjustmentState(
        hdr=HDRAdjustments(
            highlight_compression_mode="peak_fit",
            highlight_compression_start_nits=400.0,
            highlight_compression_target_nits=1000.0,
            highlight_compression_source_peak_nits=source_peak_nits,
        )
    )

    scope = build_scope(image, adjustments, PreviewKind.HDR)

    assert scope.peak_value == pytest.approx(1000.0, rel=5e-5)


def test_hdr_scope_reports_legitimate_re_expansion_after_peak_fit() -> None:
    source_peak_nits = 4000.0
    image = np.full((4, 4, 3), source_peak_nits * 0.18 / 203.0, dtype=np.float32)
    adjustments = AdjustmentState(
        hdr=HDRAdjustments(
            highlight_compression_mode="peak_fit",
            highlight_compression_start_nits=400.0,
            highlight_compression_target_nits=1000.0,
            highlight_compression_source_peak_nits=source_peak_nits,
            tone_equalizer_nodes=[
                ToneEqualizerNode(input_ev=float(input_ev), adjustment_ev=2.0)
                for input_ev in range(-6, 7)
            ],
        )
    )

    scope = build_scope(image, adjustments, PreviewKind.HDR)

    # Highlight Compression anchors the signal at its own stage. The Tone
    # Equalizer is downstream and may intentionally lift that result; scopes
    # must continue reporting the completed grade rather than the module target.
    assert scope.peak_value == pytest.approx(4000.0, rel=8e-5)
    assert scope.peak_value > adjustments.hdr.highlight_compression_target_nits


def test_gpu_waveform_uses_the_same_acescg_to_rec2020_matrix() -> None:
    app = (Path(__file__).resolve().parents[1] / "frontend" / "app.js").read_text(encoding="utf-8")

    assert "function hdrWaveformRec2020(r, g, b)" in app
    for coefficient in (
        "1.0260187082",
        "0.0221655448",
        "0.0038531634",
        "0.0017230808",
        "1.0023190716",
        "0.0005959908",
        "0.0051099278",
        "0.0216355504",
        "1.0267454781",
    ):
        assert coefficient in app
    assert "? hdrWaveformRec2020(r, g, b)" in app
    assert "[linearSrgbToScopeSignal(r), linearSrgbToScopeSignal(g), linearSrgbToScopeSignal(b)]" in app
    assert ": r >= 1 || g >= 1 || b >= 1;" in app
