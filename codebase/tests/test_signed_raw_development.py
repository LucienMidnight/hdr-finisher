from contextlib import nullcontext
from types import SimpleNamespace

import numpy as np
import pytest

from hdr_finisher import adjustments, hdr_ceiling, raw_import
from hdr_finisher.denoise_adaptive import AdaptiveControls, estimate_adaptive_model, resolve_adaptive
from hdr_finisher.finishing import apply_output_finishing
from hdr_finisher.local_adjustments import _apply_local_grade
from hdr_finisher.models import AdjustmentState, LocalGrade, OutputFinishingSettings, PreviewKind
from hdr_finisher.detail import apply_detail
from hdr_finisher.tone import apply_tone
from hdr_finisher.color_context import RenderColorContext
from hdr_finisher.models import DetailAdjustments, VignetteAdjustments


@pytest.mark.parametrize("flip", [0, 3, 5, 6])
def test_quick_raw_transport_keeps_signed_pixels_and_odd_source_dimensions(monkeypatch, flip):
    import rawpy
    from hdr_finisher import library_pictures, library_raw_decode
    from hdr_finisher.signed_raw import orient

    sensor = np.full((35, 39), 80, np.uint16)
    raw = SimpleNamespace(raw_image_visible=sensor, sizes=SimpleNamespace(flip=flip))
    camera = SimpleNamespace(camera_to_acescg=np.eye(3), as_shot_wb=np.ones(3),
        white_level=np.full(3, 1100), black_level=np.full(3, 100), raw_pattern=np.asarray([[0, 1], [1, 2]]))
    expected = orient(np.full((18, 20, 3), -20, np.float32), flip)
    monkeypatch.setattr(rawpy, "imread", lambda source: nullcontext(raw))
    monkeypatch.setattr(raw_import, "_camera_linear_metadata_from_libraw", lambda source: camera)
    monkeypatch.setattr(raw_import, "_develop_libraw_camera_rgb", lambda *args, **kwargs: expected)
    monkeypatch.setattr(library_pictures, "default_look", lambda *args: SimpleNamespace(model_dump=lambda **kwargs: {}))
    output, header = library_raw_decode.decode("odd.arw", None, 0)
    try:
        actual = np.ndarray(expected.shape, dtype=np.float32, buffer=output.buf)
        np.testing.assert_array_equal(actual, expected)
        assert header["signed_scene"]
        assert (header["source_height"], header["source_width"]) == ((39, 35) if flip in (5, 6) else (35, 39))
        assert (header["raw_height"], header["raw_width"]) == expected.shape[:2]
    finally:
        output.close()
        output.unlink()


def test_signed_normalization_reuses_float_transport_and_applies_exposure_once():
    transport = np.full((20, 20, 3), -25, dtype=np.float32)
    metadata = SimpleNamespace(white_level=np.full(3, 1100), black_level=np.full(3, 100),
        as_shot_wb=np.ones(3), camera_to_acescg=np.eye(3))
    normalized = raw_import._normalize_camera_rgb_float32(transport, metadata)
    assert normalized is transport
    np.testing.assert_allclose(normalized, -.025, rtol=0, atol=1e-8)
    converted = raw_import._camera_rgb_to_acescg_float32(normalized, metadata)
    np.testing.assert_array_equal(converted, normalized)


def test_batch_signed_raw_develops_into_mapped_rgb(monkeypatch):
    import mmap
    from hdr_finisher import delivery_frames, signed_raw

    sensor = np.random.default_rng(53).integers(0, 4096, (33, 49), dtype=np.uint16)
    pattern = [[0, 1], [1, 2]]
    black = [[512, 512], [512, 512]]
    matrix = np.eye(3, dtype=np.float32)
    metadata = SimpleNamespace(white_level=np.full(3, 4095), black_level=np.full(3, 512),
        as_shot_wb=np.array([1.8, 1., 1.4]), camera_to_acescg=np.eye(3))

    def develop():
        rgb = signed_raw.demosaic(sensor, pattern, black, matrix, rows=16)
        rgb = signed_raw.orient(rgb, 6)
        rgb = raw_import._normalize_camera_rgb_float32(rgb, metadata)
        return raw_import._camera_rgb_to_acescg_float32(rgb, metadata)

    expected = develop()
    monkeypatch.setattr(delivery_frames, "SOURCE_SPILL_BYTES", expected.nbytes)
    with delivery_frames.batch_source_buffers():
        actual = develop()
    assert isinstance(actual.base, mmap.mmap)
    assert actual.tobytes() == expected.tobytes()


@pytest.mark.parametrize("fail", [False, True])
def test_lens_vignetting_preserves_signed_samples_across_bands(fail):
    image = np.linspace(-2, 3, 537 * 9 * 3, dtype=np.float32).reshape(537, 9, 3)
    original = image.copy()
    gain = np.linspace(1, 2, 537 * 9, dtype=np.float32).reshape(537, 9, 1)

    class Modifier:
        def apply_color_modification(self, pixels):
            np.maximum(pixels, 0, out=pixels)
            pixels *= gain
            if fail:
                raise RuntimeError("Lensfun failure")

    if fail:
        with pytest.raises(RuntimeError, match="Lensfun failure"):
            raw_import._apply_signed_vignetting(Modifier(), image)
    else:
        raw_import._apply_signed_vignetting(Modifier(), image)
    np.testing.assert_array_equal(image, original * gain)


@pytest.mark.parametrize("exposure", [-6, 0, 6])
def test_global_and_local_exposure_keep_signed_values(exposure):
    image = np.broadcast_to(np.asarray([-.002, -.001, .003], np.float32), (24, 32, 3)).copy()
    state = AdjustmentState()
    state.hdr.exposure = exposure
    state.sdr.exposure = exposure
    expected = image * np.float32(2.0 ** exposure)
    np.testing.assert_array_equal(adjustments._apply_hdr_base_adjustments(image, state), expected)
    np.testing.assert_array_equal(adjustments._sdr_before_black_and_white(image, state), expected)
    np.testing.assert_array_equal(_apply_local_grade(image, LocalGrade(exposure=exposure), PreviewKind.HDR), expected)


def test_denoise_zero_strength_and_dark_model_fallback_preserve_signs():
    image = np.full((32, 32, 3), -.01, dtype=np.float32)
    model = estimate_adaptive_model(image)
    result = resolve_adaptive(image, model, AdaptiveControls(amount=0))
    np.testing.assert_array_equal(result, image)
    assert model.a == 0 and model.b > 0 and model.c == 0
    assert np.isfinite(resolve_adaptive(image, model, AdaptiveControls())).all()


def test_output_finishing_defers_floor_but_final_hdr_cap_remains_exact():
    image = np.random.default_rng(4).normal(0, 2, (32, 40, 3)).astype(np.float32)
    finished = apply_output_finishing(image, OutputFinishingSettings(), PreviewKind.HDR)
    np.testing.assert_array_equal(finished, image)
    state = AdjustmentState()
    state.hdr.highlight_compression_target_nits = 1000
    delivered = adjustments.clip_hdr_output_target(finished, state)
    assert np.isfinite(delivered).all()
    assert hdr_ceiling.channel_nits(delivered, 203).max() <= 1000


def test_opposed_reconstruction_leaves_below_black_samples_untouched():
    metadata = SimpleNamespace(raw_pattern=np.asarray([[0, 1], [3, 2]]),
        raw_channel_to_rgb=np.asarray([0, 1, 2, 1]), raw_black_level=np.full(4, 100),
        raw_white_level=np.full(4, 1100), as_shot_wb=np.ones(3))
    mosaic = np.full((32, 32), 80, np.uint16)
    mosaic[16, 17] = 1100
    original = mosaic.copy()
    raw_import._apply_raw_highlight_reconstruction(SimpleNamespace(raw_image_visible=mosaic), metadata,
        raw_import.RawImportSettings())
    np.testing.assert_array_equal(mosaic[original < 100], original[original < 100])


@pytest.mark.parametrize("kind", [PreviewKind.HDR, PreviewKind.SDR])
def test_active_detail_structure_and_vignette_preserve_negative_channels(kind):
    levels = np.random.default_rng(15).uniform(.02, .1, (40, 48)).astype(np.float32)
    image = np.stack([-levels, levels, levels], axis=-1)
    detail = apply_detail(image, DetailAdjustments(clarity_amount=50), kind)
    assert np.all(detail[..., 0] < 0)
    np.testing.assert_allclose(detail[..., 0], -detail[..., 1], rtol=0, atol=0)
    structure = adjustments._apply_image_structure(image, SimpleNamespace(softness=20, microcontrast=30), kind)
    assert np.all(structure[..., 0] < 0)
    np.testing.assert_allclose(structure[..., 0], -structure[..., 1], rtol=0, atol=0)
    vignette = adjustments._apply_vignette(image, VignetteAdjustments(amount=-50), kind)
    assert np.all(vignette[..., 0] < 0)
    np.testing.assert_array_equal(vignette[..., 0], -vignette[..., 1])


def test_tone_identity_and_authored_negative_blacks_crush_are_distinct():
    image = np.full((32, 40, 3), -.01, np.float32)
    state = AdjustmentState()
    np.testing.assert_array_equal(apply_tone(image, state.hdr, True), image)
    state.hdr.blacks = -20
    crushed = apply_tone(image, state.hdr, True)
    assert np.min(crushed) >= 0


@pytest.mark.parametrize("exposure", [-6, 0, 6])
@pytest.mark.parametrize("mode", ["peak_fit", "soft_ceiling", "clip", "fixed_cap"])
def test_signed_input_keeps_exact_hdr_cap_in_every_compression_mode(exposure, mode):
    image = np.random.default_rng(12).normal(.05, .15, (32, 40, 3)).astype(np.float32)
    image[10:20, 10:20] = 5
    state = AdjustmentState()
    state.hdr.exposure = exposure
    state.hdr.highlight_section_enabled = True
    state.hdr.highlight_compression_target_nits = 1000
    state.hdr.highlight_compression_mode = mode
    source = adjustments._apply_hdr_base_adjustments(image, state)
    finished = adjustments.apply_hdr_output_highlight_compression(source, state, color_context=RenderColorContext(203))
    assert np.isfinite(finished).all()
    assert np.max(hdr_ceiling.channel_nits(finished, 203)) <= 1000
