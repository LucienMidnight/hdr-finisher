from fastapi import FastAPI
from fastapi.testclient import TestClient
import numpy as np

from hdr_finisher.library_api import create_library_router
from hdr_finisher.loader import load_image
from hdr_finisher.library_test_patterns import set_test_patterns_enabled
from hdr_finisher.media_browser import MediaBrowserStore
from hdr_finisher.test_pattern import build_delivery_proof_pattern, build_hdr_test_pattern


def test_test_patterns_are_generated_and_pinned_only_when_enabled(tmp_path):
    browser = MediaBrowserStore(tmp_path / "preferences")
    user_folder = tmp_path / "my photos"
    user_folder.mkdir()
    browser.add_pin(str(user_folder))

    enabled = set_test_patterns_enabled(browser, True)
    folder = tmp_path / "preferences" / "Test Patterns"
    patterns = sorted(folder.glob("*.exr"))

    assert enabled == {"enabled": True, "folder": str(folder.resolve()), "pinned": True, "changed": True}
    assert [path.name for path in patterns] == ["Delivery proof test pattern.exr", "HDR test pattern.exr"]
    assert len(browser.pinned()) == 2
    for path, expected in zip(patterns, (build_delivery_proof_pattern(), build_hdr_test_pattern())):
        decoded, _descriptor, metadata, _analysis, _sdr = load_image(path)
        assert metadata["color_space"] == "ACEScg"
        assert metadata["transfer_function"] == "LINEAR"
        assert metadata["needs_color_override"] is False
        np.testing.assert_array_equal(decoded, expected)

    disabled = set_test_patterns_enabled(browser, False)

    assert disabled["enabled"] is False
    assert disabled["pinned"] is False
    assert sorted(path.name for path in folder.glob("*.exr")) == sorted(path.name for path in patterns)
    assert [pin["path"] for pin in browser.pinned()] == [str(user_folder.resolve())]


def test_reenabling_test_patterns_keeps_existing_generated_files(tmp_path):
    browser = MediaBrowserStore(tmp_path / "preferences")
    set_test_patterns_enabled(browser, True)
    pattern = tmp_path / "preferences" / "Test Patterns" / "HDR test pattern.exr"
    pattern.write_bytes(b"keep user changes")

    set_test_patterns_enabled(browser, False)
    set_test_patterns_enabled(browser, True)

    assert pattern.read_bytes() == b"keep user changes"


def test_settings_endpoint_pins_and_hides_managed_folder_without_touching_other_pins(tmp_path):
    browser = MediaBrowserStore(tmp_path / "preferences")
    user_folder = tmp_path / "my photos"
    user_folder.mkdir()
    browser.add_pin(str(user_folder))
    app = FastAPI()
    app.include_router(create_library_router(None, browser))

    client = TestClient(app)
    response = client.post("/api/library/test-patterns", json={"enabled": True})
    assert response.status_code == 200
    folder = tmp_path / "preferences" / "Test Patterns"
    assert response.json()["pinned"] is True
    assert len(browser.pinned()) == 2

    response = client.post("/api/library/test-patterns", json={"enabled": False})

    assert response.status_code == 200
    assert [pin["path"] for pin in browser.pinned()] == [str(user_folder.resolve())]
    assert len(list(folder.glob("*.exr"))) == 2
