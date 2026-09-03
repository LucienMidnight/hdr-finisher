from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from hdr_finisher.analysis import classify_hdr
from hdr_finisher.loader import _recommended_raw_exposure_ev, load_image
from hdr_finisher.models import SourceImageDescriptor
from hdr_finisher.sessions import LoadedSession


def test_loaded_raw_session_applies_shared_editable_starting_exposure(tmp_path: Path) -> None:
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
        },
    )

    assert session.adjustments.hdr.exposure == pytest.approx(1.25)
    assert session.adjustments.sdr.exposure == pytest.approx(1.25)
    assert session.metadata["default_exposure_applied"] == {
        "hdr_ev": 1.25,
        "sdr_ev": 1.25,
        "method": "bounded_median_and_p90_minus_1_5_ev",
    }


def test_raw_meter_does_not_darken_a_source_that_does_not_need_an_automatic_lift() -> None:
    image = np.full((20, 20, 3), 0.18, dtype=np.float32)

    assert _recommended_raw_exposure_ev(image) == pytest.approx(-0.009)


def test_raw_meter_shifts_its_brightening_limit_down_by_one_and_a_half_stops() -> None:
    image = np.full((20, 20, 3), 1e-5, dtype=np.float32)

    assert _recommended_raw_exposure_ev(image) == pytest.approx(2.5)


def test_loaded_authored_sdr_reference_starts_without_extra_highlight_recovery(tmp_path: Path) -> None:
    source_path = tmp_path / "source.avif"
    source_path.write_bytes(b"synthetic gain map")
    image = np.full((4, 4, 3), 0.18, dtype=np.float32)
    descriptor = SourceImageDescriptor(
        filename=source_path.name,
        suffix=".avif",
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
        session_id="authored-sdr",
        source_path=source_path,
        image=image,
        sdr_reference_image=np.full_like(image, 0.5),
        source=descriptor,
        analysis=classify_hdr(image, {"transfer_function": "LINEAR"}, ".avif"),
        metadata={},
    )

    assert session.adjustments.sdr.highlight_recovery == 0.0
    assert session.adjustments.sdr.highlight_section_enabled is False


def test_loader_records_raw_recommendation_without_baking_an_sdr_override(
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

    assert metadata["recommended_exposure_ev"] > 0.0
    assert "recommended_sdr_exposure_ev" not in metadata
