import json
import os
import sys
from pathlib import Path
import pytest
from test_library_file_commands import setup,Stop
from hdr_finisher.library_file_commands import FileCommands,FileRequest
from hdr_finisher.library_file_io import rename,same
from hdr_finisher.library_marks import MarkChange
from hdr_finisher import library_recycle

pytestmark = pytest.mark.skipif(os.name != 'nt' and sys.platform != 'darwin', reason='Library file commands require Windows or macOS.')
permanent_windows = pytest.mark.skipif(os.name != 'nt', reason='Only Windows offers explicit permanent deletion.')


class Bin:
    def __init__(self,root): self.root=root;root.mkdir();self.entries={}
    def recycle(self,path):
        target=self.root/(str(len(self.entries))+'-'+Path(path).name)
        rename(path,target);self.entries[str(path)]=str(target);return str(target)
    def find(self,path,stamp,checksum,reference=None):
        target=self.entries.get(str(path))
        return target if target and same(target,stamp,checksum) else None
    def attach(self,c): c.recycle=self.recycle;c.recycle_find=self.find


def delete(c,photo,confirmation='recycle'):
    plan=c.plan(FileRequest(action='delete',paths=[str(photo)]));return c.execute(plan['token'],confirmation)


@pytest.mark.parametrize('stage',['record','delete_settings_staged','settings_published','settings','delete_prepared','photo_deleted','recycle_returned','settings_recycle_returned','settings_deleted','indexed','cleared_item','before_clear'])
def test_recycle_interruptions_keep_settings_and_pending_marks(setup,monkeypatch,stage):
    photo,_,c,doc=setup;monkeypatch.setattr(library_recycle,'available',lambda p:True)
    bin=Bin(photo.parent.parent/'disposable-bin');bin.attach(c)
    c.marks.change([str(photo)],MarkChange(rating=5));c.hook=lambda at,i:(_ for _ in ()).throw(Stop()) if at==stage else None
    with pytest.raises(Stop): delete(c,photo)
    restarted=FileCommands(c.marks,c.browser,c.index);bin.attach(restarted)
    for r in list(restarted.records.values()): restarted.run(r,True)
    assert not restarted.records and not photo.exists() and not Path(str(photo)+'.hdrf').exists()
    assert Path(bin.entries[str(photo)]).read_bytes()==b'original pixels'*100
    settings=json.loads(Path(bin.entries[str(photo)+'.hdrf']).read_text(encoding='utf-8'))
    assert settings['marks']['rating']==5 and settings['albums']==doc['albums'] and settings['grade']==doc['grade']
    assert settings['grade_history']==doc['grade_history'] and settings['virtual_copies']==doc['virtual_copies']
    assert not c.marks.album_paths('keepers') and not c.marks._query('SELECT * FROM settings_writes')
    c.marks.writer.drain();assert not Path(str(photo)+'.hdrf').exists()


@pytest.mark.windows_only
@pytest.mark.parametrize('stage',['record','delete_settings_staged','settings_published','settings','delete_prepared','photo_deleted','settings_deleted','indexed','before_clear'])
@permanent_windows
def test_permanent_delete_is_explicit_and_recovers(setup,monkeypatch,stage):
    photo,_,c,_=setup;monkeypatch.setattr(library_recycle,'available',lambda p:False)
    c.marks.change([str(photo)],MarkChange(rating=5))
    plan=c.plan(FileRequest(action='delete',paths=[str(photo)]));assert plan['permanent']==1 and plan['recycle']==0
    with pytest.raises(ValueError,match='Confirm'): c.execute(plan['token'],'recycle')
    assert photo.exists() and Path(str(photo)+'.hdrf').exists() and not c.records
    c.hook=lambda at,i:(_ for _ in ()).throw(Stop()) if at==stage else None
    with pytest.raises(Stop): c.execute(plan['token'],'permanent')
    restarted=FileCommands(c.marks,c.browser,c.index)
    for r in list(restarted.records.values()): restarted.run(r,True)
    assert not restarted.records and not photo.exists() and not Path(str(photo)+'.hdrf').exists()


def test_restored_photo_keeps_leftover_settings_and_reappears(setup,monkeypatch):
    photo,_,c,doc=setup;monkeypatch.setattr(library_recycle,'available',lambda p:True)
    bin=Bin(photo.parent.parent/'bin');bin.attach(c)
    c.hook=lambda at,i:(_ for _ in ()).throw(Stop()) if at=='photo_deleted' else None
    with pytest.raises(Stop): delete(c,photo)
    rename(bin.entries[str(photo)],photo)
    side=Path(str(photo)+'.hdrf');before=side.read_bytes()
    restarted=FileCommands(c.marks,c.browser,c.index);bin.attach(restarted)
    for r in list(restarted.records.values()): restarted.run(r,True)
    assert not restarted.records and photo.exists() and side.read_bytes()==before
    row=c.marks.read([str(photo)])['photos'][0];assert row['marks']==doc['marks'] and row['albums']==doc['albums']


def test_bin_failure_never_falls_back_and_names_locations(setup,monkeypatch):
    photo,_,c,doc=setup;monkeypatch.setattr(library_recycle,'available',lambda p:True)
    c.recycle=lambda p:(_ for _ in ()).throw(OSError('Bin unavailable'));c.recycle_find=lambda *a:None
    result=delete(c,photo);assert photo.exists() and Path(str(photo)+'.hdrf').exists() and result['count']==0
    assert c.status()['attention'][0]['old']==str(photo) and c.status()['attention'][0]['new']==library_recycle.label()
    assert json.loads(Path(str(photo)+'.hdrf').read_text())['grade']==doc['grade']
    record=next(iter(c.records.values()))
    parked=c.status()['attention']
    c.recycle=lambda _:pytest.fail('A parked delete must wait for an explicit retry')
    c.retry_pending()
    assert c.records[record['id']] is record and c.status()['attention']==parked


def test_two_photo_delete_checks_each_original_three_times_without_rewriting_settings(setup,monkeypatch):
    from collections import Counter
    from hdr_finisher import library_file_io
    photo,_,c,_=setup
    second=photo.with_name('second.ARW');second.write_bytes(b'second photo')
    side=Path(str(photo)+'.hdrf');side_before=side.read_bytes();inode=side.stat().st_ino
    hashes,listings,probes=Counter(),Counter(),Counter()
    actual_hash=library_file_io.hashlib.file_digest
    actual_listing=Path.iterdir
    def hash_file(stream,algorithm):
        hashes[stream.name]+=1
        return actual_hash(stream,algorithm)
    def list_path(path):
        listings[path]+=1
        return actual_listing(path)
    def available(path):
        probes[path.stat().st_dev]+=1
        return True
    monkeypatch.setattr(library_file_io.hashlib,'file_digest',hash_file)
    monkeypatch.setattr(Path,'iterdir',list_path)
    monkeypatch.setattr(library_recycle,'available',available)
    bin=Bin(photo.parent.parent/'bin');bin.attach(c)
    original_document=c.marks._document
    documents=Counter()
    def document(path,**kwargs):
        documents[path]+=1
        return original_document(path,**kwargs)
    monkeypatch.setattr(c.marks,'_document',document)
    plan=c.plan(FileRequest(action='delete',paths=[str(photo),str(second)]))
    assert plan['count']==2 and listings[photo.parent]==1 and sum(probes.values())==1
    assert documents[photo]==1 and documents[second]==0
    result=c.execute(plan['token'],'recycle')
    assert result['count']==2 and not result['warnings']
    assert all(hashes[str(original)]==3 and hashes[bin.entries[str(original)]]==1 for original in (photo,second))
    settings_receipt=Path(bin.entries[str(side)])
    assert settings_receipt.read_bytes()==side_before and settings_receipt.stat().st_ino==inode


@pytest.mark.parametrize('case',['unstable_ids','recovery'])
def test_unstable_volume_and_recovery_keep_run_start_hash(setup,monkeypatch,case):
    from hdr_finisher import library_file_io
    photo,_,c,_=setup
    monkeypatch.setattr(library_recycle,'available',lambda _:True)
    bin=Bin(photo.parent.parent/'bin');bin.attach(c)
    hashes=[]
    actual=library_file_io.hashlib.file_digest
    def monitored(stream,algorithm):
        hashes.append(stream.name)
        return actual(stream,algorithm)
    monkeypatch.setattr(library_file_io.hashlib,'file_digest',monitored)
    if case=='recovery':
        c.hook=lambda at,_:(_ for _ in ()).throw(Stop()) if at=='record' else None
        with pytest.raises(Stop): delete(c,photo)
        c=FileCommands(c.marks,c.browser,c.index);bin.attach(c)
        c.retry_pending()
    else:
        monkeypatch.setattr('hdr_finisher.library_file_delete.stable_ids',lambda _:False)
        delete(c,photo)
    assert not c.records and not photo.exists()
    assert hashes.count(str(photo))==4 and hashes.count(bin.entries[str(photo)])==1


@pytest.mark.parametrize('kind',['malformed','link','conflict','missing'])
def test_delete_preview_warns_about_bad_item_but_keeps_valid_selection(setup,monkeypatch,kind):
    photo,_,c,_=setup
    valid=photo.with_name('valid.ARW');valid.write_bytes(b'valid original')
    side=Path(str(photo)+'.hdrf')
    if kind=='malformed': side.write_text('not settings')
    if kind=='link':
        side.unlink()
        try: side.symlink_to(side.with_name('missing.hdrf'))
        except OSError as e:
            if os.name=='nt' and getattr(e,'winerror',None)==1314: pytest.skip('Windows did not grant symlink creation')
            raise
    if kind=='conflict': side.with_name(photo.name+'.hdrf (conflict)').write_bytes(side.read_bytes())
    if kind=='missing': photo.unlink()
    monkeypatch.setattr(library_recycle,'available',lambda _:True)
    bin=Bin(photo.parent.parent/'bin');bin.attach(c)
    plan=c.plan(FileRequest(action='delete',paths=[str(photo),str(valid)]))
    assert plan['count']==1 and len(plan['warnings'])==1 and photo.name in plan['warnings'][0]
    result=c.execute(plan['token'],'recycle')
    assert result['count']==1 and len(result['warnings'])==1 and str(valid) in bin.entries
    assert side.exists() or side.is_symlink()


@pytest.mark.mac_only
@pytest.mark.skipif(sys.platform!='darwin',reason='macOS Trash registers in-app Undo.')
def test_retry_cannot_claim_just_confirmed_trash_delete(setup,monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    photo,_,c,_=setup
    monkeypatch.setattr(library_recycle,'available',lambda _:True)
    Bin(photo.parent.parent/'bin').attach(c)
    notices=[]
    c.notify=notices.append
    with ThreadPoolExecutor(1) as pool:
        def retry_at_save(stage,item):
            if stage=='record': pool.submit(c.retry_pending).result(timeout=2)
        c.hook=retry_at_save
        result=delete(c,photo)
        assert result['count']==1 and result['undo_available'] and not notices
        assert c.epoch==result['revision']==1
        assert c.status()['recent_changes']==[{'revision':1,'changes':result['changes'],'removed_copies':[]}]
        c.marks.undo()
        assert photo.exists() and Path(str(photo)+'.hdrf').exists()


def test_two_separate_commands_remain_in_revision_order_for_health(setup,monkeypatch):
    photo,_,c,_=setup
    second=photo.with_name('second.ARW');second.write_bytes(b'second photo')
    monkeypatch.setattr(library_recycle,'available',lambda _:True)
    Bin(photo.parent.parent/'bin').attach(c)
    first=delete(c,photo);last=delete(c,second)
    assert (first['revision'],last['revision'],c.epoch)==(1,2,2)
    assert [entry['changes'] for entry in c.status()['recent_changes']]==[first['changes'],last['changes']]


def test_settings_changed_after_photo_deleted_are_not_removed(setup,monkeypatch):
    photo,_,c,_=setup;monkeypatch.setattr(library_recycle,'available',lambda p:True);bin=Bin(photo.parent.parent/'bin');bin.attach(c)
    c.hook=lambda at,i:(_ for _ in ()).throw(Stop()) if at=='photo_deleted' else None
    with pytest.raises(Stop): delete(c,photo)
    side=Path(str(photo)+'.hdrf');side.write_bytes(b'external settings')
    restarted=FileCommands(c.marks,c.browser,c.index);bin.attach(restarted)
    for r in list(restarted.records.values()): restarted.run(r,True)
    assert restarted.status()['attention'] and side.read_bytes()==b'external settings' and not photo.exists()


def test_delete_rejected_only_and_late_answer(setup,monkeypatch):
    photo,_,c,_=setup;monkeypatch.setattr(library_recycle,'available',lambda p:True)
    Bin(photo.parent.parent/'bin').attach(c)
    second=photo.with_name('keep.ARW');second.write_bytes(b'keep');c.marks.read([str(second)])
    c.marks.change([str(photo)],MarkChange(pick='reject'))
    plan=c.plan(FileRequest(action='delete_rejected',paths=[str(photo),str(second)]));assert plan['count']==1
    c.execute(plan['token'],'recycle');assert not photo.exists() and second.exists()
    c.index.remember_facts([{'path':str(photo),'bytes':5,'mtime_ns':1}]);assert not c.marks._query('SELECT * FROM files WHERE path=?',(str(photo),))


@pytest.mark.windows_only
@permanent_windows
def test_delete_before_attempt_reports_present_original_conservatively(setup,monkeypatch):
    photo,_,c,_=setup;monkeypatch.setattr(library_recycle,'available',lambda p:False)
    c.hook=lambda at,i:(_ for _ in ()).throw(Stop()) if at=='delete_started' else None
    with pytest.raises(Stop): delete(c,photo,'permanent')
    restarted=FileCommands(c.marks,c.browser,c.index)
    for r in list(restarted.records.values()): restarted.run(r,True)
    assert photo.exists() and Path(str(photo)+'.hdrf').exists() and restarted.status()['attention']


@pytest.mark.windows_only
@permanent_windows
def test_permanent_gap_and_explorer_move_never_guess_settings_destination(setup,monkeypatch):
    photo,destination,c,_=setup;monkeypatch.setattr(library_recycle,'available',lambda p:False)
    c.hook=lambda at,i:(_ for _ in ()).throw(Stop()) if at=='permanent_returned' else None
    with pytest.raises(Stop): delete(c,photo,'permanent')
    side=Path(str(photo)+'.hdrf');before=side.read_bytes()
    restarted=FileCommands(c.marks,c.browser,c.index)
    for r in list(restarted.records.values()): restarted.run(r,True)
    assert not photo.exists() and side.read_bytes()==before and restarted.status()['attention']
    assert 'could not be proved' in restarted.status()['attention'][0]['message']


@pytest.mark.windows_only
def test_actual_windows_bin_receipt_recovers_before_checkpoint(setup):
    """Only pytest's disposable originals enter the real Bin; never empty it."""
    import os
    if os.name!='nt': pytest.skip('Windows explicit RecycleItem')
    photo,_,c,doc=setup
    if not library_recycle.available(photo): pytest.skip('This disposable drive has no Bin')
    c.hook=lambda at,i:(_ for _ in ()).throw(Stop()) if at=='recycle_returned' else None
    with pytest.raises(Stop): delete(c,photo)
    record=next(iter(c.records.values()));original=record['items'][0]
    recycled=library_recycle.find(photo,original['stamp'],original['checksum'])
    assert recycled and Path(recycled).read_bytes()==b'original pixels'*100
    restarted=FileCommands(c.marks,c.browser,c.index)
    for r in list(restarted.records.values()): restarted.run(r,True)
    assert not restarted.records and not photo.exists() and not Path(str(photo)+'.hdrf').exists()
    side=library_recycle.find(str(photo)+'.hdrf',original['delete_side_stamp'],original['delete_side_hash'])
    assert side and json.loads(Path(side).read_text(encoding='utf-8'))['marks']==doc['marks']


@pytest.mark.parametrize('boundary',[None,'before_copy_remove','copy_remove_returned','copy_removed','copy_error'])
def test_mixed_selection_never_deletes_a_copy_source(tmp_path,monkeypatch,boundary):
    from hdr_finisher.library_marks import LibraryMarks
    from hdr_finisher.media_browser import MediaBrowserStore
    from hdr_finisher.library_index import LibraryIndex
    from PIL import Image
    from hdr_finisher.sessions import SessionStore
    from hdr_finisher.library_grades import LibraryGrades
    from hdr_finisher.library_copies import LibraryCopies
    from hdr_finisher.library_marks import LibraryMarks
    from hdr_finisher.media_browser import MediaBrowserStore
    from hdr_finisher.library_index import LibraryIndex
    photos=[tmp_path/'delete.png',tmp_path/'keep.png']
    for p in photos: Image.new('RGB',(8,8),(120,80,50)).save(p)
    marks=LibraryMarks(tmp_path/'app');store=SessionStore();LibraryGrades(marks,store);copies=LibraryCopies(marks)
    a=copies.create(str(photos[0]),'clean','Attached')['photos'][0]
    b=copies.create(str(photos[1]),'clean','Separate')['photos'][0]
    d=copies.create(str(photos[1]),'clean','Second')['photos'][0]
    browser=MediaBrowserStore(tmp_path/'app');index=LibraryIndex(marks,browser,None);c=FileCommands(marks,browser,index,None,store)
    monkeypatch.setattr(library_recycle,'available',lambda p:True)
    bin=Bin(tmp_path/'bin');bin.attach(c)
    preview=c.plan(FileRequest(action='delete',paths=[str(photos[0]),a['path'],b['path'],d['path']]))
    assert preview['count']==1 and preview['attached_copies']==1 and preview['copy_paths']==[b['path'],d['path']]
    if boundary=='copy_error':
        remove=c.marks.copies.remove_many
        monkeypatch.setattr(c.marks.copies,'remove_many',lambda *a,**k:(_ for _ in ()).throw(OSError('copy settings locked')))
        failed=c.execute(preview['token'],'recycle')
        assert failed['count']==1 and failed['warnings'] and c.records and not photos[0].exists()
        assert c.status()['attention']
        monkeypatch.setattr(c.marks.copies,'remove_many',remove)
        c=FileCommands(marks,browser,index,None,store)
        bin.attach(c)
        result=c.run(next(iter(c.records.values())),True)
        assert not c.records
    elif boundary:
        c.hook=lambda at,i:(_ for _ in ()).throw(Stop()) if at==boundary else None
        with pytest.raises(Stop): c.execute(preview['token'],'recycle')
        c=FileCommands(marks,browser,index,None,store)
        bin.attach(c)
        record=next(iter(c.records.values()));result=c.run(record,True)
        assert not c.records
    else: result=c.execute(preview['token'],'recycle')
    marks.writer.drain()
    assert result['removed_copies']==[b['path'],d['path']]
    assert result['count']==1 and result['copies_count']==2 and not photos[0].exists() and photos[1].exists()
    assert not copies.items(str(photos[1])) and not Path(str(photos[0])+'.hdrf').exists()
    if sys.platform=='darwin' and boundary is None:
        c.marks.undo();assert photos[0].exists()
    c.marks.undo();assert photos[1].exists() and len(copies.items(str(photos[1])))==2


def test_complete_bin_delete_then_restore_both_rehydrates_marks_and_albums(setup,monkeypatch):
    photo,_,c,doc=setup;monkeypatch.setattr(library_recycle,'available',lambda p:True);bin=Bin(photo.parent.parent/'bin');bin.attach(c)
    delete(c,photo);assert not c.marks.album_paths('keepers')
    for path in [str(photo),str(photo)+'.hdrf']: rename(bin.entries[path],path)
    s=photo.stat();c.index.remember_scan(str(photo.parent),[{'path':str(photo),'bytes':s.st_size,'mtime_ns':s.st_mtime_ns}])
    row=c.marks.read([str(photo)])['photos'][0]
    assert row['marks']==doc['marks'] and c.marks.album_paths('keepers')==[str(photo)]
    assert json.loads(Path(str(photo)+'.hdrf').read_text())['virtual_copies']==doc['virtual_copies']


def test_delete_confirmation_counts_only_eligible_originals_and_their_copies(setup,monkeypatch):
    photo,destination,c,_=setup
    def refuse(path): raise ValueError('Settings contain additional data; left alone.')
    monkeypatch.setattr('hdr_finisher.library_file_delete.check_streams',refuse)
    preview=c.plan(FileRequest(action='delete',paths=[str(photo)]))
    assert preview['count']==0 and preview['attached_copies']==0
    assert preview['warnings'] and photo.exists() and Path(str(photo)+'.hdrf').exists()


def test_slow_bin_probe_does_not_own_marks_lock(setup,monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event
    photo,_,service,_=setup
    entered,release=Event(),Event()
    def probe(path):
        entered.set();assert release.wait(5)
        return True
    monkeypatch.setattr(library_recycle,'available',probe)
    with ThreadPoolExecutor(1) as pool:
        task=pool.submit(service.plan,FileRequest(action='delete',paths=[str(photo)]))
        try:
            assert entered.wait(5)
            assert service.marks._lock.acquire(timeout=.2)
            service.marks._lock.release()
        finally:release.set()
        assert task.result()['count']==1
        assert photo.exists()


def test_partial_delete_publishes_removed_photo_with_settings_pending(setup,monkeypatch):
    photo,_,c,_=setup
    other=photo.with_name('other.ARW');other.write_bytes(b'other disposable original')
    c.marks.read([str(other)])
    monkeypatch.setattr(library_recycle,'available',lambda p:True)
    bin=Bin(photo.parent.parent/'bin');bin.attach(c)
    recycle=c.recycle
    def fail_settings(path):
        if str(path)==str(photo)+'.hdrf': raise OSError('settings locked')
        return recycle(path)
    c.recycle=fail_settings
    plan=c.plan(FileRequest(action='delete',paths=[str(photo),str(other)]))
    result=c.execute(plan['token'],'recycle')
    assert result['count']==2 and result['settings_pending']==1
    assert {i['old'] for i in c.status()['changes']}=={str(photo),str(other)}
    assert c.status()['attention'] and not photo.exists() and Path(str(photo)+'.hdrf').exists()
    epoch=c.epoch
    c.recycle=recycle
    c.run(next(iter(c.records.values())),True)
    assert not c.records and c.epoch==epoch and c.status()['revision']==result['revision']


def test_source_activation_excluded_during_delete_without_holding_store_lock(setup,monkeypatch):
    from threading import Event,Thread
    from types import SimpleNamespace
    from hdr_finisher.sessions import SessionStore
    photo,_,c,_=setup;c.store=SessionStore()
    monkeypatch.setattr(library_recycle,'available',lambda p:True)
    Bin(photo.parent.parent/'bin').attach(c)
    entered,release=Event(),Event();errors=[]
    def pause(at,item):
        if at=='delete_started':
            entered.set()
            if not release.wait(5): raise ValueError('test timed out')
    c.hook=pause
    plan=c.plan(FileRequest(action='delete',paths=[str(photo)]))
    def execute():
        try: c.execute(plan['token'],'recycle')
        except BaseException as error: errors.append(error)
    thread=Thread(target=execute);thread.start()
    try:
        assert entered.wait(5)
        session=SimpleNamespace(to_payload=lambda:None,source_reference=lambda:SimpleNamespace(durable_path=photo))
        with pytest.raises(ValueError,match='file command in progress'): c.store.activate_session(session)
        assert c.store.current() is None and photo.exists()
    finally:
        release.set();thread.join(5)
    assert not thread.is_alive() and not errors and not photo.exists()
    assert not c.store.file_command_sources


@pytest.mark.parametrize('state',['paused','cancelled','write_failure'])
def test_copy_removal_waits_for_permission_and_durable_sidecar(tmp_path,monkeypatch,state):
    from hdr_finisher.library_marks import LibraryMarks
    from hdr_finisher.media_browser import MediaBrowserStore
    from hdr_finisher.library_index import LibraryIndex
    from PIL import Image
    from hdr_finisher.sessions import SessionStore
    from hdr_finisher.library_grades import LibraryGrades
    from hdr_finisher.library_copies import LibraryCopies
    photo=tmp_path/'keep.png';Image.new('RGB',(8,8)).save(photo)
    marks=LibraryMarks(tmp_path/'app');store=SessionStore();LibraryGrades(marks,store);copies=LibraryCopies(marks)
    key=copies.create(str(photo),'clean','Separate')['photos'][0]['path']
    marks.writer.drain()
    browser=MediaBrowserStore(tmp_path/'app');index=LibraryIndex(marks,browser,None);c=FileCommands(marks,browser,index,None,store)
    record={'id':'test','action':'delete','items':[{'old':str(photo),'new':'Recycle Bin','done':True,'cancelled':True}],'warnings':[],'copy_paths':[key]}
    if state!='write_failure':
        record[state]=True;c.save(record);c.run(record)
        assert copies.items(str(photo))
    else:
        write=marks._write_sidecar
        monkeypatch.setattr(marks,'_write_sidecar',lambda *a,**k:(_ for _ in ()).throw(PermissionError('settings locked')))
        c.save(record);c.run(record)
        assert c.records and not record.get('copies_removed')
        assert json.loads(Path(str(photo)+'.hdrf').read_text())['virtual_copies']
        # Rebuild the disposable database: recovery must remove the old disk copy.
        root=tmp_path/'rebuilt';rebuilt=LibraryMarks(root);LibraryGrades(rebuilt,store);LibraryCopies(rebuilt)
        c.marks=rebuilt;rebuilt.file_commands=c
        c.run(record,True)
        assert not c.records and not rebuilt.copies.items(str(photo))


def test_copy_only_result_excludes_grade_copy(tmp_path):
    from hdr_finisher.library_marks import LibraryMarks
    from hdr_finisher.media_browser import MediaBrowserStore
    from hdr_finisher.library_index import LibraryIndex
    from PIL import Image
    from hdr_finisher.sessions import SessionStore
    from hdr_finisher.library_grades import LibraryGrades
    from hdr_finisher.library_copies import LibraryCopies
    photo=tmp_path/'keep.png';Image.new('RGB',(8,8)).save(photo)
    marks=LibraryMarks(tmp_path/'app');store=SessionStore();grades=LibraryGrades(marks,store);copies=LibraryCopies(marks)
    keys=[copies.create(str(photo),'clean',name)['photos'][0]['path'] for name in ['First','Second']]
    browser=MediaBrowserStore(tmp_path/'app');index=LibraryIndex(marks,browser,None);c=FileCommands(marks,browser,index,None,store)
    plan=c.plan(FileRequest(action='delete',paths=keys))
    grades.history.current=lambda key:key==keys[0]
    result=c.execute(plan['token'],'recycle')
    assert result['removed_copies']==[keys[1]] and result['copies_count']==1
    assert len(copies.items(str(photo)))==1


def test_fresh_bin_delete_does_not_search_old_receipts(setup,monkeypatch):
    photo,_,c,_=setup
    monkeypatch.setattr(library_recycle,'available',lambda p:True)
    Bin(photo.parent.parent/'bin').attach(c)
    def unexpected(*args): raise AssertionError('A present original does not need receipt recovery')
    c.recycle_find=unexpected
    result=delete(c,photo)
    assert result['count']==1 and not photo.exists() and not Path(str(photo)+'.hdrf').exists()
