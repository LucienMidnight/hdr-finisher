"""Pipeline, settings carriers, exact neutral and actual-stage sampling."""
import numpy as np
import pytest

from hdr_finisher.models import AdjustmentState, LocalAdjustment, PreviewKind
from hdr_finisher.adjustments import apply_adjustments
from hdr_finisher.hsl import HSLRange, HSLRecipe
from hdr_finisher.hsl_sampling import HSLSampleRequest, sample_stage
from hdr_finisher.render_cache import SessionRenderCache
from hdr_finisher.sdr_match import _semantic_sdr_translation, _translate_local_grade


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
