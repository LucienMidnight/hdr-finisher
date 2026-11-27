import pytest
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
    fine = replace(standard, method="clean_grain", clean_splotches=False, clean_fringes=False)

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
        "splotch_size": "large", "clean_splotches": False, "clean_fringes": True,
    }}, "sdr": {"controls": {"clean_splotches": True, "clean_fringes": False}}})
    restored = DenoiseDocumentSettings.model_validate_json(grade.model_dump_json())
    assert restored == grade
    assert restored.hdr.controls.clean_splotches is False
    assert restored.hdr.controls.clean_fringes is True
    assert restored.sdr.controls.clean_splotches is True
    assert restored.sdr.controls.clean_fringes is False

    old = DenoiseDocumentSettings.model_validate({"hdr": {"controls": {"clean_color": False}}})
    assert old.hdr.controls.clean_splotches and old.hdr.controls.clean_fringes
    assert "clean_color" not in old.hdr.controls.model_dump()


def test_clean_grain_protects_a_colour_edge_while_removing_a_local_blotch():
    height, width = 155, 171
    y, x = np.ogrid[:height, :width]
    rng = np.random.default_rng(787)
    source = np.full((height, width, 3), .026, np.float32)
    source += rng.normal(0, .0005, source.shape).astype(np.float32)
    source += (.014 * np.clip((x - 80) / 8 + .5, 0, 1))[..., None] * grain.CHROMA[0]
    source += (.006 * np.exp(-((y - 75)**2 + (x - 45)**2) / 22))[..., None] * grain.CHROMA[1]

    old = grain.colour_delta(source, False)
    _, new = grain.colour_delta(source, False, fringes=False, separate=True)
    edge = np.s_[28:-28, 76:85, :]
    assert np.linalg.norm(new[edge]) < .5 * np.linalg.norm(old[edge])
    assert abs(new[75, 45, 1]) >= .9 * abs(old[75, 45, 1])
    # With protection off the splotch pass reaches the edge again.
    _, unprotected = grain.colour_delta(source, False, fringes=False, separate=True, protect_edges=False)
    assert np.linalg.norm(unprotected[edge]) > 2 * np.linalg.norm(new[edge])


def test_edge_protection_ignores_flat_noise_and_other_hues_on_an_edge():
    # Steve, November 25: protection fired on splotch rims all over flat
    # backgrounds, and held back dots of a different hue sitting on an edge.
    height, width = 155, 171
    y, x = np.ogrid[:height, :width]
    rng = np.random.default_rng(787)
    source = np.full((height, width, 3), .026, np.float32)
    source += rng.normal(0, .0005, source.shape).astype(np.float32)
    source += (.014 * np.clip((x - 80) / 8 + .5, 0, 1))[..., None] * grain.CHROMA[0]
    source += (.006 * np.exp(-((y - 75)**2 + (x - 45)**2) / 22))[..., None] * grain.CHROMA[0]
    source += (.006 * np.exp(-((y - 110)**2 + (x - 80)**2) / 22))[..., None] * grain.CHROMA[1]

    _, protected = grain.colour_delta(source, False, fringes=False, separate=True)
    _, plain = grain.colour_delta(source, False, fringes=False, separate=True, protect_edges=False)
    # A same-hue blotch away from the edge is cleaned as if unprotected.
    assert abs(protected[75, 45, 0]) >= .95 * abs(plain[75, 45, 0])
    # A different-hue dot on the edge keeps its cleanup across the edge's colour.
    # The correction is in opponent colour: the edge steps in channel 0, the dot in 1.
    dot = np.s_[106:115, 76:85, 1]
    assert np.linalg.norm(protected[dot]) >= .9 * np.linalg.norm(plain[dot])


def test_fringe_strength_is_independent_of_splotch_strength():
    rgb = np.full((80, 80, 3), 0.025, np.float32)
    rgb[40:, :, :] += .24
    rgb[39, 10:70] += .10 * grain.CHROMA[0]
    fringe, delta = grain.colour_delta(rgb, False, separate=True)
    fringe_only, unused = grain.colour_delta(rgb, True, splotches=False, separate=True)
    assert unused is None
    assert np.linalg.norm(fringe_only) > 0
    np.testing.assert_array_equal(fringe_only, fringe)
    np.testing.assert_array_equal(grain.apply_colour(rgb, fringe, 1),
                                  grain.apply_colour(grain.apply_colour(rgb, fringe, 1), delta, 0))


def test_clean_color_controls_native_and_reduced_correction(tmp_path):
    from hdr_finisher.library_cache import LibraryCache

    source = np.random.default_rng(41).normal(.025, .006, (575, 601, 3)).astype(np.float32)
    height, width = source.shape[:2]
    model = adaptive.AdaptiveNoiseModel(.0003, .00008, 0, ((1., .6, .36, .21, .12),) * 3)
    fine = adaptive.AdaptiveControls(method="clean_grain", clean_splotches=False, clean_fringes=False)
    clean = replace(fine, clean_splotches=True, clean_fringes=True, splotch_size="large")
    read = lambda top, left, bottom, right: source[top:bottom, left:right]
    fit = grain.fit_grain(height, width, read, model, fine)
    cache = LibraryCache(tmp_path)
    current = lambda: True
    prepared = grain.GrainPreparation(height, width, read, model, fine, fit, current, cache)
    expected = grain.GrainPreparation(height, width, read, model, clean, fit, current, cache)
    try:
        native = (0, 0, height, width, height, width)
        reduced = (0, 0, 161, 168, 161, 168)
        for region in (native, reduced):
            base = np.frombuffer(prepared.region(*region), dtype="<u4").reshape(-1, 4)
            corrected = np.frombuffer(expected.region(*region), dtype="<u4").reshape(-1, 4)
            assert not base[:, 3].any()
            assert corrected[:, 3].any()
            np.testing.assert_allclose(base[:, :3].copy().view("<f4"),
                                       corrected[:, :3].copy().view("<f4"), atol=2e-6)
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
    settings = adaptive.AdaptiveControls(method="clean_grain", clean_splotches=False, clean_fringes=False)
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


def test_clean_prepares_only_requested_tiles_under_memory_pressure(tmp_path, monkeypatch):
    from hdr_finisher.library_cache import LibraryCache

    monkeypatch.setattr(grain, "background_fill_allowed", lambda: False)
    size = adaptive.TILE_SIZE
    width = 3 * size
    source = np.ones((8, width, 3), dtype=np.float32)
    rendered = []

    def resolve(read, height, width, origin, size, *_):
        rendered.append(origin)
        y, x = origin
        return read(y, x, min(y + size, height), min(x + size, width)), np.s_[:, :]

    monkeypatch.setattr(grain, "_resolved_tile", resolve)
    monkeypatch.setattr(grain, "colour_delta", lambda rgb, broad: np.zeros_like(rgb))
    settings = adaptive.AdaptiveControls(method="clean_grain", clean_splotches=False, clean_fringes=False)
    prepared = grain.GrainPreparation(8, width, lambda y, x, b, r: source[y:b, x:r],
                                      None, settings, None, lambda: True, LibraryCache(tmp_path))
    try:
        assert prepared.region(0, size, 1, 1, 8, width) == grain._pack(source[:1, :1]).tobytes()
        assert rendered == [(0, size)]
    finally:
        prepared.close()


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
    settings = adaptive.AdaptiveControls(method="clean_grain", clean_splotches=False, clean_fringes=False)
    prepared = grain.GrainPreparation(8, 3 * size, read, None, settings, None, lambda: True, LibraryCache(tmp_path))
    try:
        prepared.region(0, size, 8, 2 * size, 8, 3 * size, warm_only=True)
        assert sorted(resolved) == [(0, size), (0, 2 * size)]
    finally:
        prepared.close()
        pool.pool.shutdown()


@pytest.mark.needs_native_helper
def test_native_colour_correction_matches_numpy_bytes(monkeypatch):
    import pytest
    from hdr_finisher import denoise_filters, denoise_grain

    native = denoise_filters.library()
    if not hasattr(native, "colour_guides"):
        pytest.skip("Run machine setup to build the optional native filters.")
    rng = np.random.default_rng(5)
    image = rng.normal(.04, .028, (173, 149, 3)).astype(np.float32)
    image[20:38, 12:28] *= 20
    image[60:68, 80:95] *= .1
    for enabled in ("0", "1"):
        monkeypatch.setenv("HDR_FINISHER_QUAL_COLOUR_LEVELS", enabled)
        if enabled == "1" and not hasattr(native, "colour_guides_relative"):
            pytest.skip("Run machine setup to rebuild the optional native filters.")
        for broad in (False, True):
            actual = denoise_grain.colour_delta(image, broad)
            with monkeypatch.context() as fallback:
                fallback.setattr(denoise_filters, "library", lambda: None)
                expected = denoise_grain.colour_delta(image, broad)
            assert actual.tobytes() == expected.tobytes()


def test_colour_shader_uses_the_cpu_offsets_and_ramp_bounds():
    import ast
    import inspect
    from pathlib import Path
    import re
    from hdr_finisher import denoise_grain

    root = Path(__file__).resolve().parents[1]
    shader = (root / "frontend/webgpu-shaders.js").read_text(encoding="utf-8")
    pairs = shader.split("fn cleanPairsMain(", 1)[1].split("fn cleanRelativeMain(", 1)[0]
    small, large, switching_reach = map(
        int, re.search(r"select\((\d+), (\d+), reach == (\d+)\)", pairs).groups())
    offsets = re.search(r"let offsets = array<vec2i, 4>\((.+)\);", pairs)[1]
    for reach in (12, 28):
        values = {"reach": reach, "0": 0, "d": large if reach == switching_reach else small}
        actual = []
        for arguments in re.findall(r"vec2i\(([^)]+)\)", offsets):
            coords = [token.strip() for token in arguments.split(",")]
            xy = [(-1 if token.startswith("-") else 1) * values[token.lstrip("-")] for token in coords]
            x, y = xy if len(xy) == 2 else xy * 2
            actual.append((y, x))
        assert tuple(actual) == denoise_grain._colour_offsets(reach)

    # These literal bounds are shared numerical constants. Ignore operation
    # structure because the GPU splits repair into several shader stages.
    colour = shader.split("fn cleanGuidesMain(", 1)[1].split("fn cleanOutputMain(", 1)[0]
    bounds = r",\s*(-?[.\d]+),\s*(-?[.\d]+)\)"
    gpu = {tuple(map(float, re.search(bounds, call).groups()))
           for call in colour.split("cleanRamp(")[1:]}
    cpu = set()
    for function in (denoise_grain._colour_pass, denoise_grain.colour_delta, denoise_grain._splotch_edge):
        for call in ast.walk(ast.parse(inspect.getsource(function))):
            if isinstance(call, ast.Call) and isinstance(call.func, ast.Name) and call.func.id == "_ramp":
                cpu.add(tuple(ast.literal_eval(arg) for arg in call.args[1:]))
    assert cpu == gpu

    native = (root / "backend/hdr_finisher/denoise_filters.c").read_text(encoding="utf-8")
    guides = native.split("static void colour_guides_impl(", 1)[1].split("API void colour_guides(", 1)[0]
    native_bounds = re.findall(r",\s*([.\d]+)f,\s*([.\d]+)f\)", guides)
    assert {tuple((float(low), round(float(low) + float(span), 6)))
            for low, span in native_bounds} == {
                (.065, .125), (.045, .15), (.004, .015), (.006, .014), (.06, .24), (3., 8.)
            }
