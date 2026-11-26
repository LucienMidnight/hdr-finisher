"""Saving a project must keep conflict detection attached to its destination."""
import zipfile

import pytest
from PIL import Image

from hdr_finisher.projects import ProjectError, open_project, save_project
from hdr_finisher.sessions import SessionStore


@pytest.mark.parametrize("save_as", [False, True])
def test_saved_destination_rejects_external_changes(tmp_path, save_as):
    source = tmp_path / "source.png"
    Image.new("RGB", (16, 12), (120, 90, 60)).save(source)
    store = SessionStore()
    try:
        session = store.get(store.create_session(source, owns_source_path=False).session_id)
        destination = tmp_path / "first.hdrfinisher"
        save_project(session, destination)
        if save_as:
            session = open_project(store, destination)
            destination = tmp_path / "saved as.hdrfinisher"
            save_project(session, destination)
        with zipfile.ZipFile(destination, "a") as archive:
            archive.writestr("external-change.txt", "Changed by another editor")
        external = destination.read_bytes()
        with pytest.raises(ProjectError, match="changed elsewhere"):
            save_project(session, destination)
        assert destination.read_bytes() == external
    finally:
        store.clear()
