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


def test_dirty_values_never_influence_solution_or_source_patches():
    request = example()
    excluded = np.zeros_like(request.mask, dtype=bool)
    excluded[6:11, 6:11] = True
    excluded[26:28, 20:24] = True  # Also inside some target matching windows.
    request = replace(request, excluded=excluded)
    alternative = request.pixels.copy()
    alternative[(request.mask > 0) | excluded] = 900
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
