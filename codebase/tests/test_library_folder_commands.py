import json
from types import SimpleNamespace
import pytest
from hdr_finisher.library_marks import LibraryMarks
from hdr_finisher.library_folder_commands import FolderCommands, folder_name

@pytest.fixture
def commands(tmp_path):
    parent = tmp_path / "shoot"; parent.mkdir()
    index = SimpleNamespace(preferences_path=tmp_path / "app" / "library-preferences.json", _state=__import__("threading").RLock())
    marks = LibraryMarks(tmp_path / "app")
    return parent, FolderCommands(marks, SimpleNamespace(pinned=lambda: [{"path":str(parent), "name":"shoot", "available":True}]), index)

@pytest.mark.parametrize("name", ["", ".", "..", "NUL", "con.txt", "COM¹", "lpt9.any", "ends.", "space ", "a/b", "a\\b", "x:y", "bad?", "x\0", "x"*256])
def test_invalid_names(name):
    with pytest.raises(ValueError): folder_name(name)


def test_create_unicode_clash_and_undo(commands):
    parent, c = commands
    result = c.create(parent, "เที่ยว")
    assert (parent / "เที่ยว").is_dir()
    with pytest.raises(ValueError): c.create(parent, "เที่ยว")
    assert result["undo_available"]
    c.marks.undo()
    assert not (parent / "เที่ยว").exists()
    c.create(parent, "New")
    with pytest.raises(ValueError): c.create(parent, "new")


def test_undo_never_removes_contents_or_replacement(commands):
    parent, c = commands
    c.create(parent, "New")
    (parent / "New" / "unknown.txt").write_text("keep")
    with pytest.raises(ValueError): c.marks.undo()
    assert (parent / "New" / "unknown.txt").read_text() == "keep"
    assert c.marks._undo


def test_labels_survive_database_loss_preserve_preferences_and_undo(commands):
    parent, c = commands
    c.index.preferences_path.parent.mkdir(parents=True)
    c.index.preferences_path.write_text(json.dumps({"review":{"focus_strength":.9},"future":42}))
    c.label(str(parent), "Holiday")
    assert c.pins()[0]["name"] == "Holiday"
    c.marks._connect().close(); c.marks.database.unlink()
    assert c.pins()[0]["name"] == "Holiday"
    c.marks.undo()
    saved=json.loads(c.index.preferences_path.read_text())
    assert c.pins()[0]["name"] == "shoot" and saved["future"] == 42
    assert saved["review"]["focus_strength"] == .9
    assert list(parent.iterdir()) == []


def test_unreadable_preferences_are_not_overwritten(commands):
    parent,c=commands
    c.index.preferences_path.parent.mkdir(parents=True);c.index.preferences_path.write_text("broken")
    with pytest.raises(ValueError): c.label(str(parent), "Holiday")
    assert c.index.preferences_path.read_text() == "broken"


def test_show_selected_disposable_folders(commands, monkeypatch):
    parent,c=commands; other=parent/"two";other.mkdir(); shown=[]
    monkeypatch.setattr("os.startfile",shown.append)
    c.show([str(parent),str(other),str(parent)])
    assert shown == [str(parent),str(other)]
