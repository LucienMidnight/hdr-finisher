from io import BytesIO
from pathlib import Path
import struct
import pytest
from hdr_finisher.library_embedded_jpeg import camera_jpeg_header
from hdr_finisher.library_estimates import estimate_details


@pytest.mark.parametrize('name', ['DSCF6495.RAF', 'IMG_7723.CR3', 'P1010004.ORF', 'P1010300.ORF', 'P1150601.RW2'])
def test_preview_header_matches_the_jpeg_libraw_actually_extracts(name):
    import rawpy
    from PIL import Image
    path = Path(__file__).resolve().parents[1] / 'output/test-photos/library-mixed-v1-run' / name
    if not path.exists():
        pytest.skip('Mixed v1 fixture required: ' + name)
    with rawpy.RawPy() as raw:
        raw.open_file(str(path))
        thumb = raw.extract_thumb()
        assert thumb.format == rawpy.ThumbFormat.JPEG
        expected = Image.open(BytesIO(thumb.data)).size
    assert camera_jpeg_header(path) == expected
    assert estimate_details(path, 'quick', edge=640) == (64_000_000, '')


def test_raf_header_seeks_over_metadata_and_never_reads_jpeg_pixels(tmp_path, monkeypatch):
    # APP1 is skipped, then only the SOF header is read, never the scan payload.
    sof = b'\xff\xc0' + struct.pack('>HBHHB', 17, 8, 1280, 1920, 3) + bytes(9)
    jpeg = b'\xff\xd8\xff\xe1' + struct.pack('>H', 202) + bytes(200) + sof + b'\xff\xda' + bytes(100)
    header = bytearray(148)
    header[:16] = b'FUJIFILMCCD-RAW '
    struct.pack_into('>II', header, 84, len(header), len(jpeg))
    body = bytes(header) + jpeg
    path = tmp_path / 'photo.raf'
    path.write_bytes(body)
    entropy = len(header) + len(jpeg) - 102
    class Reader(BytesIO):
        def read(self, count=-1):
            assert 0 <= count <= 16
            assert self.tell() + count <= entropy
            return super().read(count)
    original = Path.open
    monkeypatch.setattr(Path, 'open', lambda self, *a, **k: Reader(body) if self == path else original(self, *a, **k))
    assert camera_jpeg_header(path) == (1920, 1280)


@pytest.mark.parametrize('suffix', ['raf', 'cr3', 'rw2', 'orf'])
def test_truncated_or_out_of_file_preview_headers_do_not_qualify(tmp_path, suffix):
    path = tmp_path / ('broken.' + suffix)
    path.write_bytes(b'IIRO' + struct.pack('<I', 0xffffffff))
    assert camera_jpeg_header(path) is None


def test_lossless_sensor_jpeg_is_not_mistaken_for_a_rendered_preview(tmp_path):
    jpeg = b'\xff\xd8\xff\xc3' + struct.pack('>HBHHB', 11, 16, 4000, 6000, 1) + bytes(3)
    header = bytearray(148)
    header[:16] = b'FUJIFILMCCD-RAW '
    struct.pack_into('>II', header, 84, len(header), len(jpeg))
    path = tmp_path / 'sensor.raf'
    path.write_bytes(header + jpeg)
    assert camera_jpeg_header(path) is None
