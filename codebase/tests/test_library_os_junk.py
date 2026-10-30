import pytest
from pathlib import Path

from hdr_finisher.library_folders import _walk_photos, scan_folder
from hdr_finisher.media_browser import MediaBrowserStore

# Photos must be at least file_gate.MIN_PHOTO_BYTES to be listed.
PHOTO = bytes([0xFF, 0xD8, 0xFF]) + b"x" * 2048


@pytest.fixture(autouse=True)
def _real_minimum(monkeypatch):
    from hdr_finisher import file_gate
    monkeypatch.setattr(file_gate, "MIN_PHOTO_BYTES", 1024)


def _folder(tmp_path):
    (tmp_path / "IMG_1.JPG").write_bytes(PHOTO)
    # macOS AppleDouble companion: same extension, not an image.
    (tmp_path / "._IMG_1.JPG").write_bytes(b"\x00\x05\x16\x07Mac OS X")
    (tmp_path / "__MACOSX").mkdir()
    (tmp_path / "__MACOSX" / "IMG_2.JPG").write_bytes(PHOTO)
    (tmp_path / "Pesta").mkdir()
    (tmp_path / "Pesta" / "IMG_3.JPG").write_bytes(PHOTO)
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


def test_needs_attention_drops_files_the_library_no_longer_lists(tmp_path):
    from hdr_finisher.library_marks import LibraryMarks
    from hdr_finisher.library_picture_errors import PictureErrors
    root = _folder(tmp_path)
    errors = PictureErrors(LibraryMarks(root))
    for name in ("IMG_1.JPG", "._IMG_1.JPG", "__MACOSX/IMG_2.JPG"):
        path = root / name
        errors.remember(path, ValueError("cannot identify image file"), errors.revision(path))
    assert [Path(r["path"]).name for r in errors.all()] == ["IMG_1.JPG"]
    # The junk rows are removed, not just hidden.
    assert len(errors.marks._query("SELECT path FROM picture_errors")) == 1
