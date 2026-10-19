"""Optional decoded HDR peak check, local correction and delivery notes."""
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


@pytest.mark.parametrize("peak, checks", [(799, 0), (800, 0), (801, 1)])
def test_twenty_percent_headroom_boundary(peak, checks):
    decoded = []
    hdr_ceiling.encode_within_ceiling(scene(peak), 203, lambda image: image,
        lambda image: decoded.append(True) or hdr_ceiling.channel_nits(image), 1000)
    assert len(decoded) == checks


def test_proof_preserves_the_peak_option_and_its_cache_signature():
    from hdr_finisher.models import ProofArtifactRequest
    off = ProofArtifactRequest()
    on = ProofArtifactRequest(guarantee_hdr_peak=True)
    assert not off.to_export_settings('off.jpg').guarantee_hdr_peak
    assert on.to_export_settings('on.jpg').guarantee_hdr_peak
    assert off.model_dump_json() != on.model_dump_json()


def test_an_uncorrectable_codec_delivers_with_a_note():
    notes = []
    delivered = hdr_ceiling.encode_within_ceiling(scene(), 203, lambda image: image,
        lambda image: np.full(image.shape[:2], 1012.0, np.float32), 1000, notes)
    assert delivered is not None
    assert len(notes) == 1 and "12 above the 1000-nit target" in notes[0]


def test_an_export_that_stays_over_target_is_delivered_with_a_note(monkeypatch, tmp_path):
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
    result = backend.export(session, ExportSettings(format="jpegxl_hdr", quality=90, guarantee_hdr_peak=True,
        output_path=str(tmp_path / "note")))
    assert result.accepted
    assert "12 above the 1000-nit target" in result.delivery_notes[0]
    assert list(tmp_path.iterdir())


def test_pictures_far_below_the_ceiling_skip_decoding():
    """The ceiling is the highlight compression target, not the picture's own peak."""
    decoded = []
    original = scene(peak_nits=600)
    delivered = hdr_ceiling.encode_within_ceiling(original, 203, lambda image: image,
        lambda image: decoded.append(image) or np.full(image.shape[:2], 650.0, np.float32), 1000)
    assert len(decoded) == 0
    np.testing.assert_array_equal(delivered, original)


def test_the_ceiling_is_the_target_only_while_highlight_compression_is_on():
    from hdr_finisher.models import AdjustmentState
    adjustments = AdjustmentState()
    adjustments.hdr.highlight_compression_target_nits = 1000
    adjustments.hdr.highlight_section_enabled = False
    assert hdr_ceiling.delivery_ceiling_nits(adjustments) == 10000
    adjustments.hdr.highlight_section_enabled = True
    assert hdr_ceiling.delivery_ceiling_nits(adjustments) == 1000


@pytest.mark.parametrize("format_name", ["jpeg_ultrahdr", "avif_gain_map", "jpegxl_hdr"])
def test_real_encoders_land_at_or_under_a_bright_edge_peak(tmp_path, format_name):
    from types import SimpleNamespace
    from pathlib import Path
    from hdr_finisher import hdr_delivery
    from hdr_finisher.capabilities import probe_capabilities
    from hdr_finisher.exporters import build_export_backends
    from hdr_finisher.models import AdjustmentState, ExportSettings
    backend = build_export_backends(probe_capabilities())[format_name]
    if backend.capability.status.value != "available":
        pytest.skip(backend.capability.detail)
    checker = np.where(np.indices((128, 128)).sum(0)[..., None] % 2, 4000 * NITS, 30 * NITS).astype(np.float32).repeat(3, -1)
    adjustments = AdjustmentState()
    adjustments.hdr.highlight_section_enabled = True
    adjustments.hdr.highlight_compression_target_nits = 1000
    session = SimpleNamespace(session_id="ceiling", image=checker, adjustments=adjustments, hdr_reference_white_nits=203,
        sdr_reference_image=None, local_adjustments=[])
    result = backend.export(session, ExportSettings(format=format_name, quality=90, guarantee_hdr_peak=True,
        output_path=str(tmp_path / "edge")))
    assert result.accepted, result.message
    assert hdr_delivery.decoded_hdr_peak_nits(Path(result.output_path), format_name) <= 1000
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
            format=format_name, quality=90, guarantee_hdr_peak=True, full_size=True), backend)
        assert proof.sha256 == hashlib.sha256(Path(result.output_path).read_bytes()).hexdigest()
    finally:
        store.clear()


@pytest.mark.parametrize("highlights", [False, True])
def test_default_option_does_not_decode_even_with_highlights_enabled(monkeypatch, tmp_path, highlights):
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
    adjustments.hdr.highlight_section_enabled = highlights
    adjustments.hdr.highlight_compression_target_nits = 1000
    session = SimpleNamespace(session_id="off", image=scene(4000), adjustments=adjustments, hdr_reference_white_nits=203,
        sdr_reference_image=None, local_adjustments=[])
    result = backend.export(session, ExportSettings(format="jpegxl_hdr", quality=90, output_path=str(tmp_path / "off")))
    assert result.accepted and result.delivery_notes == []
