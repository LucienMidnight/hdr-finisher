import hashlib
import json
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
from PIL import Image

from hdr_finisher import adjustments, detail, finishing, hsl, pixel_rows, tone
from hdr_finisher.color import acescg_to_linear_srgb, linear_srgb_to_acescg
from hdr_finisher.delivery_frames import DeliveryFrame
from hdr_finisher.export_timing import export_clock
from hdr_finisher.hsl import HSLRange, HSLRecipe
from hdr_finisher.models import (AdjustmentState, CapabilityStatus, CropRectangle, DetailAdjustments, ExportSettings, FramingLayer,
    GeometryAdjustments, OutputFinishingSettings, PhotoFraming, PreviewKind, VignetteAdjustments, WatermarkSettings)
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


@pytest.mark.parametrize("geometry", [
    GeometryAdjustments(straighten_angle=6.3),
    GeometryAdjustments(perspective_horizontal=12.0, perspective_vertical=-9.0, perspective_rotate=1.4),
    GeometryAdjustments(rotation=90, flip_horizontal=True, flip_vertical=True,
                        crop=CropRectangle(x=.07, y=.13, width=.81, height=.74)),
])
def test_geometry_delivery_frame_is_exact(tmp_path, image, geometry):
    source = DeliveryFrame.spill(tmp_path / "source", image)
    result = finishing.apply_geometry_to_frame(source, geometry, tmp_path / "fixed")
    with result.map("r") as pixels:
        np.testing.assert_array_equal(pixels, finishing.apply_geometry(image, geometry))


@pytest.mark.parametrize("kind", [PreviewKind.HDR, PreviewKind.SDR])
@pytest.mark.parametrize("controls", [dict(texture_amount=68), dict(clarity_amount=-58, clarity_radius_percent=.2),
    dict(clarity_amount=-58, clarity_radius_percent=3), dict(sharpen_amount=85, sharpen_radius_px=2.1),
    dict(texture_amount=74, clarity_amount=63, clarity_radius_percent=3, sharpen_amount=83,
         sharpen_radius_px=2.7, sharpen_threshold=3)])
def test_detail_delivery_frame_is_exact(tmp_path, image, kind, controls):
    pixels = np.resize(image, (213, 257, 3))
    source = DeliveryFrame.spill(tmp_path / "source", pixels)
    destination = DeliveryFrame(tmp_path / "detail", source.shape)
    recipe = DetailAdjustments(**controls)
    detail.apply_detail_to_frame(source, destination, recipe, kind, rows=39)
    with destination.map("r") as actual:
        np.testing.assert_array_equal(actual, detail.apply_detail(pixels, recipe, kind))


def test_lens_delivery_frame_is_exact_across_fft_tiles(tmp_path, image):
    from hdr_finisher.lens_filter import apply_filter, apply_filter_to_frame

    pixels = np.resize(image, (129, 551, 3))
    source = DeliveryFrame.spill(tmp_path / "source", pixels)
    destination = DeliveryFrame(tmp_path / "lens", source.shape)
    arguments = ("black_pro_mist", 42, 1.2, 23)
    apply_filter_to_frame(source, destination, *arguments)
    with destination.map("r") as actual:
        np.testing.assert_array_equal(actual, apply_filter(pixels, *arguments))


@pytest.mark.parametrize("kind", [PreviewKind.HDR, PreviewKind.SDR])
@pytest.mark.parametrize("strength,halation_radius", [(100, .05), (62, 4.8)])
def test_film_delivery_frame_is_exact(tmp_path, image, kind, strength, halation_radius):
    from hdr_finisher.cpu_strips import apply_film_to_frame

    pixels = np.resize(image, (213, 257, 3))
    source = DeliveryFrame.spill(tmp_path / "a", pixels)
    destination = DeliveryFrame(tmp_path / "b", source.shape)
    state = AdjustmentState()
    branch = getattr(state, kind.value)
    branch.film_look_section_enabled = branch.detail_section_enabled = branch.vignette_section_enabled = True
    branch.film_look = branch.film_look.model_copy(update={
        "look_strength": strength, "film_resolution": 57, "halation_enabled": True, "halation_amount": 48,
        "halation_radius": halation_radius, "grain_enabled": True, "grain_amount": 37, "lens_filter": "black_pro_mist",
        "scan_sharpening": 25, "film_stock": "kodak_portra_400", "grain_film_format": "super8",
    })
    branch.detail.softness = 31
    branch.detail.microcontrast = 16
    branch.vignette.amount = -37
    with export_clock():
        expected = adjustments._apply_film_look(pixels, state, kind)
        expected = adjustments._apply_vignette(expected, branch.vignette, kind)
    with export_clock():
        result = apply_film_to_frame(source, destination, state, kind, rows=39)
    with result.map("r") as actual:
        np.testing.assert_array_equal(actual, expected)


@pytest.mark.parametrize("geometry", [GeometryAdjustments(), GeometryAdjustments(straighten_angle=6.3,
    perspective_vertical=7, rotation=90, flip_vertical=True, crop=CropRectangle(x=.08, width=.88))])
@pytest.mark.parametrize("mask_kind", ["brush", "soft_brush", "linear_gradient", "luminance_range", "path"])
def test_spatial_mask_delivery_frame_is_exact(tmp_path, image, geometry, mask_kind):
    from hdr_finisher.local_adjustments import compile_geometry_fixed_mask, compile_geometry_fixed_mask_to_frame
    from hdr_finisher.models import MaskExpression

    pixels = np.resize(image, (213, 257, 3))
    leaf = {"type": mask_kind, "mask_opacity": .71}
    if mask_kind in {"brush", "soft_brush"}:
        leaf.update(type="brush", strokes=[
            {"points": [{"x": 0.02, "y": .05}, {"x": .43, "y": .49}, {"x": .91, "y": .96}],
             "radius": .086, "hardness": .55, "opacity": .81, "flow": .67},
            {"points": [{"x": .36, "y": .43}, {"x": .43, "y": .71}], "radius": .08, "erase": True},
        ])
        if mask_kind == "soft_brush":
            leaf.update(mask_shift_edge=.04, mask_feather=.05)
    elif mask_kind == "linear_gradient":
        leaf.update(start={"x": .14, "y": .32}, end={"x": .87, "y": .72}, gradient_fan=.22)
    elif mask_kind == "luminance_range":
        leaf.update(full_start_ev=-2.5, full_end_ev=1.3, mask_feather=.03)
    else:
        leaf.update(nodes=[{"x": .12, "y": .1}, {"x": .78, "y": .31}, {"x": .31, "y": .79}], feather=.07)
    expression = MaskExpression(leaf=leaf, inverted=True)
    result = compile_geometry_fixed_mask_to_frame(pixels, expression, geometry, tmp_path / "mask", rows=39)
    with result.map("r") as actual:
        np.testing.assert_array_equal(actual, compile_geometry_fixed_mask(pixels, expression, geometry))


def _spatial_grade_state():
    from hdr_finisher.models import LocalAdjustment

    state = AdjustmentState()
    state.shared.geometry = GeometryAdjustments(straighten_angle=6.3, crop=CropRectangle(x=.01, width=.94))
    state.shared.local_adjustments_enabled = True
    recipe = HSLRecipe(ranges=[HSLRange(center=48, width=73, feather=25)], hue=33, saturation=21,
                       edge=-7, edge_feather=8)
    common = dict(exposure=.19, contrast=.21, highlights=21, hsl=recipe)
    locals_ = [
        LocalAdjustment(id="brush", opacity=.78,
            mask={"leaf": {"type": "brush", "mask_shift_edge": -.01, "mask_feather": .04, "strokes": [
                {"points": [{"x": .08, "y": .26}, {"x": .71, "y": .73}], "radius": .15}]}},
            hdr_grade={**common, "detail": {"texture_amount": 25, "sharpen_amount": 50}}, sdr_grade=common),
        LocalAdjustment(id="hue", opacity=.91,
            mask={"leaf": {"type": "hue_range", "hue_center": 48, "hue_width": 110, "edge": 6, "edge_feather": 8}},
            hdr_grade={"exposure": -.35}, sdr_grade={"exposure": -.55, "detail": {"clarity_amount": 12}}),
        LocalAdjustment(id="gradient", opacity=.35, mask={"operator": "intersect", "children": [
            {"leaf": {"type": "linear_gradient", "start": {"x": .2, "y": .2}, "end": {"x": .91, "y": .84}}},
            {"leaf": {"type": "luminance_range", "full_start_ev": -3, "full_end_ev": 2, "mask_feather": .07 / 2}},
        ]}, hdr_grade={"exposure": -.27}, sdr_grade={"exposure": .37}),
    ]
    for branch in (state.hdr, state.sdr):
        branch.hsl_section_enabled = True
        branch.hsl.channels[0].recipe = recipe
        branch.black_and_white_section_enabled = True
        branch.black_and_white.reds = 31
        branch.film_look_section_enabled = branch.detail_section_enabled = branch.vignette_section_enabled = True
        branch.detail = type(branch.detail)(texture_amount=64, clarity_amount=23, clarity_radius_percent=3,
                                          sharpen_amount=27, softness=17, microcontrast=7)
        branch.film_look = branch.film_look.model_copy(update={
            "film_stock": "kodak_portra_400", "film_resolution": 62, "grain_amount": 23, "look_strength": 77,
            "lens_filter": "pro_mist", "halation_amount": 43, "halation_radius": 4.3, "scan_sharpening": 37,
            "halation_enabled": True, "grain_enabled": True,
        })
        branch.vignette.amount = -17
    return state, locals_


def test_santorini_mask_matches_whole_frame(tmp_path, image):
    from hdr_finisher.local_adjustments import compile_geometry_fixed_mask, compile_geometry_fixed_mask_to_frame, has_hue_mask
    from hdr_finisher.models import EditDocument

    fixture = Path(__file__).parent / "fixtures" / "export-speed" / "santorini-2026-0068-grade.json"
    document = EditDocument.model_validate(json.loads(fixture.read_text(encoding="utf-8"))["grade"])
    geometry = document.global_adjustments.shared.geometry
    pixels = np.resize(image, (213, 257, 3))
    masks = [local.mask for local in document.local_adjustments if local.enabled and not has_hue_mask(local.mask)]
    assert masks
    for index, mask in enumerate(masks):
        frame = compile_geometry_fixed_mask_to_frame(pixels, mask, geometry, tmp_path / f"mask_{index}.u8",
                                                    spatial_only=True, rows=39)
        with frame.map("r") as actual:
            np.testing.assert_array_equal(actual, compile_geometry_fixed_mask(pixels, mask, geometry, spatial_only=True))


@pytest.mark.parametrize("kind,linked", [(PreviewKind.HDR, False), (PreviewKind.SDR, False), (PreviewKind.SDR, True)])
def test_staged_creative_graph_is_exact(tmp_path, image, kind, linked):
    from hdr_finisher.cpu_strips import render_staged_grade
    from hdr_finisher.local_adjustments import compile_geometry_fixed_mask_to_frame, has_hue_mask

    pixels = np.resize(image, (213, 257, 3))
    state, locals_ = _spatial_grade_state()
    state.sdr.linked_to_hdr = linked
    fixed = finishing.apply_geometry_to_frame(pixels, state.shared.geometry, tmp_path / "geometry")
    masks = {local.id: compile_geometry_fixed_mask_to_frame(pixels, local.mask, state.shared.geometry,
        tmp_path / f"{local.id}.u8", spatial_only=True, rows=39) for local in locals_ if not has_hue_mask(local.mask)}
    with export_clock():
        expected = adjustments.apply_adjustments(pixels, state, kind,
            local_adjustments=locals_, include_output_highlight_compression=False)
    with export_clock():
        result = render_staged_grade(fixed, None, state, kind, tmp_path,
                                     local_adjustments=locals_, compiled_masks=masks, rows=39)
    with result.map("r") as actual:
        np.testing.assert_array_equal(actual, expected)


def test_delivery_frame_writes_and_reads_bands_and_tiles(tmp_path, image):
    from hdr_finisher.exporters import _render_branch_to_file

    frame = DeliveryFrame(tmp_path / "banded.rgb", image.shape)
    written = []

    def render(allocate):
        writer = allocate(image.shape)
        written.append(writer)
        for top in range(0, len(image), 43):
            rows = slice(top, top + 43)
            writer[rows, :13] = image[rows, :13]
            writer[rows, 13:] = image[rows, 13:]
        np.testing.assert_array_equal(writer[40:167], image[40:167])
        return writer

    assert _render_branch_to_file(frame.path, render) == frame
    assert written[0]._mmap.closed
    with frame.map("r") as mapped:
        assert not mapped.flags.writeable
        np.testing.assert_array_equal(mapped, image)
    assert mapped._mmap.closed
    for top, band in enumerate(frame.bands(29)):
        np.testing.assert_array_equal(band, image[top * 29: (top + 1) * 29])
    assert frame.path.read_bytes() == image.tobytes()


def test_delivery_frame_leaves_no_partial_file(tmp_path, image, monkeypatch):
    from hdr_finisher import delivery_frames

    frame = DeliveryFrame(tmp_path / "banded.rgb", image.shape)
    with pytest.raises(RuntimeError, match="cancelled"), frame.map("w+") as writer:
        writer[:2] = image[:2]
        raise RuntimeError("cancelled")
    assert not frame.path.exists()
    with pytest.raises(OSError, match="Incomplete"):
        frame.write([image[:2]])
    assert not frame.path.exists()
    monkeypatch.setattr(delivery_frames.shutil, "disk_usage", lambda _: type("Usage", (), {"free": image.nbytes - 1})())
    with pytest.raises(OSError, match="free scratch disk space"), frame.map("w+"):
        pytest.fail("Writer must reject insufficient space before opening the file")
    with pytest.raises(OSError, match="free scratch disk space"):
        frame.write([image])
    assert not frame.path.exists()


@pytest.mark.parametrize("method, amount", [("clean_grain", 0.75), ("standard", 0)])
def test_mapped_denoise_matches_heap_bytes_across_tile_boundaries(tmp_path, method, amount):
    from hdr_finisher.denoise_adaptive import AdaptiveControls, estimate_adaptive_model, resolve_adaptive
    from hdr_finisher.exporters import _render_branch_to_file

    source = np.random.default_rng(62).uniform(0, 1, (55, 525, 4)).astype(np.float32)
    model = estimate_adaptive_model(source)
    controls = AdaptiveControls(method=method, amount=amount)
    expected = resolve_adaptive(source, model, controls)
    frame = _render_branch_to_file(tmp_path / "grain.rgb", lambda allocate:
        resolve_adaptive(source, model, controls, allocate_output=allocate))
    with frame.map("r") as actual:
        assert actual.tobytes() == expected.tobytes()
        np.testing.assert_array_equal(actual[..., 3], source[..., 3])


@pytest.mark.parametrize("suffix", ["jpg", "png"])
def test_staged_image_validation_accepts_only_the_expected_large_output(tmp_path, monkeypatch, suffix):
    from hdr_finisher.exporters import ExportProcessError, _validate_pillow_output

    path = tmp_path / f"staged.{suffix}"
    Image.new("RGB", (13, 11)).save(path)
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 50)
    with pytest.raises(Image.DecompressionBombError):
        _validate_pillow_output(path)
    _validate_pillow_output(path, expected_pixels=143)
    with pytest.raises(ExportProcessError, match="match the exported size"):
        _validate_pillow_output(path, expected_pixels=144)
    assert Image.MAX_IMAGE_PIXELS == 50


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
    midpoint = np.float32(0.15 + 1.40 * vignette.midpoint / 100)
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


def _finishing_session(image):
    state = AdjustmentState()
    state.shared.geometry = GeometryAdjustments(flip_horizontal=True)
    for branch in (state.hdr, state.sdr):
        branch.highlight_section_enabled = True
        branch.highlight_compression_peak_measurement = "robust"
    framing = PhotoFraming(enabled=True,
        frame=FramingLayer(color="#f1ded0", unit="px", value=14),
        border=FramingLayer(color="#413831", unit="px", value=7))
    return SimpleNamespace(session_id="bounded-finishing", image=image, adjustments=state,
        framing=framing, sdr_reference_image=None, local_adjustments=[], hdr_reference_white_nits=203)


@pytest.mark.parametrize(("resize_mode", "bounded_cpu"), [("original", True), ("long_edge", False)])
def test_resized_delivery_counts_final_size_handoffs(tmp_path, monkeypatch, resize_mode, bounded_cpu):
    from hdr_finisher import app_memory, exporters, gpu_delivery

    monkeypatch.setattr(app_memory, "CEILING", 4_000_000_000)
    monkeypatch.delenv(gpu_delivery.STREAMED_TRIAL_ENV, raising=False)
    source = np.broadcast_to(np.float32(.18), (7968, 5320, 3))
    session = SimpleNamespace(image=source, adjustments=AdjustmentState(), local_adjustments=[])
    settings = ExportSettings(format="jpeg_ultrahdr", output_finishing=OutputFinishingSettings(
        resize_mode=resize_mode, long_edge=4000, sharpening="off"))

    def render_pair(frame, request, adjustments):
        assert bool(getattr(request, "_bounded_cpu_delivery", False)) is bounded_cpu
        # Admission is the subject here; do not allocate the full-size pair.
        return {"hdr": np.zeros((1, 1, 3), dtype=np.float32)}

    monkeypatch.setattr(gpu_delivery, "render_pair", render_pair)
    exporters._render_export_branch(session, settings, PreviewKind.HDR, session.adjustments,
                                    delivery_path=tmp_path / "hdr.rgb")


@pytest.mark.parametrize("kind", [PreviewKind.HDR, PreviewKind.SDR])
def test_delivery_preserves_whole_frame_roll_pixels(tmp_path, monkeypatch, kind):
    from hdr_finisher import exporters, gpu_delivery

    monkeypatch.setattr(gpu_delivery, "render_pair", lambda *args: None)
    image = np.random.default_rng(731).normal(0, 4, (97, 201, 3)).astype(np.float32)
    session = _finishing_session(image)
    session.adjustments.shared.geometry = GeometryAdjustments(straighten_angle=45, flip_horizontal=True)
    settings = ExportSettings(format="avif_gain_map", export_with_frame=True,
        output_finishing=OutputFinishingSettings(resize_mode="long_edge", long_edge=83, sharpening="standard"))
    expected = exporters._render_export_branch(session, settings, kind, session.adjustments)
    frame, = exporters._render_delivery_files(session, settings, session.adjustments, tmp_path, lanes=(kind,))
    assert settings._last_cpu_strips
    with frame.map("r") as pixels:
        np.testing.assert_array_equal(pixels, expected)


@pytest.mark.parametrize("kind", [PreviewKind.HDR, PreviewKind.SDR])
@pytest.mark.parametrize("strength", ["off", "subtle", "standard", "strong"])
@pytest.mark.parametrize("resize", [False, True])
def test_file_finishing_matches_whole_frame(image, tmp_path, monkeypatch, kind, strength, resize):
    from hdr_finisher import cpu_strips, exporters, gpu_delivery, resource_preflight

    monkeypatch.setattr(gpu_delivery, "render_pair", lambda *args: None)
    original_plan = cpu_strips.plan_strips

    def small_strips(width, height, **kwargs):
        kwargs["budget_bytes"] = min(kwargs.get("budget_bytes", 192 * 1024), 192 * 1024)
        return original_plan(width, height, **kwargs)

    monkeypatch.setattr(cpu_strips, "plan_strips", small_strips)
    wide_image = np.tile(image, (1, 3, 1))
    session = _finishing_session(wide_image)
    settings = ExportSettings(format="avif_gain_map", export_with_frame=True,
        editing_measurements={kind.value: {"peak": 1.0}},
        output_finishing=OutputFinishingSettings(resize_mode="long_edge" if resize else "original",
            long_edge=301 if resize else None, sharpening=strength),
        watermark=WatermarkSettings(mode="rendition_test", opacity=.72))
    expected = exporters._render_export_branch(session, settings, kind, session.adjustments)
    measurement = settings._exact_measurements[kind.value].copy()
    assert not settings._last_cpu_strips

    monkeypatch.setattr(resource_preflight, "estimate_resources", lambda **kwargs: SimpleNamespace(export_decision="reject"))
    with pytest.raises(ValueError, match="framed canvas is too large"):
        exporters._render_export_branch(session, settings, kind, session.adjustments)

    with export_clock() as clock:
        frame, = exporters._render_delivery_files(session, settings, session.adjustments, tmp_path, lanes=(kind,))
    assert {"geometry", "tone_colour", "strip_render", "output_finishing", "highlight_compression",
            "framing", "watermark"} <= set(clock.lanes[kind.value])
    assert settings._last_cpu_strips
    assert settings._exact_measurements[kind.value] == measurement
    with frame.map("r") as pixels:
        np.testing.assert_array_equal(pixels, expected)
    assert set(tmp_path.iterdir()) == {frame.path}


@pytest.mark.parametrize("spatial", [False, True])
@pytest.mark.parametrize(("format_name", "capability", "suffix"), [
    ("avif_gain_map", "avif_gain_map_encoder", ".avif"),
    ("jpegxl_hdr", "jpegxl_export", ".jxl"),
    ("sdr_jpeg", None, ".jpg"),
])
def test_bounded_finishing_preserves_encoded_sha256(image, tmp_path, monkeypatch, format_name, capability, suffix, spatial):
    from hdr_finisher import exporters, gpu_delivery
    from hdr_finisher.capabilities import probe_capabilities

    capabilities = probe_capabilities()
    if capability is not None and capabilities[capability].status != CapabilityStatus.AVAILABLE:
        pytest.skip(capabilities[capability].detail)
    monkeypatch.setattr(gpu_delivery, "render_pair", lambda *args: None)
    backend = exporters.build_export_backends(capabilities)[format_name]
    session = _finishing_session(np.tile(image, (1, 3, 1)))
    if spatial:
        session.adjustments, session.local_adjustments = _spatial_grade_state()
    for branch in (session.adjustments.hdr, session.adjustments.sdr):
        branch.hsl_section_enabled = True
        branch.hsl.channels[0].recipe = HSLRecipe(ranges=[HSLRange(center=31, width=85, feather=28)],
            hue=19, saturation=24, edge=-7, edge_feather=10, edge_detail=50)
    session.adjustments.sdr.black_and_white_section_enabled = True
    session.adjustments.sdr.black_and_white.reds = 42
    settings = ExportSettings(format=format_name, export_with_frame=True, dithering="off",
        output_finishing=OutputFinishingSettings(resize_mode="long_edge", long_edge=191, sharpening="strong"),
        watermark=WatermarkSettings(mode="rendition_test"))

    def encode(name):
        job = settings.model_copy(update={"output_path": str(tmp_path / (name + suffix))})
        result = backend.export(session, job)
        assert result.accepted, result.message
        return hashlib.sha256(Path(result.output_path).read_bytes()).hexdigest(), job._last_cpu_strips

    with monkeypatch.context() as reference:
        reference.setattr(exporters, "_bounded_export_eligible", lambda *args, **kwargs: False)
        expected, used_strips = encode("reference")
        assert not used_strips
    actual, used_strips = encode("bounded")
    assert used_strips
    assert actual == expected


@pytest.mark.parametrize("linked", [False, True])
@pytest.mark.parametrize("resize", [False, True])
def test_staged_spatial_delivery_matches_whole_frame(tmp_path, image, monkeypatch, linked, resize):
    from hdr_finisher import cpu_strips, exporters, gpu_delivery
    from hdr_finisher.export_progress import ExportProgress, plan_export

    monkeypatch.setattr(gpu_delivery, "render_pair", lambda *args: None)
    session = _finishing_session(np.resize(image, (213, 257, 3)))
    session.adjustments, session.local_adjustments = _spatial_grade_state()
    state = session.adjustments
    state.sdr.linked_to_hdr = linked
    state.sdr.output_exposure = .38
    for branch in (state.hdr, state.sdr):
        branch.highlight_section_enabled = True
        branch.highlight_compression_peak_measurement = "robust"
    settings = ExportSettings(format="avif_gain_map", export_with_frame=resize,
        watermark=WatermarkSettings(mode="rendition_test"),
        output_finishing=OutputFinishingSettings(resize_mode="long_edge" if resize else "original",
            long_edge=141 if resize else None, sharpening="strong" if resize else "off"))
    lanes = (PreviewKind.HDR, PreviewKind.SDR)
    references = [exporters._render_export_branch(session, settings, lane, state) for lane in lanes]
    plan = plan_export(session, settings, state)
    assert ("hdr", "strip_render") not in plan.items
    assert {("hdr", name) for name in ("geometry", "masks", "tone_colour", "detail", "local_stack",
        "halation", "film_grain", "vignette", "output_finishing", "highlight_compression", "watermark")} <= plan.items.keys()
    calls = []
    original = cpu_strips.render_staged_grade

    def render(*args, **options):
        calls.append(args[3])
        return original(*args, rows=39, **options)

    monkeypatch.setattr(cpu_strips, "render_staged_grade", render)
    with export_clock() as clock:
        progress = ExportProgress(clock, plan)
        frames = exporters._render_delivery_files(session, settings, state, tmp_path, lanes=lanes)
        assert progress.fraction() > 0
    assert calls == ([PreviewKind.HDR] if linked else list(lanes))
    assert {"geometry", "masks", "detail", "local_stack", "halation", "film_grain"} <= clock.lanes["hdr"].keys()
    assert "geometry" not in clock.lanes["sdr"] or not linked
    for frame, reference in zip(frames, references):
        with frame.map("r") as pixels:
            np.testing.assert_array_equal(pixels, reference)
    assert set(tmp_path.iterdir()) == {frame.path for frame in frames}


@pytest.mark.parametrize("source_filter", [False, True])
def test_staged_local_luma_uses_the_reference_mask_source(tmp_path, image, monkeypatch, source_filter):
    from hdr_finisher import exporters, gpu_delivery
    from hdr_finisher.models import DenoiseDocumentSettings, LocalAdjustment

    monkeypatch.setattr(gpu_delivery, "render_pair", lambda *args: None)
    session = _finishing_session(np.resize(image, (213, 257, 3)))
    session.denoise = DenoiseDocumentSettings()
    for lane in (session.denoise.hdr, session.denoise.sdr):
        lane.enabled = True
        lane.controls.amount = .5
    state = session.adjustments
    state.shared.geometry = GeometryAdjustments(straighten_angle=6.3)
    state.shared.local_adjustments_enabled = True
    state.sdr.use_authored_base = source_filter
    session.sdr_reference_image = acescg_to_linear_srgb(session.image) if source_filter else None
    session.local_adjustments = [LocalAdjustment(id="luma", hdr_grade={"exposure": .9},
        sdr_grade={"exposure": -.8}, mask={"leaf": {"type": "luminance_range", "full_start_ev": -2,
            "full_end_ev": 1, "mask_feather": .02}})]

    def filter_pixels(pixels, authored):
        return pixels * np.float32(.74 if authored else .45)

    def denoise_inputs(current, kind, adjustments):
        return (current.image if source_filter else filter_pixels(current.image, False),
                current.sdr_reference_image, filter_pixels if source_filter else None)

    monkeypatch.setattr(exporters, "delivery_denoise_inputs", denoise_inputs)
    settings = ExportSettings(format="avif_gain_map")
    lanes = (PreviewKind.HDR, PreviewKind.SDR)
    expected = [exporters._render_export_branch(session, settings, kind, state) for kind in lanes]
    frames = exporters._render_delivery_files(session, settings, state, tmp_path, lanes=lanes)
    assert settings._last_cpu_strips
    for frame, desired in zip(frames, expected):
        with frame.map("r") as actual:
            np.testing.assert_array_equal(actual, desired)
