import json
import os
from pathlib import Path
import pytest
from test_library_file_commands import setup,Stop
from hdr_finisher.library_file_commands import FileCommands,FileRequest
from hdr_finisher.library_file_io import rename,same
from hdr_finisher.library_marks import MarkChange
from hdr_finisher import library_recycle

pytestmark = pytest.mark.skipif(os.name != 'nt', reason='Library file commands are Windows-only in this version.')


class Bin:
    def __init__(self,root): self.root=root;root.mkdir();self.entries={}
    def recycle(self,path):
        target=self.root/(str(len(self.entries))+'-'+Path(path).name)
        rename(path,target);self.entries[str(path)]=str(target);return str(target)
    def find(self,path,stamp,checksum):
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


@pytest.mark.parametrize('stage',['record','delete_settings_staged','settings_published','settings','delete_prepared','photo_deleted','settings_deleted','indexed','before_clear'])
def test_permanent_delete_is_explicit_and_recovers(setup,monkeypatch,stage):
    photo,_,c,_=setup;monkeypatch.setattr(library_recycle,'available',lambda p:False)
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
    assert c.status()['attention'][0]['old']==str(photo) and c.status()['attention'][0]['new']=='Recycle Bin'
    assert json.loads(Path(str(photo)+'.hdrf').read_text())['grade']==doc['grade']


def test_settings_changed_after_photo_deleted_are_not_removed(setup,monkeypatch):
    photo,_,c,_=setup;monkeypatch.setattr(library_recycle,'available',lambda p:True);bin=Bin(photo.parent.parent/'bin');bin.attach(c)
    c.hook=lambda at,i:(_ for _ in ()).throw(Stop()) if at=='photo_deleted' else None
    with pytest.raises(Stop): delete(c,photo)
    side=Path(str(photo)+'.hdrf');side.write_bytes(b'external settings')
    restarted=FileCommands(c.marks,c.browser,c.index);bin.attach(restarted)
    for r in list(restarted.records.values()): restarted.run(r,True)
    assert restarted.status()['attention'] and side.read_bytes()==b'external settings' and not photo.exists()


def test_delete_rejected_only_and_late_answer(setup,monkeypatch):
    photo,_,c,_=setup;monkeypatch.setattr(library_recycle,'available',lambda p:False)
    second=photo.with_name('keep.ARW');second.write_bytes(b'keep');c.marks.read([str(second)])
    c.marks.change([str(photo)],MarkChange(pick='reject'))
    plan=c.plan(FileRequest(action='delete_rejected',paths=[str(photo),str(second)]));assert plan['count']==1
    c.execute(plan['token'],'permanent');assert not photo.exists() and second.exists()
    c.index.remember_facts([{'path':str(photo),'bytes':5,'mtime_ns':1}]);assert not c.marks._query('SELECT * FROM files WHERE path=?',(str(photo),))


def test_delete_before_attempt_reports_present_original_conservatively(setup,monkeypatch):
    photo,_,c,_=setup;monkeypatch.setattr(library_recycle,'available',lambda p:False)
    c.hook=lambda at,i:(_ for _ in ()).throw(Stop()) if at=='delete_started' else None
    with pytest.raises(Stop): delete(c,photo,'permanent')
    restarted=FileCommands(c.marks,c.browser,c.index)
    for r in list(restarted.records.values()): restarted.run(r,True)
    assert photo.exists() and Path(str(photo)+'.hdrf').exists() and restarted.status()['attention']


def test_permanent_gap_and_explorer_move_never_guess_settings_destination(setup,monkeypatch):
    photo,destination,c,_=setup;monkeypatch.setattr(library_recycle,'available',lambda p:False)
    c.hook=lambda at,i:(_ for _ in ()).throw(Stop()) if at=='permanent_returned' else None
    with pytest.raises(Stop): delete(c,photo,'permanent')
    side=Path(str(photo)+'.hdrf');before=side.read_bytes()
    restarted=FileCommands(c.marks,c.browser,c.index)
    for r in list(restarted.records.values()): restarted.run(r,True)
    assert not photo.exists() and side.read_bytes()==before and restarted.status()['attention']
    assert 'could not be proved' in restarted.status()['attention'][0]['message']


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


def test_mixed_selection_never_deletes_a_copy_source(tmp_path,monkeypatch):
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
    browser=MediaBrowserStore(tmp_path/'app');index=LibraryIndex(marks,browser,None);c=FileCommands(marks,browser,index,None,store)
    monkeypatch.setattr(library_recycle,'available',lambda p:False)
    preview=c.plan(FileRequest(action='delete',paths=[str(photos[0]),a['path'],b['path']]))
    assert preview['count']==1 and preview['attached_copies']==1 and preview['copy_paths']==[b['path']]
    result=c.execute(preview['token'],'permanent');marks.writer.drain()
    assert result['count']==1 and result['copies_count']==1 and not photos[0].exists() and photos[1].exists()
    assert not copies.items(str(photos[1])) and not Path(str(photos[0])+'.hdrf').exists()
    c.marks.undo();assert photos[1].exists() and len(copies.items(str(photos[1])))==1


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
