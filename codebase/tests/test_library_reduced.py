from pathlib import Path
import numpy as np
import pytest
from PIL import Image
from hdr_finisher import app_memory
from hdr_finisher.library_scheduler import Scheduler
from hdr_finisher.library_reduced import read,png


def test_setting_updates_target_and_scaled_shares_without_changing_fixed_pool(monkeypatch):
    monkeypatch.setattr(app_memory,"machine_memory",lambda:64_000_000_000)
    old=app_memory.CEILING
    try:
        value=app_memory.configure(8_000_000_000)
        assert value["targetBytes"]==7_400_000_000
        assert app_memory.limit("thumbnails")==512*1024**2
        assert app_memory.limit("working")==600_000_000
        assert app_memory.limit("sharp")>512_000_000
        app_memory.configure(2_500_000_000)
        assert app_memory.TARGET==1_900_000_000
        assert app_memory.limit("sharp")<512_000_000
        assert app_memory.memory_options()["maximumBytes"]==57_600_000_000
    finally:app_memory.configure(old)


def test_giant_waits_with_message_does_not_block_fast_lane_and_resumes():
    s=Scheduler(4_000_000_000)
    s.update(available=40_000_000_000,ram=64_000_000_000)
    giant=s.ask("giant","w","pano.png","source",5_376_000_000)
    assert giant.granted is None and giant.reason=="needs more memory"
    assert giant.ready.is_set() and giant.id not in s.jobs
    small=s.ask("small","w","small.jpg","quick",64_000_000)
    assert small.granted is not None
    s.set_ceiling(8_000_000_000)
    s.finish("small")
    # A terminal notice releases its request; the window submits fresh demand.
    giant=s.ask("giant-retry","w","pano.png","source",5_376_000_000)
    assert giant.granted is not None
    assert len(s.jobs)==1


@pytest.mark.parametrize("suffix",["png","tif"])
def test_sequential_reader_reduces_before_exposing_pixels(tmp_path,suffix):
    p=tmp_path/("picture."+suffix)
    image=np.full((400,600,3),120,np.uint8)
    if suffix=="tif":
        import tifffile
        tifffile.imwrite(p,image,photometric="rgb",rowsperstrip=16,compression="deflate")
    else:Image.fromarray(image).save(p)
    out,original=read(p,edge=120)
    assert original==(600,400) and out.shape==(80,120,3)
    np.testing.assert_array_equal(out,120)


@pytest.mark.parametrize("mode",["P","L","LA","RGBA","1"])
def test_png_matches_existing_pillow_rgb_boundary_for_small_files(tmp_path,mode):
    p=tmp_path/"picture.png"
    image=Image.new("RGB",(17,13),(100,150,200)).convert(mode)
    image.save(p)
    out,_=png(p)
    np.testing.assert_array_equal(out,np.asarray(Image.open(p).convert("RGB")))


def test_pillow_global_guard_stays_unchanged(tmp_path):
    from hdr_finisher.library_reduced import jpeg_open
    before=Image.MAX_IMAGE_PIXELS
    p=tmp_path/"small.jpg";Image.new("RGB",(16,16)).save(p)
    with jpeg_open(p) as image: image.load()
    assert Image.MAX_IMAGE_PIXELS==before


@pytest.mark.parametrize("byteorder",["<",">"])
def test_single_strip_row_bands_keep_spatial_samples_and_byte_order(tmp_path,byteorder):
    import tifffile
    p=tmp_path/"single-strip.tif"
    values=np.arange(400*600,dtype=np.uint32).reshape(400,600)%65536
    image=np.stack([values,values//2,values//3],axis=2).astype(np.uint16)
    tifffile.imwrite(p,image,photometric="rgb",rowsperstrip=400,byteorder=byteorder)
    out,original=read(p,edge=120)
    expected=np.stack([np.asarray(Image.fromarray(image[...,c].astype(np.float32)).resize((120,80),Image.Resampling.LANCZOS)) for c in range(3)],axis=2)
    expected=np.clip(np.rint(expected),0,65535).astype(np.uint16)
    assert original==(600,400)
    np.testing.assert_array_equal(out,expected)


def test_png_keeps_oriented_original_dimensions(tmp_path):
    p=tmp_path/"rotated.png"
    exif=Image.Exif();exif[274]=6
    Image.new("RGB",(17,13),(100,150,200)).save(p,exif=exif)
    pixels,metadata=png(p)
    assert pixels.shape==(17,13,3)
    assert (metadata["source_width"],metadata["source_height"])==(13,17)


def test_giant_deadline_scales_without_shortening_ordinary_deadline(monkeypatch):
    from hdr_finisher import library_estimates
    from hdr_finisher.library_worker import LibraryWorker
    monkeypatch.setattr(library_estimates,"dimensions",lambda path:(16000,12000))
    assert LibraryWorker.decoder_timeout("giant.jpg")==40
    monkeypatch.setattr(library_estimates,"dimensions",lambda path:(4000,3000))
    assert LibraryWorker.decoder_timeout("ordinary.jpg")==5


def test_decoder_deadline_caps_giant_dng_at_five_minutes(monkeypatch):
    from hdr_finisher import library_estimates
    from hdr_finisher.library_worker import LibraryWorker
    monkeypatch.setattr(library_estimates,"dimensions",lambda path:(30000,10000))
    assert LibraryWorker.decoder_timeout("line.dng")==300
    assert LibraryWorker.decoder_timeout("line.avif")==300


@pytest.mark.parametrize("mode", ["L", "LA", "RGB", "RGBA"])
@pytest.mark.parametrize("profile", ["none", "srgb", "invalid"])
def test_png_direct_boundary_matches_encoded_boundary(tmp_path, mode, profile):
    from io import BytesIO
    from PIL import ImageCms
    from hdr_finisher import loader
    p = tmp_path / "profile-oriented.png"
    image = Image.new("RGB", (17, 13), (101, 153, 207)).convert(mode)
    exif = Image.Exif(); exif[274] = 6
    info = {"exif": exif}
    if profile != "none":
        info["icc_profile"] = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes() if profile == "srgb" else b"invalid-profile"
    image.save(p, **info)
    # Historical Library boundary: VIPS samples/metadata -> PNG -> Pillow.
    # Compare against that boundary, including metadata VIPS rejects/drops.
    import pyvips
    pixels, _ = read(p)
    reduced = Image.fromarray(pixels[..., 0] if pixels.shape[2] == 1 else pixels)
    header = pyvips.Image.new_from_file(str(p), access="sequential")
    stored = {}
    for field, key in [("icc-profile-data", "icc_profile"), ("exif-data", "exif")]:
        if header.get_typeof(field): stored[key] = header.get(field)
    body = BytesIO(); reduced.save(body, format="PNG", **stored); body.seek(0)
    expected, metadata = loader._load_with_pillow(body, encoded_samples=True)
    actual, actual_metadata = png(p)
    np.testing.assert_array_equal(actual, expected)
    for key, value in metadata.items():
        assert actual_metadata[key] == value
    assert actual_metadata["bit_depth"] == "uint8"
    assert (actual_metadata["source_width"], actual_metadata["source_height"]) == (13, 17)


@pytest.mark.parametrize("channels", [1, 3, 4])
def test_png_uint16_keeps_existing_high_byte_and_alpha_boundary(tmp_path, monkeypatch, channels):
    from hdr_finisher import library_reduced
    p = tmp_path / "sixteen.png"
    Image.new("RGB", (17, 13)).save(p)
    pixels = (np.arange(13*17*channels, dtype=np.uint16).reshape(13, 17, channels) * 97)
    monkeypatch.setattr(library_reduced, "read", lambda path: (pixels, (17, 13)))
    actual, metadata = png(p)
    high = (pixels >> 8).astype(np.uint8)
    expected = np.repeat(high, 3, axis=2) if channels == 1 else high[..., :3]
    np.testing.assert_array_equal(actual, expected)
    assert metadata["bit_depth"] == "uint8"
