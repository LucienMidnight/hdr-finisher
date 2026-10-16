import pytest
from test_library_file_commands import setup
from hdr_finisher import library_file_commands
from hdr_finisher.library_file_commands import FileRequest


def test_file_commands_are_refused_untouched_where_unsupported(setup, monkeypatch):
    photo, destination, c, doc = setup
    monkeypatch.setattr(library_file_commands, 'FILE_COMMANDS_SUPPORTED', False)
    side = photo.with_name(photo.name + '.hdrf')
    before = photo.read_bytes(), side.read_bytes()
    requests = [FileRequest(action='rename', paths=[str(photo)], name='new'),
                FileRequest(action='move', paths=[str(photo)], destination=str(destination)),
                FileRequest(action='delete', paths=[str(photo)]),
                FileRequest(action='folder_rename', paths=[str(photo.parent)], name='renamed')]
    for request in requests:
        with pytest.raises(ValueError, match='Windows only'):
            c.plan(request)
    assert (photo.read_bytes(), side.read_bytes()) == before
    assert sorted(p.name for p in photo.parent.iterdir()) == ['photo.ARW', 'photo.ARW.hdrf']
    assert list(destination.iterdir()) == []
    assert c.status()['jobs'] == [] and c.status()['attention'] == []
