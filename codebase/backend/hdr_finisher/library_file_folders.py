"""Whole-folder moves use the same durable, forward-only command record."""
from copy import deepcopy
import json
import os
from pathlib import Path
from uuid import uuid4
from .desktop_security import SOURCE_EXTENSIONS
from .library_folder_commands import folder_name
from .library_file_io import signature, digest, same, occupied, rename, durable
from .library_file_state import snapshot, mapped, document_paths, retarget, pictures


def settings_files(service):
    return (service.browser.pinned_path, service.browser.recents_path, service.index.preferences_path)


def read_settings(service):
    values=[]
    for p in settings_files(service):
        try: value=json.loads(p.read_text(encoding='utf-8'))
        except FileNotFoundError: value=[] if p!=service.index.preferences_path else {}
        if not isinstance(value,dict if p==service.index.preferences_path else list):
            raise ValueError('Library settings could not be read. Nothing was changed.')
        values.append(value)
    return values


def plan(service,request):
    if request.action=='folder_rename' and len(request.paths)!=1: raise ValueError('Select one folder to rename.')
    destination=Path(request.destination).resolve(strict=True) if request.action=='folder_move' else None
    if destination is not None and not destination.is_dir(): raise ValueError('Choose a destination folder.')
    # Refuse unreadable user settings before touching the tree.
    read_settings(service)
    roots=[Path(p).resolve(strict=True) for p in dict.fromkeys(request.paths)]
    items=[];warnings=[];reserved=set()
    for old in roots:
        try:
            if old.is_symlink() or not old.is_dir() or old.parent==old: raise ValueError('Choose a normal folder, not a drive or link.')
            if any(old!=other and old.is_relative_to(other) for other in roots):
                warnings.append(f'{old}: included with its parent folder.');continue
            if service.blocked(old): raise ValueError('An earlier file command needs attention for this folder.')
            if service.protected(old,True): raise ValueError('Open another photo before changing this folder. Nothing was changed for it.')
            new=(destination or old.parent)/(folder_name(request.name) if request.action=='folder_rename' else old.name)
            if str(new)==str(old): warnings.append(f'{old}: unchanged.');continue
            if new != old and new.is_relative_to(old): raise ValueError('A folder cannot be moved inside itself.')
            if service.cross_drive(old,new): raise ValueError('Folders can only move within the same drive in this build. Nothing was moved.')
            if occupied(new,old) or str(new).casefold() in reserved: raise ValueError('That folder name is taken. Folders are never merged. Nothing was changed.')
            reserved.add(str(new).casefold());identifier=uuid4().hex
            children=[];files=[]
            def fail(error): raise error
            for parent,dirs,names in os.walk(old,followlinks=False,onerror=fail):
                if any(Path(parent,n).is_symlink() for n in dirs+names): raise ValueError('This folder contains a link and was left alone.')
                for name in names:
                    source=Path(parent,name);files.append({'path':str(source),'stamp':signature(source),'hash':digest(source)})
                    if source.suffix.lower() not in SOURCE_EXTENSIONS: continue
                    service.marks.conflicts.scan([str(source)])
                    if any(str(source)+'.hdrf' in c['files'] or c.get('photo')==str(source) for c in service.marks.conflicts.status()):
                        raise ValueError('More than one settings file was found inside this folder. The folder was left alone.')
                    doc=service.marks._document(source);row=service.marks.read([str(source)])['photos'][0]
                    if row['storage']=='database':
                        doc=deepcopy(doc) or service.marks._new_document(row);doc['marks']=row['marks'];doc['albums']=row['albums']
                        if getattr(service.marks,'grades',None): doc=service.marks.grades.merge(str(source),doc)
                    target=Path(mapped(str(source),str(old),str(new)));side=service.marks._sidecar(source);key=uuid4().hex
                    children.append({'old':str(source),'new':str(target),'payload':document_paths(doc,str(old),str(new)),
                        'stamp':signature(source),'checksum':digest(source),
                        'side_stamp':signature(side) if side.exists() else None,'side_hash':digest(side) if side.exists() else None,
                        'settings_old':str(target.parent/('.hdr-old-settings-'+key+'.tmp')),
                        'side_stage':str(target.parent/('.hdr-settings-'+key+'.tmp'))})
            items.append({'old':str(old),'new':str(new),'folder':True,'cross':False,'stamp':signature(old),
                'stage':str(old.parent/('.hdr-folder-'+identifier+'.tmp')),'files':files,'children':children,
                'rows':snapshot(service.marks,str(old),True),'done':False})
        except (OSError,ValueError) as e:
            if request.action=='folder_rename': raise
            warnings.append(f'{old}: {e}')
    token=uuid4().hex;service.plans[token]={'id':token,'action':request.action,'items':items,'warnings':warnings}
    return {'token':token,'count':len(items),'destination':str(destination or ''),'warnings':warnings,'clashes':[]}


def validate(service,item):
    if service.protected(item['old'],True): raise ValueError('Open another photo before changing this folder. Nothing was changed for it.')
    if signature(item['old'])[:2]!=item['stamp'][:2]: raise ValueError('The folder changed. Preview again; nothing was changed.')
    for entry in item['files']:
        if not same(entry['path'],entry['stamp'],entry['hash']): raise ValueError('A file inside the folder changed. Preview again; nothing was changed.')
    if snapshot(service.marks,item['old'],True)!=item['rows']: raise ValueError('Marks or grades changed. Preview again; nothing was changed.')


def follows(value,old,new):
    if isinstance(value,str): return mapped(value,old,new)
    if isinstance(value,list): return [follows(v,old,new) for v in value]
    if isinstance(value,dict): return {mapped(k,old,new):follows(v,old,new) for k,v in value.items()}
    return value


def run(service,record,item):
    old,new,stage=map(Path,(item['old'],item['new'],item['stage']))
    if service.protected(old,True) or service.protected(new,True): raise ValueError('Open another photo before changing this folder. Nothing was changed for it.')
    def identity(p):
        try: return p.is_dir() and signature(p)[:2]==item['stamp'][:2]
        except OSError: return False
    actual=any(str(p)==str(new) for p in new.parent.iterdir())
    if not actual or not identity(new):
        if occupied(new,old): raise ValueError('The destination is occupied. Both locations were left alone; folders are never merged.')
        if not identity(stage):
            if not identity(old): raise ValueError('The folder changed or is absent. Both locations were left alone.')
            rename(old,stage);service.checkpoint(record,item,'folder_staged')
        rename(stage,new);service.checkpoint(record,item,'folder')
    for child in item['children']:
        if not same(child['new'],child['stamp'],child['checksum']): raise ValueError(f"{child['new']}: the photo changed. Its settings were left alone.")
        side=service.marks._sidecar(Path(child['new']));backup=Path(child['settings_old'])
        if child['side_stamp'] is not None and not child.get('settings_published') and not backup.exists():
            if not same(side,child['side_stamp'],child['side_hash']): raise ValueError(f'{side}: settings changed. They were left alone.')
            rename(side,backup);service.checkpoint(record,child,'folder_settings_staged')
        service.settings(record,child)
    with service.marks._lock,service.browser._lock,service.index._state:
        for p,value in zip(settings_files(service),read_settings(service)):
            adjusted=follows(value,str(old),str(new))
            if adjusted!=value: durable(p,adjusted)
        retarget(service.marks,item);pictures(service.browser.root,item)
        for child in item['children']:
            service.retired.add(child['old']);service.retired.discard(child['new'])
            if child['payload']:
                if getattr(service.marks,'grades',None): service.marks.grades.acknowledge(child['new'],child['payload'])
                if getattr(service.marks,'copies',None): service.marks.copies.acknowledge(child['new'],child['payload'])
            db=service.marks._connect()
            with db:
                db.execute('UPDATE photos SET pending=0 WHERE path=?',(child['new'],))
                db.execute('DELETE FROM settings_writes WHERE path=?',(child['new'],))
            db.close()
    service.checkpoint(record,item,'indexed')
