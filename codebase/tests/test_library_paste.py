"""Selective bulk paste exercises saved documents, virtual items and durable work."""
from copy import deepcopy
from pathlib import Path
import pytest
from test_library_grades import setup, saved, settings
from hdr_finisher.library_copies import LibraryCopies
from hdr_finisher.library_paste import LibraryPaste
from hdr_finisher.sessions import SessionStore

HDR='global_adjustments.hdr.exposure'


def test_schema_order_authored_labels_and_safe_defaults(setup):
    from hdr_finisher.library_paste import MODULE_ORDER, leaves, setting_label
    photo,store,session,marks,grades=setup
    paste=LibraryPaste(grades)
    grade=session.edit_document().model_dump(mode='json')
    groups=paste.schema(grade,grade)
    assert [group['id'] for group in groups[:6]] == [
        'raw-development','lens-corrections','highlight-reconstruction','geometry','perspective','local-adjustments']
    assert [group['id'] for group in groups if group['lane']=='hdr'] == ['hdr-'+module for module in MODULE_ORDER]
    expected={path for lane in ('hdr','sdr') for field,data in grade['global_adjustments'][lane].items()
              if field not in ('highlight_compression_source_peak_nits','highlight_compression_source_peak_percent',
                               'linked_to_hdr','output_exposure')
              for path in leaves(data,'global_adjustments.'+lane+'.'+field)}
    expected.update(leaves(grade['global_adjustments']['shared']['geometry'],'global_adjustments.shared.geometry'))
    expected.update(leaves({key:data for key,data in grade['source']['raw_import_settings'].items() if key!='lens'},'source.raw_import_settings'))
    expected.update('source.raw_import_settings.lens.'+key for key in ('mode','distortion','chromatic_aberration','vignetting'))
    expected.update({'local_adjustments','global_adjustments.shared.local_adjustments_enabled','global_adjustments.shared.film_grain_seed'})
    for lane in ('hdr','sdr'):
        expected.add('denoise.'+lane+'.enabled')
        expected.update(leaves(grade['denoise'][lane]['controls'],'denoise.'+lane+'.controls'))
    assert {row['id'] for group in groups for row in group['settings']} == expected
    colour=next(group for group in groups if group['id']=='hdr-color')
    assert 'global_adjustments.hdr.highlight_desaturation' in {row['id'] for row in colour['settings']}
    selected=set(paste.selection(groups)['settings'])
    for group in groups:
        assert all(row['label'] and 'Â' not in row['label'] and '_' not in row['label'] for row in group['settings'])
        assert all((row['id'] in selected) == (group['id'] not in ('lens-corrections','geometry','perspective','local-adjustments')) for row in group['settings'])
    assert setting_label('global_adjustments.hdr.color_grading.shadows.luminance_ev') == 'Shadows · Luminance (EV)'


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
    monkeypatch.setattr(paste,'document',lambda path, **options:(deepcopy(document),deepcopy(document)))
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


def test_cold_preview_never_imports_or_schedules(setup, monkeypatch):
    from hdr_finisher.library_scheduler import scheduler
    photo,store,session,marks,grades=setup
    saved(setup); paste=LibraryPaste(grades); paste.copy(str(photo))
    cold=photo.with_name('cold.png');cold.write_bytes(photo.read_bytes())
    before=deepcopy(grades._get(str(cold)))
    def forbidden(*args, **kwargs): raise AssertionError('Preview started heavy work')
    monkeypatch.setattr(SessionStore,'prepare_session',forbidden)
    monkeypatch.setattr(scheduler,'ask',forbidden)
    for _ in range(3):
        result=paste.paste([str(photo),str(cold)],preview=True)
        assert result['count']==0 and result['unchecked']==1
    assert grades._get(str(cold))==before


def test_cancel_keeps_reservation_until_import_stops_and_changes_no_grades(setup, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event
    from hdr_finisher.library_scheduler import Scheduler
    import hdr_finisher.library_paste as module
    photo,store,session,marks,grades=setup
    saved(setup); paste=LibraryPaste(grades);paste.copy(str(photo));store.clear()
    local=Scheduler();monkeypatch.setattr(module,'scheduler',local)
    cold=photo.with_name('cold.png');cold.write_bytes(photo.read_bytes())
    second=photo.with_name('second.png');second.write_bytes(photo.read_bytes())
    entered,stop_seen,release=Event(),Event(),Event(); imports=[]
    def develop(self,path,**options):
        imports.append(str(path));entered.set()
        assert release.wait(3)
        assert options['cancelled']();stop_seen.set()
        raise RuntimeError('Import cancelled')
    monkeypatch.setattr(SessionStore,'prepare_session',develop)
    token=paste.begin()['token']
    with ThreadPoolExecutor() as pool:
        work=pool.submit(paste.prepare,str(cold),token)
        assert entered.wait(3)
        assert len(local.jobs)==1 and next(iter(local.jobs.values())).granted is not None
        paste.cancel(token)
        assert len(local.jobs)==1  # decoder still owns its buffers
        release.set()
        with pytest.raises(ValueError,match='cancelled'):work.result(timeout=3)
    assert stop_seen.is_set() and not local.jobs
    with pytest.raises(ValueError,match='cancelled'):paste.prepare(str(second),token)
    with pytest.raises(ValueError,match='cancelled'):paste.paste([str(cold)],token=token)
    assert imports==[str(cold)]
    assert not grades._get(str(cold)).get('desired')
    assert not Path(str(cold)+'.hdrf').exists()


def test_cold_imports_share_lane_and_yield_to_grade(setup, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event
    import time
    from hdr_finisher.library_scheduler import Scheduler
    import hdr_finisher.library_paste as module
    photo,store,session,marks,grades=setup
    local=Scheduler();monkeypatch.setattr(module,'scheduler',local)
    paste=LibraryPaste(grades)
    paths=[photo.with_name(name) for name in ('one.png','two.png')]
    for path in paths:path.write_bytes(photo.read_bytes())
    real=SessionStore.prepare_session;entered,preempted=Event(),Event();calls=[]
    def develop(self,path,**options):
        calls.append(str(path))
        assert sum(j.kind=='paste-import' and j.granted is not None for j in local.jobs.values())==1
        if len(calls)==1:
            entered.set()
            for _ in range(100):
                if options['cancelled']():preempted.set();raise RuntimeError('Import cancelled')
                time.sleep(.01)
            raise AssertionError('Grade did not preempt preparation')
        return real(self,path,**options)
    monkeypatch.setattr(SessionStore,'prepare_session',develop)
    with ThreadPoolExecutor() as pool:
        first=pool.submit(paste.prepare,str(paths[0]));assert entered.wait(3)
        local.ask('grade','backend',str(photo),'grade-import',0,'Grade')
        assert preempted.wait(3)
        second=pool.submit(paste.prepare,str(paths[1]))
        local.finish('grade')
        assert first.result(timeout=10)['ready'] and second.result(timeout=10)['ready']
    assert len(calls)==3 and not local.jobs


def test_paste_import_never_uses_floor_or_over_ceiling_allowance():
    from hdr_finisher.library_scheduler import Scheduler
    local=Scheduler();local.update(total=3_800_000_000)
    job=local.ask('paste','backend','photo.ARW','paste-import',300_000_000,'now')
    assert job.granted is None and not job.floor and not job.alone
    local.finish('paste')
    huge=local.ask('large','backend','photo.ARW','paste-import',3_000_000_000,'soon')
    assert huge.granted is None and huge.reason=='needs more memory'


def test_disconnected_preparation_request_stops_import(setup, monkeypatch):
    import asyncio
    from threading import Event
    from fastapi import APIRouter, HTTPException
    from hdr_finisher.library_scheduler import Scheduler
    import hdr_finisher.library_paste as module
    photo,store,session,marks,grades=setup
    local=Scheduler();monkeypatch.setattr(module,'scheduler',local)
    router=APIRouter();module.add_paste_routes(router,grades)
    endpoint=next(route.endpoint for route in router.routes if route.path=='/grade-prepare')
    cold=photo.with_name('disconnected.png');cold.write_bytes(photo.read_bytes())
    entered,disconnect=Event(),Event()
    class Connection:
        async def is_disconnected(self):return disconnect.is_set()
    def develop(self,path,**options):
        entered.set()
        for _ in range(100):
            if options['cancelled']():raise RuntimeError('Import cancelled')
            import time
            time.sleep(.01)
        raise AssertionError('Disconnect failed to cancel import')
    monkeypatch.setattr(SessionStore,'prepare_session',develop)
    async def exercise():
        task=asyncio.create_task(endpoint({'path':str(cold)},Connection()))
        while not entered.is_set():await asyncio.sleep(.01)
        disconnect.set()
        with pytest.raises(HTTPException,match='cancelled'):
            await asyncio.wait_for(task,3)
    asyncio.run(exercise())
    assert not local.jobs and not grades._get(str(cold)).get('desired')

def test_cancel_is_not_stuck_behind_another_request_for_the_same_photo(setup, monkeypatch):
    import time
    photo,store,session,marks,grades=setup
    saved(setup); paste=LibraryPaste(grades)
    cold=photo.with_name('cold-wait.png');cold.write_bytes(photo.read_bytes())
    monkeypatch.setattr(paste.pictures,'default_document',lambda source:None)
    lock=paste._path_lock(str(marks._path(str(cold)))); lock.acquire()
    try:
        started=time.monotonic()
        with pytest.raises(ValueError, match='cancelled'):
            paste.copy(str(cold), cancelled=lambda:time.monotonic()-started>.2)
        assert time.monotonic()-started<2
    finally:
        lock.release()


@pytest.mark.parametrize('enabled', [True, False])
def test_sdr_only_denoise_saved_count_and_undo(setup, enabled):
    from hdr_finisher.models import EditDocument
    photo, store, session, marks, grades = setup
    saved(setup)
    before = session.edit_document().model_dump(mode='json')
    before['denoise']['sdr']['enabled'] = not enabled
    store.replace_edit_document(str(session.session_id), EditDocument.model_validate(before), session.edit_revision)
    grades.save(str(session.session_id)); marks.writer.drain()
    paste = LibraryPaste(grades); paste.copy(str(photo))
    paste.clipboard['grade']['denoise']['sdr']['enabled'] = enabled
    paste.clipboard['grade']['denoise']['hdr']['enabled'] = True
    selection = {'lanes': ['sdr'], 'settings': ['denoise.hdr.enabled', 'denoise.sdr.enabled']}
    assert paste.paste([str(photo)], selection, preview=True)['count'] == 1
    assert paste.paste([str(photo)], selection)['count'] == 1
    marks.writer.drain()
    expected = deepcopy(before); expected['denoise']['sdr']['enabled'] = enabled
    assert settings(photo)['grade'] == expected
    assert paste.paste([str(photo)], selection, preview=True)['count'] == 0
    marks.undo(); marks.writer.drain()
    assert settings(photo)['grade'] == before


@pytest.mark.parametrize('cancel_grade', [False, True])
def test_real_grade_start_waits_for_paste_release(setup, monkeypatch, cancel_grade):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event
    from hdr_finisher.import_jobs import ImportJobManager
    from hdr_finisher.media_browser import MediaBrowserStore
    from hdr_finisher.models import RawImportSettings
    from hdr_finisher.library_scheduler import Scheduler
    import hdr_finisher.library_scheduler as scheduler_module
    import hdr_finisher.library_paste as module
    photo, store, session, marks, grades = setup
    local = Scheduler()
    monkeypatch.setattr(module, 'scheduler', local)
    monkeypatch.setattr(scheduler_module, 'scheduler', local)
    paste = LibraryPaste(grades)
    cold = photo.with_name('cold.png'); cold.write_bytes(photo.read_bytes())
    paste_entered, release_paste, grade_entered, release_grade = (Event() for _ in range(4))
    real = SessionStore.prepare_session
    attempts = []
    def prepare(self, path, **options):
        if Path(path) == cold:
            attempts.append(path)
            if len(attempts) == 1:
                paste_entered.set()
                assert release_paste.wait(5)
                if options['cancelled']():
                    raise RuntimeError('Import cancelled')
        else:
            grade_entered.set()
            assert not any(j.kind == 'paste-import' and j.granted is not None for j in local.jobs.values())
            assert release_grade.wait(5)
        return real(self, path, **options)
    monkeypatch.setattr(SessionStore, 'prepare_session', prepare)
    manager = ImportJobManager(store, MediaBrowserStore(marks.database.parent))
    try:
        with ThreadPoolExecutor() as pool:
            work = pool.submit(paste.prepare, str(cold))
            assert paste_entered.wait(3)
            job = manager.start(photo, RawImportSettings())
            assert not grade_entered.wait(.15)
            assert next(j for j in local.jobs.values() if j.kind == 'paste-import').granted is not None
            if cancel_grade: manager.cancel(job.job_id)
            release_paste.set()
            if not cancel_grade:
                assert grade_entered.wait(3)
                assert len(attempts) == 1  # paste cannot restart ahead of Grade
            release_grade.set()
            manager._executor.shutdown(wait=True)
            if not cancel_grade:
                assert job.payload()['state'] == 'ready'
                assert local.opening  # Backend-ready is still before the first Grade picture.
                assert len(attempts) == 1
                assert not manager.presented('obsolete-session')
                assert local.opening
                assert manager.presented(job.session_id)
            assert work.result(timeout=10)['ready']
            assert job.payload()['state'] == ('cancelled' if cancel_grade else 'ready')
            assert grade_entered.is_set() == (not cancel_grade)
            assert not local.jobs
    finally:
        release_paste.set(); release_grade.set(); manager.close()


def test_redevelopment_same_session_releases_the_new_opening_not_an_old_ticket(setup, monkeypatch):
    from hdr_finisher.import_jobs import ImportJobManager
    from hdr_finisher.media_browser import MediaBrowserStore
    from hdr_finisher.models import RawImportSettings
    from hdr_finisher.library_scheduler import Scheduler
    import hdr_finisher.library_scheduler as module
    photo, store, session, marks, grades = setup
    local = Scheduler()
    monkeypatch.setattr(module, 'scheduler', local)
    manager = ImportJobManager(store, MediaBrowserStore(marks.database.parent))
    try:
        for _ in range(2):
            job = manager.start(photo, RawImportSettings(), replace_session_id=str(session.session_id))
            manager._executor.submit(lambda: None).result(timeout=5)
            assert job.state == 'ready' and job.session_id == str(session.session_id)
            assert local.opening and not job.presented
            assert manager.presented(job.session_id)
            assert job.presented and not local.opening and not local.jobs
    finally:
        manager.close()


@pytest.mark.parametrize('lane', ['hdr','sdr'])
def test_paste_creatives_only_unlinks_when_sdr_changes(setup, lane):
    photo,store,session,marks,grades=setup
    saved(setup); paste=LibraryPaste(grades); paste.copy(str(photo))
    doc=session.edit_document().model_copy(deep=True)
    doc.global_adjustments.sdr.linked_to_hdr=True
    doc.global_adjustments.sdr.use_authored_base=False
    doc.global_adjustments.sdr.exposure=.25
    doc.global_adjustments.hdr.exposure=0
    store.replace_edit_document(str(session.session_id),doc,session.edit_revision)
    grades.save(str(session.session_id));marks.writer.drain()
    before=paste.document(str(photo))[0]
    paste.paste([str(photo)],{'lanes':[lane],'settings':['global_adjustments.'+lane+'.exposure']})
    actual=paste.document(str(photo))[0]
    assert actual['global_adjustments']['sdr']['linked_to_hdr'] == (lane=='hdr')
    assert 'global_adjustments.sdr.linked_to_hdr' not in {row['id'] for group in paste.schema(actual,actual) for row in group['settings']}
    marks.undo();assert paste.document(str(photo))[0]==before
