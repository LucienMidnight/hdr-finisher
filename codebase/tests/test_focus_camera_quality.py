"""Synthetic camera-JPEG checks; these do not establish real-eye accuracy."""
from io import BytesIO
import numpy as np
import pytest
from PIL import Image, ImageDraw, ImageFilter
from hdr_finisher.color import linear_srgb_to_acescg
from hdr_finisher.library_focus import focus_map
from hdr_finisher import library_overlays as overlays


def eye_picture(contrast=1.0):
    """Fixed iris, eyelid and lashes with a plain backdrop."""
    image = Image.new('L', (256, 192), 165)
    draw = ImageDraw.Draw(image)
    draw.ellipse((42, 59, 214, 137), fill=215, outline=65, width=2)
    draw.ellipse((99, 62, 157, 134), fill=100, outline=45, width=2)
    for angle in np.linspace(0, 2*np.pi, 48, endpoint=False):
        draw.line((128+16*np.cos(angle), 98+20*np.sin(angle),
                   128+27*np.cos(angle), 98+34*np.sin(angle)), fill=165, width=1)
    draw.ellipse((116, 82, 140, 114), fill=25)
    draw.ellipse((120, 83, 125, 89), fill=240)
    for x in range(55, 206, 12):
        y = 60 + int(.003*(x-128)**2)
        draw.line((x, y, x-5, y-10), fill=45, width=1)
    pixels = np.asarray(image, dtype=np.float32)
    return Image.fromarray(np.rint(165+(pixels-165)*contrast).astype(np.uint8)).convert('RGB')


def camera_pixels(image, quality=90):
    out = BytesIO()
    image.save(out, format='JPEG', quality=quality)
    signal = np.asarray(Image.open(BytesIO(out.getvalue())).convert('RGB'), dtype=np.float32)/255
    linear = np.where(signal <= .04045, signal/12.92, ((signal+.055)/1.055)**2.4)
    return linear_srgb_to_acescg(linear).astype(np.float32)


def score(image, quality=90):
    values, noise = focus_map(camera_pixels(image, quality))
    assert values.dtype == np.uint8 and np.isfinite(noise)
    roi = values[45:145, 40:216]
    return float(roi.mean()), float(np.mean(roi > 0)), float(noise)


@pytest.mark.parametrize('quality', [60, 90, 98])
def test_camera_jpeg_sharpness_ranks_controlled_defocus(quality):
    # Standard subpixel mild, one-pixel moderate and two-pixel strong blur;
    # no blur sweep to select convenient passing examples.
    image = eye_picture()
    results = [score(image.filter(ImageFilter.GaussianBlur(radius)), quality)
               for radius in (0, .5, 1, 2)]
    print('JPEG', quality, 'blur 0/.5/1/2 mean, coverage, noise:', results)
    means = [row[0] for row in results]
    assert all(a > b for a, b in zip(means, means[1:])), results


def test_flat_camera_jpeg_has_no_focus_signal():
    values, noise = focus_map(camera_pixels(Image.new('RGB', (256, 192), (165,)*3)))
    assert not values.any()
    assert np.isfinite(noise)


@pytest.mark.parametrize('contrast', [1.0, .15])
def test_camera_processing_and_resolution_diagnostics(contrast):
    """Report hazards without inventing an approved false-positive budget."""
    image = eye_picture(contrast)
    rng = np.random.default_rng(426)
    flat = np.full((192, 256, 3), 165, dtype=np.float32)
    measurements = {}
    for radius in (0, .5, 1, 2):
        blurred = image.filter(ImageFilter.GaussianBlur(radius))
        measurements[f'blur{radius}'] = score(blurred)
        measurements[f'sharpen{radius}'] = score(blurred.filter(
            ImageFilter.UnsharpMask(radius=1.5, percent=150, threshold=0)))
        for size in (128, 64):
            reduced = blurred.resize((size, size*3//4), Image.Resampling.LANCZOS)
            values, _ = focus_map(camera_pixels(reduced))
            measurements[f'blur{radius}@{size}'] = float(values.mean())
    for sigma in (2, 8, 20):
        noisy = Image.fromarray(np.clip(flat+rng.normal(0, sigma, flat.shape), 0, 255).astype(np.uint8))
        measurements[f'flat_noise{sigma}'] = score(noisy)
    print('contrast', contrast, measurements)
    assert all(np.all(np.isfinite(value)) for value in measurements.values())


def test_camera_quality_cache_identity_is_separate(tmp_path):
    path = tmp_path / 'source.arw'
    path.write_bytes(b'stand-in source')
    keys = {overlays.map_key(path, 'focus', quality) for quality in ('camera', 'half', 'full')}
    assert len(keys) == 3


def test_camera_source_decodes_jpeg_to_bounded_float_acescg(tmp_path, monkeypatch):
    import rawpy
    from types import SimpleNamespace
    encoded = BytesIO()
    Image.new('RGB', (3200, 600), (160, 100, 60)).save(encoded, format='JPEG', quality=95)
    class Raw:
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def open_file(self, path): pass
        def extract_thumb(self):
            return SimpleNamespace(format=rawpy.ThumbFormat.JPEG, data=encoded.getvalue())
    monkeypatch.setattr(rawpy, 'RawPy', Raw)
    pixels, metadata = overlays.camera_focus_source(tmp_path / 'source.arw')
    assert pixels.dtype == np.float32 and pixels.shape[2] == 3
    assert max(pixels.shape[:2]) <= 2560 and np.isfinite(pixels).all()
    expected = camera_pixels(Image.new('RGB', (32, 32), (160, 100, 60)), quality=95)
    # Same constant JPEG colour through independent sRGB conversion, allowing
    # only float32 matrix arithmetic roundoff, not a perceptual tolerance.
    np.testing.assert_allclose(pixels[10, 10], expected[10, 10], rtol=1e-5, atol=1e-7)
    assert metadata['provisional'] is True
    assert (metadata['analysis_width'], metadata['analysis_height']) == (pixels.shape[1], pixels.shape[0])


@pytest.mark.parametrize('quality', ['camera', 'half', 'full'])
def test_camera_direct_geometry_and_native_registration_remain_distinct(tmp_path, monkeypatch, quality):
    from hdr_finisher import library_pictures
    path = tmp_path / 'source.arw'
    path.write_bytes(b'stand-in source')
    pixels = camera_pixels(eye_picture())
    calls = []
    monkeypatch.setattr(overlays, 'camera_focus_source', lambda *args: (pixels, {'provisional': True}))
    monkeypatch.setattr(overlays, 'full_focus_source', lambda *args: pixels)
    monkeypatch.setattr(library_pictures, 'decode_picture', lambda *args: (pixels, None, {'route': 'quick-half-raw'}))
    def register(*args):
        calls.append(True)
        return {'camera_frame': [.1, .2, .8, .7]}
    monkeypatch.setattr(overlays, 'camera_frame', register)
    maps = overlays.OverlayMaps(tmp_path / 'maps')
    meta = maps.build(path, 'focus', quality)
    if quality == 'camera':
        assert calls == []
        assert meta['camera_frame'] == meta['frame']
        assert meta['provisional'] is True
    else:
        assert calls == [True]
        w, h = meta['frame'][2:]
        assert meta['camera_frame'] == [.1*w, .2*h, .8*w, .7*h]
    with np.load(maps.file(meta['key'])) as stored:
        np.testing.assert_array_equal(stored['values'][..., 0], focus_map(pixels)[0])
    assert maps.cached(path, 'focus', quality)['key'] == meta['key']


def test_sharpening_can_make_mild_defocus_outscore_unsharpened_sharp_detail():
    """Known ambiguity: confidence is not a camera-independent focus score."""
    image = eye_picture()
    sharp = score(image)[0]
    sharpened_soft = score(image.filter(ImageFilter.GaussianBlur(.5)).filter(
        ImageFilter.UnsharpMask(radius=1.5, percent=150, threshold=0)))[0]
    assert sharpened_soft > sharp


@pytest.mark.parametrize('sigma', [2, 8, 20])
def test_uniform_noisy_camera_patch_does_not_peak(sigma):
    rng = np.random.default_rng(426)
    values = np.clip(165+rng.normal(0, sigma, (192, 256, 3)), 0, 255).astype(np.uint8)
    result, _ = focus_map(camera_pixels(Image.fromarray(values)))
    assert not result.any()


@pytest.mark.parametrize('size', [256, 128, 64])
def test_low_contrast_defocus_ranking_survives_preview_reduction(size):
    image = eye_picture(.15)
    means = []
    for radius in (0, .5, 1, 2):
        reduced = image.filter(ImageFilter.GaussianBlur(radius)).resize(
            (size, size*3//4), Image.Resampling.LANCZOS)
        values, _ = focus_map(camera_pixels(reduced))
        means.append(float(values.mean()))
    assert all(a > b for a, b in zip(means, means[1:])), means
