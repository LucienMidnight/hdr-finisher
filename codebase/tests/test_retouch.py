from concurrent.futures import CancelledError
from dataclasses import replace
from threading import Event, get_ident

import numpy as np
import pytest

from hdr_finisher.retouch import CpuInpaint, InpaintSettings, RepairInput
from hdr_finisher.retouch_jobs import RepairRevision, RepairWorker


def example():
    y, x = np.mgrid[:40, :40].astype(np.float32)
    pixels = np.stack((x / 100 - .5, y / 100 + 2, x / 100 + y / 100 + 5), -1)
    mask = ((x - 20)**2 + (y - 20)**2 <= 9).astype(np.float32)
    pixels[mask > 0] = -10
    return RepairInput(pixels, mask, (100, 200))


def test_reproducible_float_repair_preserves_hdr_and_untouched_pixels():
    request = example()
    before = request.pixels.copy()
    engine = CpuInpaint()
    first = engine.solve(request)
    second = engine.solve(request)
    np.testing.assert_array_equal(first.pixels, second.pixels)
    np.testing.assert_array_equal(first.source_centres, second.source_centres)
    assert first.origin == (117, 217)
    assert first.pixels.dtype == np.float32
    assert np.min(first.pixels[..., 0]) < 0
    assert np.max(first.pixels[..., 2]) > 5
    assert np.isfinite(first.pixels).all()
    x, y = 17, 17
    local_mask = request.mask[y:y + 7, x:x + 7] > 0
    np.testing.assert_array_equal(first.pixels[~local_mask], before[y:y + 7, x:x + 7][~local_mask])
    np.testing.assert_array_equal(request.pixels, before)
    assert not first.pixels.flags.writeable


@pytest.mark.parametrize("dirty_value", [900, 1e30])
def test_dirty_values_never_influence_solution_or_source_patches(dirty_value):
    request = example()
    excluded = np.zeros_like(request.mask, dtype=bool)
    excluded[6:11, 6:11] = True
    excluded[26:28, 20:24] = True  # Also inside some target matching windows.
    request = replace(request, excluded=excluded)
    alternative = request.pixels.copy()
    alternative[(request.mask > 0) | excluded] = dirty_value
    first = CpuInpaint().solve(request)
    second = CpuInpaint().solve(replace(request, pixels=alternative))
    np.testing.assert_array_equal(first.pixels[request.mask[17:24, 17:24] > 0],
                                  second.pixels[request.mask[17:24, 17:24] > 0])
    all_defects = (request.mask > 0) | excluded
    for y, x in first.source_centres:
        assert not all_defects[y - 3:y + 4, x - 3:x + 4].any()


def test_feather_blends_without_clipping():
    request = example()
    full = CpuInpaint().solve(request)
    half = CpuInpaint().solve(replace(request, mask=request.mask * .5))
    original = request.pixels[17:24, 17:24]
    np.testing.assert_allclose(half.pixels, (full.pixels.astype(np.float64) + original) / 2, atol=5e-7)


@pytest.mark.parametrize("position", [(0, 0), (0, 20), (39, 39)])
def test_image_border_spots(position):
    request = example()
    pixels = np.full_like(request.pixels, [2., -.2, .5])
    y, x = np.mgrid[:40, :40]
    mask = ((x - position[0])**2 + (y - position[1])**2 <= 9).astype(np.float32)
    pixels[mask > 0] = 0
    patch = CpuInpaint().solve(RepairInput(pixels, mask))
    np.testing.assert_allclose(patch.pixels, np.broadcast_to([2., -.2, .5], patch.pixels.shape), atol=1e-7)


def test_invalid_requests_and_cancellation():
    request = example()
    for bad in (replace(request, pixels=request.pixels.astype(np.uint8)),
                replace(request, mask=np.full((40, 40), np.nan)),
                replace(request, mask=np.zeros((40, 40))),
                replace(request, pixels=np.zeros((300, 300, 3), np.float32))):
        with pytest.raises(ValueError):
            CpuInpaint().solve(bad)
    with pytest.raises(ValueError, match="source patch"):
        CpuInpaint().solve(replace(request, mask=np.ones((40, 40))))
    calls = []
    def stop():
        calls.append(1)
        if len(calls) == 4:
            raise CancelledError()
    with pytest.raises(CancelledError):
        CpuInpaint().solve(request, checkpoint=stop)
    for kwargs in ({"patch_radius": 0}, {"iterations": 13}, {"seed": -1}, {"algorithm": "unknown"}):
        with pytest.raises(ValueError):
            InpaintSettings(**kwargs)


def test_worker_cache_revision_settings_and_source_identity():
    request = example()
    token = RepairRevision("photo", "source-a", 1)
    with RepairWorker() as worker:
        worker.set_current(token)
        first = worker.submit(request, token=token)[0].result()
        assert not first.cached
        assert worker.submit(request, token=token)[0].result().cached
        changed = worker.submit(request, InpaintSettings(seed=1), token=token)[0].result()
        assert not changed.cached and changed.key != first.key
        new = replace(token, revision=2)
        worker.set_current(new)
        with pytest.raises(CancelledError):
            worker.accept(first)
        # Downstream grade revision reuses the same completed repair.
        assert worker.submit(request, token=new)[0].result().cached
        source = replace(new, source="source-b")
        worker.set_current(source)
        assert not worker.submit(request, token=source)[0].result().cached
        edited = request.pixels.copy()
        edited[0, 0] += .1
        assert not worker.submit(replace(request, pixels=edited), token=source)[0].result().cached


def test_worker_bounds_ownership_stale_and_cancelled_jobs():
    entered, proceed = Event(), Event()
    main_thread = get_ident()
    class GatedEngine:
        def solve(self, request, settings, checkpoint):
            assert get_ident() != main_thread
            entered.set()
            assert proceed.wait(5)
            checkpoint()
            return CpuInpaint().solve(request, settings, checkpoint)
    token = RepairRevision("photo", "source", 1)
    request = example()
    with RepairWorker(GatedEngine()) as worker:
        worker.set_current(token)
        first, cancel = worker.submit(request, token=token)
        try:
            assert entered.wait(5)
            second, _ = worker.submit(request, token=token)
            with pytest.raises(RuntimeError, match="full"):
                worker.submit(request, token=token)
            request.pixels[:] = 999  # Worker must already own its input.
            cancel.set()
        finally:
            proceed.set()
        with pytest.raises(CancelledError):
            first.result(timeout=5)
        result = second.result(timeout=5)
        assert np.max(result.patch.pixels) < 999
        worker.set_current(replace(token, document="another-photo"))
        with pytest.raises(CancelledError):
            worker.submit(example(), token=token)[0].result(timeout=5)


def test_completed_cache_is_byte_bounded():
    token = RepairRevision("photo", "source", 1)
    with RepairWorker(cache_bytes=1) as worker:
        worker.set_current(token)
        assert not worker.submit(example(), token=token)[0].result().cached
        assert not worker.submit(example(), token=token)[0].result().cached


def test_revision_change_during_solve_and_cancel_after_completion():
    entered, proceed = Event(), Event()
    class GatedEngine:
        def solve(self, request, settings, checkpoint):
            entered.set()
            assert proceed.wait(5)
            checkpoint()
            return CpuInpaint().solve(request, settings, checkpoint)
    token = RepairRevision("photo", "source", 1)
    with RepairWorker(GatedEngine()) as worker:
        worker.set_current(token)
        future, _ = worker.submit(example(), token=token)
        try:
            assert entered.wait(5)
            worker.set_current(replace(token, revision=2))
        finally:
            proceed.set()
        with pytest.raises(CancelledError):
            future.result(timeout=5)
        worker.set_current(token)
        completion = worker.submit(example(), token=token)[0].result(timeout=5)
        assert not completion.cached  # Stale solve was never cached.
        completion.cancellation.set()
        with pytest.raises(CancelledError):
            worker.accept(completion)


def test_oversized_and_scattered_work_is_rejected():
    image = np.ones((256, 256, 3), np.float32)
    mask = np.zeros((256, 256), np.float32)
    mask[10:100, 10:100] = 1
    with pytest.raises(ValueError, match="4096"):
        CpuInpaint().solve(RepairInput(image, mask))
    mask[:] = 0
    mask[4:250:6, 4:250:6] = 1
    with pytest.raises(ValueError, match="target patches"):
        CpuInpaint().solve(RepairInput(image, mask))


def test_smooth_gradient_continues_through_defect():
    request = example()
    y, x = np.mgrid[17:24, 17:24].astype(np.float32)
    clean = np.stack((x / 100 - .5, y / 100 + 2, x / 100 + y / 100 + 5), -1)
    repaired = CpuInpaint().solve(request)
    selected = request.mask[17:24, 17:24] > 0
    # Existing float blending precision; this is not a visual quality threshold.
    np.testing.assert_allclose(repaired.pixels[selected], clean[selected], rtol=0, atol=5e-7)


def test_curved_hdr_highlight_repair_improves_on_dirty_input():
    y, x = np.mgrid[:96, :96].astype(np.float32)
    highlight = .2 + 8 * np.exp(-((x - 48)**2 + (y - 48)**2) / 250)
    clean = np.stack((highlight, highlight * .8, highlight * .6), -1)
    mask = ((x - 48)**2 + (y - 48)**2 <= 49).astype(np.float32)
    dirty = clean.copy()
    dirty[mask > 0] *= .65
    patch = CpuInpaint().solve(RepairInput(dirty, mask))
    selected = mask[41:56, 41:56] > 0
    expected = clean[41:56, 41:56][selected]
    original = dirty[41:56, 41:56][selected]
    assert np.mean((patch.pixels[selected] - expected)**2) < np.mean((original - expected)**2)
    assert patch.pixels[..., 0].max() > 1


@pytest.mark.parametrize("axis", [0, 1])
def test_colour_edge_is_not_replaced_by_smooth_ramp(axis):
    y, x = np.mgrid[:48, :48]
    side = (x if axis else y) >= 24
    # Colour boundary, including a negative channel: check RGB, not luma alone.
    clean = np.where(side[..., None], np.array([2., -.1, .2]), np.array([.1, .8, 2.]))
    clean = clean.astype(np.float32)
    mask = ((x - 24)**2 + (y - 24)**2 <= 9).astype(np.float32)
    dirty = clean.copy()
    dirty[mask > 0] = 0
    patch = CpuInpaint().solve(RepairInput(dirty, mask))
    local_side = side[21:28, 21:28]
    selected = mask[21:28, 21:28] > 0
    # The two sides must retain their colour ordering after repair.
    first = patch.pixels[selected & local_side].mean(axis=0)
    second = patch.pixels[selected & ~local_side].mean(axis=0)
    assert first[0] > second[0] and first[2] < second[2]


def noisy_example(seed, colour=False):
    rng = np.random.Generator(np.random.PCG64(seed))
    y, x = np.mgrid[:64, :64].astype(np.float32)
    noise = rng.normal(0, .025, (64, 64, 3 if colour else 1)).astype(np.float32)
    clean = np.array([2., -.2, .5], np.float32) + (x + y)[..., None] * .001 + noise
    mask = ((x - 32)**2 + (y - 32)**2 <= 49).astype(np.float32)
    dirty = clean.copy()
    dirty[mask > 0] *= .5
    return RepairInput(dirty, mask), clean


def put_patch(request, patch):
    result = request.pixels.copy()
    x, y = patch.origin
    result[y:y + patch.pixels.shape[0], x:x + patch.pixels.shape[1]] = patch.pixels
    return result


@pytest.mark.parametrize("seed,colour", [(3, False), (71, False), (19, True)])
def test_noise_detail_is_not_averaged_away(seed, colour):
    request, clean = noisy_example(seed, colour)
    patch = CpuInpaint().solve(request)
    repaired = put_patch(request, patch)
    assert patch.texture_offset is not None
    np.testing.assert_array_equal(repaired[request.mask == 0], request.pixels[request.mask == 0])
    # Adjacent differences measure fine-detail strength without requiring the
    # donor's random samples to equal the unknowable original samples.
    selected = (request.mask[1:] > 0) & (request.mask[:-1] > 0)
    reference = np.sqrt(np.mean(np.diff(clean.astype(np.float64), axis=0)[selected]**2))
    actual = np.sqrt(np.mean(np.diff(repaired.astype(np.float64), axis=0)[selected]**2))
    assert .5 * reference <= actual <= 1.5 * reference
    assert repaired[..., 0].max() > 1 and repaired[..., 1].min() < 0
    dx, dy = patch.texture_offset
    excluded = request.mask > 0
    # The complete 21px donor context, not only its centre, must be clean.
    assert not excluded[22 + dy:43 + dy, 22 + dx:43 + dx].any()
    assert 0 <= 22 + dx and 43 + dx <= 64 and 0 <= 22 + dy and 43 + dy <= 64
    repeat = CpuInpaint().solve(request)
    np.testing.assert_array_equal(patch.pixels, repeat.pixels)
    assert patch.texture_offset == repeat.texture_offset


def test_texture_donor_excludes_other_defects_and_extreme_dirty_values():
    request, _ = noisy_example(41)
    excluded = np.zeros_like(request.mask, dtype=bool)
    excluded[30:34, 23:25] = True  # Touches matching context, outside this repair.
    excluded[5:14, 4:17] = True
    request = replace(request, excluded=excluded)
    first = CpuInpaint().solve(request)
    assert first.texture_offset is not None
    dirty = request.pixels.copy()
    dirty[(request.mask > 0) | excluded] = 1e30
    second = CpuInpaint().solve(replace(request, pixels=dirty))
    selected = request.mask[25:40, 25:40] > 0
    np.testing.assert_array_equal(first.pixels[selected], second.pixels[selected])
    assert first.texture_offset == second.texture_offset
    dx, dy = first.texture_offset
    all_excluded = (request.mask > 0) | excluded
    assert not all_excluded[22 + dy:43 + dy, 22 + dx:43 + dx].any()


def test_cancel_during_texture_search():
    request, _ = noisy_example(3)
    calls = 0
    def checkpoint():
        nonlocal calls
        calls += 1
        if calls == 20:
            raise CancelledError()
    with pytest.raises(CancelledError):
        CpuInpaint().solve(request, InpaintSettings(iterations=1), checkpoint)


@pytest.mark.parametrize("position", [(0, 0), (0, 32), (63, 63)])
def test_noisy_border_repair_remains_bounded_and_reproducible(position):
    _, clean = noisy_example(13)
    y, x = np.mgrid[:64, :64]
    mask = ((x - position[0])**2 + (y - position[1])**2 <= 49).astype(np.float32)
    dirty = clean.copy()
    dirty[mask > 0] = 0
    request = RepairInput(dirty, mask)
    first = CpuInpaint().solve(request)
    second = CpuInpaint().solve(request)
    assert np.isfinite(first.pixels).all()
    np.testing.assert_array_equal(first.pixels, second.pixels)
    result = put_patch(request, first)
    np.testing.assert_array_equal(result[mask == 0], dirty[mask == 0])
    if first.texture_offset is not None:
        dx, dy = first.texture_offset
        ys, xs = np.nonzero(mask)
        y0, y1 = max(0, int(ys.min()) - 3), min(64, int(ys.max()) + 4)
        x0, x1 = max(0, int(xs.min()) - 3), min(64, int(xs.max()) + 4)
        assert 0 <= x0 + dx and x1 + dx <= 64 and 0 <= y0 + dy and y1 + dy <= 64
        assert not mask[y0 + dy:y1 + dy, x0 + dx:x1 + dx].any()


def test_larger_or_source_starved_repairs_keep_valid_patchmatch_result():
    request, _ = noisy_example(13)
    mask = np.zeros((64, 64), np.float32)
    mask[30:32, 15:49] = 1  # Beyond the small coherent-donor footprint.
    larger = replace(request, mask=mask)
    patch = CpuInpaint().solve(larger, InpaintSettings(iterations=1))
    assert patch.texture_offset is None and np.isfinite(patch.pixels).all()
    result = put_patch(larger, patch)
    np.testing.assert_array_equal(result[mask == 0], larger.pixels[mask == 0])
    # Small donors exist, but no complete 21px donor context can be clean.
    excluded = np.ones((64, 64), dtype=bool)
    excluded[16:26, 16:26] = False
    starved = replace(request, excluded=excluded)
    patch = CpuInpaint().solve(starved, InpaintSettings(iterations=1))
    assert patch.texture_offset is None and np.isfinite(patch.pixels).all()


def test_concurrent_same_repair_accounts_for_one_cached_patch():
    from threading import Barrier
    from hdr_finisher.cpu_budget import logical_cpus
    if logical_cpus() < 2:
        pytest.skip("needs two logical CPUs")
    ready = Barrier(2)
    class ConcurrentEngine:
        def solve(self, request, settings, checkpoint):
            ready.wait(timeout=5)
            return CpuInpaint().solve(request, settings, checkpoint)
    token = RepairRevision("photo", "source", 1)
    with RepairWorker(ConcurrentEngine()) as worker:
        worker.set_current(token)
        first = worker.submit(example(), token=token)[0]
        second = worker.submit(example(), token=token)[0]
        a, b = first.result(timeout=10), second.result(timeout=10)
        assert a.patch.pixels.tobytes() == b.patch.pixels.tobytes()
        assert worker._bytes == a.patch.nbytes
        assert worker.submit(example(), token=token)[0].result(timeout=5).cached
