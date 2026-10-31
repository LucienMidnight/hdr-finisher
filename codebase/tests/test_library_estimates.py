from PIL import Image
import pytest
from hdr_finisher.library_estimates import dimensions, estimate, estimate_pixels


@pytest.mark.parametrize("suffix,rate", [
    (".arw",7),(".cr3",7),(".jpg",23),(".hdr",23),(".png",28),
    (".tif",28),(".dng",28),(".exr",38),(".pfm",38),(".avif",38),
    (".heic",52),(".heif",52),(".jxl",52)])
def test_approved_rates(suffix,rate):
    assert estimate_pixels(suffix,6000,4000) == rate*24_000_000
    assert estimate_pixels(suffix,6000,4000,"cpu") == 25*24_000_000


def test_minimum_and_reduced_jpeg_quick_preview():
    assert estimate_pixels(".jpg",10000,6000,"quick") == 64_000_000
    assert estimate_pixels(".png",10000,6000,"quick") == 23*60_000_000
    assert estimate_pixels(".png",10,10) == 64_000_000


@pytest.mark.parametrize("suffix",[".png",".jpg",".tiff"])
def test_header_dimensions_without_decoding(tmp_path,monkeypatch,suffix):
    path = tmp_path/("source"+suffix)
    Image.new("RGB",(300,200)).save(path)
    monkeypatch.setattr(Image.Image,"load",lambda *args,**kwargs:pytest.fail("pixels decoded during admission"))
    assert dimensions(path) == (300,200)
    assert estimate(path) == 64_000_000


def test_dng_uses_full_source_header_not_thumbnail(tmp_path):
    import numpy as np
    import tifffile
    path = tmp_path/"source.dng"
    with tifffile.TiffWriter(path) as writer:
        writer.write(np.zeros((10,10),dtype="uint8"),subifds=1)
        writer.write(np.zeros((200,300),dtype="uint16"),subfiletype=0)
    assert dimensions(path) == (300,200)


def test_unknown_header_uses_ceiling_runs_alone_and_is_never_floor(tmp_path):
    from hdr_finisher.library_estimates import estimate_details
    from hdr_finisher.library_scheduler import Scheduler
    path = tmp_path/"damaged.jpg"
    path.write_bytes(b"broken header")
    ceiling = 3_000_000_000
    amount, reason = estimate_details(path,ceiling=ceiling)
    assert (amount,reason) == (ceiling,"unknown size")
    scheduler = Scheduler(ceiling)
    scheduler.update(available=20_000_000_000,ram=32_000_000_000)
    job=scheduler.ask("unknown","window",str(path),"source",amount,size_reason=reason)
    assert job.alone and job.granted is not None and not job.floor
    other=scheduler.ask("other","window","small.jpg","source",64_000_000)
    assert other.granted is None
    scheduler.finish("unknown")
    scheduler.update(grade_bytes=4_000_000_000,grade_name="scan.dng")
    waiting=scheduler.ask("unknown2","window",str(path),"source",amount,size_reason=reason)
    assert waiting.granted is None and not waiting.floor and waiting.reason=="paused for Grade"


@pytest.mark.parametrize("suffix,header",[(".hdr",b"#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 200 +X 300\n"),(".pfm",b"PF\n# header comment\n300 200\n-1.0\n")])
def test_hdr_pfm_header_only(tmp_path,suffix,header):
    path=tmp_path/("source"+suffix);path.write_bytes(header)
    assert dimensions(path)==(300,200)


def test_jpegxl_header_only(tmp_path,monkeypatch):
    import imagecodecs
    import numpy as np
    path=tmp_path/"source.jxl";path.write_bytes(imagecodecs.jpegxl_encode(np.zeros((200,300,3),dtype="uint8")))
    monkeypatch.setattr(imagecodecs,"jpegxl_decode",lambda *a,**k:pytest.fail("pixels decoded during header read"))
    assert dimensions(path)==(300,200)


def test_camera_dng_uses_raw_rate_and_linear_dng_uses_linear_rate(tmp_path):
    import numpy as np
    import tifffile
    from hdr_finisher.library_estimates import estimate_details
    camera=tmp_path/"camera.dng";linear=tmp_path/"linear.dng"
    # Header dimensions exceed the minimum without writing decoded-size data.
    for path,photo in [(camera,32803),(linear,34892)]:
        tifffile.imwrite(path,shape=(3000,4000),dtype="uint16",photometric=photo)
    assert estimate_details(camera)[0]==7*12_000_000
    assert estimate_details(linear)[0]==28*12_000_000
