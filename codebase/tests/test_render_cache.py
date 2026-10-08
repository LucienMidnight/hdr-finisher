from __future__ import annotations

from threading import Event, Thread
import time

import numpy as np
import pytest

import hdr_finisher.render_cache as render_cache_module
from hdr_finisher.color_context import RenderColorContext
from hdr_finisher.finishing import apply_geometry
from hdr_finisher.models import AdjustmentState, GeometryAdjustments, LocalAdjustment, MaskExpression, MaskLeaf, OverlayMode, PreviewKind
from hdr_finisher.preview import downsample_image
from hdr_finisher.render_cache import (
    SessionRenderCache,
    StaleRender,
    SourceMipIdentity,
    SourceMipStore,
    adjustment_signature,
    downsample_target_dimensions,
    encode_rgba32f_proxy,
    encode_rgba_proxy,
    encode_rgba_proxy_rows,
    scope_region_view,
)


def test_invalidated_singleflight_worker_cannot_detach_its_replacement(monkeypatch) -> None:
    image = np.full((32, 48, 3), 0.18, dtype=np.float32)
    cache = SessionRenderCache(image, None)
    adjustments = AdjustmentState()
    starts = [Event(), Event()]
    releases = [Event(), Event()]
    call_count = 0

    def delayed_adjustments(source, *_args, **_kwargs):
        nonlocal call_count
        index = call_count
        call_count += 1
        starts[index].set()
        assert releases[index].wait(2)
        return source.copy()

    monkeypatch.setattr(render_cache_module, "apply_adjustments", delayed_adjustments)
    first = Thread(target=lambda: cache.adjusted_frame(adjustments, PreviewKind.HDR, 256))
    first.start()
    assert starts[0].wait(2)
    cache.clear_adjusted()
    second = Thread(target=lambda: cache.adjusted_frame(adjustments, PreviewKind.HDR, 256))
    second.start()
    assert starts[1].wait(2)
    with cache._lock:
        replacement_flight = next(iter(cache._inflight.values()))

    releases[0].set()
    first.join(2)
    with cache._lock:
        assert next(iter(cache._inflight.values())) is replacement_flight

    releases[1].set()
    second.join(2)
    assert call_count == 2


def test_adjusted_proxy_is_downsampled_before_processing_and_reused() -> None:
    image = np.linspace(0.0, 4.0, 800 * 1200 * 3, dtype=np.float32).reshape(800, 1200, 3)
    adjustments = AdjustmentState()
    adjustments.hdr.exposure = 1.0
    cache = SessionRenderCache(image, None)

    first = cache.adjusted_frame(adjustments, PreviewKind.HDR, 600)
    second = cache.adjusted_frame(adjustments, PreviewKind.HDR, 600)

    assert first.shape == (400, 600, 3)
    assert second is first
    assert not first.flags.writeable


def test_scope_request_counts_one_top_level_miss_then_one_hit() -> None:
    image = np.full((64, 96, 3), 0.18, dtype=np.float32)
    cache = SessionRenderCache(image, None)
    adjustments = AdjustmentState()

    cache.scope_result(adjustments, PreviewKind.HDR, 256, "histogram", 64, 64)
    after_miss = cache.diagnostics()
    cache.scope_result(adjustments, PreviewKind.HDR, 256, "histogram", 64, 64)
    after_hit = cache.diagnostics()

    assert after_miss["misses"] == 1
    assert after_miss["hits"] == 0
    assert after_hit["misses"] == 1
    assert after_hit["hits"] == 1


def test_scope_region_is_a_post_geometry_view_and_has_an_independent_cache_key() -> None:
    image = np.arange(8 * 12 * 3, dtype=np.float32).reshape(8, 12, 3)
    region = (0.25, 0.25, 0.5, 0.5)
    view = scope_region_view(image, region)

    assert view.shape == (4, 6, 3)
    assert np.shares_memory(view, image)
    np.testing.assert_array_equal(view, image[2:6, 3:9])

    cache = SessionRenderCache(np.full((64, 96, 3), 0.18, dtype=np.float32), None)
    adjustments = AdjustmentState()
    full = cache.scope_result(adjustments, PreviewKind.HDR, 256, "histogram", 64, 64)
    cropped = cache.scope_result(adjustments, PreviewKind.HDR, 256, "histogram", 64, 64, scope_region=region)
    diagnostics = cache.diagnostics()

    assert diagnostics["misses"] == 2
    assert sum(full.channels[0].bins) > sum(cropped.channels[0].bins)


def test_overlay_only_changes_do_not_invalidate_adjusted_pixels() -> None:
    first = AdjustmentState()
    second = first.model_copy(deep=True)
    second.shared.overlay_mode = OverlayMode.FALSE_COLOR
    second.shared.overlay_opacity = 0.25

    assert adjustment_signature(first) == adjustment_signature(second)


def test_webgpu_proxy_rows_are_aligned_rgba32f() -> None:
    image = np.array([[[0.25, 0.5, 1.0], [2.0, 3.0, 4.0]]], dtype=np.float32)
    body, bytes_per_row = encode_rgba32f_proxy(image)
    packed = np.frombuffer(body, dtype="<f4").reshape(1, bytes_per_row // 4)

    assert bytes_per_row == 256
    assert len(body) == 256
    np.testing.assert_allclose(packed[0, :8], [0.25, 0.5, 1.0, 1.0, 2.0, 3.0, 4.0, 1.0])


def test_webgpu_half_proxy_initializes_padding_and_rejects_nonfinite_values() -> None:
    image = np.arange(18, dtype=np.float32).reshape(2, 3, 3)

    body, bytes_per_row, pixel_format = encode_rgba_proxy(image)
    packed = np.frombuffer(body, dtype="<f2").reshape(2, bytes_per_row // 2)

    assert pixel_format == "rgba16float"
    assert np.all(packed[:, 12:] == 0)

    nonfinite = image.copy()
    nonfinite[0, 0, 0] = np.nan
    _body, _bytes_per_row, fallback_format = encode_rgba_proxy(nonfinite)
    assert fallback_format == "rgba32float"


def test_webgpu_proxy_row_strips_reproduce_the_whole_frame_bytes() -> None:
    image = (np.arange(96 * 40 * 3, dtype=np.float32).reshape(40, 96, 3) % 97) / 53.0
    whole, bytes_per_row, pixel_format = encode_rgba_proxy(image)
    assert pixel_format == "rgba16float"

    strips = [
        encode_rgba_proxy_rows(image, top, min(40, top + 7), pixel_format=pixel_format)[0]
        for top in range(0, 40, 7)
    ]
    assert b"".join(strips) == whole
    assert all(
        encode_rgba_proxy_rows(image, top, min(40, top + 7), pixel_format=pixel_format)[1] == bytes_per_row
        for top in range(0, 40, 7)
    )

    nonfinite = image.copy()
    nonfinite[3, 4, 0] = np.inf
    float_whole, float_row, float_format = encode_rgba_proxy(nonfinite)
    assert float_format == "rgba32float"
    float_strips = [
        encode_rgba_proxy_rows(nonfinite, top, min(40, top + 11), pixel_format=float_format)[0]
        for top in range(0, 40, 11)
    ]
    assert b"".join(float_strips) == float_whole


def test_webgpu_source_proxy_applies_committed_geometry_before_grading() -> None:
    image = np.arange(8 * 12 * 3, dtype=np.float32).reshape(8, 12, 3)
    adjustments = AdjustmentState()
    adjustments.shared.geometry = GeometryAdjustments(
        rotation=90,
        crop={"x": 0.25, "y": 0.125, "width": 0.5, "height": 0.75},
    )
    cache = SessionRenderCache(image, None)

    source, _working_space = cache.source_proxy(PreviewKind.HDR, 256)
    proxy, working_space, geometry_signature = cache.geometry_source_proxy(
        PreviewKind.HDR,
        256,
        adjustments,
    )

    np.testing.assert_array_equal(proxy, apply_geometry(source, adjustments.shared.geometry))
    assert proxy.shape == (8, 4, 3)
    assert working_space == "acescg"
    assert geometry_signature == adjustments.shared.geometry.model_dump_json()


def test_geometry_cannot_expand_cpu_or_gpu_preview_past_both_dimension_caps() -> None:
    image = np.full((180, 420, 3), 0.18, dtype=np.float32)
    adjustments = AdjustmentState()
    adjustments.shared.geometry = GeometryAdjustments(straighten_angle=25)
    cache = SessionRenderCache(image, None)

    proxy, _working_space, _signature = cache.geometry_source_proxy(PreviewKind.HDR, 256, adjustments)
    frame = cache.adjusted_frame(adjustments, PreviewKind.HDR, 256)

    assert proxy.shape[0] <= 256 and proxy.shape[1] <= 256
    assert frame.shape[0] <= 256 and frame.shape[1] <= 256


def test_simple_mask_opacity_reuses_the_spatial_mask_cache() -> None:
    image = np.full((256, 256, 3), 0.18, dtype=np.float32)
    adjustments = AdjustmentState()
    cache = SessionRenderCache(image, None)
    expression = MaskExpression(
        operator="leaf",
        leaf=MaskLeaf(type="luminance_range", mask_opacity=1.0),
    )
    local = LocalAdjustment(id="luma-cache", mask=expression)

    first = cache.compiled_local_mask(adjustments, local, 256, spatial_only=True)
    changed = local.model_copy(
        update={"mask": expression.model_copy(update={"leaf": expression.leaf.model_copy(update={"mask_opacity": 0.25})})},
        deep=True,
    )
    second = cache.compiled_local_mask(adjustments, changed, 256, spatial_only=True)
    exact = cache.compiled_local_mask(adjustments, changed, 256)

    assert second is first
    assert cache.diagnostics()["local_mask_entries"] == 1
    assert np.max(exact) <= np.ceil(np.max(first) * 0.25)


def test_concurrent_cold_mask_requests_compile_one_identity_once(monkeypatch) -> None:
    image = np.full((256, 256, 3), 0.18, dtype=np.float32)
    cache = SessionRenderCache(image, None)
    adjustments = AdjustmentState()
    local = LocalAdjustment(
        id="singleflight-mask",
        mask=MaskExpression(
            operator="leaf",
            leaf=MaskLeaf(type="luminance_range", mask_feather=0.05),
        ),
    )
    started = Event()
    release = Event()
    compile_count = 0
    original_compile = render_cache_module.compile_geometry_fixed_mask

    def delayed_compile(*args, **kwargs):
        nonlocal compile_count
        compile_count += 1
        started.set()
        assert release.wait(2)
        return original_compile(*args, **kwargs)

    monkeypatch.setattr(render_cache_module, "compile_geometry_fixed_mask", delayed_compile)
    results: list[np.ndarray] = []
    workers = [
        Thread(
            target=lambda: results.append(
                cache.compiled_local_mask(adjustments, local, 256, spatial_only=True)
            )
        )
        for _ in range(4)
    ]

    for worker in workers:
        worker.start()
    assert started.wait(2)
    release.set()
    for worker in workers:
        worker.join(2)

    assert compile_count == 1
    assert len(results) == 4
    assert all(result is results[0] for result in results)
    assert cache.diagnostics()["singleflight_waits"] == 3
    assert cache.diagnostics()["local_mask_entries"] == 1


def test_replaced_source_rejects_an_obsolete_mask_compile(monkeypatch) -> None:
    old_source = np.full((256, 256, 3), 0.18, dtype=np.float32)
    new_source = np.full((256, 256, 3), 0.72, dtype=np.float32)
    cache = SessionRenderCache(old_source, None)
    adjustments = AdjustmentState()
    local = LocalAdjustment(id="source-bound-mask")
    started = Event()
    release = Event()
    compile_count = 0
    original_compile = render_cache_module.compile_geometry_fixed_mask

    def delayed_first_compile(*args, **kwargs):
        nonlocal compile_count
        compile_count += 1
        if compile_count == 1:
            started.set()
            assert release.wait(2)
        return original_compile(*args, **kwargs)

    monkeypatch.setattr(render_cache_module, "compile_geometry_fixed_mask", delayed_first_compile)
    worker = Thread(
        target=lambda: cache.compiled_local_mask(
            adjustments,
            local,
            256,
            spatial_only=True,
        )
    )
    worker.start()
    assert started.wait(2)
    cache.replace_source(new_source, None)
    release.set()
    worker.join(2)

    assert cache.diagnostics()["local_mask_entries"] == 0
    cache.compiled_local_mask(adjustments, local, 256, spatial_only=True)
    assert compile_count == 2
    assert cache.diagnostics()["local_mask_entries"] == 1


def test_clear_adjusted_preserves_masks_but_source_replacement_does_not() -> None:
    image = np.full((256, 256, 3), 0.18, dtype=np.float32)
    cache = SessionRenderCache(image, None)
    local = LocalAdjustment(id="mask-lifetime")
    cache.compiled_local_mask(AdjustmentState(), local, 256, spatial_only=True)

    cache.clear_adjusted()
    assert cache.diagnostics()["local_mask_entries"] == 1
    cache.replace_source(image * 2, None)
    assert cache.diagnostics()["local_mask_entries"] == 0


def test_interactive_proxy_and_mask_work_do_not_change_authoritative_local_output() -> None:
    rows = np.linspace(0.001, 8.0, 384, dtype=np.float32)[:, None, None]
    columns = np.linspace(0.75, 1.25, 512, dtype=np.float32)[None, :, None]
    image = np.repeat(rows * columns, 3, axis=2)
    adjustments = AdjustmentState()
    expression = MaskExpression(
        operator="leaf",
        leaf=MaskLeaf(
            type="luminance_range",
            fade_in_start_ev=-2,
            full_start_ev=-1,
            full_end_ev=1,
            fade_out_end_ev=2,
            mask_feather=0.05,
        ),
    )
    local = LocalAdjustment(id="export-invariance", mask=expression)
    local.hdr_grade.exposure = 1.5

    exercised = SessionRenderCache(image, None)
    exercised.source_proxy(PreviewKind.HDR, 256)
    exercised.compiled_local_mask(adjustments, local, 256, spatial_only=True)
    after_interaction = exercised.adjusted_frame(
        adjustments,
        PreviewKind.HDR,
        512,
        local_adjustments=[local],
    )

    fresh = SessionRenderCache(image, None)
    authoritative = fresh.adjusted_frame(
        adjustments,
        PreviewKind.HDR,
        512,
        local_adjustments=[local],
    )

    np.testing.assert_array_equal(after_interaction, authoritative)


def test_cached_strip_frame_still_reports_its_exact_scope_peak() -> None:
    """A warm frame has to state its peak as truthfully as a cold one.

    The frame cache is shared with ``adjusted_frame``, and only the bounded
    strip path measures a peak. Before this, a second request for the same
    grade was served out of the cache with a report that carried no peak at
    all, so the exact presentation lost the one number it exists to deliver.
    """
    source = np.linspace(0.0, 4.0, 32 * 48 * 3, dtype=np.float32).reshape(32, 48, 3)
    cache = SessionRenderCache(source, None)
    adjustments = AdjustmentState()

    _cold, cold_report = cache.adjusted_frame_in_strips(
        adjustments, PreviewKind.HDR, 256, budget_bytes=4096,
    )
    _warm, warm_report = cache.adjusted_frame_in_strips(
        adjustments, PreviewKind.HDR, 256, budget_bytes=4096,
    )

    assert "cached" in warm_report.passes, "the second render should have been a cache hit"
    assert cold_report.scope_peak_value is not None
    assert warm_report.scope_peak_value == cold_report.scope_peak_value


def test_strip_frame_cached_by_the_whole_frame_path_is_measured_on_use() -> None:
    """``adjusted_frame`` never measures a peak, and its frames are shared."""
    source = np.linspace(0.0, 4.0, 32 * 48 * 3, dtype=np.float32).reshape(32, 48, 3)
    cache = SessionRenderCache(source, None)
    adjustments = AdjustmentState()

    cache.adjusted_frame(adjustments, PreviewKind.HDR, 256)
    _frame, report = cache.adjusted_frame_in_strips(
        adjustments, PreviewKind.HDR, 256, budget_bytes=4096,
    )

    assert "cached" in report.passes
    assert report.scope_peak_value is not None and report.scope_peak_value > 0.0

    reference = SessionRenderCache(source, None).adjusted_frame_in_strips(
        adjustments, PreviewKind.HDR, 256, budget_bytes=4096,
    )[1]
    assert report.scope_peak_value == pytest.approx(reference.scope_peak_value, rel=2e-6)


def test_evicting_a_cached_frame_drops_the_peak_it_was_holding() -> None:
    source = np.linspace(0.0, 4.0, 32 * 48 * 3, dtype=np.float32).reshape(32, 48, 3)
    cache = SessionRenderCache(source, None)
    cache.max_frames = 1
    first = AdjustmentState()
    second = AdjustmentState()
    second.hdr.exposure = 1.25

    cache.adjusted_frame_in_strips(first, PreviewKind.HDR, 256, budget_bytes=4096)
    cache.adjusted_frame_in_strips(second, PreviewKind.HDR, 256, budget_bytes=4096)

    assert len(cache._frame_scope_peaks) <= len(cache._frames)


# -- persistent source mip cache (PRD 5.3) ---------------------------------


def _mip_identity(image: np.ndarray, **overrides) -> SourceMipIdentity:
    height, width = image.shape[:2]
    payload = {
        "content_key": "test-content",
        "byte_size": int(image.nbytes),
        "width": int(width),
        "height": int(height),
        "decoder_version": "decoder-v1",
        "color_transform_version": "color-v1",
    }
    payload.update(overrides)
    return SourceMipIdentity(**payload)


def _mip_image(height: int = 400, width: int = 600) -> np.ndarray:
    return np.linspace(0.0, 4.0, height * width * 3, dtype=np.float32).reshape(height, width, 3)


def test_source_mip_level_matches_the_cold_downsample_and_survives_a_restart(tmp_path) -> None:
    image = _mip_image()
    identity = _mip_identity(image)
    root = tmp_path / "mips"
    store = SourceMipStore(root)

    level, state = store.level(identity, 256, image)

    assert state == "built"
    np.testing.assert_array_equal(level, downsample_image(image, 256))
    assert not level.flags.writeable
    assert level.shape == (171, 256, 3)

    restarted = SourceMipStore(root)
    warm, warm_state = restarted.level(identity, 256, image)

    assert warm_state == "disk"
    np.testing.assert_array_equal(warm, level)
    diagnostics = restarted.diagnostics()
    assert diagnostics["disk_hits"] == 1
    assert diagnostics["bytes_read"] == int(level.nbytes)
    assert diagnostics["cold_builds"] == 0
    assert diagnostics["bytes_generated"] == 0


def test_source_mip_identity_covers_every_decode_input_and_nothing_else(tmp_path) -> None:
    image = _mip_image()
    base = _mip_identity(image)
    payload = base.payload()

    assert "grade" not in payload and "adjustments" not in payload
    variants = [
        _mip_identity(image, content_key="other-content"),
        _mip_identity(image, decoder_version="decoder-v2"),
        _mip_identity(image, color_transform_version="color-v2"),
        _mip_identity(image, orientation=6),
        _mip_identity(image, reference_white_nits=100),
        _mip_identity(image, interpretation="override"),
        _mip_identity(image, lane="sdr"),
    ]

    digests = {base.digest(), *(variant.digest() for variant in variants)}
    assert len(digests) == len(variants) + 1


def test_source_mip_cold_builds_do_not_invalidate_on_grade_changes(tmp_path) -> None:
    image = _mip_image()
    identity = _mip_identity(image)
    store = SourceMipStore(tmp_path / "mips")
    adjustments = AdjustmentState()
    adjusted = adjustments.model_copy(deep=True)
    adjusted.hdr.exposure = 1.5

    first = SessionRenderCache(image, None, source_identity=identity, mip_store=store)
    second = SessionRenderCache(image, None, source_identity=identity, mip_store=store)
    first.adjusted_frame(adjustments, PreviewKind.HDR, 256)
    second.adjusted_frame(adjusted, PreviewKind.HDR, 256)

    diagnostics = store.diagnostics()
    assert diagnostics["cold_builds"] == 1
    assert diagnostics["memory_hits"] == 1
    assert first._source_proxies[256] is second._source_proxies[256]


def test_source_mip_serves_disk_after_memory_is_dropped(tmp_path) -> None:
    image = _mip_image()
    identity = _mip_identity(image)
    store = SourceMipStore(tmp_path / "mips")
    built, _state = store.level(identity, 256, image)
    store.clear_memory()

    warm, state = store.level(identity, 256, image)

    assert state == "disk"
    np.testing.assert_array_equal(warm, built)


def test_source_mip_odd_dimensions_preserve_headroom_negatives_and_edges(tmp_path) -> None:
    image = np.full((777, 1235, 3), 0.18, dtype=np.float32)
    image[10, 20] = np.float32(5000.0)
    # A patch, so the negative survives averaging without relying on ringing.
    image[696:706, 1195:1205] = np.float32(-3.0)
    identity = _mip_identity(image)
    root = tmp_path / "mips"

    level, _state = SourceMipStore(root).level(identity, 256, image)
    warm, state = SourceMipStore(root).level(identity, 256, image)

    assert (level.shape[1], level.shape[0]) == downsample_target_dimensions(1235, 777, 256)
    assert state == "disk"
    assert np.array_equal(warm, level)
    assert bool(np.all(np.isfinite(level)))
    assert float(np.max(level)) > 100.0
    assert float(np.min(level)) < 0.0
    np.testing.assert_array_equal(level[0, :], warm[0, :])
    np.testing.assert_array_equal(level[-1, -8:], warm[-1, -8:])


def test_source_mip_corruption_is_discarded_and_rebuilt(tmp_path) -> None:
    image = _mip_image()
    identity = _mip_identity(image)
    root = tmp_path / "mips"
    store = SourceMipStore(root)
    built, _state = store.level(identity, 256, image)
    path = store._level_path(identity, 256)

    payload = bytearray(path.read_bytes())
    payload[-1] ^= 0xFF
    path.write_bytes(bytes(payload))

    restarted = SourceMipStore(root)
    rebuilt, state = restarted.level(identity, 256, image)

    assert state == "built"
    assert restarted.diagnostics()["corrupt_discards"] == 1
    np.testing.assert_array_equal(rebuilt, built)
    assert restarted.diagnostics()["disk_hits"] == 0

    truncated = bytearray(path.read_bytes())
    path.write_bytes(bytes(truncated[:20]))
    third = SourceMipStore(root)
    again, state = third.level(identity, 256, image)
    assert state == "built"
    assert third.diagnostics()["corrupt_discards"] == 1
    np.testing.assert_array_equal(again, built)


def test_source_mip_stale_versions_and_interrupted_writes_are_swept(tmp_path) -> None:
    image = _mip_image()
    identity = _mip_identity(image)
    root = tmp_path / "mips"
    stale = root / "v0" / "deadbeef"
    stale.mkdir(parents=True)
    (stale / "256.f32").write_bytes(b"old")
    interrupted = root / f"v{identity.format_version}" / ".256.f32.1234.5678.tmp"
    interrupted.parent.mkdir(parents=True, exist_ok=True)
    interrupted.write_bytes(b"partial")

    store = SourceMipStore(root)
    store.level(identity, 256, image)

    assert not stale.exists()
    assert not interrupted.exists()
    assert store.diagnostics()["stale_removed"] == 1


def test_source_mip_memory_and_disk_lrus_are_byte_bounded(tmp_path) -> None:
    image = _mip_image(900, 600)
    identity = _mip_identity(image)
    store = SourceMipStore(tmp_path / "mips", memory_budget_bytes=800_000, disk_budget_bytes=1_300_000)

    store.level(identity, 256, image)
    store.level(identity, 300, image)
    store.level(identity, 400, image)

    diagnostics = store.diagnostics()
    # Memory is bounded beyond the two most recent levels, which stay resident.
    assert diagnostics["memory_entries"] == 2
    assert diagnostics["disk_bytes"] <= store.disk_budget_bytes
    assert diagnostics["disk_entries"] >= 1
    assert diagnostics["memory_evictions"] >= 1
    assert diagnostics["disk_evictions"] >= 1


def test_a_level_larger_than_the_memory_budget_is_still_served_from_memory(tmp_path) -> None:
    # A magnified view reads one level for every tile, mask and pan. A
    # 36-megapixel source at 66.67% is 258 MiB against a 256 MiB budget; it
    # used to be read from disk again for each of those requests.
    image = _mip_image(900, 600)
    identity = _mip_identity(image)
    store = SourceMipStore(tmp_path / "mips", memory_budget_bytes=100_000)

    first, state = store.level(identity, 600, image)
    assert state == "built" and first.nbytes > store.memory_budget_bytes
    again, state = store.level(identity, 600, image)
    assert state == "memory" and again is first
    # The lane's other level at that size does not push it out either.
    store.level(identity, 590, image)
    assert store.level(identity, 600, image)[1] == "memory"
    assert store.level(identity, 590, image)[1] == "memory"
    store.level(identity, 256, image)
    assert store.diagnostics()["memory_entries"] == 2


def test_source_mip_telemetry_counts_cold_warm_and_build_duration(tmp_path) -> None:
    image = _mip_image()
    identity = _mip_identity(image)
    root = tmp_path / "mips"
    store = SourceMipStore(root)

    store.level(identity, 256, image)
    cold = store.diagnostics()
    assert cold["cold_builds"] == 1
    assert cold["build_count"] == 1
    assert cold["build_ms_total"] > 0.0
    assert cold["build_ms_mean"] > 0.0
    assert cold["bytes_generated"] == int(downsample_image(image, 256).nbytes)
    assert cold["warm_hits"] == 0

    store.level(identity, 256, image)
    memory = store.diagnostics()
    assert memory["memory_hits"] == 1
    assert memory["warm_hits"] == 1

    disk = SourceMipStore(root)
    disk.level(identity, 256, image)
    assert disk.diagnostics()["warm_hits"] == 1
    assert disk.diagnostics()["disk_bytes"] > 0


def test_cold_mip_reports_channel_progress_and_discards_a_cancelled_build(tmp_path) -> None:
    image = _mip_image()
    identity = _mip_identity(image)
    store = SourceMipStore(tmp_path / "mips")
    current = True
    observed = []

    def report(completed: int, total: int) -> None:
        nonlocal current
        observed.append((completed, total, store.diagnostics()["active_builds"]))
        current = False

    with pytest.raises(StaleRender):
        store.level(identity, 256, image, is_current=lambda: current, progress=report)

    assert observed[0][0:2] == (1, 3)
    assert observed[0][2][0]["completed"] == 1
    assert store.diagnostics()["active_builds"] == []
    assert store.diagnostics()["memory_entries"] == 0
    assert store.diagnostics()["disk_entries"] == 0

    level, state = store.level(identity, 256, image)
    assert state == "built"
    np.testing.assert_array_equal(level, downsample_image(image, 256))


def test_source_mip_native_edge_returns_the_decoded_image_uncached(tmp_path) -> None:
    image = _mip_image(300, 500)
    identity = _mip_identity(image)
    store = SourceMipStore(tmp_path / "mips")

    level, state = store.level(identity, 500, image)
    level, state = store.level(identity, 4096, image)

    assert state == "native"
    assert level is image
    diagnostics = store.diagnostics()
    assert diagnostics["native_passes"] == 2
    assert diagnostics["cold_builds"] == 0
    assert diagnostics["disk_entries"] == 0


def test_source_replacement_swaps_identity_and_drops_the_old_memory(tmp_path) -> None:
    old_image = _mip_image()
    new_image = np.full((400, 600, 3), 0.72, dtype=np.float32)
    store = SourceMipStore(tmp_path / "mips")
    cache = SessionRenderCache(
        old_image,
        None,
        source_identity=_mip_identity(old_image),
        mip_store=store,
    )
    cache._proxies(256)
    assert store.diagnostics()["memory_entries"] == 1

    new_identity = _mip_identity(new_image, content_key="new-content")
    cache.replace_source(new_image, None, identity=new_identity)
    level, _sdr = cache._proxies(256)

    assert store.diagnostics()["memory_entries"] <= 1
    assert float(np.max(level)) < 1.0


def test_color_context_changes_do_not_invalidate_source_mips(tmp_path) -> None:
    image = _mip_image()
    store = SourceMipStore(tmp_path / "mips")
    cache = SessionRenderCache(image, None, source_identity=_mip_identity(image), mip_store=store)
    first, _sdr = cache._proxies(256)

    cache.set_color_context(RenderColorContext(100))
    second, _sdr = cache._proxies(256)

    assert second is first
    assert store.diagnostics()["cold_builds"] == 1


def test_geometry_tiles_served_from_a_warm_mip_match_the_cold_path(tmp_path) -> None:
    image = _mip_image(600, 900)
    identity = _mip_identity(image)
    root = tmp_path / "mips"
    adjustments = AdjustmentState()
    adjustments.shared.geometry = GeometryAdjustments(
        rotation=90,
        crop={"x": 0.25, "y": 0.125, "width": 0.5, "height": 0.75},
    )

    cold_cache = SessionRenderCache(image, None, source_identity=identity, mip_store=SourceMipStore(root))
    cold_tile, _space, _signature, cold_placement = cold_cache.geometry_source_tile(
        PreviewKind.HDR,
        256,
        adjustments,
        (10, 20, 90, 120),
        halo=16,
    )

    warm_cache = SessionRenderCache(image, None, source_identity=identity, mip_store=SourceMipStore(root))
    warm_tile, _space, _signature, warm_placement = warm_cache.geometry_source_tile(
        PreviewKind.HDR,
        256,
        adjustments,
        (10, 20, 90, 120),
        halo=16,
    )

    np.testing.assert_array_equal(warm_tile, cold_tile)
    assert warm_placement == cold_placement
    assert warm_cache.mip_store.diagnostics()["disk_hits"] >= 1
    assert warm_cache.mip_store.diagnostics()["cold_builds"] == 0


def test_source_mip_read_failure_is_recorded_instead_of_looking_like_a_miss(
    tmp_path, monkeypatch
) -> None:
    image = _mip_image()
    identity = _mip_identity(image)
    expected, _ = SourceMipStore(tmp_path / "reference").level(identity, 256, image)
    root = tmp_path / "mips"
    SourceMipStore(root).level(identity, 256, image)
    store = SourceMipStore(root)
    target = store._level_path(identity, 256)
    original_read = render_cache_module.Path.read_bytes

    def deny(self):
        if self == target:
            raise PermissionError("denied by test")
        return original_read(self)

    monkeypatch.setattr(render_cache_module.Path, "read_bytes", deny)
    level, state = store.level(identity, 256, image)

    assert state == "built"
    np.testing.assert_array_equal(level, expected)
    diagnostics = store.diagnostics()
    assert diagnostics["disk_read_failures"] == 1
    assert diagnostics["disk_hits"] == 0
    assert diagnostics["last_failure"] == {"category": "read", "path": str(target)}


def test_source_mip_write_failure_is_recorded_and_stays_nonfatal(tmp_path, monkeypatch) -> None:
    image = _mip_image()
    identity = _mip_identity(image)
    expected, _ = SourceMipStore(tmp_path / "reference").level(identity, 256, image)
    store = SourceMipStore(tmp_path / "mips")

    def deny_replace(source, destination):
        raise PermissionError("denied by test")

    monkeypatch.setattr(render_cache_module.os, "replace", deny_replace)
    level, state = store.level(identity, 256, image)

    assert state == "built"
    np.testing.assert_array_equal(level, expected)
    diagnostics = store.diagnostics()
    assert diagnostics["disk_write_failures"] == 1
    assert diagnostics["write_failures"] == 1
    assert diagnostics["last_failure"] == {"category": "write", "path": str(store._level_path(identity, 256))}


def test_source_mip_stale_cleanup_counts_only_successful_deletions(tmp_path, monkeypatch) -> None:
    image = _mip_image()
    identity = _mip_identity(image)
    root = tmp_path / "mips"
    stale = root / "v0" / "deadbeef"
    stale.mkdir(parents=True)
    (stale / "256.f32").write_bytes(b"old")
    store = SourceMipStore(root)

    def deny_rmtree(path, *args, **kwargs):
        raise PermissionError("denied by test")

    monkeypatch.setattr(render_cache_module.shutil, "rmtree", deny_rmtree)
    store.level(identity, 256, image)

    assert stale.exists()
    diagnostics = store.diagnostics()
    assert diagnostics["stale_removed"] == 0
    assert diagnostics["disk_delete_failures"] == 1
    assert diagnostics["last_failure"] == {"category": "delete", "path": str(root / "v0")}


def test_strip_and_whole_frame_paths_share_one_single_flight(monkeypatch) -> None:
    image = _mip_image()
    cache = SessionRenderCache(image, None)
    adjustments = AdjustmentState()
    started = Event()
    release = Event()
    calls: list[str] = []
    original_strips = render_cache_module.render_in_strips

    def delayed_strips(*args, **kwargs):
        calls.append("strips")
        started.set()
        assert release.wait(2)
        return original_strips(*args, **kwargs)

    monkeypatch.setattr(render_cache_module, "render_in_strips", delayed_strips)
    results: dict[str, object] = {}

    def run_strips() -> None:
        results["strips"] = cache.adjusted_frame_in_strips(adjustments, PreviewKind.HDR, 256)

    def run_whole_frame() -> None:
        assert started.wait(2)
        results["whole_frame"] = cache.adjusted_frame(adjustments, PreviewKind.HDR, 256)

    strip_thread = Thread(target=run_strips)
    whole_thread = Thread(target=run_whole_frame)
    strip_thread.start()
    whole_thread.start()
    deadline = time.monotonic() + 2.0
    while cache._singleflight_waits < 1 and time.monotonic() < deadline:
        time.sleep(0.01)
    assert cache._singleflight_waits >= 1, "the whole-frame request never joined the strip flight"
    release.set()
    strip_thread.join(5)
    whole_thread.join(5)
    assert not strip_thread.is_alive() and not whole_thread.is_alive()

    strip_frame, report = results["strips"]
    assert calls == ["strips"]
    assert "cached" not in report.passes
    np.testing.assert_array_equal(results["whole_frame"], strip_frame)
    assert cache._misses == 1
    assert cache._hits == 1


@pytest.mark.parametrize(
    "geometry",
    [
        GeometryAdjustments(straighten_angle=1, perspective_horizontal=-30, perspective_vertical=-20, perspective_rotate=-2),
        GeometryAdjustments(straighten_angle=2.5),
        GeometryAdjustments(rotation=90, crop={"x": 0.07, "y": 0.11, "width": 0.61, "height": 0.83}),
    ],
)
def test_geometry_map_states_the_proxy_frame_size_at_every_edge_without_building_a_level(geometry) -> None:
    # The GPU preview fetches a region of the frame this size names, so it must
    # be the size of the proxy itself and not the full-resolution frame scaled.
    image = np.random.default_rng(5).random((797, 532, 3), dtype=np.float32)
    adjustments = AdjustmentState()
    adjustments.shared.geometry = geometry
    for edge in (797, 564, 398, 282):
        cache = SessionRenderCache(image, None)
        _to_source, _to_output, width, height = cache.geometry_map(adjustments, edge)
        assert not cache._source_proxies
        proxy, _space, _signature = cache.geometry_source_proxy(PreviewKind.HDR, edge, adjustments)
        assert (width, height) == proxy.shape[1::-1]
