"""Tag management, albums and the Library index, on temporary copies only."""
import json
import time

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from hdr_finisher.library_api import create_library_router
from hdr_finisher.library_index import LibraryIndex
from hdr_finisher.library_marks import LibraryMarks, MarkChange, NameTaken
from hdr_finisher.library_metadata import FACT_FIELDS
from hdr_finisher.library_pictures import SIDECAR_SUFFIX
from hdr_finisher.library_worker import LibraryWorker
from hdr_finisher.media_browser import MediaBrowserStore


def photo(root, name="photo.png"):
    source = root / name
    source.parent.mkdir(parents=True, exist_ok=True)
    source.write_bytes(b"original photo bytes")
    return source


def document(source):
    return json.loads(source.with_name(source.name + SIDECAR_SUFFIX).read_text(encoding="utf-8"))


def tagged(tmp_path):
    sources = [photo(tmp_path, f"{name}.png") for name in ("one", "two", "three")]
    store = LibraryMarks(tmp_path / "app")
    store.change(sources[:2], MarkChange(add_tag="Holiday"))
    store.writer.drain()  # Files catch up separately from the command.
    store.change(sources[1:], MarkChange(add_tag="Beach"))
    store.writer.drain()  # Files catch up separately from the command.
    return store, sources


def counts(store):
    return {row["tag"]: row["count"] for row in store.tags(limit=None)}


def test_tag_rename_reaches_every_photo_and_undoes_as_one_step(tmp_path):
    store, sources = tagged(tmp_path)
    result = store.tag_rename("holiday", "Trips")
    store.writer.drain()  # Files catch up separately from the command.
    assert result["changed"] == 2 and result["offline"] == 0
    assert document(sources[0])["marks"]["tags"] == ["Trips"]
    assert document(sources[1])["marks"]["tags"] == ["Beach", "Trips"]
    assert counts(store) == {"Trips": 2, "Beach": 2}
    store.undo()
    store.writer.drain()  # Files catch up separately from the command.
    assert document(sources[0])["marks"]["tags"] == ["Holiday"]
    assert counts(store) == {"Holiday": 2, "Beach": 2}
    assert all(source.read_bytes() == b"original photo bytes" for source in sources)


def test_rename_to_existing_tag_stops_until_merge_is_confirmed(tmp_path):
    store, sources = tagged(tmp_path)
    with pytest.raises(NameTaken):
        store.tag_rename("Holiday", "beach")
        store.writer.drain()  # Files catch up separately from the command.
    assert counts(store) == {"Holiday": 2, "Beach": 2}
    store.tag_rename("Holiday", "beach", merge=True)
    store.writer.drain()  # Files catch up separately from the command.
    assert counts(store) == {"Beach": 3}  # The existing spelling wins.
    assert document(sources[0])["marks"]["tags"] == ["Beach"]
    assert document(sources[1])["marks"]["tags"] == ["Beach"]
    store.tag_rename("beach", "Seaside")
    store.writer.drain()  # Files catch up separately from the command.
    assert counts(store) == {"Seaside": 3}


def test_merge_remove_and_new_tag(tmp_path):
    store, sources = tagged(tmp_path)
    store.tag_create("Portfolio")
    store.writer.drain()  # Files catch up separately from the command.
    assert counts(store)["Portfolio"] == 0
    with pytest.raises(ValueError):
        store.tag_create("portfolio")
        store.writer.drain()  # Files catch up separately from the command.
    store.tag_merge(["Holiday", "Beach"], "Beach")
    store.writer.drain()  # Files catch up separately from the command.
    assert counts(store) == {"Beach": 3, "Portfolio": 0}
    store.tag_remove(["Beach", "Portfolio"])
    store.writer.drain()  # Files catch up separately from the command.
    assert counts(store) == {}
    assert all(document(source)["marks"]["tags"] == [] for source in sources)
    store.undo()
    store.writer.drain()  # Files catch up separately from the command.
    assert counts(store) == {"Beach": 3, "Portfolio": 0}
    store.undo()
    store.writer.drain()  # Files catch up separately from the command.
    assert counts(store) == {"Holiday": 2, "Beach": 2, "Portfolio": 0}


def test_tag_command_leaves_unconnected_photos_and_says_so(tmp_path):
    store, sources = tagged(tmp_path)
    sources[0].rename(tmp_path / "moved-away.png")  # Its drive is "unplugged".
    result = store.tag_rename("Holiday", "Trips")
    store.writer.drain()  # Files catch up separately from the command.
    assert result["changed"] == 1 and result["offline"] == 1
    assert "not connected" in result["warnings"][-1]
    assert counts(store) == {"Holiday": 1, "Trips": 1, "Beach": 2}


def test_unreadable_settings_file_stops_a_tag_command_before_any_write(tmp_path):
    store, sources = tagged(tmp_path)
    broken = sources[1].with_name(sources[1].name + SIDECAR_SUFFIX)
    broken.write_text("{ not json")
    with pytest.raises(ValueError, match="left untouched"):
        store.tag_remove(["Holiday"])
        store.writer.drain()  # Files catch up separately from the command.
    assert document(sources[0])["marks"]["tags"] == ["Holiday"]
    assert broken.read_text() == "{ not json"


def test_albums_are_written_to_settings_files_and_rebuilt_from_them(tmp_path):
    sources = [photo(tmp_path, f"{name}.png") for name in ("one", "two", "three")]
    store = LibraryMarks(tmp_path / "app")
    assert store.album_create("Empty")["changed"] == 0
    store.writer.drain()  # Files catch up separately from the command.
    assert store.album_create("Best of 2026", sources[:2])["changed"] == 2
    store.writer.drain()  # Files catch up separately from the command.
    with pytest.raises(ValueError, match="already exists"):
        store.album_create("best OF 2026")
        store.writer.drain()  # Files catch up separately from the command.
    assert store.albums() == [{"name": "Best of 2026", "count": 2}, {"name": "Empty", "count": 0}]
    saved = document(sources[0])
    assert saved["albums"] == ["Best of 2026"] and saved["marks"]["rating"] == 0
    assert store.album_change("Best of 2026", sources[1:], True)["changed"] == 1
    store.writer.drain()  # Files catch up separately from the command.
    assert store.album_change("Best of 2026", sources[:1], False)["changed"] == 1
    store.writer.drain()  # Files catch up separately from the command.
    assert document(sources[0])["albums"] == []
    assert sorted(store.album_paths("best of 2026")) == sorted(str(source) for source in sources[1:])
    # Marks and album membership do not disturb each other.
    store.change(sources[1:2], MarkChange(rating=4))
    store.writer.drain()  # Files catch up separately from the command.
    assert document(sources[1]) | {} == {**document(sources[1]), "albums": ["Best of 2026"]}
    assert store.read(sources[1:2])["photos"][0]["albums"] == ["Best of 2026"]
    # A lost database comes back from the settings files.
    store.database.unlink()
    rebuilt = LibraryMarks(tmp_path / "app")
    rebuilt.read(sources)
    assert rebuilt.albums() == [{"name": "Best of 2026", "count": 2}]
    assert all(source.read_bytes() == b"original photo bytes" for source in sources)


def test_album_rename_delete_and_undo(tmp_path):
    sources = [photo(tmp_path, f"{name}.png") for name in ("one", "two")]
    store = LibraryMarks(tmp_path / "app")
    store.album_create("Family", sources)
    store.writer.drain()  # Files catch up separately from the command.
    store.album_create("Print")
    store.writer.drain()  # Files catch up separately from the command.
    with pytest.raises(ValueError, match="Nothing was renamed"):
        store.album_rename("Family", "print")
        store.writer.drain()  # Files catch up separately from the command.
    store.album_rename("Family", "Family 2026")
    store.writer.drain()  # Files catch up separately from the command.
    assert document(sources[0])["albums"] == ["Family 2026"]
    assert [album["name"] for album in store.albums()] == ["Family 2026", "Print"]
    store.album_delete("Family 2026")
    store.writer.drain()  # Files catch up separately from the command.
    assert store.albums() == [{"name": "Print", "count": 0}]
    assert document(sources[1])["albums"] == []
    store.undo()
    store.writer.drain()  # Files catch up separately from the command.
    assert store.albums() == [{"name": "Family 2026", "count": 2}, {"name": "Print", "count": 0}]
    store.undo()
    store.writer.drain()  # Files catch up separately from the command.
    assert document(sources[0])["albums"] == ["Family"]
    with pytest.raises(ValueError, match="no longer"):
        store.album_change("Missing", sources, True)
        store.writer.drain()  # Files catch up separately from the command.


def test_album_in_unwritable_folder_stays_in_the_library(tmp_path, monkeypatch):
    source = photo(tmp_path)
    store = LibraryMarks(tmp_path / "app")
    monkeypatch.setattr(store, "_write_sidecar", lambda *_, **kwargs: (_ for _ in ()).throw(PermissionError("read-only")))
    result = store.album_create("Card", [source])
    store.writer.drain()  # Files catch up separately from the command.
    assert result["photos"][0]["storage"] == "database" and store.writer.status()["events"]
    assert LibraryMarks(tmp_path / "app").read([source])["photos"][0]["albums"] == ["Card"]


class Pins:
    def __init__(self, root, folders):
        self.root, self.folders = root, folders

    def pinned(self):
        return [{"name": folder.name, "path": str(folder), "available": folder.is_dir()} for folder in self.folders]


def record(source, **facts):
    stat = source.stat()
    return {"path": str(source), "bytes": stat.st_size, "mtime_ns": stat.st_mtime_ns, **dict.fromkeys(FACT_FIELDS), **facts}


def test_index_keeps_facts_for_unchanged_files_only(tmp_path):
    folder = tmp_path / "photos"
    first, second = photo(folder, "a.png"), photo(folder, "b.png")
    index = LibraryIndex(LibraryMarks(tmp_path / "app"), Pins(tmp_path / "app", [folder]), None)

    def listing():
        return [{"path": str(source), "bytes": source.stat().st_size, "mtime_ns": source.stat().st_mtime_ns} for source in (first, second) if source.exists()]

    photos = listing()
    index.remember_scan(folder, photos)
    assert not any(item.get("indexed") for item in photos)
    index.remember_facts([record(first, camera="ILCE-7RM3", iso=400), record(second, camera="X-E2S")])
    photos = listing()
    index.remember_scan(folder, photos)
    assert [(item["camera"], item["indexed"]) for item in photos] == [("ILCE-7RM3", True), ("X-E2S", True)]
    first.write_bytes(b"edited in another program")
    second.unlink()
    photos = listing()
    index.remember_scan(folder, photos)
    assert "camera" not in photos[0]
    listed, missing = index.photos([str(first), str(second)])
    assert missing == 1 and [item["name"] for item in listed] == ["a.png"] and "indexed" not in listed[0]
    index.kick()  # Without a helper there is nothing to start.
    assert index.status()["state"] == "idle"


def test_library_preferences_survive_and_are_not_in_the_database(tmp_path):
    index = LibraryIndex(LibraryMarks(tmp_path / "app"), Pins(tmp_path / "app", []), None)
    assert index.preferences() == {"background_indexing": True, "label_names": {"red": "", "orange": "", "green": "", "blue": ""}}
    index.set_preferences(label_names={"red": "To retouch", "purple": "ignored"})
    index.set_preferences(background_indexing=False)
    again = LibraryIndex(LibraryMarks(tmp_path / "app"), Pins(tmp_path / "app", []), None)
    assert again.preferences() == {"background_indexing": False, "label_names": {"red": "To retouch", "orange": "", "green": "", "blue": ""}}
    assert again.status()["state"] == "off"
    assert not again.marks.database.exists()


def test_background_indexing_reaches_a_pinned_folder_never_visited(tmp_path):
    from PIL import Image
    folder = tmp_path / "photos" / "2024"
    folder.mkdir(parents=True)
    exif = Image.Exif()
    exif[272] = "ILCE-7RM3"
    exif[34665] = {36867: "2024:02:03 04:05:06", 34855: 800}
    Image.new("RGB", (16, 8)).save(folder / "dated.jpg", exif=exif)
    Image.new("RGB", (16, 8)).save(folder / "plain.png")
    marked = LibraryMarks(tmp_path / "elsewhere")
    marked.change([folder / "plain.png"], MarkChange(rating=5, add_tag="Birds"))
    marked.writer.drain()  # Files catch up separately from the command.
    marked.album_create("Portfolio", [folder / "plain.png"])
    marked.writer.drain()  # Files catch up separately from the command.
    originals = {path.name: path.read_bytes() for path in folder.iterdir()}

    app_data = tmp_path / "app"
    store = MediaBrowserStore(app_data)
    worker = LibraryWorker(app_data)
    try:
        app = FastAPI()
        app.include_router(create_library_router(worker, store))
        client = TestClient(app)
        assert client.post("/api/library/pins", json={"paths": [str(tmp_path / "photos")]}).status_code == 200
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            if client.get("/api/library/index").json()["state"] == "idle" and client.get("/api/library/albums").json()["albums"]:
                break
            time.sleep(0.1)
        # Marks, tags and albums were found without ever opening the folder.
        assert client.get("/api/library/albums").json() == {"albums": [{"name": "Portfolio", "count": 1}]}
        assert client.get("/api/library/tags?all=true").json() == {"tags": [{"tag": "Birds", "count": 1}]}
        listed = client.post("/api/library/collection", json={"kind": "album", "name": "Portfolio"}).json()
        assert [item["name"] for item in listed["photos"]] == ["plain.png"] and listed["photos"][0]["marks"]["rating"] == 5
        facts = client.post("/api/library/collection", json={"kind": "tag", "name": "birds"}).json()["photos"][0]
        assert facts["indexed"] is True and facts["camera"] is None
        index = LibraryIndex(LibraryMarks(app_data), store, None)
        dated = index.photos([str(folder / "dated.jpg")])[0][0]
        assert (dated["camera"], dated["iso"], dated["capture_time"]) == ("ILCE-7RM3", 800, "2024-02-03T04:05:06")
        assert client.post("/api/library/index", json={"action": "disable"}).json()["state"] == "off"
    finally:
        worker.close()
    assert {path.name: path.read_bytes() for path in folder.iterdir()} == originals
