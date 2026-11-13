"""Disposable-file macOS coverage; real Trash checks require the shared lock."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from threading import Event

import pytest
from test_library_file_commands import setup, Stop
from hdr_finisher import library_file_io, library_recycle
from hdr_finisher.library_file_commands import FileCommands, FileRequest
from hdr_finisher.library_marks import MarkChange

pytestmark = pytest.mark.skipif(sys.platform != 'darwin', reason='macOS native primitives')
real_trash = pytest.mark.skipif(os.environ.get('HDR_FINISHER_TEST_MAC_TRASH') != '1',
    reason='Run with HDR_FINISHER_TEST_MAC_TRASH=1 through gpu-run-lock.py')


@pytest.fixture
def receipts(monkeypatch):
    entries=[]
    recycle=library_recycle.recycle
    def tracked(path):
        stamp=library_file_io.signature(path);checksum=library_file_io.digest(path)
        receipt=recycle(path)
        entries.append((receipt,stamp,checksum))
        return receipt
    monkeypatch.setattr(library_recycle,'recycle',tracked)
    yield entries
    for path,stamp,checksum in entries:
        if library_file_io.relocated(path,stamp,checksum):
            Path(path).unlink()


def test_native_no_replace_preserves_files_and_folders(tmp_path):
    for folder in (False,True):
        source=tmp_path/('source-'+str(folder));target=tmp_path/('target-'+str(folder))
        if folder:
            source.mkdir();target.mkdir()
        else:
            source.write_bytes(b'source');target.write_bytes(b'occupant')
        with pytest.raises(FileExistsError): library_file_io.rename(source,target)
        assert source.exists() and target.exists()
        if not folder: assert source.read_bytes()==b'source' and target.read_bytes()==b'occupant'


def test_trash_unavailable_never_offers_permanent_delete(setup,monkeypatch):
    photo,_,service,_=setup
    side=Path(str(photo)+'.hdrf');before=side.read_bytes()
    monkeypatch.setattr(library_recycle,'available',lambda path:False)
    plan=service.plan(FileRequest(action='delete',paths=[str(photo)]))
    assert plan['count']==0 and plan['permanent']==0 and plan['warnings']
    with pytest.raises(ValueError,match='Confirm'): service.execute(plan['token'],'permanent')
    assert service.execute(plan['token'],'recycle')['count']==0
    assert photo.exists() and side.read_bytes()==before and not service.records


@real_trash
def test_saved_recovery_reference_survives_its_creating_process(tmp_path,receipts):
    photo=tmp_path/'bookmark-photo';photo.write_bytes(b'process-independent recovery')
    stamp=library_file_io.signature(photo);checksum=library_file_io.digest(photo)
    code='from hdr_finisher import library_recycle; import sys; print(library_recycle.reference(sys.argv[1]))'
    reference=subprocess.check_output([sys.executable,'-c',code,str(photo)],
        cwd=Path(library_file_io.__file__).parent.parent,text=True).strip()
    receipt=library_recycle.recycle(photo)
    assert library_recycle.find(photo,stamp,checksum,reference)==receipt
    assert library_recycle.find(photo,stamp,checksum,'invalid bookmark') is None
    library_file_io.rename(receipt,photo)
    assert photo.read_bytes()==b'process-independent recovery'


def test_cross_volume_copy_preserves_extended_attributes(setup):
    photo,destination,service,_=setup
    subprocess.run(['xattr','-w','org.hdrfinisher.test','photo-metadata',str(photo)],check=True)
    subprocess.run(['xattr','-w','org.hdrfinisher.test','side-metadata',str(photo)+'.hdrf'],check=True)
    plan=service.plan(FileRequest(action='move',paths=[str(photo)],destination=str(destination)))
    record=service.plans.pop(plan['token']);record['items'][0]['cross']=True
    service.save(record);service.run(record)
    new=destination/photo.name
    assert not service.records and not photo.exists()
    for path,expected in [(new,'photo-metadata'),(Path(str(new)+'.hdrf'),'side-metadata')]:
        assert subprocess.check_output(['xattr','-p','org.hdrfinisher.test',str(path)],text=True).strip()==expected


def test_owned_removal_recovers_after_atomic_capture(tmp_path,monkeypatch):
    photo=tmp_path/'photo';photo.write_bytes(b'checked original')
    stamp=library_file_io.signature(photo);checksum=library_file_io.digest(photo)
    native=library_file_io.rename
    def interrupted(source,target,replace=False):
        native(source,target,replace)
        raise Stop()
    monkeypatch.setattr(library_file_io,'rename',interrupted)
    with pytest.raises(Stop): library_file_io.remove_owned(photo,stamp,checksum)
    assert library_file_io.removal_pending(photo,stamp)
    monkeypatch.setattr(library_file_io,'rename',native)
    library_file_io.remove_owned(photo,stamp,checksum)
    assert not photo.exists() and not library_file_io.removal_pending(photo,stamp)


def test_owned_removal_never_unlinks_a_replacement(tmp_path):
    photo=tmp_path/'photo';photo.write_bytes(b'checked original')
    stamp=library_file_io.signature(photo);checksum=library_file_io.digest(photo)
    photo.unlink();photo.write_bytes(b'replacement')
    with pytest.raises(ValueError,match='changed'): library_file_io.remove_owned(photo,stamp,checksum)
    assert photo.read_bytes()==b'replacement'


def test_changed_destination_retains_original_even_during_removal(tmp_path):
    source=tmp_path/'source';target=tmp_path/'target'
    source.write_bytes(b'original');target.write_bytes(b'original')
    source_stamp=library_file_io.signature(source);target_stamp=library_file_io.signature(target)
    checksum=library_file_io.digest(source)
    with pytest.raises(ValueError,match='checked copy changed'):
        with library_file_io.read_guard(target,target_stamp,checksum):
            library_file_io.remove_owned(source,source_stamp,checksum)
            target.write_bytes(b'changed')
    assert source.read_bytes()==b'original' and target.read_bytes()==b'changed'


@pytest.mark.skipif(not os.environ.get('HDR_FINISHER_TEST_CROSS_VOLUME'), reason='No disposable second volume selected')
@pytest.mark.parametrize('stage',['copy_chunk','verified','photo','source_removed','settings_published','settings','indexed','before_clear'])
def test_real_cross_volume_recovery_and_undo(setup,stage):
    photo,_,service,document=setup
    with tempfile.TemporaryDirectory(prefix='hdr-filecmd-',dir=os.environ['HDR_FINISHER_TEST_CROSS_VOLUME']) as folder:
        destination=Path(folder)
        assert photo.stat().st_dev!=destination.stat().st_dev
        plan=service.plan(FileRequest(action='move',paths=[str(photo)],destination=folder))
        record=service.plans.pop(plan['token']);assert record['items'][0]['cross']
        service.save(record)
        service.hook=lambda at,item:(_ for _ in ()).throw(Stop()) if at==stage else None
        with pytest.raises(Stop): service.run(record)
        restarted=FileCommands(service.marks,service.browser,service.index)
        for pending in list(restarted.records.values()): restarted.run(pending,True)
        target=destination/photo.name
        assert not restarted.records and not photo.exists() and target.read_bytes()==b'original pixels'*100
        saved=json.loads(Path(str(target)+'.hdrf').read_text())
        for key in ('marks','albums','grade_history','virtual_copies'): assert saved[key]==document[key]
        plan=restarted.plan(FileRequest(action='move',paths=[str(target)],destination=str(photo.parent)))
        record=restarted.plans.pop(plan['token']);restarted.save(record);restarted.run(record)
        done=Event();restarted.hook=lambda at,item:done.set() if at=='before_clear' else None
        restarted.marks.undo();assert done.wait(10)
        with restarted._lane:
            assert not restarted.records
        assert not photo.exists() and target.read_bytes()==b'original pixels'*100


@pytest.mark.parametrize('stage',['record','photo_staged','photo','settings_published','settings','indexed','cleared_item','before_clear'])
@real_trash
def test_trash_undo_recovers_after_crash(setup,receipts,stage):
    photo,_,service,document=setup;service.recycle=library_recycle.recycle
    plan=service.plan(FileRequest(action='delete',paths=[str(photo)]))
    service.execute(plan['token'],'recycle')
    service.hook=lambda at,item:(_ for _ in ()).throw(Stop()) if at==stage else None
    with pytest.raises(Stop): service.marks.undo()
    restarted=FileCommands(service.marks,service.browser,service.index)
    for record in list(restarted.records.values()): restarted.run(record,True)
    assert not restarted.records and photo.read_bytes()==b'original pixels'*100
    saved=json.loads(Path(str(photo)+'.hdrf').read_text())
    for key in ('marks','albums','grade','grade_history','virtual_copies'): assert saved[key]==document[key]
    assert restarted.marks.album_paths('keepers')==[str(photo)]


@real_trash
@pytest.mark.parametrize('stage',['record','delete_settings_staged','settings_published','settings',
    'delete_prepared','recycle_returned','photo_deleted','settings_recycle_returned',
    'settings_deleted','indexed','cleared_item','before_clear'])
def test_real_trash_recovers_every_checkpoint(setup,receipts,stage):
    photo,_,service,document=setup
    service.recycle=library_recycle.recycle
    service.marks.change([str(photo)],MarkChange(rating=5))
    plan=service.plan(FileRequest(action='delete',paths=[str(photo)]))
    assert plan['count']==1 and plan['recycle_label']=='Trash' and plan['permanent']==0
    service.hook=lambda at,item:(_ for _ in ()).throw(Stop()) if at==stage else None
    with pytest.raises(Stop): service.execute(plan['token'],'recycle')
    restarted=FileCommands(service.marks,service.browser,service.index)
    for record in list(restarted.records.values()): restarted.run(record,True)
    assert not restarted.records and not photo.exists() and not Path(str(photo)+'.hdrf').exists()
    assert len(receipts)==2
    assert Path(receipts[0][0]).read_bytes()==b'original pixels'*100
    saved=json.loads(Path(receipts[1][0]).read_text())
    for key in ('albums','grade','grade_history','virtual_copies'): assert saved[key]==document[key]
    assert saved['marks']['rating']==5


@real_trash
def test_native_trash_undo_restores_grades_marks_copies_and_albums(setup,receipts):
    photo,_,service,document=setup;service.recycle=library_recycle.recycle
    service.marks.change([str(photo)],MarkChange(rating=5))
    plan=service.plan(FileRequest(action='delete',paths=[str(photo)]))
    assert service.execute(plan['token'],'recycle')['count']==1
    assert not photo.exists() and len(receipts)==2
    restored=service.marks.undo()
    assert restored['count']==1 and not restored['warnings'] and not service.records
    assert photo.read_bytes()==b'original pixels'*100
    saved=json.loads(Path(str(photo)+'.hdrf').read_text())
    assert saved['marks']['rating']==5
    for key in ('albums','grade','grade_history','virtual_copies'): assert saved[key]==document[key]
    assert service.marks.album_paths('keepers')==[str(photo)]
    assert not any(Path(path).exists() for path,_,_ in receipts)


@real_trash
def test_trash_undo_refuses_occupied_original_name(setup,receipts):
    photo,_,service,_=setup;service.recycle=library_recycle.recycle
    plan=service.plan(FileRequest(action='delete',paths=[str(photo)]))
    service.execute(plan['token'],'recycle');photo.write_bytes(b'new arrival')
    with pytest.raises(ValueError,match='occupied'): service.marks.undo()
    assert photo.read_bytes()==b'new arrival' and all(Path(path).exists() for path,_,_ in receipts)


@real_trash
def test_delete_started_recovery_does_not_delete_possible_restoration(setup,receipts):
    photo,_,service,_=setup;service.recycle=library_recycle.recycle
    plan=service.plan(FileRequest(action='delete',paths=[str(photo)]))
    service.hook=lambda at,item:(_ for _ in ()).throw(Stop()) if at=='delete_started' else None
    with pytest.raises(Stop): service.execute(plan['token'],'recycle')
    restarted=FileCommands(service.marks,service.browser,service.index)
    for record in list(restarted.records.values()): restarted.run(record,True)
    assert photo.exists() and Path(str(photo)+'.hdrf').exists() and not receipts
    assert restarted.status()['attention']
