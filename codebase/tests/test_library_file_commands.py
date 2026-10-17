import json
import os
from pathlib import Path
from types import SimpleNamespace
import pytest
from hdr_finisher.library_marks import LibraryMarks, MarkChange
from hdr_finisher.library_index import LibraryIndex
from hdr_finisher.media_browser import MediaBrowserStore
from hdr_finisher.library_file_commands import FileCommands, FileRequest

pytestmark = pytest.mark.skipif(os.name != 'nt', reason='Library file commands are Windows-only in this version.')


class Stop(BaseException): pass


@pytest.fixture
def setup(tmp_path):
    folder=tmp_path/'shoot';folder.mkdir();destination=tmp_path/'destination';destination.mkdir()
    photo=folder/'photo.ARW';photo.write_bytes(b'original pixels'*100)
    doc={'format':'HDR Finisher Photo','schema_version':1,'photo_id':'original','source':{'filename':photo.name},'contains_source_pixels':False,
         'marks':{'rating':4,'pick':'pick','label':'green','tags':['holiday']},'albums':['keepers'],
         'grade':{'source':{'filename':photo.name,'durable_path':str(photo)},'edit':'authored'},'grade_history':{'previous':[1,2]},
         'virtual_copies':[{'photo_id':'copy','name':'Alternative','marks':{'rating':3},'albums':['copies']}]}
    side=Path(str(photo)+'.hdrf');side.write_text(json.dumps(doc),encoding='utf-8')
    root=tmp_path/'app';marks=LibraryMarks(root);browser=MediaBrowserStore(root);index=LibraryIndex(marks,browser,None)
    marks.read([str(photo)]);s=photo.stat();index.remember_scan(str(folder),[{'path':str(photo),'bytes':s.st_size,'mtime_ns':s.st_mtime_ns}])
    return photo,destination,FileCommands(marks,browser,index),doc


def perform(service,photo,destination=None,name=None):
    r=service.plan(FileRequest(action='rename' if name else 'move',paths=[str(photo)],name=name or '',destination=str(destination or '')))
    return service.execute(r['token'])


@pytest.mark.parametrize('stage',['record','photo_staged','photo','settings_published','settings','indexed','cleared_item','before_clear'])
@pytest.mark.parametrize('operation',['rename','move'])
def test_recovery_at_every_boundary(setup,stage,operation):
    photo,destination,c,doc=setup
    def stop(at,item):
        if at==stage: raise Stop()
    c.hook=stop
    with pytest.raises(Stop): perform(c,photo,name='เที่ยว' if operation=='rename' else None,destination=destination)
    new=photo.with_name('เที่ยว.ARW') if operation=='rename' else destination/photo.name
    restarted=FileCommands(c.marks,c.browser,c.index)
    for record in list(restarted.records.values()): restarted.run(record,True)
    assert not restarted.records and not photo.exists() and new.read_bytes()==b'original pixels'*100
    saved=json.loads(Path(str(new)+'.hdrf').read_text(encoding='utf-8'))
    assert saved['marks']==doc['marks'] and saved['albums']==doc['albums'] and saved['virtual_copies']==doc['virtual_copies']
    assert saved['grade_history']==doc['grade_history'] and saved['source']['filename']==new.name
    assert saved['grade']['source']['durable_path']==str(new)
    assert not Path(str(photo)+'.hdrf').exists()
    assert c.marks.album_paths('keepers')==[str(new)]


def test_pending_marks_are_carried_and_no_old_write(setup):
    photo,destination,c,doc=setup;c.marks.change([str(photo)],MarkChange(rating=5))
    perform(c,photo,name='new');new=photo.with_name('new.ARW')
    assert json.loads(Path(str(new)+'.hdrf').read_text())['marks']['rating']==5
    c.marks.writer.drain()
    assert not Path(str(photo)+'.hdrf').exists() and not c.marks._query('SELECT * FROM settings_writes')


def test_clash_choices_and_undo_clash(setup):
    photo,destination,c,doc=setup;(destination/photo.name).write_bytes(b'occupant')
    request=FileRequest(action='move',paths=[str(photo)],destination=str(destination))
    assert c.plan(request)['clashes'] and photo.exists()
    request.choices={str(photo):'cancel'};assert c.plan(request)['cancelled']
    request.choices={str(photo):'skip'};assert c.plan(request)['count']==0
    request.choices={str(photo):'keep'};plan=c.plan(request);result=c.execute(plan['token'])
    assert (destination/'photo (2).ARW').exists() and (destination/photo.name).read_bytes()==b'occupant'
    photo.write_bytes(b'new occupant');undo=c.marks.undo()
    assert photo.read_bytes()==b'new occupant' and (destination/'photo (2).ARW').exists() and undo['warnings']


def test_destination_settings_clash_after_photo_move_and_retry(setup):
    photo,destination,c,doc=setup
    def stop(at,item):
        if at=='photo': raise Stop()
    c.hook=stop
    with pytest.raises(Stop): perform(c,photo,destination)
    new=destination/photo.name;side=Path(str(new)+'.hdrf');side.write_bytes(b'occupant')
    restarted=FileCommands(c.marks,c.browser,c.index);record=next(iter(restarted.records.values()));restarted.run(record,True)
    assert restarted.status()['attention'] and side.read_bytes()==b'occupant' and Path(str(photo)+'.hdrf').exists()
    side.unlink();photo.write_bytes(b'old name taken');restarted.run(record,True)
    assert not restarted.records and photo.read_bytes()==b'old name taken' and json.loads(side.read_text())['marks']==doc['marks']


@pytest.mark.parametrize('boundary',['copy_chunk','verified','photo','source_removed','settings_published','settings','indexed','before_clear'])
def test_cross_drive_verified_copy_boundaries(setup,boundary):
    photo,destination,c,doc=setup;c.cross_drive=lambda a,b:True
    # Run synchronously for deterministic interruption injection, on disposable folders.
    request=FileRequest(action='move',paths=[str(photo)],destination=str(destination));plan=c.plan(request);record=c.plans.pop(plan['token']);c.save(record)
    def stop(at,item):
        if at==boundary: raise Stop()
    c.hook=stop
    with pytest.raises(Stop): c.run(record)
    if boundary in {'copy_chunk','verified'}: assert photo.exists() and not (destination/photo.name).exists()
    restarted=FileCommands(c.marks,c.browser,c.index);restarted.run(next(iter(restarted.records.values())),True)
    assert not restarted.records and not photo.exists() and (destination/photo.name).read_bytes()==b'original pixels'*100


def test_case_only_and_unicode_undo(setup):
    photo,destination,c,doc=setup;result=perform(c,photo,name='PHOTO');assert result['count']==1
    assert photo.with_name('PHOTO.ARW').exists();c.marks.undo()
    assert photo.exists() and json.loads(Path(str(photo)+'.hdrf').read_text())['source']['filename']==photo.name


def test_rename_undo_and_preview_stale(setup):
    photo,destination,c,doc=setup;perform(c,photo,name='new');c.marks.undo();assert photo.exists()
    plan=c.plan(FileRequest(action='rename',paths=[str(photo)],name='again'));c.marks.change([str(photo)],MarkChange(rating=1))
    with pytest.raises(ValueError,match='Marks or grades changed'):c.execute(plan['token'])
    assert photo.exists()


@pytest.mark.parametrize('failure',[PermissionError('locked'),OSError(28,'drive full'),FileNotFoundError('drive absent')])
def test_failure_never_destroys_original_pair(setup,monkeypatch,failure):
    photo,destination,c,doc=setup
    def fail(*args,**kwargs): raise failure
    monkeypatch.setattr('hdr_finisher.library_file_commands.rename',fail)
    result=perform(c,photo,destination)
    assert result['warnings'] and photo.exists() and Path(str(photo)+'.hdrf').exists()
    assert c.status()['attention']


def test_protected_conflict_unreadable_and_raw_jpeg_independent(setup):
    photo,destination,c,doc=setup
    c.store=SimpleNamespace(_current=SimpleNamespace(source_reference=lambda:SimpleNamespace(durable_path=photo)))
    assert c.plan(FileRequest(action='move',paths=[str(photo)],destination=str(destination)))['count']==0
    c.store=None
    extra=Path(str(photo)+'.hdrf conflict');extra.write_text(json.dumps(doc));assert c.plan(FileRequest(action='move',paths=[str(photo)],destination=str(destination)))['count']==0
    extra.unlink();Path(str(photo)+'.hdrf').write_bytes(b'broken')
    assert c.plan(FileRequest(action='move',paths=[str(photo)],destination=str(destination)))['count']==0
    Path(str(photo)+'.hdrf').write_text(json.dumps(doc));jpeg=photo.with_suffix('.jpg');jpeg.write_bytes(b'jpeg')
    perform(c,photo,destination);assert jpeg.read_bytes()==b'jpeg'


def test_retired_helper_facts_are_discarded(setup):
    photo,destination,c,doc=setup;s=photo.stat();perform(c,photo,destination)
    c.index.remember_facts([{'path':str(photo),'bytes':s.st_size,'mtime_ns':s.st_mtime_ns}])
    assert not c.marks._query('SELECT * FROM files WHERE path=?',(str(photo),))
    assert c.marks._query('SELECT * FROM files WHERE path=?',(str(destination/photo.name),))


def test_quick_and_kept_pictures_follow_without_new_identity(setup):
    import numpy as np
    from hdr_finisher.library_pictures import LibraryPictureCache,picture_key
    from hdr_finisher.library_kept import KeptPictures, PICTURE_VERSION
    photo,destination,c,doc=setup;cache=LibraryPictureCache(c.browser.root);cache.managed.prepare();cache.root.mkdir()
    old_key=picture_key(photo,512,'quick');meta={'path':str(photo),'edge':512,'quality':'quick'}
    with cache.file(old_key).open('wb') as f:np.savez_compressed(f,pixels=np.zeros((2,2,3)),metadata=np.asarray(json.dumps(meta)))
    kept=KeptPictures(c.browser.root,c.marks,None);grade_id='grade-identity';key=kept.key(str(photo),grade_id)
    (cache.root/(key+'.jpg')).write_bytes(b'kept picture');(cache.root/(key+'.json')).write_text(json.dumps({'grade_identity':grade_id,'extension':'jpg','source_stat':[photo.stat().st_size,photo.stat().st_mtime_ns],'edge':2560,'picture_version':PICTURE_VERSION}))
    perform(c,photo,destination);new=destination/photo.name
    assert cache.file(picture_key(new,512,'quick')).exists() and not cache.file(old_key).exists()
    new_key=kept.key(str(new),grade_id);assert (cache.root/(new_key+'.jpg')).read_bytes()==b'kept picture'
    assert kept.current_meta(str(new),grade_id)


def test_real_pending_grade_history_and_copies_travel(tmp_path):
    from PIL import Image
    from hdr_finisher.sessions import SessionStore
    from hdr_finisher.library_grades import LibraryGrades,grade_key
    from hdr_finisher.library_copies import LibraryCopies
    from test_library_grades import edit
    photo=tmp_path/'real.png';Image.new('RGB',(32,32),(120,80,50)).save(photo)
    store=SessionStore();session=store.get(store.create_session(photo,owns_source_path=False).session_id)
    marks=LibraryMarks(tmp_path/'app');grades=LibraryGrades(marks,store);copies=LibraryCopies(marks);grades.attach(str(session.session_id))
    edit(store,session);grades.save(str(session.session_id));copies.create(str(photo),'current','Alternative');marks.album_create('keepers',[str(photo)])
    expected=grades.merge(str(photo),marks._document(photo) or marks._new_document(marks._rows([str(photo)])[str(photo)]))
    store.clear();browser=MediaBrowserStore(tmp_path/'app');index=LibraryIndex(marks,browser,None);c=FileCommands(marks,browser,index,None,store)
    perform(c,photo,name='new');new=photo.with_name('new.png');saved=json.loads(Path(str(new)+'.hdrf').read_text())
    from hdr_finisher.library_file_state import document_paths
    expected=document_paths(expected,str(photo),str(new))
    assert grade_key(saved['grade'])==grade_key(expected['grade']) and saved['grade_history']==expected['grade_history']
    assert len(saved['virtual_copies'])==1 and saved['virtual_copies'][0]['name']=='Alternative'
    assert marks.album_paths('keepers')==[str(new)] and not marks._query('SELECT * FROM settings_writes')
    marks.undo();assert photo.exists() and copies.items(str(photo))[0]['name']=='Alternative'


def test_cross_drive_extra_streams_are_left_whole(setup):
    import os
    if os.name!='nt': pytest.skip('Windows named streams')
    photo,destination,c,_=setup
    stream=Path(str(photo)+':disposable-note');stream.write_bytes(b'additional original data')
    c.cross_drive=lambda a,b:True
    preview=c.plan(FileRequest(action='move',paths=[str(photo)],destination=str(destination)))
    assert preview['count']==0 and 'additional data streams' in preview['warnings'][0]
    assert photo.exists() and stream.read_bytes()==b'additional original data'


def test_settings_with_extra_streams_are_not_rewritten(setup):
    import os
    if os.name!='nt': pytest.skip('Windows named streams')
    photo,_,c,_=setup
    stream=Path(str(photo)+'.hdrf:disposable-note');stream.write_bytes(b'additional settings data')
    with pytest.raises(ValueError,match='additional data streams'): perform(c,photo,name='new')
    assert photo.exists() and stream.read_bytes()==b'additional settings data'


def test_late_read_rejected_inside_acceptance_lock_even_when_old_path_exists(setup):
    photo,destination,c,_=setup;epoch=c.epoch;stat=photo.stat()
    stale=[{'path':str(photo),'bytes':stat.st_size,'mtime_ns':stat.st_mtime_ns}]
    perform(c,photo,name='PHOTO')
    # Windows case-only rename leaves the old spelling readable; existence is not freshness.
    with pytest.raises(ValueError,match='Photos changed'):
        c.index.remember_scan(str(photo.parent),stale,epoch=epoch)
    with pytest.raises(ValueError,match='Photos changed'):
        c.index.remember_facts(stale,epoch=epoch)
    assert not c.marks._query('SELECT path FROM files WHERE path=?',(str(photo),))


def test_recovery_rebuilds_album_names_after_database_loss(setup):
    photo,destination,c,_=setup
    c.hook=lambda at,item: (_ for _ in ()).throw(Stop()) if at=='photo' else None
    with pytest.raises(Stop): perform(c,photo,name='new')
    c.marks.database.unlink()
    marks=LibraryMarks(c.browser.root);index=LibraryIndex(marks,c.browser,None)
    restarted=FileCommands(marks,c.browser,index)
    for record in list(restarted.records.values()): restarted.run(record,True)
    assert not restarted.records
    assert marks.album_paths('keepers')==[str(photo.with_name('new.ARW'))]
    assert any(row['name']=='keepers' for row in marks.albums())
