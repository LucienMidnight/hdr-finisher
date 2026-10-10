import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from pydantic import ValidationError

from hdr_finisher.library_marks import LibraryMarks, MarkChange
from hdr_finisher.library_pictures import SIDECAR_SUFFIX


def photo(root, name="photo.png"):
    source = root / name
    source.parent.mkdir(parents=True, exist_ok=True)
    source.write_bytes(b"original photo bytes")
    return source


def sidecar(source):
    return source.with_name(source.name + SIDECAR_SUFFIX)


def test_unmarked_browse_writes_nothing(tmp_path):
    source = photo(tmp_path)
    store = LibraryMarks(tmp_path / "app")
    assert store.read([source])["photos"][0]["marks"]["rating"] == 0
    assert store.tags() == []
    assert not store.database.exists()
    assert list(tmp_path.iterdir()) == [source]
    assert store.change([source], MarkChange(rating=0))["photos"] == []
    assert not sidecar(source).exists()
    assert not store.database.exists()


def test_bulk_marks_save_at_once_and_undo_as_one_action(tmp_path):
    sources = [photo(tmp_path, "one.png"), photo(tmp_path, "two.png")]
    store = LibraryMarks(tmp_path / "app")
    result = store.change(sources, MarkChange(rating=4, pick="pick", label="red", add_tag="  Family   trip "))
    assert len(result["photos"]) == 2
    ids = []
    for source in sources:
        document = json.loads(sidecar(source).read_text())
        assert document["marks"] == {"rating": 4, "pick": "pick", "label": "red", "tags": ["Family trip"]}
        assert document["source"]["filename"] == source.name
        assert document["contains_source_pixels"] is False
        assert source.read_bytes() == b"original photo bytes"
        ids.append(document["photo_id"])
    assert ids[0] != ids[1]
    undo = store.undo()
    assert not undo["undo_available"]
    assert len(undo["photos"]) == 2
    assert all(row["marks"]["rating"] == 0 for row in undo["photos"])
    assert [json.loads(sidecar(source).read_text())["photo_id"] for source in sources] == ids
    assert store.tags() == [{"tag": "Family trip", "count": 0}]


def test_restarts_and_deleted_database_rebuild_from_sidecars(tmp_path):
    source = photo(tmp_path)
    store = LibraryMarks(tmp_path / "app")
    store.change([source], MarkChange(rating=5, pick="reject", add_tag="Birds"))
    assert LibraryMarks(tmp_path / "app").read([source])["photos"][0]["marks"]["rating"] == 5
    store.database.unlink()
    rebuilt = LibraryMarks(tmp_path / "app")
    assert rebuilt.read([source])["photos"][0]["marks"]["pick"] == "reject"
    assert rebuilt.tags("bi") == [{"tag": "Birds", "count": 1}]


def test_existing_grade_and_unknown_fields_survive_marks_and_undo(tmp_path):
    source = photo(tmp_path)
    store = LibraryMarks(tmp_path / "app")
    store.change([source], MarkChange(rating=2))
    document = json.loads(sidecar(source).read_text())
    document["adjustments"] = {"hdr": {"exposure": 1.23}}
    document["virtual_copies"] = [{"id": "copy", "custom": [1, 2, 3]}]
    sidecar(source).write_text(json.dumps(document))
    store.change([source], MarkChange(rating=3))
    store.undo()
    saved = json.loads(sidecar(source).read_text())
    assert saved["adjustments"] == document["adjustments"]
    assert saved["virtual_copies"] == document["virtual_copies"]
    assert saved["marks"]["rating"] == 2


def test_read_only_sidecar_failure_keeps_database_marks_across_restart(tmp_path, monkeypatch):
    source = photo(tmp_path)
    store = LibraryMarks(tmp_path / "app")
    store.change([source], MarkChange(rating=1))
    old = sidecar(source).read_bytes()
    def denied(*args):
        raise PermissionError("read-only share")
    monkeypatch.setattr(store, "_write_sidecar", denied)
    result = store.change([source], MarkChange(rating=5, add_tag="Keep"))
    assert result["warnings"] and result["photos"][0]["storage"] == "database"
    assert sidecar(source).read_bytes() == old
    assert LibraryMarks(tmp_path / "app").read([source])["photos"][0]["marks"]["rating"] == 5
    assert store.undo()["photos"][0]["marks"]["rating"] == 1


@pytest.mark.parametrize("content", ["broken", '{"format":"HDR Finisher Photo","schema_version":999}'])
def test_invalid_or_newer_sidecar_is_not_overwritten_even_in_bulk(tmp_path, content):
    one, two = photo(tmp_path, "one.png"), photo(tmp_path, "two.png")
    sidecar(two).write_text(content)
    store = LibraryMarks(tmp_path / "app")
    assert store.read([one, two])["warnings"]
    with pytest.raises(ValueError):
        store.change([one, two], MarkChange(rating=3))
    assert not sidecar(one).exists()
    assert sidecar(two).read_text() == content
    assert not store.database.exists()


def test_atomic_failure_keeps_old_settings_and_no_temporary_files(tmp_path, monkeypatch):
    source = photo(tmp_path)
    store = LibraryMarks(tmp_path / "app")
    store.change([source], MarkChange(rating=1))
    old = sidecar(source).read_bytes()
    def denied(*args):
        raise PermissionError("file is in use")
    monkeypatch.setattr("hdr_finisher.library_marks.os.replace", denied)
    result = store.change([source], MarkChange(rating=4))
    assert result["warnings"]
    assert sidecar(source).read_bytes() == old
    assert not list(tmp_path.glob("*.tmp"))
    assert store.read([source])["photos"][0]["marks"]["rating"] == 4


def test_tag_counts_case_deduplication_and_whole_selection_label_toggle(tmp_path):
    sources = [photo(tmp_path, "one.png"), photo(tmp_path, "two.png")]
    store = LibraryMarks(tmp_path / "app")
    store.change(sources, MarkChange(add_tag="Family", label="red", toggle_label=True))
    assert store.change(sources, MarkChange(add_tag="family"))["photos"] == []
    result = store.change(sources, MarkChange(label="red", toggle_label=True))
    assert all(row["marks"]["label"] == "" for row in result["photos"])
    store.change([sources[0]], MarkChange(remove_tag="FAMILY"))
    assert store.tags() == [{"tag": "Family", "count": 1}]


def test_single_writer_preserves_concurrent_changes(tmp_path):
    source = photo(tmp_path)
    store = LibraryMarks(tmp_path / "app")
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(lambda tag: store.change([source], MarkChange(add_tag=tag)), ["one", "two", "three", "four"]))
    assert set(store.read([source])["photos"][0]["marks"]["tags"]) == {"one", "two", "three", "four"}
    for _ in range(4):
        store.undo()
    assert store.read([source])["photos"][0]["marks"]["tags"] == []


def test_removed_or_externally_changed_sidecars_refresh_disposable_index(tmp_path):
    source = photo(tmp_path)
    store = LibraryMarks(tmp_path / "app")
    store.change([source], MarkChange(rating=2, add_tag="Old"))
    document = json.loads(sidecar(source).read_text())
    document["marks"]["rating"] = 5
    document["marks"]["tags"] = ["New"]
    sidecar(source).write_text(json.dumps(document))
    assert store.read([source])["photos"][0]["marks"]["rating"] == 5
    sidecar(source).unlink()
    assert store.read([source])["photos"][0]["marks"]["rating"] == 0
    assert all(tag["count"] == 0 for tag in store.tags())


@pytest.mark.parametrize("change", [{"rating":6}, {"rating":True}, {"label":"purple"}, {"add_tag":" "}, {"pick":"maybe"}])
def test_invalid_commands_rejected(change):
    with pytest.raises(ValidationError):
        MarkChange(**change)
