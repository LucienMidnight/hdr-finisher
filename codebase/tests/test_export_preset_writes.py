"""Independent API preset stores must not share a temporary filename."""
import os

import pytest

from hdr_finisher.export_presets import ExportPreset, ExportPresets, ExportVersion


def test_overlapping_preset_saves_keep_their_own_document(tmp_path, monkeypatch):
    first = ExportPreset(id="shared", name="First", versions=[ExportVersion()])
    second = first.model_copy(update={"name": "Second"})
    native_replace = os.replace
    nested = False

    def replace(source, destination):
        nonlocal nested
        if not nested:
            nested = True
            ExportPresets(tmp_path).save(second)
        native_replace(source, destination)

    monkeypatch.setattr(os, "replace", replace)
    ExportPresets(tmp_path).save(first)
    assert ExportPresets(tmp_path).list() == [first]
    assert [path.name for path in tmp_path.iterdir()] == ["shared.json"]


def test_failed_preset_publish_cleans_temporary_file(tmp_path, monkeypatch):
    def fail(*_):
        raise PermissionError("destination locked")

    monkeypatch.setattr(os, "replace", fail)
    with pytest.raises(PermissionError):
        ExportPresets(tmp_path).save(ExportPreset(name="Locked", versions=[ExportVersion()]))
    assert not list(tmp_path.iterdir())
