import numpy as np
import pytest

from hdr_finisher import adjustments, detail, finishing, hsl, pixel_rows, tone
from hdr_finisher.color import acescg_to_linear_srgb, linear_srgb_to_acescg
from hdr_finisher.export_timing import export_clock
from hdr_finisher.models import AdjustmentState, PreviewKind, VignetteAdjustments, WatermarkSettings
from hdr_finisher.photo_framing import FramingLayout, compose
from hdr_finisher.watermark import apply_watermark


@pytest.fixture
def image():
    rng = np.random.default_rng(127)
    pixels = rng.uniform(-0.04, 1.1, size=(413, 47, 3)).astype(np.float32)
    pixels *= np.exp2(np.linspace(-7, 3, len(pixels), dtype=np.float32))[:, None, None]
    pixels[:2] = 0.04
    pixels[-2:] = 2.1
    pixels[127:130, :22] = [0.49, 0.12, 0.08]
    pixels[255:258, 22:] = [0.09, 0.29, 0.54]
    return pixels


@pytest.mark.parametrize("scale", [None, 1.0, 0.46, 0.01])
def test_global_hsl_matches_whole_frame_with_mask_and_edge_controls(image, scale, monkeypatch):
    recipes = [
        hsl.HSLRecipe(ranges=[hsl.HSLRange(center=25, width=36, feather=45)], hue=19,
                      saturation=27, luminance=0.42, edge=-7, edge_feather=16, edge_detail=70),
        hsl.HSLRecipe(ranges=[hsl.HSLRange(center=238, width=37, feather=29),
                              hsl.HSLRange(center=265, width=11, feather=13, subtract=True)],
                      luminance=-0.21, uniformity=30, opacity=0.7, edge=5, edge_feather=9, edge_detail=15),
    ]
    mask = np.linspace(-0.1, 1.1, image.shape[0] * image.shape[1], dtype=np.float32).reshape(image.shape[:2])
    untouched = image.copy()
    masked = hsl.apply_recipes(image, recipes, mask=mask, shared_selection=scale)
    sdr = hsl.apply_stage(image, recipes, PreviewKind.SDR, shared_selection=scale)
    hdr = hsl.apply_stage(image, recipes, PreviewKind.HDR, shared_selection=scale)
    monkeypatch.setattr(hsl, "_RECIPE_ROWS", len(image))
    np.testing.assert_array_equal(masked, hsl.apply_recipes(image, recipes, mask=mask, shared_selection=scale))
    np.testing.assert_array_equal(sdr, hsl.apply_recipes(image, recipes, shared_selection=scale))
    np.testing.assert_array_equal(hdr, linear_srgb_to_acescg(
        hsl.apply_recipes(acescg_to_linear_srgb(image), recipes, shared_selection=scale)))
    np.testing.assert_array_equal(image, untouched)


@pytest.mark.parametrize("kind", [PreviewKind.HDR, PreviewKind.SDR])
@pytest.mark.parametrize("column_major", [False, True])
def test_tone_and_colour_stages_match_whole_frame(image, kind, column_major, monkeypatch):
    if column_major:
        image = np.asfortranarray(image)
    state = AdjustmentState()
    branch = getattr(state, kind.value)
    branch.white_balance_kelvin = 8400
    branch.tint = 13
    branch.red_hue = -15
    branch.blue_purity = 21
    branch.saturation = 16
    branch.vibrance = 23
    branch.contrast = 17
    branch.blacks, branch.shadows, branch.midtones, branch.highlights, branch.whites = -19, 26, -11, 32, -34
    branch.tone_equalizer_nodes = type(branch)(tone_equalizer_nodes=[
        {"input_ev": -6, "adjustment_ev": 0.1}, {"input_ev": -2, "adjustment_ev": -0.6},
        {"input_ev": 1, "adjustment_ev": 0.4}, {"input_ev": 6, "adjustment_ev": -0.1},
    ]).tone_equalizer_nodes
    branch.tone_equalizer_smoothing = 0.67
    curve = [[0, 0], [0.44, 0.52], [1, 1]]
    branch.luma_curve = curve
    branch.red_curve = curve
    branch.color_grading.shadows.saturation = 30
    branch.color_grading.midtones.luminance_ev = -0.2
    branch.color_grading.highlights.saturation = 70
    branch.color_grading.highlights.hue = 47
    branch.black_and_white.reds = 35
    hdr = kind == PreviewKind.HDR
    prefix = adjustments._hdr_before_black_and_white if hdr else adjustments._sdr_before_black_and_white
    equalizer = adjustments._apply_hdr_tone_equalizer if hdr else adjustments._apply_sdr_tone_equalizer
    stages = {
        "tone and colour prefix": lambda: prefix(image, state),
        "black and white guide": lambda: adjustments._black_and_white_guide(image, branch.black_and_white, prefix, state),
        "black and white": lambda: adjustments._apply_black_and_white(image, branch.black_and_white, guide=image[::-1]),
        "tone equalizer": lambda: equalizer(image, branch),
        "tone zones": lambda: tone.apply_tone(image, branch, hdr),
        "curves": lambda: adjustments._apply_curve_set(image, branch, kind),
        "colour grading": lambda: adjustments._apply_color_grading(image, branch.color_grading, kind),
    }
    untouched = image.copy()
    banded = {name: run() for name, run in stages.items()}
    monkeypatch.setattr(pixel_rows, "PIXEL_ROWS", len(image))
    for name, run in stages.items():
        np.testing.assert_array_equal(banded[name], run(), err_msg=name)
    np.testing.assert_array_equal(image, untouched)


@pytest.mark.parametrize("kind", [PreviewKind.HDR, PreviewKind.SDR])
@pytest.mark.parametrize("protection,roundness", [(0, -39), (73, 68)])
def test_vignette_matches_full_coordinate_grids(image, kind, protection, roundness):
    vignette = VignetteAdjustments(amount=-56, midpoint=36, feather=59, roundness=roundness,
                                  center_x=0.36, center_y=0.73, scale_x=143, scale_y=69,
                                  highlight_protection=protection)
    window = adjustments.FrameWindow(left=21, top=31, width=115, height=480)
    bottom, right = window.top + image.shape[0], window.left + image.shape[1]
    grid_y, grid_x = np.mgrid[window.top:bottom, window.left:right].astype(np.float32)
    scale = np.float32(0.5 * min(window.width, window.height))
    dx = np.abs((grid_x - np.float32(vignette.center_x * (window.width - 1))) / scale)
    dy = np.abs((grid_y - np.float32(vignette.center_y * (window.height - 1))) / scale)
    dx /= np.float32(vignette.scale_x / 100)
    dy /= np.float32(vignette.scale_y / 100)
    exponent = 2 + (6 if roundness >= 0 else 1) * (roundness / 100)
    radius = np.power(np.power(dx, exponent) + np.power(dy, exponent), 1 / exponent)
    midpoint = np.float32(0.15 + 0.70 * vignette.midpoint / 100)
    feather = np.float32(0.02 + 0.98 * vignette.feather / 100)
    mask = adjustments._smoothstep(float(midpoint), float(midpoint + feather), radius)
    if protection:
        luma = np.maximum(adjustments._film_luma(image, kind), 0.0)
        highlights = adjustments._smoothstep(0.55, 0.95, adjustments._film_encode_luma(luma, kind))
        mask *= 1 - highlights * np.float32(protection / 100)
    expected = image * np.exp2(np.float32(2 * vignette.amount / 100) * mask)[..., None]
    np.testing.assert_array_equal(adjustments._apply_vignette(image, vignette, kind, frame_window=window), expected)


@pytest.mark.parametrize("kind", [PreviewKind.HDR, PreviewKind.SDR])
@pytest.mark.parametrize("stock,paper,strength", [
    ("kodak_portra_400", "kodak_2383", 67),
    ("fujifilm_velvia_100", "fujifilm_crystal_archive_typeii", 100),
])
def test_fused_grain_and_stock_match_separate_stages(image, kind, stock, paper, strength, monkeypatch):
    monkeypatch.setattr(adjustments, "EXPORT_GRAIN_CHUNK_ROWS", 100)
    monkeypatch.setattr(adjustments, "FILM_STOCK_CHUNK_PIXELS", 3001)
    image = np.maximum(image, 0.0001)
    image[0, 0] = -0.25
    untouched = image.copy()
    state = AdjustmentState()
    look = getattr(state, kind.value).film_look
    look.film_stock, look.print_paper, look.look_strength = stock, paper, strength
    look.print_contrast, look.shadow_contrast, look.highlight_contrast = 31, 16, -20
    look.grain_enabled, look.grain_amount, look.grain_chroma = True, 54, 20
    full = np.float32(1)
    with export_clock():
        delta = adjustments._apply_density_grain(image, look, kind, state.shared.film_grain_seed,
                                                 full, density_delta=True)
        printed = adjustments._apply_film_stock(image.copy(), look, kind, full, density_delta=delta)
        actual = adjustments._apply_film_look(image, state, kind)
    expected = image + (printed - image) * np.float32(strength / 100)
    np.testing.assert_array_equal(actual, expected)
    np.testing.assert_array_equal(image, untouched)


def test_full_look_strength_still_rounds_the_blend(image, monkeypatch):
    state = AdjustmentState()
    state.sdr.film_look.film_stock = "kodak_portra_400"
    image = np.ones_like(image)
    printed = np.full_like(image, 0.1)
    expected = image + (printed - image) * np.float32(1)
    assert np.any(printed != expected)
    monkeypatch.setattr(adjustments, "_apply_film_stock", lambda *_: printed.copy())
    np.testing.assert_array_equal(adjustments._apply_film_look(image, state, PreviewKind.SDR), expected)


def _whole_frame_box(signal, radius):
    span = 2 * radius + 1
    for axis, padding in enumerate((((radius, radius), (0, 0)), ((0, 0), (radius, radius)))):
        cumulative = np.cumsum(np.pad(signal, padding, mode="edge"), axis=axis, dtype=np.float32)
        zeros = np.zeros_like(np.take(cumulative, [0], axis=axis))
        cumulative = np.concatenate((zeros, cumulative), axis=axis)
        signal = (np.take(cumulative, range(span, cumulative.shape[axis]), axis=axis)
                  - np.take(cumulative, range(cumulative.shape[axis] - span), axis=axis)) / np.float32(span)
    return signal


def _whole_frame_sharpen(image, strength, kind):
    luma = finishing._luminance(image, kind)
    hdr = kind == PreviewKind.HDR
    signal = (np.log2(np.maximum(luma, 1e-7) / np.float32(0.18)) if hdr
              else finishing._srgb_encode(np.maximum(luma, 0.0)))
    fine_base = _whole_frame_box(signal, 1)
    medium_base = _whole_frame_box(fine_base, 2)
    fine, medium = signal - fine_base, fine_base - medium_base
    gradient_x = np.abs(np.diff(medium_base, axis=1, append=medium_base[:, -1:]))
    gradient_y = np.abs(np.diff(medium_base, axis=0, append=medium_base[-1:, :]))
    structure = np.sqrt(gradient_x * gradient_x + gradient_y * gradient_y)
    residual = _whole_frame_box(np.abs(fine), 1)
    mask = np.clip(0.18 + 2.8 * structure / (structure + residual + 1e-6), 0, 1)
    mask = np.where((np.abs(fine) + np.abs(medium)) > 1e-7, mask, 0).astype(np.float32)
    fine_amount, medium_amount = {"subtle": (0.22, 0.08), "standard": (0.38, 0.14), "strong": (0.58, 0.22)}[strength]
    correction = mask * (np.float32(fine_amount) * fine + np.float32(medium_amount) * medium)
    local_min, local_max = finishing._local_extrema(signal)
    allowance = np.float32(0.18 if strength == "strong" else 0.12) * (local_max - local_min)
    sharpened = np.clip(signal + correction, local_min - allowance, local_max + allowance)
    target = (np.float32(0.18) * np.exp2(np.clip(sharpened, -32, 16)) if hdr
              else finishing._srgb_decode(np.maximum(sharpened, 0.0)))
    gain = np.ones_like(luma, dtype=np.float32)
    np.divide(target, luma, out=gain, where=(luma > 1e-7) & (np.abs(sharpened - signal) > 1e-7))
    return image * gain[..., None]


@pytest.mark.parametrize("kind", [PreviewKind.HDR, PreviewKind.SDR])
@pytest.mark.parametrize("strength", ["subtle", "standard", "strong"])
@pytest.mark.parametrize("flip", [False, True])
def test_output_sharpen_matches_full_frame_at_borders_and_seams(image, kind, strength, flip):
    if flip:
        image = image[:, ::-1]
    actual = finishing._edge_aware_multiscale_sharpen(image, strength, kind)
    np.testing.assert_array_equal(actual, _whole_frame_sharpen(image, strength, kind))
    flat = np.full_like(image, 1.3)
    np.testing.assert_array_equal(finishing._edge_aware_multiscale_sharpen(flat, strength, kind), flat)


@pytest.mark.parametrize("kind", [PreviewKind.HDR, PreviewKind.SDR])
def test_halation_and_detail_match_whole_frame(image, kind, monkeypatch):
    branch = getattr(AdjustmentState(), kind.value)
    branch.film_look.halation_amount = 53
    branch.film_look.halation_radius = 67
    branch.detail.texture_amount, branch.detail.clarity_amount, branch.detail.sharpen_amount = 26, -14, 32
    halation = adjustments._apply_halation(image, branch.film_look, kind, np.float32(1))
    detailed = detail.apply_detail(image, branch.detail, kind)
    monkeypatch.setattr(pixel_rows, "PIXEL_ROWS", len(image))
    expected = adjustments._apply_halation(image, branch.film_look, kind, np.float32(1))
    for actual, reference in zip(halation, expected):
        np.testing.assert_array_equal(actual, reference)
    np.testing.assert_array_equal(detailed, detail.apply_detail(image, branch.detail, kind))


@pytest.mark.parametrize("frame,border", [(0, 0), (3, 0), (0, 9), (3, 9)])
def test_framing_matches_nested_fills(image, frame, border):
    height, width = image.shape[:2]
    inset = frame + border
    layout = FramingLayout(width + 2 * inset, height + 2 * inset, frame=frame, border=border)
    colors = ((0.87, 0.21, 0.39), (0.12, 0.09, 0.05))
    expected = np.empty((layout.height, layout.width, 3), dtype=np.float32)
    expected[:] = colors[1]
    expected[border:layout.height-border, border:layout.width-border] = colors[0]
    expected[inset:inset+height, inset:inset+width] = image
    np.testing.assert_array_equal(compose(image, layout, colors), expected)


@pytest.mark.parametrize("kind", [PreviewKind.HDR, PreviewKind.SDR])
def test_watermark_in_place_matches_copying_and_preserves_cached_input(image, kind):
    settings = WatermarkSettings(mode="rendition_test", position="bottom_left")
    owned = image.copy()
    image.setflags(write=False)
    expected = apply_watermark(image, settings, kind.value)
    np.testing.assert_array_equal(image, owned)
    actual = apply_watermark(owned, settings, kind.value, in_place=True)
    assert actual is owned
    assert np.any(actual != image)
    np.testing.assert_array_equal(actual, expected)
