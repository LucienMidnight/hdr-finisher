import numpy as np
import pytest
from pydantic import ValidationError
from hdr_finisher.models import AdjustmentState, PreviewKind, VignetteAdjustments
from hdr_finisher import adjustments


@pytest.mark.parametrize("kind", [PreviewKind.HDR, PreviewKind.SDR])
@pytest.mark.parametrize("old", [0, 1, 37.25, 50, 99, 100])
def test_old_saved_vignette_pixels_and_roundtrip_are_exact(kind, old):
    recipe = dict(amount=-56, midpoint=old, feather=59, roundness=-39,
                  center_x=.36, center_y=.73, scale_x=143, scale_y=69)
    loaded = AdjustmentState.model_validate({kind.value: {"vignette": recipe}})
    vignette = getattr(loaded, kind.value).vignette
    assert vignette.midpoint == old / 2
    assert vignette.midpoint_scale_version == 2
    image = np.random.default_rng(1).random((83, 125, 3), dtype=np.float32)
    # Frozen pre-change coordinate equation, independent of the new mapping.
    y, x = np.mgrid[:83, :125].astype(np.float32)
    dx = np.abs((x - np.float32(.36 * 124)) / np.float32(41.5)) / np.float32(1.43)
    dy = np.abs((y - np.float32(.73 * 82)) / np.float32(41.5)) / np.float32(.69)
    exponent = 2 + -39 / 100
    radius = np.power(np.power(dx, exponent) + np.power(dy, exponent), 1 / exponent)
    start = np.float32(.15 + .70 * old / 100)
    end = start + np.float32(.02 + .98 * 59 / 100)
    mask = adjustments._smoothstep(float(start), float(end), radius)
    expected = image * np.exp2(np.float32(2 * -56 / 100) * mask)[..., None]
    np.testing.assert_array_equal(adjustments._apply_vignette(image, vignette, kind), expected)
    restored = AdjustmentState.model_validate_json(loaded.model_dump_json())
    assert getattr(restored, kind.value).vignette == vignette


def test_new_midpoint_reaches_edges_and_then_beyond_corners():
    image = np.ones((401, 601, 3), dtype=np.float32)
    vignette = VignetteAdjustments(midpoint_scale_version=2, midpoint=100, amount=-100, feather=0)
    result = adjustments._apply_vignette(image, vignette, PreviewKind.SDR)
    assert result[200, 0, 0] == 1  # side centre is now clear
    assert result[0, 0, 0] == .25  # corners still receive the darkening
    vignette.midpoint = 200
    np.testing.assert_array_equal(adjustments._apply_vignette(image, vignette, PreviewKind.SDR), image)
    with pytest.raises(ValidationError):
        VignetteAdjustments(midpoint_scale_version=2, midpoint=201)


def test_scale_metadata_is_not_a_user_facing_paste_choice():
    from hdr_finisher.library_paste import leaves
    paths = leaves(VignetteAdjustments().model_dump(), "global_adjustments.hdr.vignette")
    assert "global_adjustments.hdr.vignette.midpoint" in paths
    assert all("midpoint_scale_version" not in path for path in paths)


@pytest.mark.parametrize("bad", [None, "broken", -1, 101, float("nan")])
def test_invalid_legacy_midpoint_is_rejected(bad):
    with pytest.raises(ValidationError):
        VignetteAdjustments.model_validate({"midpoint": bad})


def test_saved_document_recovery_upgrades_both_lanes_without_a_notice():
    from hdr_finisher.models import EditDocument
    from hdr_finisher.projects import validate_saved
    from hdr_finisher.saved_grades import notice
    raw = {
        "schema_version": 4,
        "hdr_reference_white_nits": 203,
        "source": {"filename": "saved.tiff", "luminance": {
            "luminance_semantics": "scene_relative", "transfer_function": "unknown"}},
        "global_adjustments": {
            "hdr": {"vignette": {"midpoint": 99, "amount": -12}},
            "sdr": {"vignette": {"midpoint": 37.25, "amount": -56}}},
    }
    restored = validate_saved(EditDocument, raw)
    assert notice(restored) is None
    assert restored.global_adjustments.hdr.vignette.midpoint == 49.5
    assert restored.global_adjustments.sdr.vignette.midpoint == 18.625
    again = validate_saved(EditDocument, restored.model_dump(mode="json"))
    assert again.global_adjustments == restored.global_adjustments
    assert raw["global_adjustments"]["hdr"]["vignette"]["midpoint"] == 99
