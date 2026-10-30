from hdr_finisher.library_folders import _walk_photos, scan_folder
from hdr_finisher.media_browser import MediaBrowserStore


def _folder(tmp_path):
    (tmp_path / "IMG_1.JPG").write_bytes(b"photo")
    # macOS AppleDouble companion: same extension, not an image.
    (tmp_path / "._IMG_1.JPG").write_bytes(b"\x00\x05\x16\x07Mac OS X")
    (tmp_path / "__MACOSX").mkdir()
    (tmp_path / "__MACOSX" / "IMG_2.JPG").write_bytes(b"copy")
    (tmp_path / "Pesta").mkdir()
    (tmp_path / "Pesta" / "IMG_3.JPG").write_bytes(b"photo")
    (tmp_path / "Pesta" / "._IMG_3.JPG").write_bytes(b"\x00\x05\x16\x07")
    return tmp_path


def test_scan_and_walk_list_photos_but_not_os_junk(tmp_path):
    root = _folder(tmp_path)
    scanned = sorted(p["name"] for p in scan_folder(root)["photos"])
    walked = sorted(p["name"] for p in _walk_photos(root, [], [lambda: False]) if p)
    assert scanned == walked == ["IMG_1.JPG", "IMG_3.JPG"]


def test_add_folder_peek_counts_only_photos(tmp_path):
    root = _folder(tmp_path)
    browser = MediaBrowserStore.__new__(MediaBrowserStore)
    assert browser.folder_peek(str(root))["count"] == 1
