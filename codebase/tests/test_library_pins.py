from fastapi import FastAPI
from fastapi.testclient import TestClient

from hdr_finisher.library_api import create_library_router
from hdr_finisher.media_browser import MediaBrowserStore


def test_unpin_offline_folder_keeps_other_pins_and_source(tmp_path):
    store = MediaBrowserStore(tmp_path / 'preferences')
    app = FastAPI()
    app.include_router(create_library_router(None, store))
    client = TestClient(app)
    first, second = tmp_path / 'first', tmp_path / 'second'
    first.mkdir()
    second.mkdir()
    photo = second / 'photo.jpg'
    photo.write_bytes(b'original photo bytes')
    assert client.post('/api/library/pins', json={'paths': [str(first), str(second)]}).status_code == 200
    first.rmdir()
    response = client.post('/api/library/pins/remove', json={'path': str(first)})
    assert response.status_code == 200
    assert [pin['path'] for pin in response.json()['pinned']] == [str(second.resolve())]
    assert photo.read_bytes() == b'original photo bytes'
    # Removing again is harmless, and reopening the store retains the removal.
    assert client.post('/api/library/pins/remove', json={'path': str(first)}).json() == response.json()
    assert MediaBrowserStore(store.root).pinned() == response.json()['pinned']
