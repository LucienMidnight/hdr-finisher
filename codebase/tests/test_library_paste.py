"""Selective bulk paste exercises saved documents, virtual items and durable work."""
from copy import deepcopy
from pathlib import Path
import pytest
from test_library_grades import setup, saved, settings
from hdr_finisher.library_copies import LibraryCopies
from hdr_finisher.library_paste import LibraryPaste, raw_exposure_from_start
from hdr_finisher.library_kept import KeptPictures, identity
from hdr_finisher.library_marks import LibraryMarks
from hdr_finisher.library_grades import LibraryGrades
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


def test_raw_starting_exposure_delta_is_isolated():
    assert raw_exposure_from_start(2.5,1.5,-.25)==.75


def test_pending_pictures_survive_restart_resume_and_coalesce_latest_grade(setup):
    photo,store,session,marks,grades=setup;grade=saved(setup)
    kept=KeptPictures(marks.database.parent,marks,None);marks.kept=kept
    kept.queue_command({'action':'pause'})
    kept.enqueue(str(photo),grade)
    changed=deepcopy(grade);changed['global_adjustments']['hdr']['exposure']=2
    state=grades._get(str(photo));state.update(desired=changed,pending=True);grades._put(str(photo),state)
    kept.enqueue(str(photo),changed)
    assert kept.queue_status()['pending']==1
    kept.close()
    restarted_marks=LibraryMarks(marks.database.parent);LibraryGrades(restarted_marks,SessionStore())
    restarted=KeptPictures(marks.database.parent,restarted_marks,None)
    # Pending work survives a restart, but a pause lasts one app session (Steve, October 18, 2026).
    assert restarted.queue_status()['pending']==1 and not restarted.queue_status()['paused']
    assert restarted_marks._query('SELECT grade_id FROM picture_jobs')[0][0]==identity(changed)
    restarted.queue_command({'action':'resume','paths':[str(photo)]})
    assert not restarted.queue_status()['paused']
    restarted.close()


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

def test_real_paste_applies_raw_delta_and_defers_offline_target(setup):
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
    assert desired['global_adjustments']['hdr']['exposure']==2.5
    assert grades._get(str(target))['previous_grade']==starting
    marks.undo()
    assert grades._get(str(target))['desired']==starting
    (photo.parent/'disconnected').rename(folder)
    marks.writer.drain()
    assert not grades._get(str(target)).get('conflict')
    assert settings(target)['grade']==starting
