from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
import struct

from hdr_finisher.analysis import classify_hdr
from hdr_finisher.loader import load_image
from hdr_finisher.models import SourceImageDescriptor
from hdr_finisher.sessions import LoadedSession
from hdr_finisher.import_defaults import fuji_raw_exposure_bias, calibrate_camera_raw


def raf_with_bias(tmp_path, numerator, denominator=100):
    path = tmp_path / "recorded.raf"
    header = bytearray(100)
    header[:16] = b"FUJIFILMCCD-RAW "
    directory = struct.pack('>IHHhh', 1, 0x9650, 4, numerator, denominator)
    struct.pack_into('>II', header, 92, 100, len(directory))
    path.write_bytes(header + directory)
    return path


@pytest.mark.parametrize('bias', [-72, -172, -272, -110, 0])
def test_recorded_fuji_bias_is_compensated_as_a_uniform_gain(tmp_path, bias):
    path = raf_with_bias(tmp_path, bias)
    assert fuji_raw_exposure_bias(path) == pytest.approx(bias / 100)
    original = np.asarray([[[.01, .2, 2.0], [.5, .04, .9]]], dtype=np.float32)
    pixels = original.copy()
    info = calibrate_camera_raw(pixels, path)
    np.testing.assert_allclose(pixels, original * np.float32(2 ** (-.8 - bias / 100)))
    assert info['recorded_brightness_ev'] == pytest.approx(-bias / 100)


@pytest.mark.parametrize('damage', ['missing', 'truncated', 'zero-denominator', 'invalid-header'])
def test_unreadable_fuji_bias_uses_plain_calibration(tmp_path, damage):
    path = raf_with_bias(tmp_path, -272, 0 if damage == 'zero-denominator' else 100)
    if damage == 'missing':
        path.write_bytes(path.read_bytes()[:100] + struct.pack('>I', 0))
    elif damage == 'truncated':
        path.write_bytes(path.read_bytes()[:-1])
    elif damage == 'invalid-header':
        path.write_bytes(b'not a RAF')
    pixels = np.ones((2, 2, 3), np.float32)
    assert calibrate_camera_raw(pixels, path)['recorded_brightness_ev'] == 0
    np.testing.assert_allclose(pixels, np.float32(2 ** -.8))


def test_non_raw_loader_and_library_starts_are_unchanged(tmp_path):
    from PIL import Image
    from hdr_finisher.library_pictures import default_look
    source = tmp_path / 'plain.png'
    Image.new('RGB', (8, 8), (128, 128, 128)).save(source)
    pixels, _, metadata, _, _ = load_image(source)
    assert 'raw_start_brightness' not in metadata
    grade = default_look(pixels, None, False, '.png')
    assert grade.hdr.exposure == grade.sdr.exposure == .25


def test_loaded_raw_session_starts_at_zero_in_both_renditions(tmp_path: Path) -> None:
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
        },
    )

    assert session.adjustments.hdr.exposure == 0
    assert session.adjustments.sdr.exposure == 0
    assert session.starting_adjustments() == session.adjustments
    from hdr_finisher.library_pictures import default_look
    assert default_look(image, None, True, ".arw") == session.starting_adjustments()
    session.adjustments.hdr.exposure = 2.5
    session._apply_import_defaults(session.adjustments)
    assert session.adjustments.hdr.exposure == 2.5


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

    assert session.adjustments.sdr.highlight_section_enabled is False


def test_loader_applies_only_fixed_linear_gain_before_peak_analysis(
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

    original = image.copy()
    pixels, _, metadata, analysis, _ = load_image(source_path)

    np.testing.assert_allclose(pixels, original * np.float32(2 ** -.8))
    assert metadata["raw_start_brightness"]["calibration_ev"] == -.8
    assert analysis.peak_linear == pytest.approx(float(np.max(pixels)))
    assert "recommended_exposure_ev" not in metadata
    assert "recommended_sdr_exposure_ev" not in metadata
