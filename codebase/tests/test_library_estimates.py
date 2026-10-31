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
