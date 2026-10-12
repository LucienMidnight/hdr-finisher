import json
from pathlib import Path
from types import SimpleNamespace
import pytest
from test_library_file_commands import setup, Stop
from hdr_finisher.library_file_commands import FileCommands, FileRequest
from hdr_finisher.library_marks import MarkChange


def command(c,old,destination=None,name=None):
    p=c.plan(FileRequest(action='folder_rename' if name else 'folder_move',paths=[str(old)],name=name or '',destination=str(destination or '')))
    return c.execute(p['token'])


@pytest.mark.parametrize('at',['record','folder_staged','folder','folder_settings_staged','settings_published','settings','indexed','cleared_item','before_clear'])
@pytest.mark.parametrize('operation',['rename','move'])
def test_folder_interruption_carries_unknown_files_and_state(setup,at,operation):
    photo,destination,c,doc=setup;old=photo.parent
    nested=old/'inside';nested.mkdir();unknown=nested/'notes.txt';unknown.write_bytes(b'unknown content')
    c.browser.add_pin(str(old));c.browser.add_pin(str(nested))
    prefs={'pin_labels':{str(nested):'Favourite'},'smart_albums':[{'filters':{'folders':[str(nested)]}}]}
    c.index.preferences_path.write_text(json.dumps(prefs))
    c.marks.change([str(photo)],MarkChange(rating=5))
    c.hook=lambda stage,item: (_ for _ in ()).throw(Stop()) if stage==at else None
    with pytest.raises(Stop): command(c,old,destination,name='เที่ยว' if operation=='rename' else None)
    new=old.with_name('เที่ยว') if operation=='rename' else destination/old.name
    restarted=FileCommands(c.marks,c.browser,c.index)
    for r in list(restarted.records.values()): restarted.run(r,True)
    assert not restarted.records and not old.exists()
    assert (new/'inside'/'notes.txt').read_bytes()==b'unknown content'
    moved=new/photo.name;assert moved.read_bytes()==b'original pixels'*100
    saved=json.loads(Path(str(moved)+'.hdrf').read_text(encoding='utf-8'))
    assert saved['marks']['rating']==5 and saved['albums']==doc['albums'] and saved['virtual_copies']==doc['virtual_copies']
    assert saved['grade']['source']['durable_path']==str(moved) and saved['grade_history']==doc['grade_history']
    assert c.marks.album_paths('keepers')==[str(moved)]
    assert {p['path'] for p in c.browser.pinned()}=={str(new),str(new/'inside')}
    values=json.loads(c.index.preferences_path.read_text(encoding='utf-8'));assert values['pin_labels']=={str(new/'inside'):'Favourite'}
    assert values['smart_albums'][0]['filters']['folders']==[str(new/'inside')]
    c.marks.writer.drain();assert not old.exists() and not list(new.rglob('*.tmp'))


def test_folder_no_merge_cross_drive_grade_and_undo_clash(setup):
    photo,destination,c,_=setup;old=photo.parent
    (destination/old.name).mkdir();(destination/old.name/'occupant.txt').write_bytes(b'keep')
    result=command(c,old,destination);assert result['count']==0 and old.exists() and 'never merged' in result['warnings'][0]
    c.cross_drive=lambda a,b:True
    p=c.plan(FileRequest(action='folder_move',paths=[str(old)],destination=str(destination)))
    assert 'same drive' in p['warnings'][0] and old.exists()
    c.cross_drive=lambda a,b:False
    c.store=SimpleNamespace(_current=SimpleNamespace(source_reference=lambda:SimpleNamespace(durable_path=photo)))
    result=command(c,old,destination);assert 'Open another photo' in result['warnings'][0] and old.exists()
    c.store=None;command(c,old,name='other');old.mkdir();(old/'occupant.txt').write_bytes(b'keep')
    result=c.marks.undo();assert old.joinpath('occupant.txt').read_bytes()==b'keep' and old.with_name('other').exists() and result['warnings']


def test_folder_case_only_and_one_undo(setup):
    photo,destination,c,_=setup;old=photo.parent
    command(c,old,name='SHOOT');new=old.with_name('SHOOT')
    assert any(p.name=='SHOOT' for p in old.parent.iterdir()) and len(c.marks._undo)==1
    c.marks.undo();assert any(p.name=='shoot' for p in old.parent.iterdir()) and Path(str(photo)+'.hdrf').exists()


def test_folder_forward_when_old_name_taken_and_settings_changed(setup):
    photo,destination,c,_=setup;old=photo.parent
    c.hook=lambda at,item: (_ for _ in ()).throw(Stop()) if at=='folder' else None
    with pytest.raises(Stop): command(c,old,name='new')
    old.mkdir();(old/'occupant.txt').write_bytes(b'new occupant')
    new=old.with_name('new');side=Path(str(new/photo.name)+'.hdrf');original=side.read_bytes();side.write_bytes(b'external settings')
    restarted=FileCommands(c.marks,c.browser,c.index);r=next(iter(restarted.records.values()));restarted.run(r,True)
    assert restarted.status()['attention'] and side.read_bytes()==b'external settings' and (new/photo.name).exists()
    # Cannot guess even if the changed file is rewritten byte-for-byte: its stamp differs.
    assert old.joinpath('occupant.txt').read_bytes()==b'new occupant'
