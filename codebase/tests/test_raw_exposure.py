from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
import struct
from io import BytesIO
from PIL import Image

from hdr_finisher.analysis import classify_hdr
from hdr_finisher.loader import load_image
from hdr_finisher.models import SourceImageDescriptor
from hdr_finisher.sessions import LoadedSession
from hdr_finisher.import_defaults import fuji_dynamic_range, calibrate_camera_raw


def raf_with_dr(tmp_path, setting, selected, auto=None):
    path = tmp_path / "recorded.raf"
    header = bytearray(100)
    header[:16] = b"FUJIFILMCCD-RAW "
    fields = [(tag, value) for tag, value in [(0x1402, setting), (0x1403, selected), (0x140b, auto)] if value is not None]
    note = b'FUJIFILM' + struct.pack('<IH', 12, len(fields))
    note += b''.join(struct.pack('<HHIHH', tag, 3, 1, value, 0) for tag, value in fields) + b'\0' * 4
    exif = Image.Exif()
    exif[34665] = {37500: note}
    stream = BytesIO()
    Image.new('RGB', (2, 2)).save(stream, format='JPEG', exif=exif)
    jpeg = stream.getvalue()
    struct.pack_into('>II', header, 84, 100, len(jpeg))
    # An unrelated built-in base bias must not affect the selected DR correction.
    directory = struct.pack('>IHHhh', 1, 0x9650, 4, -113, 100)
    struct.pack_into('>II', header, 92, 100 + len(jpeg), len(directory))
    path.write_bytes(header + jpeg + directory)
    return path


@pytest.mark.parametrize('setting,selected,auto,dr,ev', [
    (1, 100, None, 100, 0), (1, 200, None, 200, 1), (1, 400, None, 400, 2),
    (0, 400, 100, 100, 0), (0, None, 200, 200, 1), (0, None, 400, 400, 2),
    (0x100, None, None, 100, 0), (0x201, None, None, 400, 2),
    (None, 400, None, None, 0), (0, 400, None, None, 0),
    (1, 800, None, None, 0), (0x8000, 400, None, None, 0),
])
def test_recorded_fuji_dr_mode_is_compensated_as_a_uniform_gain(tmp_path, setting, selected, auto, dr, ev):
    path = raf_with_dr(tmp_path, setting, selected, auto)
    assert fuji_dynamic_range(path) == dr
    original = np.asarray([[[.01, .2, 2.0], [.5, .04, .9]]], dtype=np.float32)
    pixels = original.copy()
    info = calibrate_camera_raw(pixels, path)
    np.testing.assert_allclose(pixels, original * np.float32(2 ** (-.8 + ev)))
    assert info['recorded_brightness_ev'] == ev


@pytest.mark.parametrize('damage', ['missing', 'truncated', 'invalid-header'])
def test_unreadable_fuji_dr_uses_plain_calibration(tmp_path, damage):
    path = raf_with_dr(tmp_path, 1, 400)
    if damage == 'missing':
        path.write_bytes(path.read_bytes()[:100])
    elif damage == 'truncated':
        path.write_bytes(path.read_bytes()[:110])
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
