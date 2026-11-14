"""Pipeline, settings carriers, exact neutral and actual-stage sampling."""
import numpy as np
import pytest

from hdr_finisher.models import AdjustmentState, LocalAdjustment, PreviewKind
from hdr_finisher.adjustments import apply_adjustments
from hdr_finisher.hsl import HSLRange, HSLRecipe
from hdr_finisher.hsl_sampling import HSLSampleRequest, sample_stage
from hdr_finisher.render_cache import SessionRenderCache
from hdr_finisher.sdr_match import _semantic_sdr_translation, _translate_local_grade


@pytest.mark.parametrize("scale", [.05, .2, .5, 1])
@pytest.mark.parametrize("edge,feather", [(0, 0), (8, 16), (-8, 16)])
@pytest.mark.parametrize("position", [(0, 0), (.31, .27), (.8, .8)])
def test_selection_viewport_keeps_whole_frame_coverage(scale, edge, feather, position):
    from hdr_finisher.hsl_sampling import HSLSelectionRect, selection_crop
    from hdr_finisher.hsl_selection import prepare, select
    pixels = np.random.default_rng(41).uniform(.001, 1, (180, 240, 3)).astype(np.float32)
    recipe = HSLRecipe(ranges=[HSLRange(center=75, width=60, feather=20),
                               HSLRange(center=110, width=12, feather=8, subtract=True)],
                       edge=edge, edge_feather=feather, edge_detail=75)
    rect = HSLSelectionRect(x=position[0], y=position[1], width=.2, height=.2)
    (left, top, right, bottom), (start_x, start_y, end_x, end_y) = selection_crop(pixels.shape, rect, recipe, scale)
    options = dict(edge=edge, edge_feather=feather, edge_detail=75)
    whole = select(prepare(pixels, scale), recipe.ranges, **options)
    cropped = select(prepare(pixels[start_y:end_y, start_x:end_x], scale, (start_x, start_y)), recipe.ranges, **options)
    actual = cropped[top-start_y:bottom-start_y, left-start_x:right-start_x]
    np.testing.assert_array_equal(np.rint(actual * 115).astype(np.uint8),
                                  np.rint(whole[top:bottom, left:right] * 115).astype(np.uint8))


@pytest.mark.parametrize("lane", list(PreviewKind))
def test_viewport_overlay_decodes_to_the_original_overlay_pixels(lane):
    import base64
    from io import BytesIO
    from PIL import Image
    from hdr_finisher.hsl_sampling import HSLSelectionRect
    image = np.random.default_rng(15).uniform(.01, 2, (150, 210, 3)).astype(np.float32)
    cache = SessionRenderCache(image, None)
    grade = AdjustmentState()
    recipe = HSLRecipe(ranges=[HSLRange(center=75, width=60)], edge=3, edge_feather=8)
    request = HSLSampleRequest(lane=lane, adjustments=grade, points=[{"x": .5, "y": .5}],
                               edit_revision=0, selection_recipe=recipe)
    def decode(result):
        return np.asarray(Image.open(BytesIO(base64.b64decode(result['selection_overlay'].split(',')[1]))))
    whole = decode(sample_stage(cache, request))
    request.selection_rect = HSLSelectionRect(x=.3, y=.25, width=.2, height=.2)
    result = sample_stage(cache, request)
    region = result['selection_region']
    left, top = round(region['x'] * whole.shape[1]), round(region['y'] * whole.shape[0])
    actual = decode(result)
    np.testing.assert_array_equal(actual, whole[top:top+actual.shape[0], left:left+actual.shape[1]])
    assert actual.size < whole.size / 4


@pytest.mark.parametrize("lane", list(PreviewKind))
def test_global_stage_cache_reuses_only_the_upstream_recipe(lane):
    from hdr_finisher.hsl_sampling import capture_stage_input
    image = np.random.default_rng(12).uniform(0, 2, (12, 18, 3)).astype(np.float32)
    cache = SessionRenderCache(image, None)
    grade = AdjustmentState()
    branch = getattr(grade, lane.value)
    original = cache.hsl_stage_input(grade, 1000, lane)
    branch.hsl.channels[0].recipe.hue = 40
    branch.film_look.grain_amount = 30
    branch.red_curve = [[0, 0], [.5, .8], [1, 1]]
    assert cache.hsl_stage_input(grade, 1000, lane) is original
    getattr(grade, 'hdr' if lane == PreviewKind.SDR else 'sdr').exposure = 2
    assert cache.hsl_stage_input(grade, 1000, lane) is original
    branch.exposure = .5
    changed = cache.hsl_stage_input(grade, 1000, lane)
    assert changed is not original
    np.testing.assert_array_equal(changed, capture_stage_input(image, grade, lane))
    assert cache.hsl_stage_input(grade, 800, lane) is not changed
    grade.shared.geometry.rotation = 90
    rotated = cache.hsl_stage_input(grade, 1000, lane)
    assert rotated.shape[:2] == image.shape[1::-1]
    cache.replace_source(image * .5, None)
    assert cache.hsl_stage_input(grade, 1000, lane) is not rotated
    cache.trim_memory(0)
    assert not cache._hsl_inputs
    assert cache._retained_bytes_locked() == 0


def test_global_sdr_cache_invalidates_authored_reference_and_highlights():
    image = np.full((12, 18, 3), [.4, .1, .03], np.float32)
    cache = SessionRenderCache(image, image * .5)
    grade = AdjustmentState()
    original = cache.hsl_stage_input(grade, 1000, PreviewKind.SDR)
    grade.sdr.use_authored_base = False
    generated = cache.hsl_stage_input(grade, 1000, PreviewKind.SDR)
    assert generated is not original
    grade.sdr.highlight_compression_start_percent = 30
    assert cache.hsl_stage_input(grade, 1000, PreviewKind.SDR) is not generated


@pytest.mark.parametrize("lane", list(PreviewKind))
def test_neutral_and_bypass_are_exact_through_global_and_local_pipelines(lane):
    image = np.random.default_rng(3).uniform(-.01, 4, (8, 12, 3)).astype(np.float32)
    grade = AdjustmentState()
    local = LocalAdjustment()
    neutral = apply_adjustments(image, grade, lane, local_adjustments=[local])
    branch = getattr(grade, lane.value)
    branch.hsl_section_enabled = False
    branch.hsl.channels[0].recipe.hue = 60
    local_grade = getattr(local, lane.value + "_grade")
    local_grade.hsl_section_enabled = False
    local_grade.hsl = HSLRecipe(ranges=[HSLRange(center=0, width=180)], hue=60)
    disabled = apply_adjustments(image, grade, lane, local_adjustments=[local])
    np.testing.assert_array_equal(neutral, disabled)
    restored = AdjustmentState.model_validate_json(grade.model_dump_json())
    assert getattr(restored, lane.value).hsl == branch.hsl
    assert not getattr(restored, lane.value).hsl_section_enabled
    assert LocalAdjustment.model_validate_json(local.model_dump_json()) == local


@pytest.mark.parametrize("lane", list(PreviewKind))
def test_picker_captures_before_hsl_curves_and_downstream_grade(lane):
    image = np.full((8, 12, 3), [.4, .08, .03], np.float32)
    cache = SessionRenderCache(image, None)
    grade = AdjustmentState()
    request = HSLSampleRequest(lane=lane, adjustments=grade, points=[{"x": .5, "y": .5}], edit_revision=0)
    before = sample_stage(cache, request)["samples"]
    branch = getattr(grade, lane.value)
    branch.hsl.channels[0].recipe.hue = 70
    branch.red_curve = [[0, 0], [.5, .8], [1, 1]]
    assert sample_stage(cache, request)["samples"] == before
    branch.exposure = 1
    assert sample_stage(cache, request)["samples"] != before
    # Local picker receives its own upstream tonal/WB controls, and samples
    # even a disabled local. Its HSL and downstream curves cannot affect it.
    local = LocalAdjustment(enabled=False)
    request.local_id = local.id
    request.local_adjustments = [local]
    original = sample_stage(cache, request)["samples"]
    local_grade = getattr(local, lane.value + "_grade")
    local_grade.hsl = HSLRecipe(ranges=[HSLRange(center=0, width=180)], hue=120)
    local_grade.red_curve = [[0, 0], [.5, .9], [1, 1]]
    assert sample_stage(cache, request)["samples"] == original
    local_grade.exposure = 1
    assert sample_stage(cache, request)["samples"] != original
    request.selection_recipe = local_grade.hsl
    assert sample_stage(cache, request)["selection_overlay"].startswith("data:image/png;base64,")


def test_match_copies_hsl_without_colour_grading_translation_or_attenuation():
    grade = AdjustmentState()
    grade.hdr.hsl.channels[1].recipe.hue = 45
    grade.hdr.hsl.channels[4].recipe.luminance = .7
    grade.hdr.hsl_section_enabled = False
    sdr = _semantic_sdr_translation(grade, np.full((8, 12, 3), .3, np.float32))
    assert sdr.hsl == grade.hdr.hsl
    assert not sdr.hsl_section_enabled
    sdr.hsl.channels[1].recipe.hue = 1
    assert grade.hdr.hsl.channels[1].recipe.hue == 45
    local = LocalAdjustment().hdr_grade
    local.hsl = HSLRecipe(ranges=[HSLRange(center=355)], hue=55, luminance=.8)
    local.hsl_section_enabled = False
    translated = _translate_local_grade(local, .1)
    assert translated.hsl == local.hsl
    assert not translated.hsl_section_enabled


def test_library_paste_lists_independent_hsl_sections_and_complete_channel_recipes():
    from hdr_finisher.library_paste import LibraryPaste
    from hdr_finisher.models import DenoiseDocumentSettings, RawImportSettings
    grade = {"global_adjustments": AdjustmentState().model_dump(mode="json"),
             "denoise": DenoiseDocumentSettings().model_dump(mode="json"),
             "source": {"raw_import_settings": RawImportSettings().model_dump(mode="json")},
             "local_adjustments": []}
    groups = LibraryPaste.schema(None, grade, grade)
    for lane in ("hdr", "sdr"):
        group = next(g for g in groups if g["id"] == f"{lane}-hsl")
        assert group["label"] == "HSL"
        assert {s["id"] for s in group["settings"]} == {
            f"global_adjustments.{lane}.hsl.channels",
            f"global_adjustments.{lane}.hsl_section_enabled",
        }
