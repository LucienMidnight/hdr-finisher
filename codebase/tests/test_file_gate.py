"""The Library's file gate: which files are listed and read (design section 6.9, edge cases F1-F18)."""
import os
import sqlite3
import sys
import time
from pathlib import Path
from types import SimpleNamespace

import pytest
from PIL import Image

from hdr_finisher import file_gate
from hdr_finisher.file_gate import NotAPhoto, check_contents, detect_format, is_cloud_placeholder, still_copying
from hdr_finisher.library_folders import _walk_photos, folder_tree, scan_folder
from hdr_finisher.media_browser import MediaBrowserStore

WINDOWS = sys.platform == "win32"


@pytest.fixture(autouse=True)
def _real_gate_limits(monkeypatch):
    # conftest relaxes these for other tests' stand-in photos; check the real ones here.
    monkeypatch.setattr(file_gate, "SETTLE_SECONDS", 2.0)
    monkeypatch.setattr(file_gate, "MIN_PHOTO_BYTES", 1024)


def photo(path, size=(64, 48)):
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", size, (120, 90, 60)).save(path, quality=95)
    assert path.stat().st_size >= file_gate.MIN_PHOTO_BYTES or size == (8, 8)
    return path


def library(tmp_path):
    root = tmp_path / "Photos"
    photo(root / "IMG_1.JPG", (400, 300))
    photo(root / "_DSC0001.jpg", (400, 300))          # Sony Adobe RGB names start with "_"
    photo(root / "Trip" / "IMG_2.jpeg", (400, 300))
    # Hidden and temporary names (F1)
    for name in ("._IMG_1.JPG", ".hidden.jpg", "~IMG_1.jpg", ".IMG_1.4f2a.sdr.tmp.jpg"):
        (root / name).write_bytes(b"\xff\xd8\xff" + b"x" * 4096)
    # Trash, snapshot, NAS and metadata folders (F2)
    for folder in ("$RECYCLE.BIN", "System Volume Information", "#recycle", "@Recycle", "@eaDir",
                   "#snapshot", ".snapshot", ".Trash-1000", "__MACOSX", "~tmp", ".thumbnails"):
        photo(root / folder / "IMG_9.jpg", (400, 300))
    # Too small to be a photo (F3), and sidecars (F18)
    (root / "empty.jpg").write_bytes(b"")
    (root / "tiny.jpg").write_bytes(b"\xff\xd8\xff\xe0")
    for name in ("IMG_1.JPG.hdrf", "IMG_1.xmp", "IMG_1.pp3", "IMG_1.dop", "notes.txt"):
        (root / name).write_text("x" * 2048)
    return root


EXPECTED = ["IMG_1.JPG", "IMG_2.jpeg", "_DSC0001.jpg"]


def test_scan_and_index_walk_list_only_real_photos(tmp_path):
    root = library(tmp_path)
    scanned = sorted(p["name"] for p in scan_folder(root)["photos"])
    walked = sorted(p["name"] for p in _walk_photos(root, [], [lambda: False]) if p)
    assert scanned == walked == EXPECTED


def test_folder_tree_and_add_folder_browser_hide_skipped_folders(tmp_path):
    root = library(tmp_path)
    assert [c["name"] for c in folder_tree(root)["children"]] == ["Trip"]
    browser = MediaBrowserStore(tmp_path / "browser")
    listing = browser.list_directory(str(root), "source")
    names = {item["name"] for item in listing["entries"]}
    assert {"Trip", "IMG_1.JPG", "_DSC0001.jpg"} <= names
    assert not names & {"$RECYCLE.BIN", "@eaDir", ".snapshot", "~tmp", ".hidden.jpg", "._IMG_1.JPG", "~IMG_1.jpg"}
    assert browser.folder_peek(str(root))["count"] == 2


@pytest.mark.skipif(not WINDOWS, reason="Windows file attributes")
def test_windows_hidden_and_system_files_and_folders_are_skipped(tmp_path):
    import ctypes
    root = tmp_path / "Photos"
    photo(root / "visible.jpg", (400, 300))
    photo(root / "secret.jpg", (400, 300))
    photo(root / "Private" / "inside.jpg", (400, 300))
    hide = ctypes.windll.kernel32.SetFileAttributesW
    assert hide(str(root / "secret.jpg"), 0x2) and hide(str(root / "Private"), 0x2 | 0x4)
    assert [p["name"] for p in scan_folder(root)["photos"]] == ["visible.jpg"]
    assert [p["name"] for p in _walk_photos(root, [], [lambda: False]) if p] == ["visible.jpg"]


@pytest.mark.skipif(not WINDOWS, reason="Windows junctions")
def test_junction_loops_are_not_followed(tmp_path):
    import _winapi
    root = tmp_path / "Photos"
    photo(root / "Trip" / "IMG_1.jpg", (400, 300))
    _winapi.CreateJunction(str(root), str(root / "Trip" / "loop"))
    _winapi.CreateJunction(str(root / "Trip"), str(root / "elsewhere"))
    assert [p["name"] for p in scan_folder(root)["photos"]] == ["IMG_1.jpg"]
    assert [p["name"] for p in _walk_photos(root, [], [lambda: False]) if p] == ["IMG_1.jpg"]
    assert [c["name"] for c in folder_tree(root)["children"]] == ["Trip"]


def test_unicode_and_case_only_names_are_listed(tmp_path):
    root = tmp_path / "Photos"
    decomposed = "Café.jpg"       # macOS-style decomposed accent (F12)
    photo(root / decomposed, (400, 300))
    photo(root / "Ünïcødé 写真" / "IMG.JPG", (400, 300))
    names = sorted(p["name"] for p in _walk_photos(root, [], [lambda: False]) if p)
    assert names == sorted([decomposed, "IMG.JPG"])


def test_cloud_placeholders_are_listed_but_flagged(tmp_path, monkeypatch):
    from hdr_finisher import library_folders
    root = tmp_path / "Photos"
    photo(root / "local.jpg", (400, 300))
    photo(root / "online.jpg", (900, 700))
    monkeypatch.setattr(library_folders, "is_cloud_placeholder", lambda info: info.st_size == (root / "online.jpg").stat().st_size)
    rows = {p["name"]: p for p in _walk_photos(root, [], [lambda: False]) if p}
    assert rows["online.jpg"].get("cloud") is True and "cloud" not in rows["local.jpg"]


def test_cloud_placeholder_attributes():
    # A real OneDrive online-only file reports ARCHIVE | RECALL_ON_DATA_ACCESS.
    assert is_cloud_placeholder(SimpleNamespace(st_file_attributes=0x400020))
    assert is_cloud_placeholder(SimpleNamespace(st_file_attributes=0x1000))          # offline
    assert is_cloud_placeholder(SimpleNamespace(st_flags=0x40000000))                # macOS dataless
    assert not is_cloud_placeholder(SimpleNamespace(st_file_attributes=0x20))


@pytest.mark.parametrize("header,found", [
    (b"\xff\xd8\xff\xe1", "jpeg"), (b"\x89PNG\r\n\x1a\n", "png"), (b"II*\x00", "tiff"), (b"MM\x00*", "tiff"),
    (b"IIRO", "orf"), (b"IIU\x00", "rw2"), (b"FUJIFILMCCD-RAW 0201", "raf"),
    (b"\x00\x00\x00\x18ftypcrx ", "cr3"), (b"\x00\x00\x00\x18ftypheic", "isobmff"), (b"\x00\x00\x00\x1cftypavif", "isobmff"),
    (b"\xff\x0a", "jxl"), (b"\x00\x00\x00\x0cJXL \r\n\x87\n", "jxl"), (b"v/1\x01", "exr"),
    (b"#?RADIANCE\n", "hdr"), (b"PF\n6000 4000\n", "pfm"),
    (b"<!DOCTYPE html>", None), (b"\x00\x05\x16\x07Mac OS X", None), (b"", None),
])
def test_detect_format(header, found):
    assert detect_format(header + b"\x00" * 16) == found


def test_a_web_page_saved_as_jpg_is_not_a_photo(tmp_path):
    page = tmp_path / "IMG_1.jpg"
    page.write_bytes(b"<!DOCTYPE html><html>Access denied</html>" + b" " * 2048)   # F6
    with pytest.raises(NotAPhoto):
        check_contents(page)
    heic_named_jpg = tmp_path / "IMG_2.jpg"
    heic_named_jpg.write_bytes(b"\x00\x00\x00\x18ftypheic" + b"\x00" * 2048)        # F5: allowed
    assert check_contents(heic_named_jpg) == "isobmff"


def test_still_copying(monkeypatch):
    monkeypatch.setattr(file_gate, "SETTLE_SECONDS", 2.0)
    now = time.time()
    assert still_copying(SimpleNamespace(st_mtime=now - 0.5), now)
    assert not still_copying(SimpleNamespace(st_mtime=now - 5), now)
    assert not still_copying(SimpleNamespace(st_mtime=now + 3600), now)     # camera clock ahead: not "copying" forever


def test_index_rows_from_before_the_gate_stay_hidden():
    from hdr_finisher.library_folder_stream import NOT_JUNK, junk
    sep = os.sep
    prefix = f"D:{sep}Photos{sep}"
    rows = [prefix + p.replace("/", sep) for p in (
        "IMG_1.JPG", "Trip/IMG_2.jpg", "_DSC1.ARW", "._IMG_1.JPG", ".hidden/IMG.jpg", "~IMG.jpg",
        "$RECYCLE.BIN/IMG.jpg", "System Volume Information/IMG.jpg", "#recycle/IMG.jpg", "@eaDir/IMG.jpg",
        "__MACOSX/IMG.jpg", "Trip/v1.2 edits/IMG_3.jpg")]
    db = sqlite3.connect(":memory:")
    db.execute("CREATE TABLE files(path TEXT)")
    db.executemany("INSERT INTO files VALUES (?)", [(r,) for r in rows])
    kept = [r[0] for r in db.execute("SELECT path FROM files WHERE path>=?" + NOT_JUNK + " ORDER BY path", (prefix, *junk(prefix)))]
    assert sorted(os.path.relpath(p, prefix).replace(sep, "/") for p in kept) == sorted(
        ["IMG_1.JPG", "Trip/IMG_2.jpg", "_DSC1.ARW", "Trip/v1.2 edits/IMG_3.jpg"])
    # A folder pinned inside a dot-folder still lists its own photos.
    pinned = f"C:{sep}Users{sep}me{sep}.photos{sep}"
    db.execute("INSERT INTO files VALUES (?)", (pinned + "IMG.jpg",))
    assert db.execute("SELECT count(*) FROM files WHERE path>=?" + NOT_JUNK, (pinned, *junk(pinned))).fetchone()[0] >= 1


def _api(root):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from hdr_finisher.library_api import create_library_router
    from hdr_finisher.sessions import SessionStore

    class Helper:
        def status(self):
            return {"running": True, "paused": False, "pending": 0, "failure": None}

        def submit_library(self, *args, **kwargs):
            raise AssertionError("No decoder may start for these files")

    app = FastAPI()
    app.include_router(create_library_router(Helper(), MediaBrowserStore(root / "browser"), SessionStore()))
    return TestClient(app)


def _settled(path):
    old = time.time() - 60
    os.utime(path, (old, old))
    return path


def test_not_a_photo_is_remembered_once_and_never_decoded(tmp_path):
    page = tmp_path / "IMG_1.jpg"
    page.write_bytes(b"<!DOCTYPE html><html>Access denied</html>" + b" " * 2048)
    _settled(page)
    api = _api(tmp_path / "app")
    response = api.post("/api/library/live-scene", json={"path": str(page)})
    assert response.status_code == 422 and response.json()["library_error"]["reason"].startswith("Not a valid photo")
    errors = api.get("/api/library/health").json()["picture_errors"]
    assert [Path(e["path"]).name for e in errors] == ["IMG_1.jpg"]


def test_a_file_still_being_copied_waits(tmp_path, monkeypatch):
    monkeypatch.setattr(file_gate, "SETTLE_SECONDS", 2.0)
    fresh = photo(tmp_path / "IMG_1.jpg", (400, 300))           # modified just now
    api = _api(tmp_path / "app")
    response = api.post("/api/library/live-scene", json={"path": str(fresh)})
    assert response.status_code == 202 and response.json()["waiting"] == "copying"
    assert api.get("/api/library/health").json()["picture_errors"] == []


def test_cloud_files_are_read_only_for_the_opened_photo(tmp_path, monkeypatch):
    from hdr_finisher import library_api
    online = _settled(photo(tmp_path / "IMG_1.jpg", (400, 300)))
    monkeypatch.setattr(library_api, "is_cloud_placeholder", lambda info: True)
    api = _api(tmp_path / "app")
    assert api.post("/api/library/live-plan", json={"path": str(online)}).json()["cloud_only"] is True
    grid = api.post("/api/library/live-scene", json={"path": str(online), "priority": 10})
    assert grid.status_code == 409 and grid.json()["cloud_only"] is True
    assert api.post("/api/library/preview", json={"path": str(online)}).status_code == 204
    assert api.post("/api/library/fallback-picture", json={"path": str(online), "priority": 30}).status_code == 409
    assert api.get("/api/library/health").json()["picture_errors"] == []


@pytest.mark.parametrize("name,mode", [("cmyk.jpg", "CMYK"), ("gray.jpg", "L"), ("palette.png", "P"),
    ("bilevel.png", "1"), ("rgba.png", "RGBA"), ("animated.png", "RGB")])
def test_unusual_jpeg_and_png_variants_open(tmp_path, name, mode):
    # F10: supported extension, less common variant. Each opens on the GPU route.
    from hdr_finisher import library_rgb
    from hdr_finisher.library_live import recipe
    image = Image.new("RGB", (400, 300), (40, 160, 220)).convert(mode)
    path = tmp_path / name
    extra = dict(save_all=True, append_images=[image.rotate(180)], duration=100) if name == "animated.png" else {}
    image.save(path, **extra)
    header, _ = library_rgb.decoded(path, recipe(None))
    assert (header["width"], header["height"]) == (400, 300)


def test_a_jpeg_named_heic_decodes_as_jpeg(tmp_path):
    # F5, a real case: iPhone edited copies (IMG_E….HEIC) are often JPEGs.
    from hdr_finisher import library_rgb, loader
    from hdr_finisher.file_gate import decode_suffix
    from hdr_finisher.library_live import recipe
    path = tmp_path / "IMG_E0001.HEIC"
    Image.new("RGB", (400, 300), (200, 120, 90)).save(path, format="JPEG", quality=95)
    assert decode_suffix(path) == ".jpg"
    header, _ = library_rgb.decoded(path, recipe(None))
    assert (header["width"], header["height"]) == (400, 300)
    assert loader.load_image(path)[0].shape[:2] == (300, 400)
    real = tmp_path / "real.jpg"
    Image.new("RGB", (64, 48)).save(real)
    assert decode_suffix(real) == ".jpg" and decode_suffix(tmp_path / "x.arw") == ".arw"
