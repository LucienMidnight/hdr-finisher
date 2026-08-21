from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from hdr_finisher.analysis import classify_hdr
from hdr_finisher.loader import (
    _recommended_mosaiced_raw_sdr_exposure_ev,
    _recommended_raw_exposure_ev,
    load_image,
)
from hdr_finisher.models import SourceImageDescriptor
from hdr_finisher.sessions import LoadedSession


def test_mosaiced_raw_sdr_meter_lifts_dark_midtones_beyond_hdr_recommendation() -> None:
    image = np.full((20, 20, 3), 0.005, dtype=np.float32)
    image[:2] = 1.0

    hdr_ev = _recommended_raw_exposure_ev(image)
    sdr_ev = _recommended_mosaiced_raw_sdr_exposure_ev(image, hdr_ev)

    assert sdr_ev == pytest.approx(5.0)
    assert sdr_ev > hdr_ev


def test_mosaiced_raw_sdr_meter_lifts_middle_gray_to_a_photographic_display_midpoint() -> None:
    image = np.full((20, 20, 3), 0.18, dtype=np.float32)

    sdr_ev = _recommended_mosaiced_raw_sdr_exposure_ev(image, -1.0)

    assert sdr_ev == pytest.approx(1.322)


def test_mosaiced_raw_sdr_meter_does_not_darken_an_already_bright_source() -> None:
    image = np.full((20, 20, 3), 0.5, dtype=np.float32)

    sdr_ev = _recommended_mosaiced_raw_sdr_exposure_ev(image, -1.0)

    assert sdr_ev == 0.0


def test_loaded_raw_session_applies_independent_hdr_and_sdr_starting_exposures(tmp_path: Path) -> None:
    source_path = tmp_path / "source.arw"
    source_path.write_bytes(b"synthetic raw")
    image = np.full((4, 4, 3), 0.18, dtype=np.float32)
    descriptor = SourceImageDescriptor(
        filename=source_path.name,
        suffix=".arw",
        width=4,
        height=4,
        channels=3,
        dtype="float32",
        source_color_space="ACEScg",
        transfer_function="LINEAR",
        interpretation_mode="auto",
        color_space_confident=True,
    )
    session = LoadedSession(
        session_id="raw-exposure",
        source_path=source_path,
        image=image,
        sdr_reference_image=None,
        source=descriptor,
        analysis=classify_hdr(image, {"transfer_function": "LINEAR"}, ".arw"),
        metadata={
            "raw_input": True,
            "recommended_exposure_ev": 1.25,
            "recommended_sdr_exposure_ev": 3.5,
        },
    )

    assert session.adjustments.hdr.exposure == pytest.approx(1.25)
    assert session.adjustments.sdr.exposure == pytest.approx(3.5)
    assert session.metadata["default_exposure_applied"] == {
        "hdr_ev": 1.25,
        "sdr_ev": 3.5,
        "method": "bounded_hdr_median_and_p90_plus_sdr_display_midtones",
    }


def test_loader_adds_independent_sdr_recommendation_only_for_mosaiced_raw(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source_path = tmp_path / "source.arw"
    source_path.write_bytes(b"synthetic raw")
    image = np.full((20, 20, 3), 0.005, dtype=np.float32)
    image[:2] = 1.0

    monkeypatch.setattr(
        "hdr_finisher.loader.decode_raw",
        lambda *_args, **_kwargs: (
            image,
            {
                "raw_input": True,
                "raw_mosaiced": True,
                "color_space": "ACEScg",
                "transfer_function": "LINEAR",
                "decoder_normalized_to_acescg": True,
            },
        ),
    )

    _, _, metadata, _, _ = load_image(source_path)

    assert metadata["recommended_sdr_exposure_ev"] == pytest.approx(5.0)
    assert metadata["recommended_sdr_exposure_ev"] > metadata["recommended_exposure_ev"]
