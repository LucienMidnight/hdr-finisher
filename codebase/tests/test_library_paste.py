"""Selective bulk paste exercises saved documents, virtual items and durable work."""
from copy import deepcopy
from pathlib import Path
import pytest
from test_library_grades import setup, saved, settings
from hdr_finisher.library_copies import LibraryCopies
from hdr_finisher.library_paste import LibraryPaste
from hdr_finisher.sessions import SessionStore

HDR='global_adjustments.hdr.exposure'


def test_three_targets_virtual_item_selective_paste_and_one_undo(setup):
    photo,store,session,marks,grades=setup
    copied=saved(setup); paste=LibraryPaste(grades); paste.copy(str(photo))
    copies=LibraryCopies(marks); virtual=copies.create(photo,'clean')['path'];marks.writer.drain()
    paths=[]
    for name in ('one.png','two.png'):
        target=photo.with_name(name);target.write_bytes(photo.read_bytes())
        other=store.get(store.create_session(target,owns_source_path=False).session_id);grades.attach(str(other.session_id))
        paths.append(str(target))
    store.clear(); paths.append(virtual)
    before={p:deepcopy(paste.document(p)[0]) for p in paths}
    result=paste.paste(paths,{'lanes':['hdr'],'settings':[HDR]})
    assert result['count']==3 and result['grade_changed']
    marks.writer.drain()
    for p in paths:
        actual=paste.document(p)[0];expected=deepcopy(before[p]);expected['global_adjustments']['hdr']['exposure']=1
        assert actual==expected
        assert grades._get(p)['previous_grade'] is None or grades._get(p)['previous_grade']==before[p]
    assert settings(photo)['grade']==copied
    restored=marks.undo();marks.writer.drain()
    assert restored["grade_changed"]
    for p in paths: assert paste.document(p)[0]==before[p]


def test_never_pasted_fields_and_preferences(setup):
    photo,store,session,marks,grades=setup;saved(setup)
    paste=LibraryPaste(grades);description=paste.copy(str(photo))
    ids={r['id'] for g in description['groups'] for r in g['settings']}
    assert 'hdr_reference_white_nits' not in ids
    assert not any('source_peak' in p or '.profile_id' in p or 'overlay' in p or 'interpretation' in p for p in ids)
    selection={'lanes':['hdr'],'settings':[HDR]}
    paste.paste([str(photo)],selection)
    assert LibraryPaste(grades).selection(description['groups'])==selection
    with pytest.raises(ValueError,match='Unknown'):paste.paste([str(photo)],{'lanes':['hdr'],'settings':['hdr_reference_white_nits']})


def test_open_paste_saves_immediately_and_grade_undo_has_before_document(setup):
    photo,store,session,marks,grades=setup;saved(setup)
    paste=LibraryPaste(grades);paste.copy(str(photo))
    changed=deepcopy(paste.clipboard['grade']);changed['global_adjustments']['hdr']['exposure']=2
    paste.clipboard['grade']=changed
    result=paste.paste([str(photo)],{'lanes':['hdr'],'settings':[HDR]})
    assert not store._current.dirty and result['session']
    assert store._current.undo_history
    marks.writer.drain();assert settings(photo)['grade']['global_adjustments']['hdr']['exposure']==2
    marks.undo();marks.writer.drain();assert settings(photo)['grade']['global_adjustments']['hdr']['exposure']==1

def test_real_paste_copies_plain_exposure_and_defers_offline_target(setup):
    import json
    photo,store,session,marks,grades=setup;copied=saved(setup)
    state=grades._get(str(photo));state['default']['global_adjustments']['hdr']['exposure']=.5;grades._put(str(photo),state)
    paste=LibraryPaste(grades);paste.copy(str(photo));store.clear()
    folder=photo.parent/'detachable';folder.mkdir();target=folder/'target.ARW';target.write_bytes(photo.read_bytes())
    starting=deepcopy(copied);starting['source']['filename']=target.name;starting['source']['durable_path']=str(target)
    starting['global_adjustments']['hdr']['exposure']=2
    document={'format':'HDR Finisher Photo','schema_version':1,'photo_id':'raw-target','marks':{},'albums':[],
        'grade':starting,'grade_default':starting}
    Path(str(target)+'.hdrf').write_text(json.dumps(document),encoding='utf-8')
    marks.read([target]);folder.rename(photo.parent/'disconnected')
    result=paste.paste([str(target)],{'lanes':['hdr'],'settings':[HDR]})
    assert result['count']==1 and 'offline' in result['warnings'][0]['message']
    desired=grades._get(str(target))['desired']
    assert desired['global_adjustments']['hdr']['exposure']==1
    assert grades._get(str(target))['previous_grade']==starting
    marks.undo()
    assert grades._get(str(target))['desired']==starting
    (photo.parent/'disconnected').rename(folder)
    marks.writer.drain()
    assert not grades._get(str(target)).get('conflict')
    assert settings(target)['grade']==starting


def test_paste_reuses_scene_start_and_develops_each_photo_once(setup, monkeypatch):
    import threading, time
    from hdr_finisher.library_pictures import LibraryPictureCache
    photo,store,session,marks,grades=setup
    shown=photo.with_name('shown.png');shown.write_bytes(photo.read_bytes())
    fresh=photo.with_name('fresh.png');fresh.write_bytes(photo.read_bytes())
    start=session.edit_document().model_dump(mode='json')
    start['source'].update(filename=shown.name,durable_path=str(shown.resolve()))
    start['global_adjustments']['hdr']['exposure']=.7
    cache=LibraryPictureCache(marks.database.parent);cache.keep_default_document(shown,start)
    imports=[];real=SessionStore.prepare_session
    def counted(self,path,**options):
        imports.append(Path(path).name);time.sleep(.2);return real(self,path,**options)
    monkeypatch.setattr(SessionStore,'prepare_session',counted)
    paste=LibraryPaste(grades)
    # A photo the grid already developed takes Grade's start from the stored scene.
    assert paste.document(str(shown))[1]['global_adjustments']['hdr']['exposure']==.7
    assert imports==[]
    # The paste check and the paste itself may ask for the same new photo at once.
    threads=[threading.Thread(target=paste.prepare,args=(str(fresh),)) for _ in range(3)]
    for thread in threads: thread.start()
    for thread in threads: thread.join()
    assert imports==['fresh.png'] and grades._get(str(fresh))['default']


def test_gpu_raw_start_is_reused_by_simultaneous_paste_requests(setup, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from hdr_finisher import library_gpu_raw
    from hdr_finisher.library_pictures import LibraryPictureCache
    from test_library_gpu_raw import _header, _payload
    photo, store, session, marks, grades = setup
    raw = photo.with_name('shown.ARW')
    raw.write_bytes(b'disposable sensor source')
    cache = LibraryPictureCache(marks.database.parent)
    library_gpu_raw.developed(cache, str(raw), _header(raw), _payload(8,12,(.1,.2,.3)))
    def forbidden(*args, **kwargs):
        raise AssertionError('Paste must reuse the GPU development, without CPU preparation')
    monkeypatch.setattr(SessionStore, 'prepare_session', forbidden)
    paste = LibraryPaste(grades)
    with ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(lambda _: paste.document(str(raw)), range(3)))
    assert results[0] == results[1] == results[2]
    assert results[0][1] == cache.default_document(raw)
    assert grades._get(str(raw))['default'] == results[0][1]


@pytest.mark.parametrize('contents', ['{', '[]', '{}', '{"lanes":"hdr","settings":[]}', '{"lanes":[],"settings":[{}]}'])
def test_corrupt_preferences_use_defaults(setup, contents):
    photo,store,session,marks,grades=setup
    paste=LibraryPaste(grades);expected=paste.copy(str(photo))['selection']
    paste.preferences.write_text(contents,encoding='utf-8')
    assert paste.copy(str(photo))['selection']==expected


def test_stale_preferences_allow_copy_and_paste(setup):
    import json
    photo,store,session,marks,grades=setup;saved(setup)
    paste=LibraryPaste(grades)
    paste.preferences.write_text(json.dumps({'lanes':['hdr','obsolete'], 'settings':[HDR,'shadow_lift','primaries_section_enabled']}),encoding='utf-8')
    description=paste.copy(str(photo))
    assert description['name'] and description['selection']=={'lanes':['hdr'],'settings':[HDR]}
    paste.clipboard['grade']['global_adjustments']['hdr']['exposure']=2
    assert paste.paste([str(photo)])['count']==1
    assert paste.document(str(photo))[0]['global_adjustments']['hdr']['exposure']==2
    assert json.loads(paste.preferences.read_text())==description['selection']
    assert paste.describe()['selection']==description['selection']


@pytest.mark.parametrize('selection', [{'lanes':['obsolete'],'settings':[HDR]}, {'lanes':['hdr'],'settings':['shadow_lift']}, {'lanes':['hdr'],'settings':[{}]}])
def test_explicit_bad_selection_is_rejected(setup, selection):
    photo,store,session,marks,grades=setup
    paste=LibraryPaste(grades);paste.copy(str(photo))
    with pytest.raises(ValueError,match='Unknown paste setting'):
        paste.paste([str(photo)],selection)


@pytest.mark.parametrize('raw_first', [True,False])
def test_preferences_shared_between_raw_and_nonraw(setup, monkeypatch, raw_first):
    import json
    photo,store,session,marks,grades=setup
    paste=LibraryPaste(grades)
    raw=photo.with_suffix('.ARW');raw.write_bytes(b'test RAW placeholder')
    document=session.edit_document().model_dump(mode='json')
    monkeypatch.setattr(paste,'document',lambda path:(deepcopy(document),deepcopy(document)))
    first,second=(raw,photo) if raw_first else (photo,raw)
    description=paste.copy(str(first))
    raw_id=next(r['id'] for g in description['groups'] if g['id']=='raw-development' for r in g['settings'])
    selection={'lanes':['hdr'],'settings':[HDR,raw_id]}
    paste.paste([str(first)],selection)
    assert json.loads(paste.preferences.read_text())==selection
    assert paste.copy(str(second))['selection']==selection
    result=paste.paste([str(second)],preview=True)
    assert bool(result['warnings'])==raw_first
    groups=[g for g in description['groups'] if g['id']!='raw-development']
    assert paste.selection(groups)=={'lanes':['hdr'],'settings':[HDR]}
