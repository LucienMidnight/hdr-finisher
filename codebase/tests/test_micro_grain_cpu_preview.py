from concurrent.futures import ThreadPoolExecutor
from threading import Event
from types import SimpleNamespace

import numpy as np
import pytest

from hdr_finisher import denoise_micro_grain, raw_import
from hdr_finisher.color_context import RenderColorContext
from hdr_finisher.denoise_micro_grain import MicroGrainControls
from hdr_finisher.grain_work import checkpoint, render_work
from hdr_finisher.main import _render_selected_execution
from hdr_finisher.models import AdjustmentState, DenoiseLiveControls, PreviewKind, PreviewRequest, RawImportSettings
from hdr_finisher.preview import downsample_image
from hdr_finisher.render_cache import SessionRenderCache, StaleRender


@pytest.fixture
def micro_frame(tmp_path, monkeypatch):
    path = tmp_path / "synthetic.ARW"
    path.touch()
    image = np.linspace(-0.05, 1.6, 320 * 272 * 3, dtype=np.float32).reshape(272, 320, 3)
    frame = SimpleNamespace(
        image=image, source_path=path, raw_import_settings=RawImportSettings(),
        metadata={"raw_development": {"signed_sensor_samples": True},
                  "lens_correction": {"applied": True}, "raw_exif": {"aperture": 8.0}},
        sdr_reference_image=None, local_adjustments=[],
        render_cache=SessionRenderCache(image, None, eager_peak_candidates=False),
    )
    controls = DenoiseLiveControls(method="micro_grain")
    lane = SimpleNamespace(enabled=True, controls=controls)
    frame.denoise = SimpleNamespace(hdr=lane, sdr=lane)
    built, rendered = [], []

    class Sensor:
        gain = np.float32(1.25)
        prepared_nbytes = 320 * 272 * 2

        def __init__(self, path, settings, *, cancelled):
            built.append(path)

        def clear_bayer_cache(self):
            pass

        def render(self, controls, *, cancelled):
            assert not cancelled()
            checkpoint()
            rendered.append(controls)
            return image * np.float32(1 - controls.luminance / 4)

    def lens(pixels, settings, **kwargs):
        assert pixels.shape == image.shape
        assert settings.aperture == 8.0
        assert kwargs["consume_input"]
        pixels[::2, 1::2, 0] *= np.float32(1.1)
        return pixels, {}

    monkeypatch.setattr(denoise_micro_grain, "MicroGrainSource", Sensor)
    monkeypatch.setattr(denoise_micro_grain, "_recent_source", (None, None))
    monkeypatch.setattr(raw_import, "apply_lens_correction", lens)
    yield frame, controls, built, rendered
    frame.render_cache.close_micro_preview()


def preview(frame, controls, *, edge=256, exposure=0.0, kind=PreviewKind.HDR, current=lambda: True):
    grade = AdjustmentState()
    grade.hdr.exposure = exposure
    request = PreviewRequest(execution="strips", micro_grain_controls=controls)
    return _render_selected_execution(frame, request, kind, grade, edge, current)[0]


def test_micro_preview_reuses_source_across_grade_and_view_changes(micro_frame):
    frame, controls, built, rendered = micro_frame
    first = preview(frame, controls)
    frame.render_cache.clear_adjusted()
    edited = preview(frame, controls, exposure=0.6)
    frame.render_cache.set_color_context(RenderColorContext(hdr_reference_white_nits=100))
    preview(frame, controls, kind=PreviewKind.SDR)
    assert not np.array_equal(first, edited)
    assert len(built) == len(rendered) == 1

    changed = controls.model_copy(update={"micro_luminance": 0.9})
    assert not np.array_equal(first, preview(frame, changed))
    preview(frame, controls, edge=288)
    assert len(built) == 1
    assert rendered == [MicroGrainControls.from_settings(c) for c in (controls, changed, controls)]


def test_cached_micro_pixels_equal_previous_processing(micro_frame):
    frame, controls, built, rendered = micro_frame
    cache = frame.render_cache
    micro = MicroGrainControls.from_settings(controls)
    expected = downsample_image(denoise_micro_grain.resolve_source(frame, micro, cancelled=lambda: False), 256)
    result, _ = cache.micro_preview_source(frame, micro, 256, None)
    cached, _ = cache.micro_preview_source(frame, micro, 256, None)
    np.testing.assert_array_equal(result, expected)
    assert result is cached
    assert len(rendered) == 2
    assert cache.diagnostics()["micro_source_bytes"] == result.nbytes + 320 * 272 * 2
    cache.trim_memory(0)
    assert cache.diagnostics()["micro_source_bytes"] == 0
    preview(frame, controls)
    assert len(built) == len(rendered) == 3
    cache.replace_source(frame.image.copy(), None)
    assert cache.diagnostics()["micro_source_bytes"] == 0
    preview(frame, controls)
    assert len(built) == len(rendered) == 4
    cache.close_micro_preview()
    assert cache.diagnostics()["micro_source_bytes"] == 0


@pytest.mark.parametrize("change_grade", [False, True])
def test_superseding_micro_preview_joins_the_running_render(micro_frame, monkeypatch, change_grade):
    frame, controls, built, rendered = micro_frame
    original = denoise_micro_grain.MicroGrainSource.render
    started, superseded = Event(), Event()

    def slow_render(source, controls, *, cancelled):
        started.set()
        assert superseded.wait(5)
        assert not cancelled()
        return original(source, controls, cancelled=cancelled)

    monkeypatch.setattr(denoise_micro_grain.MicroGrainSource, "render", slow_render)

    def first():
        with render_work(lambda: not superseded.is_set()):
            return preview(frame, controls, current=lambda: not superseded.is_set())

    with ThreadPoolExecutor(max_workers=2) as workers:
        prior = workers.submit(first)
        assert started.wait(5)
        superseded.set()
        replacement = workers.submit(preview, frame, controls, exposure=0.6 if change_grade else 0.0)
        assert replacement.result(timeout=5).shape == (218, 256, 3)
        with pytest.raises(StaleRender):
            prior.result(timeout=5)
    assert len(built) == len(rendered) == 1


def test_abandoned_micro_preview_stops_without_publishing_pixels(micro_frame, monkeypatch):
    frame, controls, built, rendered = micro_frame
    started, abandoned = Event(), Event()

    def slow_render(source, controls, *, cancelled):
        started.set()
        assert abandoned.wait(5)
        assert cancelled()
        raise InterruptedError("Micro Grain was replaced.")

    monkeypatch.setattr(denoise_micro_grain.MicroGrainSource, "render", slow_render)
    with ThreadPoolExecutor(max_workers=1) as workers:
        prior = workers.submit(preview, frame, controls, current=lambda: not abandoned.is_set())
        assert started.wait(5)
        abandoned.set()
        with pytest.raises(StaleRender):
            prior.result(timeout=5)
    assert len(built) == 1
    assert not rendered
    assert frame.render_cache.diagnostics()["micro_source_bytes"] == 320 * 272 * 2
