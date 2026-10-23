from concurrent.futures import CancelledError

import numpy as np
import pytest
from pydantic import ValidationError

from hdr_finisher.retouch import InpaintSettings, RepairPatch
from hdr_finisher.retouch_jobs import RepairRevision, RepairWorker
from hdr_finisher.retouch_recipe import (InpaintRecipe, compose_repairs,
                                         prepare_repair, stroke_mask)


def recipe(**changes):
    values = dict(source_size=(200, 100), search_rect=(60, 10, 140, 90),
                  points=[dict(x=.5, y=.5)], radius_px=6, hardness=.5,
                  settings=InpaintSettings(seed=42))
    return InpaintRecipe(**(values | changes))


def test_round_trip_owns_one_native_window_and_keeps_float_range():
    record = recipe()
    restored = InpaintRecipe.model_validate_json(record.model_dump_json())
    np.testing.assert_array_equal(stroke_mask(record), stroke_mask(restored))
    source = np.full((100, 200, 3), [-.25, 2., 9.], dtype=np.float32)
    excluded = np.zeros(source.shape[:2], dtype=bool)
    excluded[20, 70] = True
    calls = []

    def read(top, left, bottom, right):
        calls.append((top, left, bottom, right))
        return source[top:bottom, left:right]

    request = prepare_repair(restored, read, read_excluded=lambda t, l, b, r: excluded[t:b, l:r])
    assert calls == [(10, 60, 90, 140)]
    assert request.origin == (60, 10)
    assert request.excluded[10, 10]
    assert request.excluded[request.mask > 0].all()
    source[:] = 0
    excluded[:] = False
    np.testing.assert_array_equal(request.pixels[0, 0], np.array([-.25, 2., 9.], np.float32))
    assert request.excluded[10, 10]


def test_non_square_source_disc_is_round_and_has_feathered_boundary():
    mask = stroke_mask(recipe())
    # Native centre is (100,50); the window centre is (40,40).
    np.testing.assert_array_equal(mask, mask.T)
    assert mask[40, 40] == 1
    assert 0 < mask[40, 45] < 1
    assert mask[40, 46] == 0
    assert mask.dtype == np.float32


def test_capsules_fill_between_sparse_samples_and_repeated_points():
    record = recipe(points=[dict(x=.45, y=.5), dict(x=.55, y=.5), dict(x=.55, y=.5)])
    mask = stroke_mask(record)
    assert (mask[40, 30:50] == 1).all()
    assert not mask[0].any()
    assert not mask[-1].any()


def test_clipping_is_only_at_actual_image_border():
    mask = stroke_mask(recipe(search_rect=(0, 0, 80, 80), points=[dict(x=0, y=0)]))
    assert mask[0, 0] == 1
    assert not mask[-1].any()
    with pytest.raises(ValidationError, match="cut off"):
        recipe(search_rect=(100, 10, 140, 90))


@pytest.mark.parametrize("changes", [
    dict(search_rect=(0, 0, 2049, 80), source_size=(2100, 100)),
    dict(search_rect=(-1, 0, 80, 80)), dict(source_size=(0, 100)),
    dict(search_rect=(60.5, 10, 140, 90)), dict(radius_px=float("nan")),
    dict(points=[dict(x=float("inf"), y=.5)]),
    dict(settings=dict(algorithm="unavailable-engine")),
    dict(points=[dict(x=.5, y=.5)] * 513),
])
def test_invalid_recipes_rejected(changes):
    with pytest.raises((ValueError, ValidationError)):
        recipe(**changes)


def test_empty_stroke_rejected_before_reading_source():
    def unexpected_read(*args):
        pytest.fail("Invalid stroke must not read the source")

    with pytest.raises(ValueError, match="at least one"):
        prepare_repair(recipe(points=[dict(x=.5, y=.5, pressure=0)]), unexpected_read)



def test_reader_shape_dtype_and_exclusion_contracts_are_checked():
    with pytest.raises(ValueError, match="shape"):
        prepare_repair(recipe(), lambda *args: np.zeros((79, 80, 3), np.float32))
    with pytest.raises(ValueError, match="float32"):
        prepare_repair(recipe(), lambda *args: np.zeros((80, 80, 3), np.uint8))
    with pytest.raises(ValueError, match="boolean"):
        prepare_repair(recipe(), lambda *args: np.zeros((80, 80, 3), np.float32),
                       read_excluded=lambda *args: np.zeros((80, 80), np.float32))


def test_mutated_nested_point_is_revalidated_before_any_read():
    record = recipe()
    record = record.model_copy(update={"points": (record.points[0].model_copy(update={"x": 10}),)})
    with pytest.raises(ValueError):
        prepare_repair(record, lambda *args: pytest.fail("Should not read"))


def test_cancellation_between_capsules_prevents_source_read():
    checks = 0

    def cancel():
        nonlocal checks
        checks += 1
        if checks == 3:
            raise CancelledError()

    with pytest.raises(CancelledError):
        prepare_repair(recipe(points=[dict(x=.45, y=.5), dict(x=.5, y=.5), dict(x=.55, y=.5)]),
                       lambda *args: pytest.fail("Should not read"), checkpoint=cancel)


def test_recipe_worker_replay_and_composition_are_independent_of_window_boundaries():
    source = np.full((100, 200, 3), [-.25, 2., 9.], dtype=np.float32)
    record = recipe(hardness=1)
    mask = stroke_mask(record)
    source[10:90, 60:140][mask > 0] = -10
    original = source.copy()
    reader = lambda t, l, b, r: source[t:b, l:r]
    request = prepare_repair(record, reader)
    with RepairWorker() as worker:
        token = RepairRevision("document", "native-source", 1)
        worker.set_current(token)
        future, _ = worker.submit(request, record.settings, token=token)
        completion = future.result(timeout=10)
        patch = worker.accept(completion)
        future, _ = worker.submit(prepare_repair(InpaintRecipe.model_validate_json(record.model_dump_json()), reader),
                                  record.settings, token=token)
        replay = future.result(timeout=10)
        assert replay.cached
        np.testing.assert_array_equal(replay.patch.pixels, patch.pixels)
    whole = compose_repairs(source, (0, 0), [patch])
    windows = np.concatenate([compose_repairs(source[:, :100], (0, 0), [patch]),
                              compose_repairs(source[:, 100:], (100, 0), [patch])], axis=1)
    np.testing.assert_array_equal(whole, windows)
    np.testing.assert_array_equal(source, original)
    np.testing.assert_allclose(whole[50, 100], [-.25, 2., 9.], atol=1e-6)
    untouched = np.ones(source.shape[:2], bool)
    untouched[10:90, 60:140] = mask == 0
    np.testing.assert_array_equal(whole[untouched], original[untouched])


def test_completed_patches_compose_in_dependency_order_without_feathering_again():
    empty = np.empty((0, 2), np.int32)
    first = RepairPatch((5, 5), np.full((4, 4, 3), 2., np.float32), empty, empty)
    second = RepairPatch((7, 7), np.full((4, 4, 3), -.5, np.float32), empty, empty)
    window = np.zeros((6, 6, 3), np.float32)
    result = compose_repairs(window, (6, 6), [first, second])
    assert (result[0, 0] == 2).all()
    assert (result[1:5, 1:5] == -.5).all()
    assert not window.any()


@pytest.mark.parametrize("diameter", [100, 512, 1024])
def test_large_native_brush_is_bounded_repeatable_and_does_not_sample_dirt(diameter):
    from hdr_finisher.retouch import CpuInpaint, NativeRepairInput
    edge = min(2048, diameter * 2)
    record = recipe(source_size=(edge, edge), search_rect=(0, 0, edge, edge),
                    points=[dict(x=.5, y=.5)], radius_px=diameter / 2, hardness=.75)
    mask = stroke_mask(record)
    source = np.full((edge, edge, 3), [-.25, 2., 9.], np.float32)
    dirty = source.copy()
    dirty[mask > 0] = -50
    request = prepare_repair(record, lambda t, l, b, r: dirty[t:b, l:r])
    assert isinstance(request, NativeRepairInput)
    patch = CpuInpaint().solve(request)
    repaired = compose_repairs(dirty, (0, 0), [patch])
    np.testing.assert_allclose(repaired[edge//2, edge//2], source[0, 0], atol=1e-5)
    np.testing.assert_array_equal(repaired[mask == 0], dirty[mask == 0])
    dirty[mask > 0] = 10000
    repeat = CpuInpaint().solve(prepare_repair(record, lambda t, l, b, r: dirty[t:b, l:r]))
    # Native feathering deliberately retains the original at soft boundaries.
    x, y = patch.origin
    solid = mask[y:y+patch.pixels.shape[0], x:x+patch.pixels.shape[1]] == 1
    np.testing.assert_array_equal(patch.pixels[solid], repeat.pixels[solid])
    assert len(patch.target_centres) <= 8192
