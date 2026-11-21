from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from threading import Barrier, Event

import numpy as np

from hdr_finisher import denoise_adaptive as adaptive, denoise_grain as grain
from hdr_finisher.models import DenoiseDocumentSettings
from tools.denoise_eval.candidates import even_keep_round4 as round4


def test_experimental_grain_matches_research():
    rng = np.random.default_rng(115)
    y, x = np.mgrid[:372, :547].astype(np.float32)
    rgb = np.broadcast_to((.12 + x * .0006 - y * .0007)[..., None], (*x.shape, 3)).copy()
    rgb += rng.normal(0, .007, rgb.shape).astype(np.float32)
    rgb[45:57, 312:326, 1] += .03
    rgb[100:109, 316:327] -= .06
    model = adaptive.AdaptiveNoiseModel(.0003, .00008, 0, ((1., .6, .36, .21, .12),) * 3)
    standard = adaptive.AdaptiveControls()
    fine = replace(standard, method="fine_grain")

    np.testing.assert_array_equal(
        adaptive.resolve_adaptive(rgb, model, replace(fine, grain_evenness=0)),
        adaptive.resolve_adaptive(rgb, model, standard),
    )
    expected_fine = round4.resolve(rgb, model, 18, calibration=round4.calibrate_brightness(rgb, model, (18,)))
    actual = adaptive.resolve_adaptive(rgb, model, fine)
    np.testing.assert_allclose(actual, expected_fine, atol=2e-6, rtol=1e-5)


def test_clean_grain_lowers_compact_colour_without_changing_luminance():
    rng = np.random.default_rng(18)
    rgb = np.full((117, 119, 3), .031, dtype=np.float32)
    rgb += rng.normal(0, .0006, rgb.shape).astype(np.float32)
    rgb[54:60, 55:61] += np.array([.019, -.005, -.014], dtype=np.float32)
    yx = np.s_[55:59, 56:60]
    clean = grain.apply_colour(rgb, grain.colour_delta(rgb, False), 1)
    np.testing.assert_allclose(clean @ grain.LUMA, rgb @ grain.LUMA, atol=1e-7)
    assert np.linalg.norm(clean[yx] @ grain.CHROMA.T) < .5 * np.linalg.norm(rgb[yx] @ grain.CHROMA.T)


def test_clean_grain_limits_colour_spread_from_a_bright_point():
    from hdr_finisher.delivery_colour import compare_finished_pixels
    from hdr_finisher.preview import _hdr_to_sdr_display

    rgb = np.broadcast_to(np.array([.014, .03, .02], dtype=np.float32), (85, 85, 3)).copy()
    rgb[40:43, 40:43] = (2, .65, .23)
    clean = grain.apply_colour(rgb, grain.colour_delta(rgb, False), 1)
    dy, dx = np.ogrid[-41:44, -41:44]
    ring = ((dy**2 + dx**2 >= 9) & (dy**2 + dx**2 <= 400))
    before, after = [_hdr_to_sdr_display(frame[ring][None] * 4) for frame in (rgb, clean)]
    assert compare_finished_pixels(before, after, "sdr").passed


def test_grain_settings_round_trip_with_standard_default():
    existing_grade = DenoiseDocumentSettings.model_validate({"hdr": {"enabled": True, "controls": {"amount": .35}}})
    assert existing_grade.hdr.controls.method == "standard"
    assert existing_grade.hdr.controls.amount == .35
    grade = DenoiseDocumentSettings.model_validate({"hdr": {"enabled": True, "controls": {
        "method": "clean_grain", "grain_evenness": .57, "color_splotches": .33,
        "splotch_size": "large",
    }}})
    assert DenoiseDocumentSettings.model_validate_json(grade.model_dump_json()) == grade


def test_clean_grain_reuses_native_fine_grain_across_tile_edges(tmp_path):
    from hdr_finisher.library_cache import LibraryCache

    source = np.random.default_rng(41).normal(.025, .006, (575, 601, 3)).astype(np.float32)
    height, width = source.shape[:2]
    model = adaptive.AdaptiveNoiseModel(.0003, .00008, 0, ((1., .6, .36, .21, .12),) * 3)
    fine = adaptive.AdaptiveControls(method="fine_grain")
    clean = replace(fine, method="clean_grain", splotch_size="large")
    read = lambda top, left, bottom, right: source[top:bottom, left:right]
    fit = grain.fit_grain(height, width, read, model, fine)
    cache = LibraryCache(tmp_path)
    current = lambda: True
    prepared = grain.GrainPreparation(height, width, read, model, fine, fit, current, cache)
    expected = grain.GrainPreparation(height, width, read, model, clean, fit, current, cache)
    try:
        native = (0, 0, height, width, height, width)
        reduced = (0, 0, 161, 168, 161, 168)
        original = [prepared.region(*region, colour=False) for region in (native, reduced)]
        prepared.add_colour(clean, current)
        for region, fine_bytes in zip((native, reduced), original):
            assert prepared.region(*region, colour=False) == fine_bytes
            assert prepared.region(*region, colour=True) == expected.region(*region)
    finally:
        prepared.close()
        expected.close()


def test_native_warmup_does_not_fill_the_rest_and_visible_reads_share_work(tmp_path, monkeypatch):
    from hdr_finisher import cpu_budget
    from hdr_finisher.library_cache import LibraryCache

    size = adaptive.TILE_SIZE
    width = 4 * size
    source = np.broadcast_to(np.arange(width, dtype=np.float32)[None, :, None], (16, width, 3))
    resolved = []
    background_entered = Event()
    release_background = Event()
    visible_submitted = Event()
    pool = cpu_budget.PriorityCpuPool(1)
    submit = pool.submit

    def observe(function, **options):
        future = submit(function, **options)
        if options.get("background") is None and background_entered.is_set():
            visible_submitted.set()
        return future

    def resolve(read, height, width, origin, size, *_):
        resolved.append(origin)
        y, x = origin
        if x == 0:
            background_entered.set()
            assert release_background.wait(5)
        return read(y, x, min(y + size, height), min(x + size, width)), np.s_[:, :]

    monkeypatch.setattr(cpu_budget, "_cpu_pool", pool)
    monkeypatch.setattr(pool, "submit", observe)
    monkeypatch.setattr(grain, "_resolved_tile", resolve)
    read = lambda y, x, b, r: source[y:b, x:r]
    settings = adaptive.AdaptiveControls(method="fine_grain")
    prepared = grain.GrainPreparation(16, width, read, None, settings, None, lambda: True, LibraryCache(tmp_path))
    warm = (0, 3 * size, 1, 1, 16, width)
    visible = (0, 2 * size, 1, 1, 16, width)
    try:
        assert resolved == []
        assert prepared.region(*warm, warm_only=True) is None
        assert resolved == [(0, 3 * size)]
        prepared.region(*warm)
        assert background_entered.wait(5)

        with ThreadPoolExecutor(2) as readers:
            first = readers.submit(prepared.region, *visible)
            second = readers.submit(prepared.region, *visible)
            try:
                assert visible_submitted.wait(5)
            finally:
                release_background.set()
            assert first.result(5) == second.result(5) == grain._pack(source[:1, 2 * size:2 * size + 1]).tobytes()
        assert resolved[:3] == [(0, 3 * size), (0, 0), (0, 2 * size)]
        assert resolved.count((0, 2 * size)) == 1
    finally:
        release_background.set()
        prepared.close()
        pool.pool.shutdown()


def test_native_warmup_runs_visible_tiles_together(tmp_path, monkeypatch):
    from hdr_finisher import cpu_budget
    from hdr_finisher.library_cache import LibraryCache

    size = adaptive.TILE_SIZE
    source = np.full((8, 3 * size, 3), .25, dtype=np.float32)
    visible = Barrier(2, timeout=5)
    resolved = []
    pool = cpu_budget.PriorityCpuPool(2)

    def resolve(read, height, width, origin, size, *_):
        resolved.append(origin)
        y, x = origin
        assert x >= size
        # This can only complete if both visible tiles are dispatched together.
        visible.wait()
        return read(y, x, height, min(x + size, width)), np.s_[:, :]

    monkeypatch.setattr(cpu_budget, "_cpu_pool", pool)
    monkeypatch.setattr(grain, "_resolved_tile", resolve)
    read = lambda y, x, b, r: source[y:b, x:r]
    settings = adaptive.AdaptiveControls(method="fine_grain")
    prepared = grain.GrainPreparation(8, 3 * size, read, None, settings, None, lambda: True, LibraryCache(tmp_path))
    try:
        prepared.region(0, size, 8, 2 * size, 8, 3 * size, warm_only=True)
        assert sorted(resolved) == [(0, size), (0, 2 * size)]
    finally:
        prepared.close()
        pool.pool.shutdown()
