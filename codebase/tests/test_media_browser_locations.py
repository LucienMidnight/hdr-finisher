"""Saved browser locations are shortcuts only; Library pins stay separate (Steve, November 13, 2026)."""
from fastapi.testclient import TestClient

from hdr_finisher import main
from hdr_finisher.media_browser import MediaBrowserStore


def test_saved_locations_never_change_library_pins(tmp_path, monkeypatch):
    store = MediaBrowserStore(tmp_path / "app")
    monkeypatch.setattr(main, "media_browser_store", store)
    client = TestClient(main.app)
    shoot = tmp_path / "shoot"
    shoot.mkdir()

    response = client.post("/api/media-browser/locations", json={"path": str(shoot)})
    assert response.status_code == 200
    assert [place["path"] for place in response.json()["saved_locations"]] == [str(shoot.resolve())]
    # Pinning a location does not add a Library folder.
    assert store.pinned() == []

    listing = client.get("/api/media-browser", params={"path": str(tmp_path), "mode": "export_directory"}).json()
    assert [place["path"] for place in listing["saved_locations"]] == [str(shoot.resolve())]
    assert "pinned" not in listing  # Library pins are no longer offered as browser shortcuts.

    # A Library pin does not become a location, and removing the location keeps the pin.
    store.add_pin(str(shoot))
    assert client.post("/api/media-browser/locations/remove", json={"path": str(shoot)}).json() == {"saved_locations": []}
    assert [pin["path"] for pin in store.pinned()] == [str(shoot.resolve())]
    assert MediaBrowserStore(store.root).saved_locations() == []

    # A folder that is not there cannot be saved.
    assert client.post("/api/media-browser/locations", json={"path": str(tmp_path / "missing")}).status_code == 400
