"""Import-boundary gamut projection: signed conversion, shared routes and cache identity."""
from pathlib import Path

import numpy as np
import pytest

from hdr_finisher import loader
from hdr_finisher.color import (
    aces2065_to_acescg, map_negative_acescg, normalize_to_acescg,
    transform_float32_bounded,
)


def test_negative_mapping_preserves_positive_bits_and_hdr_headroom():
    source = np.array([[[0., -0., 10.], [1.e-38, 2., 65504.],
                        [-.08, .2, .3], [-2., -1., 0.]]], dtype=np.float32)
    before = source.copy()
    actual = map_negative_acescg(source)
    np.testing.assert_array_equal(actual[:, :2].view(np.uint32), source[:, :2].view(np.uint32))
    np.testing.assert_allclose(actual[0, 2], [0., .22105263, .3], rtol=1e-7)
    np.testing.assert_array_equal(actual[0, 3], [0., 0., 0.])
    np.testing.assert_array_equal(source, before)


def test_mapping_extreme_samples_is_finite_and_preserves_maximum():
    largest = np.finfo(np.float32).max
    source = np.array([[[-largest, 0., largest], [-largest, 0., 1.e-38],
                        [np.nan, np.inf, -np.inf]]], dtype=np.float32)
    actual = map_negative_acescg(source)
    assert np.all(np.isfinite(actual)) and np.all(actual >= 0.)
    np.testing.assert_array_equal(actual[0, :2, 2], source[0, :2, 2])
    np.testing.assert_array_equal(actual[0, 2], [0., 65504., 0.])


def test_projection_preserves_channel_order_and_relative_difference():
    source = np.array([[[-.2, .1, .8], [.8, -.2, .1], [.1, .8, -.2]]], dtype=np.float32)
    actual = map_negative_acescg(source)
    np.testing.assert_allclose(actual, [[[0., .24, .8], [.8, 0., .24], [.24, .8, 0.]]], rtol=1e-7)
    np.testing.assert_array_equal(map_negative_acescg(actual), actual)


def test_linear_conversion_keeps_signed_values_until_shared_boundary():
    signed = np.array([[[-.08, .2, .3]]], dtype=np.float32)
    np.testing.assert_array_equal(normalize_to_acescg(signed, "ACEScg", "LINEAR"), signed)
    np.testing.assert_array_equal(normalize_to_acescg(signed, None, "LINEAR"), signed)
    # AP0 red transforms outside AP1; the legacy RAW bridge must retain it.
    assert np.min(aces2065_to_acescg(np.array([[[1., 0., 0.]]], dtype=np.float32))) < 0.


@pytest.mark.parametrize("route", ["raw", "linear-dng", "ultrahdr"])
def test_decoder_normalized_routes_map_before_analysis(monkeypatch, route):
    signed = np.array([[[-.08, .2, .3]]], dtype=np.float32)
    metadata = {"color_space": "ACEScg", "transfer_function": "LINEAR",
                "decoder_normalized_to_acescg": True, "raw_input": route == "raw"}
    if route == "raw":
        monkeypatch.setattr(loader, "decode_raw", lambda *a, **k: (signed.copy(), metadata.copy()))
        path = Path("source.arw")
    elif route == "linear-dng":
        from types import SimpleNamespace
        monkeypatch.setattr(loader, "inspect_dng", lambda *a, **k: SimpleNamespace(route=loader.DngRoute.LINEAR_DNG))
        monkeypatch.setattr(loader, "decode_linear_dng", lambda *a, **k: (signed.copy(), metadata.copy()))
        path = Path("source.dng")
    else:
        monkeypatch.setattr(loader, "is_ultrahdr_jpeg", lambda *a: True)
        authored_sdr = np.full_like(signed, .4)
        monkeypatch.setattr(loader, "decode_ultrahdr_jpeg", lambda *a, **k: (signed.copy(), authored_sdr, metadata.copy()))
        path = Path("source.jpg")
    original_analysis = loader.classify_hdr
    seen = []
    def analyze(image, *args, **kwargs):
        seen.append(image.copy())
        return original_analysis(image, *args, **kwargs)
    monkeypatch.setattr(loader, "classify_hdr", analyze)
    actual, _, _, _, sdr = loader.load_image(path)
    np.testing.assert_allclose(actual, [[[0., .22105263, .3]]], rtol=1e-7)
    np.testing.assert_array_equal(seen[0], actual)
    if route == "ultrahdr":
        np.testing.assert_array_equal(sdr, authored_sdr)


@pytest.mark.parametrize("identified", [True, False])
def test_real_exr_signed_samples_are_mapped_only_after_interpretation(tmp_path, identified):
    import OpenEXR
    source = np.array([[[-.08, .2, .3], [2., 4., 8.]]], dtype=np.float32)
    path = tmp_path / "signed.exr"
    header = {"colorInteropID": "lin_ap1_scene"} if identified else {}
    with OpenEXR.File(header, {"RGB": source}) as image:
        image.write(str(path))
    actual, *_ = loader.load_image(path)
    if identified:
        np.testing.assert_allclose(actual[0, 0], [0., .22105263, .3], rtol=1e-7)
    else:
        np.testing.assert_array_equal(actual, source)
        actual, *_ = loader.load_image(path, overrides={"color_space": "ACEScg"})
        np.testing.assert_allclose(actual[0, 0], [0., .22105263, .3], rtol=1e-7)
    np.testing.assert_array_equal(actual[0, 1], source[0, 1])


def test_bounded_mapping_matches_whole_frame_and_checks_cancellation():
    source = np.tile(np.array([[[-.08, .2, .3], [1., 2., 3.]]], dtype=np.float32), (257, 1, 1))
    expected = map_negative_acescg(source)
    np.testing.assert_array_equal(transform_float32_bounded(source.copy(), map_negative_acescg, rows=17), expected)
    with pytest.raises(RuntimeError, match="Import cancelled"):
        transform_float32_bounded(source, map_negative_acescg, cancelled=lambda: True)


def test_source_cache_transform_identity_changed():
    assert loader.SOURCE_COLOR_TRANSFORM_VERSION != "acescg-bounded-v1"
