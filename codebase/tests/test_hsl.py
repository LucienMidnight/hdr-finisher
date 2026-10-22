"""Behavioral contract for the production Python port of the HSL prototype."""
import json
from pathlib import Path
import subprocess

import numpy as np
import pytest
from pydantic import ValidationError

from hdr_finisher.hsl import (
    HSLRecipe, HSLRange, HSLSettings, add_sample, apply_recipes,
    from_lab, sample_neighborhood, selection, to_lab,
)


def color(hue):
    return from_lab([.7, .15 * np.cos(np.radians(hue)), .15 * np.sin(np.radians(hue))])


def test_separated_ranges_exclusion_wrap_and_grey_rejection():
    recipe = HSLRecipe()
    assert not add_sample(recipe, [.5, .5, .5])
    assert add_sample(recipe, color(355))
    assert add_sample(recipe, color(140), "add")
    for hue in (2, 140):
        assert selection(color(hue), recipe.ranges)[0] > .99
    assert selection(color(70), recipe.ranges)[0] == 0
    assert add_sample(recipe, color(140), "subtract")
    assert selection(color(140), recipe.ranges)[0] == 0
    assert selection(color(355), recipe.ranges)[0] > .99
    assert add_sample(recipe, color(50))
    assert len(recipe.ranges) == 1


def test_feather_and_exposure_independent_membership():
    ranges = [HSLRange(center=0, width=10, feather=20)]
    for hue, expected in ((10, 1), (20, .5), (30, 0)):
        assert selection(color(hue), ranges)[0] == pytest.approx(expected, abs=1e-6)
    rgb = np.array([.4, .08, .03])
    r = HSLRecipe()
    add_sample(r, rgb)
    assert selection(rgb, r.ranges)[0] == pytest.approx(selection(rgb * 64, r.ranges)[0], abs=1e-10)


def test_neutral_exact_and_zero_mask_preserve_hdr_negative_and_alpha():
    image = np.array([[[12, .2, -.03, .5]]], dtype=np.float32)
    neutral = HSLSettings()
    assert apply_recipes(image, [c.recipe for c in neutral.channels]) is image
    r = HSLRecipe(hue=70, saturation=50)
    add_sample(r, image[0, 0, :3])
    np.testing.assert_array_equal(apply_recipes(image, [r], np.zeros((1, 1))), image)
    output = apply_recipes(image, [r])
    assert np.isfinite(output).all()
    assert output[..., :3].max() > 1
    assert output[0, 0, 3] == image[0, 0, 3]


def test_corrections_uniformity_and_additive_same_input_channels():
    image = np.array([[color(65)]], dtype=np.float64)
    r = HSLRecipe(ranges=[HSLRange(center=50, width=30, feather=10)], uniformity=100)
    lab = to_lab(apply_recipes(image, [r]))[0, 0]
    assert np.degrees(np.arctan2(lab[2], lab[1])) == pytest.approx(50, abs=.001)
    r.uniformity = 0
    r.luminance = 1
    np.testing.assert_allclose(apply_recipes(image, [r]), image * 2, atol=1e-6)
    r.luminance = 0
    r.saturation = -100
    lab = to_lab(apply_recipes(image, [r]))[0, 0]
    assert np.hypot(lab[1], lab[2]) < 1e-6
    r.saturation = 50
    other = r.model_copy(deep=True)
    other.hue = 100
    expected = image + (apply_recipes(image, [r]) - image) + (apply_recipes(image, [other]) - image)
    np.testing.assert_allclose(apply_recipes(image, [r, other]), expected, atol=1e-12)
    np.testing.assert_allclose(apply_recipes(image, [r], np.array([[.25]])),
                               image + .25 * (apply_recipes(image, [r]) - image), atol=1e-12)


def test_sampler_linear_light_alpha_and_edges():
    image = np.array([[[1, 0, 0, 1], [0, 1, 0, 0]], [[0, 0, 1, 1], [0, 0, 0, 1]]], dtype=float)
    np.testing.assert_allclose(sample_neighborhood(image, 0, 0), [1/3, 0, 1/3])
    assert np.array_equal(sample_neighborhood(image * 0, 0, 0), [0, 0, 0])


def test_recipe_roundtrip_limits_deduplication_and_invalid_values():
    settings = HSLSettings()
    assert HSLSettings.model_validate_json(settings.model_dump_json()) == settings
    assert len(settings.channels) == 9
    with pytest.raises(ValidationError):
        HSLRecipe(hue=float("nan"))
    with pytest.raises(ValidationError):
        HSLRecipe(ranges=[HSLRange(center=0)] * 33)
    with pytest.raises(ValidationError):
        HSLSettings(channels=settings.channels + [settings.channels[0]])
    recipe = HSLRecipe(ranges=[HSLRange(center=i, width=1, feather=1) for i in range(32)])
    assert not add_sample(recipe, color(1), "add")
    with pytest.raises(ValueError, match="limited to 32"):
        add_sample(recipe, color(180), "add")
    assert len(recipe.ranges) == 32


def test_python_port_matches_existing_javascript_engine():
    # Compare executable behavior, including unbounded HDR and negative RGB.
    # This is an engineering arithmetic check, not a finished-image tolerance.
    rng = np.random.default_rng(42)
    pixels = rng.uniform(-.05, 8, (96, 4)).astype(np.float32)
    recipe = HSLRecipe(ranges=[HSLRange(center=50, width=90, feather=35),
                               HSLRange(center=140, width=10, feather=15, subtract=True)],
                       hue=37, saturation=25, luminance=.4, uniformity=40)
    script = """
import { processCPU } from './tools/hsl-prototype/engine.mjs';
let input=''; for await (const chunk of process.stdin) input+=chunk;
const data=JSON.parse(input);
console.log(JSON.stringify([...processCPU(new Float32Array(data.pixels),data.recipe)]));
"""
    result = subprocess.run(["node", "--input-type=module", "-e", script],
        cwd=Path(__file__).resolve().parents[1], input=json.dumps({"pixels": pixels.ravel().tolist(),
        "recipe": recipe.model_dump()}), text=True, capture_output=True, check=True)
    expected = np.array(json.loads(result.stdout), dtype=np.float32).reshape(pixels.shape)
    np.testing.assert_array_equal(apply_recipes(pixels, [recipe]), expected)
