"""Exercise D's actual unstable IDs only in newly made disposable folders."""
import json
import os
from pathlib import Path
import tempfile
import pytest
from test_library_file_commands import setup,Stop
from test_library_file_delete import Bin
from hdr_finisher.library_file_commands import FileCommands,FileRequest
from hdr_finisher.library_file_io import stable_ids,relocated
from hdr_finisher.library_file_state import document_paths
from hdr_finisher.library_marks import LibraryMarks,MarkChange
from hdr_finisher.media_browser import MediaBrowserStore
from hdr_finisher.library_index import LibraryIndex


@pytest.fixture
def fat(setup,tmp_path):
    output=Path(__file__).resolve().parents[1]/'output'
    if os.name!='nt' or stable_ids(output): pytest.skip('This workspace is not on a FAT filesystem')
    original,_,_,doc=setup;root=Path(tempfile.mkdtemp(prefix='exfat-command-',dir=output))
    folder=root/'shoot';folder.mkdir();target=root/'target';target.mkdir()
    photo=folder/original.name;photo.write_bytes(original.read_bytes())
    doc=document_paths(doc,str(original),str(photo));Path(str(photo)+'.hdrf').write_text(json.dumps(doc),encoding='utf-8')
    (folder/'notes.txt').write_bytes(b'unknown file content');(folder/'empty').mkdir()
    marks=LibraryMarks(tmp_path/'fat-app');browser=MediaBrowserStore(tmp_path/'fat-app');index=LibraryIndex(marks,browser,None)
    c=FileCommands(marks,browser,index);marks.read([str(photo)]);marks.change([str(photo)],MarkChange(rating=5))
    return photo,target,c,doc


BOUNDARIES=[(op,stage) for op in ['rename','move'] for stage in ['record','photo_staged','photo','settings_published','settings','indexed','before_clear']]
BOUNDARIES += [('folder_rename',stage) for stage in ['record','folder_staged','folder','folder_settings_staged','settings_published','settings','indexed','before_clear']]
BOUNDARIES += [('cross',stage) for stage in ['copy_chunk','verified','photo','source_removed','settings_published','settings','indexed','before_clear']]
BOUNDARIES += [('delete',stage) for stage in ['record','delete_settings_staged','settings_published','delete_prepared','recycle_returned','photo_deleted','settings_recycle_returned','settings_deleted','indexed','before_clear']]


@pytest.mark.parametrize('op,stage',BOUNDARIES)
def test_real_exfat_interruption_boundaries(fat,monkeypatch,op,stage):
    from hdr_finisher import library_recycle
    photo,target,c,doc=fat;bin=Bin(photo.parent.parent/'disposable-bin')
    bin.find=lambda p,s,h: bin.entries.get(str(p)) if bin.entries.get(str(p)) and relocated(bin.entries[str(p)],s,h) else None
    if op=='delete': monkeypatch.setattr(library_recycle,'available',lambda p:True);bin.attach(c)
    c.hook=lambda at,item:(_ for _ in ()).throw(Stop()) if at==stage else None
    request=FileRequest(action='move' if op=='cross' else op,paths=[str(photo.parent if op=='folder_rename' else photo)],name='new' if op in {'rename','folder_rename'} else '',destination=str(target))
    plan=c.plan(request)
    with pytest.raises(Stop):
        if op=='cross':
            record=c.plans.pop(plan['token']);record['items'][0]['cross']=True;c.save(record);c.run(record)
        else: c.execute(plan['token'],'recycle' if op=='delete' else '')
    restarted=FileCommands(c.marks,c.browser,c.index);bin.attach(restarted)
    for r in list(restarted.records.values()): restarted.run(r,True)
    assert not restarted.records, restarted.status()['attention']
    new=photo.with_name('new.ARW') if op=='rename' else photo.parent.with_name('new')/photo.name if op=='folder_rename' else target/photo.name
    if op=='delete':
        new=Path(bin.entries[str(photo)]);side=Path(bin.entries[str(photo)+'.hdrf'])
    else: side=Path(str(new)+'.hdrf')
    assert new.read_bytes()==b'original pixels'*100 and not photo.exists()
    saved=json.loads(side.read_text(encoding='utf-8'))
    assert saved['marks']['rating']==5 and saved['albums']==doc['albums'] and saved['virtual_copies']==doc['virtual_copies']
    assert saved['grade_history']==doc['grade_history']
    if op=='folder_rename': assert (new.parent/'notes.txt').read_bytes()==b'unknown file content' and (new.parent/'empty').is_dir()


def test_changed_exfat_staging_file_is_never_overwritten(fat):
    photo,target,c,_=fat;plan=c.plan(FileRequest(action='move',paths=[str(photo)],destination=str(target)))
    record=c.plans.pop(plan['token']);record['items'][0]['cross']=True;c.save(record)
    c.hook=lambda at,item:(_ for _ in ()).throw(Stop()) if at=='copy_chunk' else None
    with pytest.raises(Stop):c.run(record)
    stage=Path(record['items'][0]['stage']);stage.write_bytes(b'something else now owns this temporary name')
    restarted=FileCommands(c.marks,c.browser,c.index)
    for r in list(restarted.records.values()): restarted.run(r,True)
    assert not restarted.records and stage.read_bytes()==b'something else now owns this temporary name'
    assert (target/photo.name).read_bytes()==b'original pixels'*100


@pytest.mark.parametrize('folder',[False,True])
def test_identical_arrival_cannot_be_mistaken_for_a_completed_move(fat,folder):
    import shutil
    photo,target,c,_=fat;old=photo.parent if folder else photo
    plan=c.plan(FileRequest(action='folder_move' if folder else 'move',paths=[str(old)],destination=str(target)))
    c.hook=lambda at,item:(_ for _ in ()).throw(Stop()) if at=='record' else None
    with pytest.raises(Stop):c.execute(plan['token'])
    if folder: shutil.copytree(old,target/old.name)
    else: shutil.copy2(old,target/old.name)
    restarted=FileCommands(c.marks,c.browser,c.index)
    for r in list(restarted.records.values()): restarted.run(r,True)
    assert restarted.status()['attention'] and photo.exists() and Path(str(photo)+'.hdrf').exists()
    assert (target/old.name).exists()
