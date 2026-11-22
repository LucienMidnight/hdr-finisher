import lensfunpy
import numpy as np
import pytest

from hdr_finisher import lens_correction, raw_import
from hdr_finisher.models import LensCorrectionSettings


CANON_PROFILE = "Canon|Canon EOS 60D|Canon EF-S|Canon|Canon EF-S 18-135mm f/3.5-5.6 IS STM"
SONY_IDENTITY = dict(camera_maker="Sony", camera_model="ILCE-7RM3", lens_maker="Sigma", lens_name="65mm F2")


def numpy_bilinear(image, coordinates, *, frame_shape=None, origin=(0, 0)):
    """Reference for the original float32 coordinates and float64 weights."""
    height, width = frame_shape or image.shape[:2]
    output = np.empty((*coordinates.shape[:2], 3), dtype=np.float32)
    for channel in range(3):
        xy = coordinates[:, :, channel] if coordinates.ndim == 4 else coordinates
        x = np.clip(xy[..., 0], 0.0, width - 1.0)
        y = np.clip(xy[..., 1], 0.0, height - 1.0)
        x0 = np.floor(x).astype(np.int32)
        y0 = np.floor(y).astype(np.int32)
        wx, wy = x - x0, y - y0
        x1 = np.minimum(x0 + 1, width - 1) - origin[0]
        y1 = np.minimum(y0 + 1, height - 1) - origin[1]
        x0 -= origin[0]
        y0 -= origin[1]
        top = image[y0, x0, channel] * (1.0 - wx) + image[y0, x1, channel] * wx
        bottom = image[y1, x0, channel] * (1.0 - wx) + image[y1, x1, channel] * wx
        output[..., channel] = top * (1.0 - wy) + bottom * wy
    return output


def reference_frame(image, settings, identity):
    database = lensfunpy.Database()
    resolved = raw_import._resolve_lens_profile(
        database, settings, **dict(dict.fromkeys(SONY_IDENTITY), **identity),
    )
    camera, lens, _ = resolved
    height, width = image.shape[:2]
    modifier = lensfunpy.Modifier(lens, camera.crop_factor, width, height)
    modifier.initialize(
        settings.focal_length_mm, settings.aperture, settings.focus_distance_m or 1000,
        scale=0, pixel_format=np.float32, flags=raw_import._lens_flags(settings, lensfunpy),
    )
    magnitudes = np.abs(image)
    if settings.vignetting:
        applied = modifier.apply_color_modification(magnitudes)
        assert applied == bool(lens.calib_vignetting)
        np.copysign(magnitudes, image, out=magnitudes)
    else:
        magnitudes = image
    coordinates = (modifier.apply_subpixel_geometry_distortion() if settings.chromatic_aberration
                   else modifier.apply_geometry_distortion())
    assert coordinates is not None
    return numpy_bilinear(magnitudes, coordinates), magnitudes


def canon_settings(**overrides):
    return LensCorrectionSettings(
        mode="manual", profile_id=CANON_PROFILE, focal_length_mm=18, aperture=3.5, focus_distance_m=10,
    ).model_copy(update=overrides)


@pytest.mark.parametrize("chromatic", [False, True])
@pytest.mark.parametrize(("profile", "vignetting", "height"), [
    ("canon", True, 147), ("canon", False, 147), ("sony", True, 149), ("sony", False, 11),
])
def test_native_lens_bytes_match_whole_frame_numpy(profile, vignetting, height, chromatic):
    if profile == "canon":
        settings = canon_settings(chromatic_aberration=chromatic, vignetting=vignetting)
        identity = {}
    else:
        settings = LensCorrectionSettings(
            mode="auto", focal_length_mm=65, aperture=2, chromatic_aberration=chromatic, vignetting=vignetting,
        )
        identity = SONY_IDENTITY
    image = np.random.default_rng(74).standard_normal((height, 417, 3), dtype=np.float32)
    image[0, ::2] = -0.0
    image[-1, 1::2] = 0.0
    expected, _ = reference_frame(image, settings, identity)
    original = image.tobytes()
    actual, metadata = raw_import.apply_lens_correction(image, settings, **identity)
    assert metadata["applied"]
    assert actual.tobytes() == expected.tobytes()
    assert image.tobytes() == original


def test_owned_lens_input_is_vignetted_in_place_and_remaps_into_memmap(tmp_path):
    settings = canon_settings()
    image = np.random.default_rng(75).standard_normal((147, 417, 3), dtype=np.float32)
    expected, vignetted = reference_frame(image, settings, {})
    output = np.memmap(tmp_path / "output.f32", shape=image.shape, dtype=np.float32, mode="w+")
    try:
        actual, _ = raw_import.apply_lens_correction(
            image, settings, consume_input=True, allocate_output=lambda shape: output,
        )
        assert image.tobytes() == vignetted.tobytes()
        assert actual is output
        assert output.tobytes() == expected.tobytes()
    finally:
        output._mmap.close()


@pytest.mark.parametrize("failure", ["setup", "mid_image"])
def test_lens_strip_failure_restarts_with_native_strips(failure, monkeypatch):
    settings = canon_settings()
    image = np.random.default_rng(75).standard_normal((147, 417, 3), dtype=np.float32)
    expected, _ = reference_frame(image, settings, {})
    allocations = []
    failures = []
    monkeypatch.setattr(lens_correction, "logical_cpus", lambda: 1)

    def allocate(shape):
        allocations.append(np.empty(shape, dtype=np.float32))
        return allocations[-1]

    def one_failure(method, should_fail):
        real = getattr(lens_correction, method)

        def call(*args):
            if not failures and should_fail(args):
                failures.append(True)
                raise lens_correction.LensStripError("test coordinate failure")
            return real(*args)

        monkeypatch.setattr(lens_correction, method, call)

    if failure == "setup":
        one_failure("_capture_rows", lambda args: True)
    else:
        one_failure("_generate", lambda args: args[4] == lens_correction.COORDINATE_ROWS)

    actual, _ = raw_import.apply_lens_correction(image, settings, allocate_output=allocate)
    assert failures == [True]
    assert len(allocations) == 1 and actual is allocations[0]
    assert actual.tobytes() == expected.tobytes()


def test_native_lens_cancellation_between_strips_leaves_later_rows_unwritten(monkeypatch):
    image = np.ones((147, 417, 3), dtype=np.float32)
    output = np.zeros_like(image)
    monkeypatch.setattr(lens_correction, "logical_cpus", lambda: 1)
    with pytest.raises(raw_import.RawImportError, match="Import cancelled"):
        raw_import.apply_lens_correction(
            image, canon_settings(vignetting=False), allocate_output=lambda shape: output,
            cancelled=lambda: bool(output[0, 0, 0]),
        )
    assert np.all(output[:lens_correction.COORDINATE_ROWS] == 1)
    assert not np.any(output[lens_correction.COORDINATE_ROWS:])


@pytest.mark.parametrize("chromatic", [False, True])
def test_native_lens_tile_clamps_edges_and_keeps_weights_in_frame_coordinates(chromatic):
    rng = np.random.default_rng(31)
    image = rng.standard_normal((19, 23, 3), dtype=np.float32)
    origin = (0, 5)
    tile = image[origin[1]:, :12]
    xy = rng.uniform([-3, 5.25], [10, 21], (7, 13, 2)).astype(np.float32)
    coords = np.stack([xy, xy - 0.1, xy + 0.1], axis=2) if chromatic else xy
    expected = numpy_bilinear(image, coords)
    actual = lens_correction.remap_region(
        tile, coords, frame_shape=image.shape[:2], origin=origin, check=lambda: None,
    )
    assert actual.tobytes() == expected.tobytes()


def test_native_lens_database_keeps_search_signatures_and_refuses_mounts():
    native = lens_correction.native_lens_database()
    cameras = native.find_cameras("Canon", "Canon EOS 60D", loose_search=True)
    assert cameras and native.find_cameras(maker="Canon", model="Canon EOS 60D")
    assert native.find_lenses(cameras[0], None, "EF-S 18-135mm", loose_search=True)
    with pytest.raises(NotImplementedError):
        native.mounts
    with pytest.raises(NotImplementedError):
        native.find_mount("Canon EF-S")
