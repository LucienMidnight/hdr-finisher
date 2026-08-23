from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from hdr_finisher.color import linear_bt2020_to_acescg
from hdr_finisher.models import PreviewKind, ScopeMode
from hdr_finisher.scopes import _linear_srgb_to_signal, build_scope_from_processed


ROOT = Path(__file__).resolve().parents[1]


def _populated_bin(channel) -> int:
    populated = np.flatnonzero(np.asarray(channel.bins))
    assert populated.size == 1
    return int(populated[0])


def test_sdr_histogram_measures_display_signal_and_honors_channel_selection() -> None:
    linear_gray = np.full((1, 1, 3), 0.18, dtype=np.float32)
    scope = build_scope_from_processed(
        linear_gray,
        PreviewKind.SDR,
        ScopeMode.HISTOGRAM,
        bins=256,
        channel_names=("Y",),
    )
    expected_signal = float(_linear_srgb_to_signal(np.asarray(0.18, dtype=np.float32)))

    assert [channel.name for channel in scope.channels] == ["Y"]
    assert _populated_bin(scope.channels[0]) == int(expected_signal * 256)
    assert scope.peak_value == pytest.approx(expected_signal, abs=1e-6)
    assert [guide.label for guide in scope.guides] == ["18% signal", "50% signal", "100% signal"]


def test_sdr_histogram_flags_primary_clipping_even_when_luma_is_legal() -> None:
    scope = build_scope_from_processed(
        np.asarray([[[1.0, 0.0, 0.0]]], dtype=np.float32),
        PreviewKind.SDR,
        ScopeMode.HISTOGRAM,
        bins=64,
        channel_names=("Y",),
    )

    assert scope.peak_value == pytest.approx(0.2126, abs=1e-6)
    assert scope.clipped is True


def test_hdr_histogram_uses_bt2020_transport_primaries_and_linear_luminance() -> None:
    transport = np.asarray([[[0.18, 0.0, 0.0]]], dtype=np.float32)
    acescg = linear_bt2020_to_acescg(transport)
    scope = build_scope_from_processed(
        acescg,
        PreviewKind.HDR,
        ScopeMode.HISTOGRAM,
        bins=256,
        max_nits=4000,
        channel_names=("R", "Y"),
    )
    expected_r_nits = 203.0
    expected_y_nits = expected_r_nits * 0.2627
    expected_r_bin = int(np.log10(expected_r_nits) / np.log10(4000.0) * 256)

    assert [channel.name for channel in scope.channels] == ["R", "Y"]
    assert _populated_bin(scope.channels[0]) == expected_r_bin
    assert scope.peak_value == pytest.approx(expected_y_nits, rel=2e-5)
    assert scope.clipped is False


def test_hdr_histogram_flags_transport_primary_above_pq_limit_even_with_legal_luminance() -> None:
    peak_linear = np.float32(12000.0 * 0.18 / 203.0)
    acescg = linear_bt2020_to_acescg(np.asarray([[[peak_linear, 0.0, 0.0]]], dtype=np.float32))
    scope = build_scope_from_processed(
        acescg,
        PreviewKind.HDR,
        ScopeMode.HISTOGRAM,
        bins=64,
        max_nits=10000,
        channel_names=("Y",),
    )

    assert scope.peak_value == pytest.approx(12000.0 * 0.2627, rel=2e-5)
    assert scope.peak_value < 10000.0
    assert scope.clipped is True


def test_gpu_histogram_contract_matches_cpu_domain_and_normalization() -> None:
    javascript = (ROOT / "frontend" / "app.js").read_text(encoding="utf-8")

    assert "linearSrgbToScopeSignal" in javascript
    assert "hdrWaveformRec2020(r, g, b)" in javascript
    assert 'robustScopePopulationPeak(counts, mode === "histogram" ? 0.985 : 0.995)' in javascript
    assert 'mode === "histogram" ? "18% signal" : "18%"' in javascript
