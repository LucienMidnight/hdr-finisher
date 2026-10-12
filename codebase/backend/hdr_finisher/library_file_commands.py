"""Recorded, forward-only original moves. Records survive a disposable DB."""
from copy import deepcopy
import json
import os
from pathlib import Path
import shutil
from threading import Event, RLock, Thread
from uuid import uuid4
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict
from .library_file_io import digest, signature, same, rename, durable, occupied, relocated, stable_ids, check_streams
from .library_file_state import snapshot, retarget, pictures, document_paths, mapped
from .library_folder_commands import folder_name
from .library_diagnostics import log

OPEN_MESSAGE = 'Open another photo before changing this one. Nothing was changed for it.'


class FileRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    action: str
    paths: list[str]
    name: str = ''
    destination: str = ''
    choices: dict[str,str] = {}
    token: str = ''
    confirmation: str = ''


class FileCommands:
    def __init__(self, marks, browser, index, worker=None, store=None):
        self.marks,self.browser,self.index,self.worker,self.store=marks,browser,index,worker,store
        self.root=Path(browser.root)/'library-file-commands'; self.root.mkdir(parents=True,exist_ok=True)
        self._lane=RLock(); self._stop=Event(); self._thread=None
        self.epoch=0; self.retired=set(); self.plans={}; self.jobs={}; self.events=[];self.changes=[]
        self.hook=lambda stage,item: None
        self.cross_drive=lambda a,b: Path(a).stat().st_dev != Path(b).parent.stat().st_dev
        from . import library_recycle
        self.recycle=library_recycle.recycle;self.recycle_find=library_recycle.find
        marks.file_commands=self
        self.records={p.stem:json.loads(p.read_text(encoding='utf-8')) for p in self.root.glob('*.json')}

    def blocked(self,path):
        path=str(self.marks.source_path(path))
        return any(mapped(path,i['old'],'@')!=path or mapped(path,i.get('new',''),'@')!=path
                   for r in self.records.values() for i in r['items'] if not i.get('done'))

    def protected(self,path,folder=False):
        current=getattr(self.store,'_current',None)
        if current is None: return False
        source=current.source_reference().durable_path
        return source is not None and (os.path.normcase(str(source))==os.path.normcase(str(path)) or folder and str(source).casefold().startswith((str(path)+os.sep).casefold()))

    def save(self,record):
        durable(self.root/(record['id']+'.json'),record)
        self.records[record['id']]=record

    def notify(self,message):
        self.marks.writer.notify(message);log('file_command_notice',message=message)

    def invalidate(self):
        self.epoch+=1
        if self.worker is not None:
            with self.worker._lock: jobs=list(self.worker._requests)
            for job in jobs: self.worker.cancel(job)
        kept=getattr(self.marks,'kept',None)
        if kept:
            with kept._lock: kept.jobs.clear()
        with self.index._state: self.index._generation+=1
        with self.index.checks.lock: self.index.checks.revision+=1

    def plan(self,request):
        with self._lane,self.marks.writer._lane,self.marks._lock:
            if request.action in {'delete','delete_rejected'}:
                from .library_file_delete import plan
                return plan(self,request)
            if request.action in {'folder_rename','folder_move'}:
                from .library_file_folders import plan
                return plan(self,request)
            if request.action not in {'rename','move'}: raise ValueError('That file command is not available.')
            if request.action=='rename' and len(request.paths)!=1: raise ValueError('Select one original photo to rename.')
            destination=Path(request.destination).resolve(strict=True) if request.action=='move' else None
            if destination is not None and not destination.is_dir(): raise ValueError('Choose a destination folder.')
            items=[];warnings=[];clashes=[];reserved=set()
            for value in dict.fromkeys(request.paths):
                try:
                    if '|copy|' in value: raise ValueError('A virtual copy was left alone; select its original to move it.')
                    old=self.marks._path(value)
                    if self.blocked(old): raise ValueError('An earlier file command needs attention for this photo.')
                    if self.protected(old): raise ValueError(OPEN_MESSAGE)
                    self.marks.conflicts.scan([str(old)])
                    if any(str(old)+'.hdrf' in c['files'] or c.get('photo')==str(old) for c in self.marks.conflicts.status()):
                        raise ValueError('More than one settings file was found. This photo was left alone.')
                    doc=self.marks._document(old)
                    row=self.marks.read([str(old)])['photos'][0]
                    side=self.marks._sidecar(old)
                    if side.exists(): check_streams(side)
                    checksum=digest(old); stamp=signature(old)
                    name=folder_name(request.name)+old.suffix if request.action=='rename' else old.name
                    if request.action=='rename': folder_name(name)
                    new=(old.parent if destination is None else destination)/name
                    if str(new)==str(old): warnings.append(f'{old.name}: the name is unchanged.');continue
                    taken=occupied(new,old) or occupied(self.marks._sidecar(new),side) or str(new).casefold() in reserved
                    answer=request.choices.get(str(old),'')
                    if taken:
                        if request.action=='rename': raise ValueError('That name is taken. Nothing was renamed.')
                        if answer=='cancel': return {'cancelled':True,'clashes':[],'items':[],'warnings':['Move cancelled. Nothing was moved.']}
                        if answer=='skip': warnings.append(f'{old.name}: skipped.');continue
                        if answer!='keep': clashes.append({'path':str(old),'name':old.name});continue
                        number=2
                        while True:
                            new=destination/f'{old.stem} ({number}){old.suffix}'
                            if not occupied(new) and not occupied(self.marks._sidecar(new)) and str(new).casefold() not in reserved: break
                            number+=1
                    reserved.add(str(new).casefold())
                    rows=snapshot(self.marks,str(old))
                    # Carry the sole writer's current marks, grades/history and copies
                    # in the durable record; no queued write can target the old path.
                    pending=row['storage']=='database'
                    payload=deepcopy(doc)
                    if pending:
                        payload=payload or self.marks._new_document(row)
                        payload['marks']=row['marks'];payload['albums']=row['albums']
                        if getattr(self.marks,'grades',None): payload=self.marks.grades.merge(str(old),payload)
                    if payload: payload=document_paths(payload,str(old),str(new))
                    cross=self.cross_drive(old,new)
                    if cross: check_streams(old)
                    identifier=uuid4().hex
                    items.append({'old':str(old),'new':str(new),'stamp':stamp,'checksum':checksum,
                        'side_stamp':signature(side) if side.exists() else None,'side_hash':digest(side) if side.exists() else None,
                        'payload':payload,'rows':rows,'cross':cross,
                        'stage':str(new.parent/('.hdr-moving-'+identifier+'.tmp')),
                        'side_stage':str(new.parent/('.hdr-settings-'+identifier+'.tmp')),
                        'side_old_stage':str(old.parent/('.hdr-old-settings-'+identifier+'.tmp')),'done':False})
                except (OSError,ValueError) as e:
                    if request.action=='rename': raise
                    warnings.append(f'{Path(value).name}: {e}')
            if clashes: return {'clashes':clashes,'warnings':warnings,'message':'Nothing has been moved or overwritten yet.'}
            token=uuid4().hex;record={'id':token,'action':request.action,'items':items,'warnings':warnings}
            self.plans[token]=record
            return {'token':token,'count':len(items),'warnings':warnings,'clashes':[], 'destination':str(destination or '')}

    def execute(self,token,confirmation=''):
        with self._lane,self.marks.writer._lane,self.marks._lock:
            record=self.plans.get(token)
            if record is None: raise ValueError('The command preview expired. Open it again; nothing was changed.')
            if record['action'] in {'delete','delete_rejected'}:
                expected='permanent' if any(i['new']!='Recycle Bin' for i in record['items']) else 'recycle'
                if confirmation!=expected: raise ValueError('Confirm this deletion first. Nothing was deleted.')
                record['confirmed']=expected
            for path,document in record.get('copy_documents',{}).items():
                if self.marks.copies.document(path)!=document: raise ValueError('A selected virtual copy changed. Preview again; nothing was deleted.')
            self.plans.pop(token)
            # Revalidate the whole selection before recording or touching originals.
            for item in record['items']:
                if item.get('folder'):
                    from .library_file_folders import validate
                    validate(self,item);continue
                if self.protected(item['old']): raise ValueError(OPEN_MESSAGE)
                if not same(item['old'],item['stamp'],item['checksum']): raise ValueError('A photo changed; preview the command again. Nothing was changed.')
                old=Path(item['old']);side=self.marks._sidecar(old)
                if (signature(side) if side.exists() else None)!=item['side_stamp'] or side.exists() and digest(side)!=item['side_hash']:
                    raise ValueError('Settings changed; preview the command again. Nothing was changed.')
                # New pending settings supersede a preview, never silently lose a mark.
                if snapshot(self.marks,item['old'])!=item['rows']: raise ValueError('Marks or grades changed; preview the command again. Nothing was changed.')
            if not record['items']:
                result=self.result(record)
                if record.get('copy_paths'):
                    copies=self.marks.copies.remove_many(record['copy_paths']);result.update(copies,files_changed=True,copies_count=copies['count'],count=0)
                return result
            self.save(record);self.invalidate();self.hook('record',record['items'][0])
        if any(i['cross'] for i in record['items']):
            Thread(target=self.run,args=(record,),name='hdr-library-file-move',daemon=True).start()
            return self.result(record,queued=True)
        result=self.run(record)
        if record.get('copy_paths'):
            copies=self.marks.copies.remove_many(record['copy_paths']);result['copies_count']=copies['count'];result['warnings']+=copies['warnings'];result['undo_available']=copies['undo_available']
        return result

    def checkpoint(self,record,item,stage):
        item['phase']=stage;self.save(record);self.hook(stage,item)

    def copy_checked(self,record,item,source,stage,checksum):
        stage=Path(stage)
        if item.get('publish_stamp') and relocated(stage,item['publish_stamp'],checksum): return stage
        if item.get('temp_stamp') and stage.exists() and not stable_ids(stage):
            # A FAT directory-entry ID can be reused after deletion. Never reopen
            # an interrupted staging file for writing on that filesystem.
            item.setdefault('retained_temps',[]).append(str(stage))
            stage=stage.parent/('.hdr-moving-'+uuid4().hex+'.tmp')
            item['stage']=str(stage);item.pop('temp_stamp');self.save(record)
        if not item.get('temp_stamp'):
            with stage.open('xb') as f: f.flush();os.fsync(f.fileno())
            item['temp_stamp']=signature(stage);self.save(record)
        if not stage.exists() or signature(stage)[:2]!=item['temp_stamp'][:2]: raise ValueError('The temporary copy changed; it was left untouched.')
        # Our recorded staging inode may contain an interrupted copy. Recopy it.
        with Path(source).open('rb') as src,stage.open('wb') as dst:
            while block:=src.read(1024*1024):
                dst.write(block);self.hook('copy_chunk',item)
            dst.flush();os.fsync(dst.fileno())
        shutil.copystat(source,stage)
        if digest(stage)!=checksum: raise ValueError('The copy could not be checked. The original was kept.')
        item['publish_stamp']=signature(stage);self.checkpoint(record,item,'verified');return stage

    def move_item(self,record,item):
        old,new,stage=Path(item['old']),Path(item['new']),Path(item['stage'])
        if self.protected(old): raise ValueError(OPEN_MESSAGE)
        expected=item.get('publish_stamp',item['stamp'])
        actual_spelling=any(str(p)==str(new) for p in new.parent.iterdir())
        if actual_spelling and new != old and not stable_ids(new) and (stage.exists() or not item.get('publish_stamp') and same(old,item['stamp'],item['checksum'])):
            raise ValueError('The destination is occupied while the original is still present. Both locations were left alone.')
        if not actual_spelling or not relocated(new,expected,item['checksum']):
            if occupied(new,old): raise ValueError('The destination is occupied. Neither location was overwritten.')
            if item['cross']:
                if not same(old,item['stamp'],item['checksum']): raise ValueError('The original changed or is absent. Both locations were left alone.')
                stage=self.copy_checked(record,item,old,stage,item['checksum'])
            else:
                if not relocated(stage,item['stamp'],item['checksum']):
                    if not same(old,item['stamp'],item['checksum']): raise ValueError('The original changed or is absent. Both locations were left alone.')
                    rename(old,stage);self.checkpoint(record,item,'photo_staged')
            rename(stage,new)
            self.checkpoint(record,item,'photo')
        if item['cross'] and old.exists():
            if not same(old,item['stamp'],item['checksum']): raise ValueError('The old location changed. Nothing there was removed.')
            from .library_file_io import remove_owned,read_guard
            with read_guard(new,item['publish_stamp'],item['checksum']):
                remove_owned(old,item['stamp'],item['checksum'])
            self.checkpoint(record,item,'source_removed')
        from .library_file_io import read_guard
        with read_guard(new,item.get('publish_stamp',item['stamp']),item['checksum']):
            self.settings(record,item)
        with self.marks._lock:
            retarget(self.marks,item)
            self.retired.add(item['old']);self.retired.discard(item['new'])
            if item['payload']:
                if getattr(self.marks,'grades',None): self.marks.grades.acknowledge(item['new'],item['payload'])
                if getattr(self.marks,'copies',None): self.marks.copies.acknowledge(item['new'],item['payload'])
            db=self.marks._connect()
            with db:
                db.execute('UPDATE photos SET pending=0 WHERE path=?',(item['new'],))
                db.execute('DELETE FROM settings_writes WHERE path=?',(item['new'],))
            db.close()
            pictures(self.browser.root,item)
        self.checkpoint(record,item,'indexed')

    def settings(self,record,item):
        old=Path(item['settings_old']) if item.get('settings_old') else self.marks._sidecar(Path(item['old']))
        new=self.marks._sidecar(Path(item.get('settings_target',item['new'])))
        if os.path.normcase(str(old))==os.path.normcase(str(new)) and str(old)!=str(new):
            backup=Path(item['side_old_stage'])
            if not backup.exists() and not item.get('settings_published') and old.exists():
                if not relocated(old,item['side_stamp'],item['side_hash']): raise ValueError('The old settings changed. They were left alone.')
                rename(old,backup);self.checkpoint(record,item,'case_settings_staged')
            old=backup
        payload=item['payload']
        if payload is None:
            if old.exists(): raise ValueError('An unexpected settings file appeared at the old location. It was left alone.')
            return
        data=json.dumps(payload,ensure_ascii=False).encode('utf-8')
        import hashlib
        checksum=hashlib.sha256(data).hexdigest()
        if not item.get('settings_published') or not new.exists():
            # A publish followed by a power failure can precede the checkpoint.
            if new.exists():
                if not item.get('settings_stamp') or not relocated(new,item['settings_stamp'],checksum): raise ValueError('The destination settings name is taken. Both locations were left alone.')
            else:
                if item['side_stamp'] is not None and not relocated(old,item['side_stamp'],item['side_hash']): raise ValueError('The old settings changed or are absent. Both locations were left alone.')
                temp=Path(item['side_stage'])
                if temp.exists():
                    if not item.get('settings_stamp') or not relocated(temp,item['settings_stamp'],checksum): raise ValueError('The settings temporary file changed. It was left alone.')
                else:
                    with temp.open('xb') as f: f.write(data);f.flush();os.fsync(f.fileno())
                item['settings_stamp']=signature(temp);self.save(record)
                rename(temp,new)
            item['settings_published']=True;self.checkpoint(record,item,'settings_published')
        if not relocated(new,item['settings_stamp'],checksum): raise ValueError('The new settings changed. Both locations were left alone.')
        if old.exists() and str(old)!=str(new):
            if item['side_stamp'] is None: raise ValueError('Unexpected settings appeared at the old location. They were left alone.')
            from .library_file_io import remove_owned,read_guard
            with read_guard(new,item['settings_stamp'],checksum):
                remove_owned(old,item['side_stamp'],item['side_hash'])
        self.checkpoint(record,item,'settings')

    def result(self,record,**extra):
        done=[i for i in record['items'] if i.get('done') and not i.get('cancelled')]
        return {'photos':[],'warnings':record['warnings']+[i['error'] for i in record['items'] if i.get('error')],
                'undo_available':bool(self.marks._undo),'files_changed':True,'count':len(done),
                'changes':[{'old':i['old'],'new':i.get('new','')} for i in done],**extra}

    def run(self,record,recovery=False):
        with self._lane,self.marks.writer._lane:
            for item in record['items']:
                if item.get('done'): continue
                if self._stop.is_set() or record.get('paused'): break
                if record.get('cancelled') and not item.get('phase'):
                    item['done']=True;item['cancelled']=True;self.save(record);continue
                try:
                    if item.get('delete'):
                        from .library_file_delete import run
                        run(self,record,item,recovery)
                    elif item.get('folder'):
                        from .library_file_folders import run
                        run(self,record,item)
                    else: self.move_item(record,item)
                    item.pop('error',None);item['done']=True;self.save(record);self.hook('cleared_item',item)
                except (OSError,ValueError) as e:
                    item['error']=f"{item['old']} → {item.get('new','')}: {e}"
                    self.save(record);log('file_command_attention',old=item['old'],new=item.get('new',''),reason=str(e),action='both locations retained; retry forward')
            if all(i.get('done') for i in record['items']):
                self.hook('before_clear',record['items'][0])
                (self.root/(record['id']+'.json')).unlink(missing_ok=True);self.records.pop(record['id'],None)
                completed=[i for i in record['items'] if not i.get('cancelled')]
                self.changes=[{'old':i['old'],'new':i.get('new','')} for i in completed];self.epoch+=1
                if completed and not recovery and record['action'] not in {'undo','delete','delete_rejected'}:
                    def undo():
                        reverse=FileRequest(action='move',paths=[])
                        # Each prior destination can differ; combine previews into one record.
                        items=[];warnings=[]
                        for original in completed:
                            try:
                                folder=original.get('folder',False)
                                request=FileRequest(action='folder_rename' if folder else 'rename',paths=[original['new']],name=Path(original['old']).name if folder else Path(original['old']).stem)
                                if Path(original['new']).parent!=Path(original['old']).parent:
                                    request=FileRequest(action='folder_move' if folder else 'move',paths=[original['new']],destination=str(Path(original['old']).parent))
                                result=self.plan(request)
                                if result.get('clashes'): raise ValueError('The old name is taken. Undo left this photo alone.')
                                r=self.plans.pop(result['token']);prepared=r['items']
                                for entry in prepared:
                                    if not entry.get('folder'): entry['payload']=document_paths(entry['payload'],entry['new'],original['old'])
                                    entry['new']=original['old']
                                items+=prepared;warnings+=r['warnings']
                            except (OSError,ValueError) as e: warnings.append(f"{original['new']}: {e}")
                        token=uuid4().hex;self.plans[token]={'id':token,'action':'undo','items':items,'warnings':warnings}
                        result=self.execute(token);return result
                    with self.marks._lock: self.marks._undo.append({'command':undo,'file_command':True})
                if recovery and completed: self.notify(f'Finished an interrupted delete for {len(completed)} photos and their settings.' if record['action'] in {'delete','delete_rejected'} else f'Finished an interrupted file command for {len(completed)} items. Settings are together with their photos.')
                log('file_command_complete',operation=record['action'],count=len(completed),recovery=recovery)
            return self.result(record)

    def locations(self,item):
        paths=[item['old'],item.get('new','')]
        for child in item.get('children',[item]):
            paths += [child['old']+'.hdrf',child['new']+'.hdrf' if not child.get('delete') else child.get('settings_receipt','Recycle Bin' if child['new']=='Recycle Bin' else 'Gone for good')]
            paths += child.get('retained_temps',[])
            paths += [child.get(k,'') for k in ('stage','settings_old','side_old_stage','side_stage','photo_receipt','settings_receipt')]
        return list(dict.fromkeys(p for p in paths if p))

    def status(self):
        records=list(self.records.values())
        return {'revision':self.epoch,'changes':self.changes,'jobs':[{'id':r['id'],'action':r['action'],'done':sum(bool(i.get('done')) for i in r['items']),'total':len(r['items']),'paused':r.get('paused',False)} for r in records],
                'attention':[{'id':r['id'],'old':i['old'],'new':i.get('new',''),'message':i['error'],'locations':self.locations(i)} for r in records for i in r['items'] if i.get('error')]}

    def start(self):
        # Read and finish records before the settings writer/indexer is started.
        for r in list(self.records.values()): self.run(r,True)
        def retry():
            while not self._stop.wait(15):
                for r in list(self.records.values()): self.run(r,True)
        self._thread=Thread(target=retry,name='hdr-library-file-recovery',daemon=True);self._thread.start()

    def control(self,id,action):
        record=self.records.get(id)
        if record is None: return self.status()
        if action=='cancel': record['cancelled']=True;record['paused']=False
        elif action in {'pause','resume'}: record['paused']=action=='pause'
        else: raise ValueError('That file-job command is not available.')
        self.save(record)
        if action!='pause': Thread(target=self.run,args=(record,),name='hdr-library-file-resume',daemon=True).start()
        return self.status()


def add_file_routes(router,marks,browser,index,worker,store):
    service=FileCommands(marks,browser,index,worker,store)
    @router.post('/file-command')
    def command(request:FileRequest):
        try: return service.execute(request.token,request.confirmation) if request.token else service.plan(request)
        except (OSError,ValueError) as e: raise HTTPException(400,str(e)) from e
    class Job(BaseModel):
        id:str
        action:str
    @router.post('/file-jobs')
    def control(request:Job): return service.control(request.id,request.action)
    return service
