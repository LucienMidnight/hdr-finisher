"""Decoded HDR target enforcement and local correction."""
import numpy as np
import pytest

from hdr_finisher import hdr_ceiling

NITS = .18 / 203


def scene(peak_nits=1000):
    image = np.full((96, 128, 3), 100 * NITS, np.float32)
    image[40:56, 60:76] = peak_nits * NITS  # one bright patch; the rest is mid-grey
    return image


def ringing_codec(overshoot=1.07):
    """A fake codec whose decode overshoots next to bright edges, like JPEG ringing."""
    calls = []

    def encode(image):
        calls.append(image.copy())
        return image

    def decode(image):
        nits = hdr_ceiling.channel_nits(image, 203)
        bright = nits > 0.5 * nits.max()
        edge = bright & ~(np.roll(bright, 1, 0) & np.roll(bright, -1, 0) & np.roll(bright, 1, 1) & np.roll(bright, -1, 1))
        return np.where(edge, nits * overshoot, nits)

    return encode, decode, calls


def test_overshoot_is_brought_under_the_finished_peak():
    encode, decode, calls = ringing_codec()
    delivered = hdr_ceiling.encode_within_ceiling(scene(), 203, encode, decode, 1000)
    assert decode(delivered).max() <= 1000.0
    assert len(calls) >= 2


def test_only_the_neighbourhood_of_the_overshoot_changes():
    encode, decode, _ = ringing_codec()
    original = scene()
    delivered = hdr_ceiling.encode_within_ceiling(original, 203, encode, decode, 1000)
    far = (slice(0, 8), slice(0, 8))  # well outside the patch and its fade
    np.testing.assert_array_equal(delivered[far], original[far])
    # The patch keeps nearly all of its brightness: no whole-image dimming.
    assert hdr_ceiling.channel_nits(delivered, 203).max() > 0.85 * 1000


def test_a_clean_codec_is_encoded_once_and_left_alone():
    calls = []
    original = scene()
    delivered = hdr_ceiling.encode_within_ceiling(original, 203, lambda image: calls.append(image) or image,
        lambda image: hdr_ceiling.channel_nits(image, 203), 1000)
    assert len(calls) == 1
    np.testing.assert_array_equal(delivered, original)


@pytest.mark.parametrize("peak", [600, 799, 800, 801])
def test_every_checked_delivery_is_decoded_even_with_input_headroom(peak):
    decoded = []
    hdr_ceiling.encode_within_ceiling(scene(peak), 203, lambda image: image,
        lambda image: decoded.append(True) or hdr_ceiling.channel_nits(image), 1000)
    assert len(decoded) == 1


@pytest.mark.parametrize("peak", [1000, 1005, 1010])
def test_encoding_allowance_preserves_bytes_and_adds_no_note(peak):
    assert hdr_ceiling.ENCODING_ALLOWANCE == 0.01
    notes, calls = [], []
    original = scene()
    delivered = hdr_ceiling.encode_within_ceiling(original, 203,
        lambda image: calls.append(image) or b"encoded bytes",
        lambda payload: np.full(original.shape[:2], peak, np.float32), 1000, notes,
        encoding_allowance=hdr_ceiling.ENCODING_ALLOWANCE)
    assert delivered == b"encoded bytes" and len(calls) == 1 and notes == []


def test_above_allowance_aims_below_target_even_if_a_round_is_within_allowance():
    calls = []
    peaks = iter([1010.01, 1005, 995])
    hdr_ceiling.encode_within_ceiling(scene(), 203,
        lambda image: calls.append(image) or image,
        lambda image: np.full(image.shape[:2], next(peaks), np.float32), 1000,
        encoding_allowance=hdr_ceiling.ENCODING_ALLOWANCE)
    assert len(calls) == 3


def test_last_round_can_accept_encoding_rounding_but_codec_limit_has_no_allowance():
    calls = []
    def decode(image):
        return np.full(image.shape[:2], 1012 if len(calls) == 1 else 1005, np.float32)
    hdr_ceiling.encode_within_ceiling(scene(), 203,
        lambda image: calls.append(image) or image, decode, 1000,
        encoding_allowance=hdr_ceiling.ENCODING_ALLOWANCE)
    assert len(calls) == len(hdr_ceiling.MARGINS) + 1
    with pytest.raises(hdr_ceiling.CeilingError):
        hdr_ceiling.encode_within_ceiling(scene(), 203, lambda image: image,
            lambda image: np.full(image.shape[:2], 10050, np.float32), 10000)


def test_proof_preserves_the_peak_option_and_its_cache_signature():
    from hdr_finisher.models import ProofArtifactRequest
    off = ProofArtifactRequest()
    on = ProofArtifactRequest(guarantee_hdr_peak=True)
    assert not off.to_export_settings('off.jpg').guarantee_hdr_peak
    assert on.to_export_settings('on.jpg').guarantee_hdr_peak
    assert off.model_dump_json() != on.model_dump_json()


def test_an_uncorrectable_codec_is_rejected():
    notes = []
    with pytest.raises(hdr_ceiling.CeilingError, match="1000-nit target"):
        hdr_ceiling.encode_within_ceiling(scene(), 203, lambda image: image,
            lambda image: np.full(image.shape[:2], 1012.0, np.float32), 1000, notes,
            encoding_allowance=hdr_ceiling.ENCODING_ALLOWANCE)
    assert notes == []


def test_an_export_that_stays_over_target_preserves_the_destination(monkeypatch, tmp_path):
    from types import SimpleNamespace
    from hdr_finisher import exporters
    from hdr_finisher.capabilities import probe_capabilities
    from hdr_finisher.models import AdjustmentState, ExportSettings
    backend = exporters.build_export_backends(probe_capabilities())["jpegxl_hdr"]
    if backend.capability.status.value != "available":
        pytest.skip(backend.capability.detail)
    monkeypatch.setattr(exporters, "_decoded_jpegxl_channel_nits", lambda payload: np.full((96, 128), 1012.0, np.float32))
    adjustments = AdjustmentState()
    adjustments.hdr.highlight_section_enabled = True
    adjustments.hdr.highlight_compression_target_nits = 1000
    session = SimpleNamespace(session_id="note", image=scene(4000), adjustments=adjustments, hdr_reference_white_nits=203,
        sdr_reference_image=None, local_adjustments=[])
    output = tmp_path / "existing.jxl"
    output.write_bytes(b"previous export")
    result = backend.export(session, ExportSettings(format="jpegxl_hdr", quality=90, overwrite=True,
        output_path=str(output)))
    assert not result.accepted
    assert "1000-nit target" in result.message
    assert output.read_bytes() == b"previous export"
    assert list(tmp_path.iterdir()) == [output]


@pytest.mark.parametrize("format_name", ["jpeg_ultrahdr", "avif_gain_map", "jpegxl_hdr"])
@pytest.mark.parametrize("highlights", [False, True])
def test_only_active_highlights_get_the_encoding_allowance(monkeypatch, tmp_path, format_name, highlights):
    from types import SimpleNamespace
    from hdr_finisher import exporters
    from hdr_finisher.capabilities import probe_capabilities
    from hdr_finisher.models import AdjustmentState, ExportSettings
    backend = exporters.build_export_backends(probe_capabilities())[format_name]
    if backend.capability.status.value != "available":
        pytest.skip(backend.capability.detail)
    def decoded(*args):
        return np.full((96, 128), 10050.0, np.float32)
    monkeypatch.setattr(exporters, "decoded_channel_nits", decoded)
    monkeypatch.setattr(exporters, "_decoded_jpegxl_channel_nits", decoded)
    adjustments = AdjustmentState()
    adjustments.hdr.highlight_section_enabled = highlights
    adjustments.hdr.highlight_compression_target_nits = 10000
    session = SimpleNamespace(session_id="allowance", image=scene(), adjustments=adjustments,
        hdr_reference_white_nits=203, sdr_reference_image=None, local_adjustments=[])
    result = backend.export(session, ExportSettings(format=format_name, quality=90,
        guarantee_hdr_peak=True, output_path=str(tmp_path / "delivery")))
    assert result.accepted is highlights, result.message
    assert result.delivery_notes == []


def test_a_codec_can_overshoot_despite_input_headroom():
    original = scene(peak_nits=600)
    encode, decode, calls = ringing_codec(overshoot=2.0)
    delivered = hdr_ceiling.encode_within_ceiling(original, 203, encode, decode, 1000)
    assert decode(delivered).max() <= 1000
    assert len(calls) >= 2


@pytest.mark.parametrize("invalid", [float("nan"), float("inf")])
def test_non_finite_decoded_pixels_cannot_pass(invalid):
    with pytest.raises(hdr_ceiling.CeilingError, match="non-finite"):
        hdr_ceiling.encode_within_ceiling(scene(), 203, lambda image: image,
            lambda image: np.full(image.shape[:2], invalid, np.float32), 1000)


def test_the_ceiling_is_the_target_only_while_highlight_compression_is_on():
    from hdr_finisher.models import AdjustmentState
    adjustments = AdjustmentState()
    adjustments.hdr.highlight_compression_target_nits = 1000
    adjustments.hdr.highlight_section_enabled = False
    assert hdr_ceiling.delivery_ceiling_nits(adjustments) == 10000
    adjustments.hdr.highlight_section_enabled = True
    assert hdr_ceiling.delivery_ceiling_nits(adjustments) == 1000


@pytest.mark.parametrize("format_name", ["jpeg_ultrahdr", "avif_gain_map", "jpegxl_hdr"])
@pytest.mark.parametrize("full_size", [False, True])
def test_real_encoders_land_at_or_under_a_bright_edge_peak(tmp_path, format_name, full_size):
    from types import SimpleNamespace
    from pathlib import Path
    from hdr_finisher import hdr_delivery
    from hdr_finisher.capabilities import probe_capabilities
    from hdr_finisher.exporters import build_export_backends
    from hdr_finisher.models import AdjustmentState, ExportSettings
    backend = build_export_backends(probe_capabilities())[format_name]
    if backend.capability.status.value != "available":
        pytest.skip(backend.capability.detail)
    checker = np.where(np.indices((512, 512)).sum(0)[..., None] % 2, 4000 * NITS, 30 * NITS).astype(np.float32).repeat(3, -1)
    adjustments = AdjustmentState()
    adjustments.hdr.highlight_section_enabled = True
    adjustments.hdr.highlight_compression_target_nits = 1000
    session = SimpleNamespace(session_id="ceiling", image=checker, adjustments=adjustments, hdr_reference_white_nits=203,
        sdr_reference_image=None, local_adjustments=[])
    result = backend.export(session, ExportSettings(format=format_name, quality=90,
        output_path=str(tmp_path / "edge")))
    assert result.accepted, result.message
    assert hdr_delivery.decoded_hdr_peak_nits(Path(result.output_path), format_name) <= 1000 * (1 + hdr_ceiling.ENCODING_ALLOWANCE)
    from hdr_finisher.color_context import RenderColorContext
    from hdr_finisher.render_cache import SessionRenderCache
    from hdr_finisher.models import ProofArtifactRequest
    from hdr_finisher.proofing import ProofArtifactStore
    import hashlib
    session.color_context = RenderColorContext(203)
    session.render_cache = SessionRenderCache(checker, None, color_context=session.color_context)
    session.denoise = None
    store = ProofArtifactStore()
    try:
        proof = store.create(session, ProofArtifactRequest(adjustments=adjustments,
            format=format_name, quality=90, full_size=full_size, long_edge=256), backend)
        assert hdr_delivery.decoded_hdr_peak_nits(store.artifact(proof.artifact_id).path, format_name) <= 1000 * (1 + hdr_ceiling.ENCODING_ALLOWANCE)
        if full_size:
            assert proof.sha256 == hashlib.sha256(Path(result.output_path).read_bytes()).hexdigest()
    finally:
        store.clear()


def test_bypassed_highlights_without_explicit_check_still_encode_once(monkeypatch, tmp_path):
    from types import SimpleNamespace
    from hdr_finisher import exporters
    from hdr_finisher.capabilities import probe_capabilities
    from hdr_finisher.models import AdjustmentState, ExportSettings
    assert ExportSettings().guarantee_hdr_peak is False
    backend = exporters.build_export_backends(probe_capabilities())["jpegxl_hdr"]
    if backend.capability.status.value != "available":
        pytest.skip(backend.capability.detail)
    def never(payload):
        raise AssertionError("The peak check ran although the preset did not ask for it.")
    monkeypatch.setattr(exporters, "_decoded_jpegxl_channel_nits", never)
    adjustments = AdjustmentState()
    adjustments.hdr.highlight_section_enabled = False
    adjustments.hdr.highlight_compression_target_nits = 1000
    session = SimpleNamespace(session_id="off", image=scene(4000), adjustments=adjustments, hdr_reference_white_nits=203,
        sdr_reference_image=None, local_adjustments=[])
    result = backend.export(session, ExportSettings(format="jpegxl_hdr", quality=90, output_path=str(tmp_path / "off")))
    assert result.accepted and result.delivery_notes == []


@pytest.mark.parametrize("format_name", ["jpeg_ultrahdr", "avif_gain_map", "jpegxl_hdr"])
def test_compliant_encoded_bytes_do_not_change(monkeypatch, tmp_path, format_name):
    from types import SimpleNamespace
    from pathlib import Path
    from hdr_finisher import exporters
    from hdr_finisher.capabilities import probe_capabilities
    from hdr_finisher.models import AdjustmentState, ExportSettings
    backend = exporters.build_export_backends(probe_capabilities())[format_name]
    if backend.capability.status.value != "available":
        pytest.skip(backend.capability.detail)
    adjustments = AdjustmentState()
    adjustments.hdr.highlight_section_enabled = True
    adjustments.hdr.highlight_compression_target_nits = 1000
    session = SimpleNamespace(session_id="unchanged", image=scene(600), adjustments=adjustments,
        hdr_reference_white_nits=203, sdr_reference_image=None, local_adjustments=[])
    checked = backend.export(session, ExportSettings(format=format_name, quality=90,
        output_path=str(tmp_path / "checked")))
    assert checked.accepted, checked.message
    assert hdr_ceiling.decoded_channel_nits(Path(checked.output_path), format_name).max() <= 1000
    monkeypatch.setattr(exporters, "_peak_ceiling", lambda *args: None)
    unchecked = backend.export(session, ExportSettings(format=format_name, quality=90,
        output_path=str(tmp_path / "unchecked")))
    assert unchecked.accepted, unchecked.message
    assert Path(checked.output_path).read_bytes() == Path(unchecked.output_path).read_bytes()
