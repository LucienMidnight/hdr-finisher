from fastapi import FastAPI
from fastapi.testclient import TestClient
from hdr_finisher.library_api import create_library_router
from hdr_finisher.library_worker import LibraryWorker
from hdr_finisher.media_browser import MediaBrowserStore


def test_batched_page_events_reach_existing_log_with_original_timestamp(tmp_path, monkeypatch):
    records = []
    monkeypatch.setattr('hdr_finisher.library_api.log', lambda event, **fields: records.append((event, fields)))
    app = FastAPI()
    worker = LibraryWorker(tmp_path)
    app.include_router(create_library_router(worker, MediaBrowserStore(tmp_path)))
    client = TestClient(app)
    response = client.post('/api/library/stopwatch', json=[
        {'stage': 'ready', 'time': 123.5},
        {'stage': 'picture_drawn', 'time': 124.0, 'picture_key': 'a'*64, 'first': True, 'duration_ms': 12.25,
         'photo_pixels': 'never log unknown fields'}])
    assert response.status_code == 200
    assert records == [('page_ready', {'time': 123.5}), ('page_picture_drawn',
        {'time': 124.0, 'picture_key': 'a'*64, 'duration_ms': 12.25, 'first': True})]
    assert not worker.status()['running']
