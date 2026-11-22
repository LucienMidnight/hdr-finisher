from concurrent.futures import ThreadPoolExecutor
from threading import Event
from types import SimpleNamespace

import numpy as np
import pytest

from hdr_finisher import app_memory, denoise_micro_grain, lens_correction, raw_import
from hdr_finisher.adjustments import apply_adjustments
from hdr_finisher.color_context import RenderColorContext
from hdr_finisher.denoise_micro_grain import MicroGrainControls
from hdr_finisher.grain_work import checkpoint, render_work
from hdr_finisher.main import _render_selected_execution
from hdr_finisher.models import AdjustmentState, DenoiseLiveControls, PreviewKind, PreviewRequest, RawImportSettings
from hdr_finisher.preview import downsample_image
from hdr_finisher.render_cache import SessionRenderCache, StaleRender
from test_lens_correction import canon_settings, numpy_bilinear, reference_frame


_APPLY_LENS_CORRECTION = raw_import.apply_lens_correction


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


def test_finished_micro_frame_does_not_displace_reusable_source(micro_frame, monkeypatch):
    frame, controls, _, rendered = micro_frame
    cache = frame.render_cache
    original_claim = app_memory.claim
    # The image source and its sensor preparation fit, but a second RGB
    # frame at the same size does not.
    capacity = 256 * 218 * 3 * 4 + 320 * 272 * 2

    def claim(key, share, size):
        return (key != cache._ram_key or size <= capacity) and original_claim(key, share, size)

    monkeypatch.setattr(app_memory, "claim", claim)
    first = preview(frame, controls)
    kept = cache.diagnostics()
    assert kept["micro_source_bytes"] == capacity
    assert kept["frame_bytes"] == 0
    edited = preview(frame, controls, exposure=0.25)
    assert not np.array_equal(first, edited)
    assert len(rendered) == 1


def test_generated_sdr_micro_finish_matches_whole_frame(micro_frame, monkeypatch):
    from hdr_finisher import render_cache

    frame, controls, _, _ = micro_frame
    original = render_cache.render_in_strips
    strip_counts = []

    def render(*args, **options):
        result, report = original(*args, **options, budget_bytes=1024 * 1024)
        strip_counts.append(report.plan.strip_count)
        return result, report

    monkeypatch.setattr(render_cache, "render_in_strips", render)
    source, _ = frame.render_cache.micro_preview_source(
        frame, MicroGrainControls.from_settings(controls), 256, None,
    )
    expected = apply_adjustments(source, AdjustmentState(), PreviewKind.SDR, source_pixel_scale=0.8)
    actual = preview(frame, controls, kind=PreviewKind.SDR)
    assert strip_counts[0] > 1
    np.testing.assert_array_equal(actual, expected)


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


@pytest.mark.parametrize("chromatic", [False, True])
@pytest.mark.parametrize("outcome", ["success", "fallback", "cancel", "error"])
def test_reduced_micro_lens_scratch(micro_frame, monkeypatch, tmp_path, chromatic, outcome):
    from contextlib import contextmanager
    import tempfile
    from hdr_finisher.delivery_frames import DeliveryFrame

    frame, controls, _, _ = micro_frame
    frame.raw_import_settings.lens = canon_settings(chromatic_aberration=chromatic)
    micro = MicroGrainControls.from_settings(controls)
    height = frame.image.shape[0]
    strip_rows = lens_correction.COORDINATE_ROWS
    assert height % strip_rows
    calls = []
    cancelled = False
    remap = lens_correction._generate
    monkeypatch.setattr(lens_correction, "logical_cpus", lambda: 1)
    monkeypatch.setattr(raw_import, "apply_lens_correction", _APPLY_LENS_CORRECTION)

    def generate(library, handle, apply, state, top, count, coordinates):
        nonlocal cancelled
        if top >= strip_rows:
            if outcome == "fallback" and not calls:
                calls.append((top, count))
                raise lens_correction.LensStripError("test strip failure")
            if outcome == "cancel":
                cancelled = True
            if outcome == "error":
                raise ValueError("test remap error")
            calls.append((top, count))
        return remap(library, handle, apply, state, top, count, coordinates)

    monkeypatch.setattr(lens_correction, "_generate", generate)
    system_temp = tmp_path / "system"
    proof_root = tmp_path / "proof-root"
    system_temp.mkdir()
    proof_root.mkdir()
    monkeypatch.setattr(tempfile, "tempdir", str(system_temp))
    monkeypatch.setenv("HDR_FINISHER_PROOF_ROOT", str(proof_root))
    refreshes = []
    monkeypatch.setattr(app_memory, "refresh_after_scratch", lambda size: refreshes.append(size) or (size, size))
    original_map = DeliveryFrame.map
    mappings = []

    @contextmanager
    def track_map(scratch, mode):
        with original_map(scratch, mode) as mapped:
            mappings.append((scratch.path, mapped._mmap))
            assert mode == "w+"
            yield mapped

    monkeypatch.setattr(DeliveryFrame, "map", track_map)
    if outcome in ("cancel", "error"):
        error = StaleRender if outcome == "cancel" else raw_import.RawImportError
        with pytest.raises(error):
            frame.render_cache.micro_preview_source(frame, micro, 256, lambda: not cancelled)
        assert refreshes == []
    else:
        source = frame.image * np.float32(1 - micro.luminance / 4)
        expected, _ = reference_frame(source, frame.raw_import_settings.lens, {})
        expected = downsample_image(expected * np.float32(1.25), 256)
        actual, _ = frame.render_cache.micro_preview_source(frame, micro, 256, None)
        assert actual.tobytes() == expected.tobytes()
        assert calls[-1] == (height - height % strip_rows, height % strip_rows)
        # A lens-corrected preview refreshes a stale census before it is cached.
        assert refreshes == [actual.nbytes]
    assert len(mappings) == 1
    for file, mapping in mappings:
        # Crash sweeps cover the desktop scratch root, not system temp.
        assert file.parent.parent == proof_root
        assert mapping.closed
        assert not file.exists()
        assert not file.parent.exists()


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


def test_gpu_micro_source_admitted_and_reclaimed(micro_frame):
    frame, _, built, _ = micro_frame
    from hdr_finisher.denoise_micro_grain import _trim_recent_source, prepare_source

    initial = app_memory.cache_snapshot()["working"]["bytes"]
    try:
        source = prepare_source(frame)
        assert prepare_source(frame) is source
        assert len(built) == 1
        assert app_memory.cache_snapshot()["working"]["bytes"] == initial + source.prepared_nbytes

        _trim_recent_source(0)
        assert app_memory.cache_snapshot()["working"]["bytes"] == initial
        assert prepare_source(frame) is not source
        assert len(built) == 2
    finally:
        _trim_recent_source(0)


@pytest.mark.parametrize("changed", [None, "cleanup", "highlights", "file", "fingerprint"])
def test_lens_toggle_reuses_only_matching_bayer_preparation(micro_frame, changed):
    from hdr_finisher.denoise_micro_grain import _trim_recent_source, prepare_source

    frame, controls, built, _ = micro_frame
    micro = MicroGrainControls.from_settings(controls)
    off = frame.raw_import_settings
    lens = off.lens.model_copy(update={"mode": "auto"})
    frame.raw_import_settings = off.model_copy(update={"lens": lens})
    # Cold reconstruction is the old path: prepare from the RAW, render,
    # then apply the new lens settings and reduce the result.
    expected = downsample_image(denoise_micro_grain.resolve_source(frame, micro, cancelled=lambda: False), 256)

    frame.raw_import_settings = off
    frame.metadata["lens_correction"]["applied"] = False
    frame.source_fingerprint_sha256 = "original"
    initial = app_memory.cache_snapshot()["working"]["bytes"]
    try:
        prepare_source(frame)
        assert len(built) == 2
        frame.raw_import_settings = off.model_copy(update={"lens": lens}, deep=True)
        frame.metadata["lens_correction"]["applied"] = True
        if changed == "cleanup":
            frame.raw_import_settings.pixel_cleanup.remove_hot_pixels = True
        elif changed == "highlights":
            frame.raw_import_settings.highlight_reconstruction.clipping_threshold = 0.95
        elif changed == "file":
            frame.source_path.write_bytes(b"updated file")
        elif changed == "fingerprint":
            frame.source_fingerprint_sha256 = "replacement"

        actual, _ = frame.render_cache.micro_preview_source(frame, micro, 256, None)
        assert actual.tobytes() == expected.tobytes()
        if changed is None:
            assert len(built) == 2
            assert app_memory.cache_snapshot()["working"]["bytes"] == initial + actual.nbytes + 320 * 272 * 2
        else:
            assert len(built) == 3
    finally:
        _trim_recent_source(0)


def test_parallel_measurement_reads_each_window_once():
    from hdr_finisher.denoise_adaptive import _WindowSource

    first, second, release = Event(), Event(), Event()
    reads = []
    def read(top, left, bottom, right):
        reads.append((top, left))
        if left == 0:
            first.set()
            assert release.wait(3)
        else:
            second.set()
        return np.full((bottom - top, right - left, 3), left, dtype=np.float32)

    source = _WindowSource(2, 4, read)
    with ThreadPoolExecutor(max_workers=3) as pool:
        first_read = pool.submit(lambda: source[0:2, 0:2])
        try:
            assert first.wait(3)
            duplicate = pool.submit(lambda: source[0:2, 0:2])
            other = pool.submit(lambda: source[0:2, 2:4])
            assert second.wait(3)
            np.testing.assert_array_equal(other.result(), 2)
        finally:
            release.set()
        assert duplicate.result() is first_read.result()
    assert reads == [(0, 0), (0, 2)]


@pytest.mark.parametrize("rotation,flip", [(0, False), (90, True), (180, False), (270, True)])
def test_lens_corrected_micro_viewport_matches_full_grade(micro_frame, monkeypatch, rotation, flip):
    from hdr_finisher.adjustments import apply_adjustments
    from hdr_finisher.models import CropRectangle, ScopeRegion
    import lensfunpy

    frame, controls, _, _ = micro_frame
    rng = np.random.default_rng(158)
    pixels = rng.uniform(-0.07, 1.4, frame.image.shape).astype(np.float32)
    camera = lensfunpy.Database().find_cameras("Canon", "Canon EOS 5D Mark II")[0]
    lens = lensfunpy.Database().find_lenses(camera, maker="Canon", lens="Canon EF 24-105mm f/4L IS USM")[0]
    modifier = lensfunpy.Modifier(lens, camera.crop_factor, pixels.shape[1], pixels.shape[0])
    flags = lensfunpy.ModifyFlags.SCALE | lensfunpy.ModifyFlags.DISTORTION | lensfunpy.ModifyFlags.TCA | lensfunpy.ModifyFlags.VIGNETTING
    modifier.initialize(24, 4, 5, pixel_format=np.float32, flags=flags)

    class Sensor:
        shape = pixels.shape[:2]
        gain = np.float32(.57)
        prepared_nbytes = 0

        def __init__(self, *args, **kwargs):
            pass

        def cores(self, rect):
            left, top, right, bottom = rect
            return ((x, y, min(x + 64, self.shape[1]), min(y + 64, self.shape[0]))
                    for y in range(top // 64 * 64, bottom, 64)
                    for x in range(left // 64 * 64, right, 64))

        def render_core(self, _, rect, **kwargs):
            left, top, right, bottom = rect
            return pixels[top:bottom, left:right].copy()

    monkeypatch.setattr(denoise_micro_grain, "MicroGrainSource", Sensor)
    monkeypatch.setattr(denoise_micro_grain, "micro_background_allowed", lambda: False)
    monkeypatch.setattr(raw_import, "_lens_modifier", lambda *a, **kv: (modifier, {"vignetting": True, "profile": {"vignetting": True}}))
    grade = AdjustmentState()
    grade.hdr.exposure = .4
    grade.shared.geometry.rotation = rotation
    grade.shared.geometry.flip_horizontal = flip
    grade.shared.geometry.crop = CropRectangle(x=.13, y=.14, width=.7, height=.7)
    vignetted = pixels.copy()
    raw_import._apply_signed_vignetting(modifier, vignetted)
    corrected = numpy_bilinear(vignetted, modifier.apply_subpixel_geometry_distortion())
    full = apply_adjustments(corrected * Sensor.gain, grade, PreviewKind.HDR)
    for viewport in (ScopeRegion(x=.07, y=.13, width=.39, height=.36),
                     ScopeRegion(x=.61, y=.53, width=.38, height=.46)):
        visible, (x, y, width, height) = frame.render_cache.micro_preview_region(
            frame, MicroGrainControls.from_settings(controls), grade, PreviewKind.HDR, viewport, [], lambda: True,
        )
        assert (height, width) == full.shape[:2]
        np.testing.assert_array_equal(visible, full[y:y + visible.shape[0], x:x + visible.shape[1]])


def test_micro_fit_consumes_cached_tiles_and_memory_gate_blocks_background(monkeypatch):
    from hdr_finisher.denoise_micro_grain import MicroPreviewTiles

    calls = []
    published = Event()

    class Source:
        shape = (3, 8)

        def cores(self, rect):
            return (core for core in [(0, 0, 4, 3), (4, 0, 8, 3)] if core[0] < rect[2] and core[2] > rect[0])

        def render_core(self, _, core, **kwargs):
            calls.append(core)
            return np.full((3, 4, 3), core[0], dtype=np.float32)

    def claim(_, __, size):
        if size:
            published.set()
        return True

    monkeypatch.setattr(app_memory, "claim", claim)
    monkeypatch.setattr(denoise_micro_grain, "micro_background_allowed", lambda: False)
    source = Source()
    tiles = MicroPreviewTiles(source, MicroGrainControls())
    try:
        left = tiles.read(source, (0, 0, 4, 3), cancelled=lambda: False)
        assert published.wait(3)
        tiles.start_fill(source)
        assert calls == [(0, 0, 4, 3)]
        full = tiles.read(source, (0, 0, 8, 3), cancelled=lambda: False, consume=True)
        np.testing.assert_array_equal(full[:, :4], left)
        np.testing.assert_array_equal(full[:, 4:], 4)
        assert calls == [(0, 0, 4, 3), (4, 0, 8, 3)]
        assert tiles.bytes == 0
    finally:
        tiles.close()


@pytest.mark.parametrize("hdr_display", [False, True])
def test_micro_region_preview_uses_the_display_transport(micro_frame, monkeypatch, hdr_display):
    from hdr_finisher import main
    from hdr_finisher.models import ScopeRegion

    frame, controls, _, _ = micro_frame
    frame.hdr_reference_white_nits = 100
    detail = frame.image[:32, :48].copy()
    base = frame.image[:16, :24].copy()
    monkeypatch.setattr(main.store, "next_preview_token", lambda *_: 4)
    monkeypatch.setattr(main.store, "is_preview_current", lambda *_: True)
    monkeypatch.setattr(frame.render_cache, "micro_preview_region", lambda *_: (detail, (8, 7, 320, 272)))
    monkeypatch.setattr(frame.render_cache, "adjusted_frame", lambda *a, **kw: base)
    request = PreviewRequest(micro_grain_viewport=ScopeRegion(x=.1, y=.15, width=.25, height=.2),
                             hdr_display=hdr_display, micro_grain_controls=controls, generation=3)
    response = main._micro_preview_raw("photo", frame, PreviewKind.HDR, request, AdjustmentState())
    assert response.headers["x-micro-region"] == "8,7,320,272"
    assert response.headers["x-generation"] == "3"
    if hdr_display:
        import imagecodecs

        split = int(response.headers["x-micro-detail-bytes"])
        assert response.headers["x-micro-media-type"] == "image/avif"
        assert imagecodecs.avif_decode(response.body[:split]).shape[:2] == detail.shape[:2]
        assert imagecodecs.avif_decode(response.body[split:]).shape[:2] == base.shape[:2]
    else:
        assert response.body == (main.encode_processed_rgba8(detail, PreviewKind.HDR)
                                 + main.encode_processed_rgba8(base, PreviewKind.HDR))
