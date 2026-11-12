import numpy as np
import pytest
from hdr_finisher.models import ExportSettings, ProofArtifactRequest, WatermarkSettings
from hdr_finisher.watermark import apply_watermark


def test_disabled_is_noop_and_enabled_preserves_source():
    image = np.full((200, 300, 3), .1, dtype=np.float32)
    assert apply_watermark(image, WatermarkSettings(), "hdr") is image
    marked = apply_watermark(image, WatermarkSettings(mode="text", text="Test"), "hdr")
    assert np.all(image == .1)
    assert np.any(marked != image)
    assert np.array_equal(marked[:100], image[:100])


@pytest.mark.parametrize("corner", ["top_left", "top_right", "bottom_left", "bottom_right"])
def test_test_labels_differ_and_respect_ceiling(corner):
    image = np.full((200, 300, 3), .1, dtype=np.float32)
    settings = WatermarkSettings(mode="rendition_test", position=corner)
    hdr = apply_watermark(image, settings, "hdr", 203, 250)
    sdr = apply_watermark(image, settings, "sdr")
    assert not np.allclose(hdr / .18, sdr)
    assert hdr.max() * 203 / .18 <= 250.001
    # The backing panel is the same relative luminance in each rendition.
    both = (hdr[..., 0] != image[..., 0]) & (sdr[..., 0] != image[..., 0])
    assert np.any(np.isclose(hdr[..., 0][both] / .18, .2))


def test_proof_and_export_settings_round_trip():
    request = ProofArtifactRequest(watermark={"mode": "rendition_test", "text": "Test"})
    rebuilt = ProofArtifactRequest.model_validate(request.model_dump())
    export = rebuilt.to_export_settings("test.jpg")
    assert export.watermark == request.watermark
    assert ExportSettings.model_validate(export.model_dump()).watermark == request.watermark


def test_invalid_settings_and_tiny_output():
    for settings in ({"size": float("nan")}, {"opacity": float("inf")}, {"text": "two\nlines"}):
        with pytest.raises(ValueError):
            WatermarkSettings(**settings)
    image = np.ones((1, 1, 3), dtype=np.float32)
    assert apply_watermark(image, WatermarkSettings(mode="rendition_test"), "hdr").shape == image.shape


@pytest.mark.parametrize("format", ["jpeg_ultrahdr", "avif_gain_map"])
def test_real_encoded_labels_and_full_proof_identity(tmp_path, format):
    from types import SimpleNamespace
    import hashlib
    from hdr_finisher.capabilities import probe_capabilities
    from hdr_finisher.exporters import build_export_backends, _render_export_branch
    from hdr_finisher.models import AdjustmentState, PreviewKind
    from hdr_finisher.color_context import RenderColorContext
    from hdr_finisher.gainmap_decoders import decode_ultrahdr_jpeg, decode_avif
    from hdr_finisher.proofing import ProofArtifactStore
    from hdr_finisher.render_cache import SessionRenderCache
    backends = build_export_backends(probe_capabilities())
    backend = backends[format]
    if backend.capability.status.value != "available":
        pytest.skip(backend.capability.detail)
    image = np.full((384, 512, 3), .05, dtype=np.float32)
    adjustments = AdjustmentState()
    session = SimpleNamespace(session_id="watermark", image=image, sdr_reference_image=None,
        adjustments=adjustments, local_adjustments=[], denoise=None, edit_revision=0,
        hdr_reference_white_nits=203, color_context=RenderColorContext(203),
        render_cache=SessionRenderCache(image, None))
    watermark = WatermarkSettings(mode="rendition_test", text="Test", size=10)
    path = tmp_path / ("test.jpg" if format == "jpeg_ultrahdr" else "test.avif")
    settings = ExportSettings(format=format, output_path=str(path), quality=100,
        jpeg_chroma_subsampling="444", avif_chroma_subsampling="444",
        avif_gain_map_scale="full", watermark=watermark)
    result = backend.export(session, settings)
    assert result.accepted, result.message
    hdr, sdr, _ = (decode_ultrahdr_jpeg if format == "jpeg_ultrahdr" else decode_avif)(path)
    expected_hdr = _render_export_branch(session, settings, PreviewKind.HDR, adjustments)
    expected_sdr = _render_export_branch(session, settings, PreviewKind.SDR, adjustments)
    # Classify the actual decoded label against both authored labels. Restrict
    # to differing glyph pixels so the untouched photo cannot hide a failure.
    distinct = np.abs(expected_hdr[..., 0] / .18 - expected_sdr[..., 0]) > .3
    assert distinct.sum() > 100
    assert np.mean(abs(hdr[distinct] - expected_hdr[distinct])) < np.mean(abs(hdr[distinct] - expected_sdr[distinct] * .18))
    assert np.mean(abs(sdr[distinct] - expected_sdr[distinct])) < np.mean(abs(sdr[distinct] - expected_hdr[distinct] / .18))
    store = ProofArtifactStore()
    try:
        request = ProofArtifactRequest.model_validate({**settings.model_dump(), "full_size": True, "adjustments": adjustments.model_dump()})
        proof = store.create(session, request, backend)
        assert proof.sha256 == hashlib.sha256(path.read_bytes()).hexdigest()
    finally:
        store.clear()


@pytest.mark.parametrize("lane", ["hdr", "sdr"])
def test_gpu_pair_is_watermarked_without_poisoning_shared_cached_pixels(monkeypatch, lane):
    from types import SimpleNamespace
    from hdr_finisher.models import AdjustmentState, PreviewKind
    from hdr_finisher.exporters import _render_export_branch
    import hdr_finisher.gpu_delivery as gpu
    image = np.full((200, 300, 3), .1, dtype=np.float32)
    monkeypatch.setattr(gpu, "render_pair", lambda *_: {"hdr": image, "sdr": image})
    settings = ExportSettings(watermark={"mode": "rendition_test"})
    result = _render_export_branch(SimpleNamespace(hdr_reference_white_nits=203), settings,
        PreviewKind(lane), AdjustmentState())
    assert np.all(image == .1)
    assert np.any(result != image)
