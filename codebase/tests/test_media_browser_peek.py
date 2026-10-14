from concurrent.futures import CancelledError
from threading import Event
from io import BytesIO
import struct

import numpy as np
import pytest
from PIL import Image

from hdr_finisher import media_browser as media


def test_peek_counts_direct_photos_and_bounds_candidates_without_decoding(tmp_path, monkeypatch):
    for i in range(30):
        (tmp_path / f"photo-{i}.arw").write_bytes(b"raw stand-in")
    (tmp_path / "photo.png").write_bytes(b"png stand-in")
    (tmp_path / "notes.txt").write_text("ignored")
    (tmp_path / "nested").mkdir()
    (tmp_path / "nested" / "child.arw").write_bytes(b"nested")
    monkeypatch.setattr(media, "_read_thumbnail_source", lambda *a, **k: pytest.fail("Peek decoded a photo"))
    result = media.MediaBrowserStore(tmp_path / "cache").folder_peek(str(tmp_path))
    assert result["count"] == 31
    assert result["formats"] == ["ARW", "PNG"]
    assert len(result["samples"]) == 12
    assert not (tmp_path / "cache").exists()


def test_peek_stops_when_cancelled(tmp_path):
    (tmp_path / "photo.arw").touch()
    cancelled = Event()
    cancelled.set()
    with pytest.raises(CancelledError):
        media.MediaBrowserStore(tmp_path / "cache").folder_peek(str(tmp_path), cancel_event=cancelled)


def test_embedded_only_never_falls_back_to_source_decode(tmp_path, monkeypatch):
    source = tmp_path / "photo.png"
    Image.new("RGB", (20, 10)).save(source)
    monkeypatch.setattr(media, "_read_thumbnail_source", lambda *a, **k: pytest.fail("Peek used source pixels"))
    browser = media.MediaBrowserStore(tmp_path / "cache")
    with pytest.raises(media.MediaBrowserError, match="No embedded JPEG"):
        browser.thumbnail(str(source), embedded_only=True)
    assert not list(browser.thumbnail_root.glob("*.jpg"))


def test_generated_thumbnail_and_embedded_thumbnail_have_separate_keys(tmp_path, monkeypatch):
    source = tmp_path / "photo.png"
    Image.new("RGB", (20, 10), "red").save(source)
    browser = media.MediaBrowserStore(tmp_path / "cache")
    generated = browser.thumbnail(str(source))
    monkeypatch.setattr(media, "_read_embedded_thumbnail", lambda path: np.zeros((10, 20, 3), dtype=np.uint8))
    embedded = browser.thumbnail(str(source), embedded_only=True)
    assert generated != embedded
    assert generated.is_file() and embedded.is_file()


def test_thumbnail_cleanup_keeps_only_512_temporary_files(tmp_path):
    browser = media.MediaBrowserStore(tmp_path / "cache")
    browser.thumbnail_root.mkdir(parents=True)
    for i in range(514):
        (browser.thumbnail_root / f"{i}.jpg").write_bytes(b"temporary")
    browser._prune_thumbnails(512)
    assert len(list(browser.thumbnail_root.glob("*.jpg"))) == 512


def test_camera_jpeg_is_used_instead_of_the_source_pixels(tmp_path):
    camera = BytesIO()
    Image.new("RGB", (32, 16), "blue").save(camera, format="JPEG")
    jpeg = camera.getvalue()
    # EXIF IFD0 points to IFD1 with JPEG offset/length; no source decode needed.
    tiff = b"II" + struct.pack("<HI", 42, 8) + struct.pack("<HI", 0, 14)
    tiff += struct.pack("<H", 2)
    tiff += struct.pack("<HHII", 513, 4, 1, 44)
    tiff += struct.pack("<HHII", 514, 4, 1, len(jpeg)) + struct.pack("<I", 0) + jpeg
    source = tmp_path / "camera.jpg"
    Image.new("RGB", (100, 100), "red").save(source, exif=b"Exif\0\0" + tiff)
    browser = media.MediaBrowserStore(tmp_path / "cache")
    for embedded_only in (True, False):
        output = browser.thumbnail(str(source), embedded_only=embedded_only)
        with Image.open(output) as image:
            assert image.width == 32 and image.height == 16
            pixel = image.getpixel((10, 10))
            assert pixel[2] > 240 and pixel[0] < 10
