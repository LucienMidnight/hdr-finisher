"""Malformed project manifests fail as project errors, without opening a source."""
import zipfile

import pytest

from hdr_finisher.projects import ProjectError, open_project


@pytest.mark.parametrize("manifest", [b"null", b"[]", b"42", b'"text"', b'\xff'])
def test_invalid_manifest_reports_project_error(tmp_path, manifest):
    path = tmp_path / "invalid.hdrfinisher"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("manifest.json", manifest)
        archive.writestr("edit-state.json", "{}")
    with pytest.raises(ProjectError):
        open_project(None, path)
