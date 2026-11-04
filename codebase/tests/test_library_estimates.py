from PIL import Image
import pytest
from hdr_finisher.library_estimates import dimensions, estimate, estimate_pixels


@pytest.mark.parametrize("suffix,rate", [
    (".arw",7),(".cr3",7),(".jpg",23),(".hdr",23),(".png",28),
    (".tif",28),(".dng",28),(".exr",38),(".pfm",38),(".avif",56),
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


@pytest.mark.parametrize("suffix,rate", [(".jpg",6),(".png",8),(".tiff",6),(".dng",6)])
def test_reduced_source_rates_only_for_qualified_large_library_routes(monkeypatch, tmp_path, suffix, rate):
    from hdr_finisher import library_estimates as estimates
    monkeypatch.setattr(estimates,"dimensions",lambda path:(20000,10000))
    monkeypatch.setattr(estimates,"reduced_rate",lambda path:rate)
    path=tmp_path/("source"+suffix)
    if suffix==".dng":
        import tifffile
        tifffile.imwrite(path,shape=(20,30),dtype="uint16",photometric=34892)
    assert estimates.estimate_details(path)[0] == rate*200_000_000
    assert estimates.estimate_details(path,edge=100000)[0] == estimates.RATES[suffix]*200_000_000
    assert estimates.estimate_details(path,kind="cpu")[0] == 25*200_000_000
    monkeypatch.setattr(estimates,"reduced_rate",lambda path:None)
    assert estimates.estimate_details(path)[0] == estimates.RATES[suffix]*200_000_000


def test_reduced_jpeg_qualification_keeps_gainmap_rate(tmp_path, monkeypatch):
    from hdr_finisher.library_estimates import reduced_rate
    from hdr_finisher import loader
    path=tmp_path/"photo.jpg"
    Image.new("RGB",(16,12)).save(path)
    assert reduced_rate(path)==6
    assert reduced_rate(str(path))==6
    monkeypatch.setattr(loader,"is_ultrahdr_jpeg",lambda path:True)
    assert reduced_rate(path) is None


@pytest.mark.parametrize("suffix", [".jpg", ".png", ".tiff"])
@pytest.mark.parametrize("orientation", [1, 3, 5, 6, 7, 8])
def test_gpu_plan_matches_decoder_orientation_without_decoding(tmp_path, monkeypatch, suffix, orientation):
    from hdr_finisher.library_estimates import gpu_metadata
    path = tmp_path / ("portrait" + suffix)
    exif = Image.Exif()
    exif[274] = orientation
    Image.new("RGB", (300, 200)).save(path, exif=exif)
    monkeypatch.setattr(Image.Image, "load", lambda *a, **k: pytest.fail("admission decoded pixels"))
    meta = gpu_metadata(path, edge=640)
    expected = (200, 300) if suffix != ".tiff" and orientation >= 5 else (300, 200)
    assert (meta["width"], meta["height"]) == expected


def test_gpu_plan_retains_raw_sensor_geometry_and_libraw_flip(tmp_path, monkeypatch):
    from hdr_finisher import library_estimates
    from types import SimpleNamespace
    import rawpy
    class Header:
        sizes = SimpleNamespace(raw_width=8000, raw_height=5320, flip=5)
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def open_file(self, path): pass
    monkeypatch.setattr(library_estimates, "dimensions", lambda p: (7952, 5304))
    monkeypatch.setattr(rawpy, "RawPy", Header)
    monkeypatch.setattr("hdr_finisher.file_gate.decode_suffix", lambda p: ".arw")
    meta = library_estimates.gpu_metadata(tmp_path / "rotated.arw", edge=640)
    assert (meta["width"], meta["height"], meta["flip"]) == (8000, 5320, 5)


def test_large_jpegxl_container_header_does_not_need_entire_box(tmp_path, monkeypatch):
    import imagecodecs, struct
    import numpy as np
    payload=imagecodecs.jpegxl_encode(np.zeros((200,300,3),dtype="uint8"))
    assert payload.startswith(b"\xff\x0a")
    path=tmp_path/"large.jxl"
    path.write_bytes(b"\x00\x00\x00\x0cJXL \r\n\x87\n" + struct.pack(">I4s", 2_000_008, b"jxlc") + payload + bytes(2_000_000-len(payload)))
    monkeypatch.setattr(imagecodecs,"jpegxl_decode",lambda *a,**k:pytest.fail("header read decoded pixels"))
    assert dimensions(path)==(300,200)


def test_exr_header_does_not_require_context_manager(tmp_path):
    import OpenEXR, numpy as np
    path=tmp_path/"source.exr"
    OpenEXR.File({}, {"RGB":np.zeros((200,300,3),dtype=np.float32)}).write(str(path))
    assert dimensions(path)==(300,200)


def test_large_jpeg_gpu_plan_matches_dct_samples(tmp_path, monkeypatch):
    from hdr_finisher.library_estimates import gpu_metadata
    from PIL import JpegImagePlugin
    # Header dimensions alone exercise draft's DCT choice without a giant raster.
    path=tmp_path/"large.jpg"
    Image.new("RGB",(16,12)).save(path)
    original=JpegImagePlugin.JpegImageFile._open
    def header(image):
        original(image)
        image._size=(16000,12000)
    monkeypatch.setattr(JpegImagePlugin.JpegImageFile,"_open",header)
    monkeypatch.setattr(Image.Image,"load",lambda *a,**k:pytest.fail("planning decoded pixels"))
    plan=gpu_metadata(path,edge=640)
    assert (plan["width"],plan["height"])==(8000,6000)


@pytest.mark.parametrize("width,height", [(8000,6000),(20000,10000)])
def test_rgb_correction_dng_reserves_existing_dng_rate_without_decoding(tmp_path, monkeypatch, width, height):
    import tifffile
    from hdr_finisher import library_estimates, linear_dng
    from test_library_dng import inspection
    path=tmp_path/"corrected.dng"
    tifffile.imwrite(path,shape=(20,30),dtype="uint16",photometric=32803)
    monkeypatch.setattr(library_estimates,"dimensions",lambda path:(width,height))
    monkeypatch.setattr(linear_dng,"inspect_dng",lambda path:inspection())
    monkeypatch.setattr(tifffile.TiffPage,"asarray",lambda *a,**k:pytest.fail("admission decoded pixels"))
    assert library_estimates.estimate_details(path)==(28*width*height, "")
    assert library_estimates.estimate_details(path,kind="cpu")== (25*width*height, "")


def test_xtrans_cpu_uses_approved_exception_without_decoding(tmp_path, monkeypatch):
    import struct
    import rawpy
    from hdr_finisher import library_estimates, library_gpu_raw
    path = tmp_path / "fuji.raf"
    header = bytearray(100)
    header[:16] = b"FUJIFILMCCD-RAW "
    data = struct.pack(">IHH", 1, 0x0131, 36) + bytes([0, 1, 2] * 12)
    header[92:100] = struct.pack(">II", 100, len(data))
    path.write_bytes(header + data)
    monkeypatch.setattr(library_estimates, "dimensions", lambda path: (4992, 3296))
    monkeypatch.setattr(rawpy, "imread", lambda *a, **k: pytest.fail("admission unpacked RAW"))
    assert library_gpu_raw.xtrans_cpu(path)
    assert library_estimates.estimate_details(path, "cpu")[0] == 740_413_440
    assert library_estimates.estimate_details(path, "quick")[0] != 740_413_440
    data = data[:-36] + bytes(36)
    path.write_bytes(header + data)
    assert not library_gpu_raw.xtrans_cpu(path)
    assert library_estimates.estimate_details(path, "cpu")[0] == 411_340_800


@pytest.mark.parametrize("pixels", [14_000_000,18_000_000,42_000_000])
@pytest.mark.parametrize("kind", ["source","cpu"])
def test_measured_gain_map_avif_rate(pixels,kind):
    assert estimate_pixels(".avif",pixels,1,kind,gain_map=True)==50*pixels


def test_avif_gain_map_does_not_change_primary_only_quick_rate():
    assert estimate_pixels(".avif",6000,4000,"quick",gain_map=True)==23*24_000_000


@pytest.mark.parametrize("gain_map,rate",[(True,50),(False,56)])
def test_avif_admission_reads_headers_without_decoding(monkeypatch,gain_map,rate):
    from hdr_finisher import avif_info, library_estimates
    monkeypatch.setattr(avif_info,"inspect_avif",lambda path:dict(resolution="6000x4000",gain_map_present=gain_map))
    monkeypatch.setattr(library_estimates,"dimensions",lambda path:pytest.fail("AVIF pixels opened for admission"))
    assert library_estimates.estimate_details("header.avif")== (rate*24_000_000,"")


def test_unknown_avif_header_keeps_unknown_size_gate(monkeypatch):
    from hdr_finisher import avif_info, library_estimates
    def invalid(path):raise ValueError("bad header")
    monkeypatch.setattr(avif_info,"inspect_avif",invalid)
    assert library_estimates.estimate_details("bad.avif",ceiling=4_000_000_000)==(4_000_000_000,"unknown size")


def test_two_measured_avifs_fit_default_budget_without_blocking_camera_preview():
    from hdr_finisher.library_scheduler import Scheduler
    scheduler=Scheduler(4_000_000_000)
    scheduler.update(available=20_000_000_000,ram=32_000_000_000,total=1_850_000_000)
    first=scheduler.ask("avif-a","library","a.avif","source",estimate_pixels(".avif",14_000_000,1,gain_map=True),cls="eventually")
    second=scheduler.ask("avif-b","library","b.avif","source",estimate_pixels(".avif",18_000_000,1,gain_map=True),cls="eventually")
    camera=scheduler.ask("camera","library","camera.arw","quick",64_000_000)
    assert first.granted is not None and second.granted is not None and camera.granted is not None


@pytest.mark.parametrize("preview,expected", [(True,64_000_000),(False,978_375_840)])
def test_dxo_subifd_quick_estimate_is_header_only(tmp_path, monkeypatch, preview, expected):
    import struct
    import tifffile
    import rawpy
    from hdr_finisher.library_estimates import estimate_details
    # Tiny TIFF headers only: IFD0 RGB thumbnail, LinearRaw SubIFD and optional
    # full-size YCbCr/JPEG SubIFD. No IFD1, JPEG body or RAW raster is present.
    path = tmp_path / "dxo.dng"
    def ifd(entries):
        return struct.pack("<H",len(entries)) + b"".join(
            struct.pack("<HHII",tag,kind,count,value) for tag,kind,count,value in entries
        ) + struct.pack("<I",0)
    def page(width,height,photo,compression,extra=()):
        return [(256,4,1,width),(257,4,1,height),(258,3,1,8),
                (259,3,1,compression),(262,3,1,photo),*extra]
    root_size = 2+6*12+4
    raw_offset = 8+root_size
    jpeg_offset = raw_offset+2+5*12+4
    offsets_offset = jpeg_offset+2+5*12+4
    sub = (330,13,2,offsets_offset) if preview else (330,13,1,raw_offset)
    body = b"II"+struct.pack("<HI",42,8)+ifd(page(250,165,2,1,[sub]))
    body += ifd(page(8020,5304,34892,7))
    if preview:
        body += ifd(page(8020,5304,6,7))+struct.pack("<II",raw_offset,jpeg_offset)
    path.write_bytes(body)
    monkeypatch.setattr(tifffile.TiffPage,"asarray",lambda *a,**k:pytest.fail("decoded TIFF pixels"))
    monkeypatch.setattr(rawpy,"RawPy",lambda *a,**k:pytest.fail("opened RAW during admission"))
    monkeypatch.setattr(Image.Image,"load",lambda *a,**k:pytest.fail("decoded JPEG pixels"))
    assert estimate_details(path,"quick",edge=640) == (expected, "")
    assert estimate_details(path,"quick",edge=2560) == ((244_593_960 if preview else expected), "")
    assert estimate_details(path,"cpu") == (25*8020*5304, "")
