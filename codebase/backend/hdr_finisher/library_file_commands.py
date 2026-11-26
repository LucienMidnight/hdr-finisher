"""Recorded, forward-only original moves. Records survive a disposable DB."""
from copy import deepcopy
from collections import defaultdict, deque
import errno
import json
import os
import sys
from pathlib import Path
import shutil
from threading import Event, RLock, Thread, get_ident
from contextlib import contextmanager, nullcontext
from contextvars import ContextVar
from uuid import uuid4
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict
from .library_file_io import digest, signature, optional_signature, same, rename, durable, occupied, relocated, stable_ids, check_streams, hash_timings
from .library_file_state import snapshot, retarget, pictures, document_paths, mapped
from .library_folder_commands import folder_name
from .library_diagnostics import log, timed_lock
from functools import wraps
import asyncio
import time

OPEN_MESSAGE = 'Open another photo before changing this one. Nothing was changed for it.'
FILE_COMMANDS_SUPPORTED = os.name == 'nt' or sys.platform == 'darwin'
PLATFORM_MESSAGE = 'Renaming, moving and deleting photos from the Library is available on Windows and macOS only in this version. Nothing was changed.'
_activity = ContextVar('library_file_command_activity', default=None)


class WaitingForSettings(ValueError):
    pass


def transient(error):
    return (isinstance(error, WaitingForSettings)
            or isinstance(error, OSError) and (error.errno in {errno.EBUSY, errno.EAGAIN, errno.ETIMEDOUT}
                or getattr(error, 'winerror', None) in {32, 33}))


class FileRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    action: str
    paths: list[str]
    name: str = ''
    destination: str = ''
    choices: dict[str,str] = {}
    token: str = ''
    confirmation: str = ''
    request_id: str = ''


def file_event(stage):
    def decorate(function):
        @wraps(function)
        def call(self, *args, **kwargs):
            started = time.perf_counter()
            request = args[0] if args else None
            record = request if isinstance(request,dict) else self.plans.get(request,{}) if isinstance(request,str) else {}
            operation = getattr(request, 'action', None) or record.get('action')
            token = request if isinstance(request, str) else record.get('id')
            request_id = getattr(request,'request_id','') or kwargs.get('request_id') or token
            count = len(getattr(request,'paths',record.get('items',())))
            log('file_command_' + stage + '_started', operation=operation, token=token,
                count=count)
            try:
                with self.activity(request_id,operation,stage,count) as timings:
                    result = function(self, *args, **kwargs)
            except Exception as error:
                log('file_command_' + stage + '_failed', operation=operation, token=token,
                    reason=str(error), duration_ms=(time.perf_counter()-started)*1000,
                    phases_ms={key:round(ms,2) for key,ms in timings.items()})
                raise
            log('file_command_' + stage + '_finished', operation=operation,
                token=result.get('token', token), count=result.get('count'),
                warnings=result.get('warnings', []), duration_ms=(time.perf_counter()-started)*1000,
                phases_ms={key:round(ms,2) for key,ms in timings.items()})
            return result
        return call
    return decorate


class FileCommands:
    def __init__(self, marks, browser, index, worker=None, store=None):
        self.marks,self.browser,self.index,self.worker,self.store=marks,browser,index,worker,store
        self.root=Path(browser.root)/'library-file-commands'; self.root.mkdir(parents=True,exist_ok=True)
        self._lane=RLock(); self._stop=Event(); self._thread=None
        self._fences={}; self._state=RLock(); self._record_lock=RLock()
        self._inflight=set(); self._invalidated=set(); self._active={}
        self.epoch=0; self.retired=set(); self.plans={}
        self._revision=0; self._changes=deque(maxlen=32)
        self.hook=lambda stage,item: None
        self.cross_drive=lambda a,b: Path(a).stat().st_dev != Path(b).parent.stat().st_dev
        from . import library_recycle
        self.recycle=library_recycle.recycle;self.recycle_find=library_recycle.find
        marks.file_commands=self
        self.records={p.stem:json.loads(p.read_text(encoding='utf-8')) for p in self.root.glob('*.json')}

    @contextmanager
    def activity(self,request_id,operation,step,total):
        timings=defaultdict(float)
        key=object()
        progress={'request_id':request_id,'action':operation,'step':step,'phase':'waiting_lane','done':0,'total':total}
        with self._state: self._active[key]=progress
        token=_activity.set((progress,timings))
        hashing=hash_timings.set(timings)
        try: yield timings
        finally:
            hash_timings.reset(hashing);_activity.reset(token)
            with self._state: self._active.pop(key)

    def progress(self):
        with self._state:
            return [dict(progress) for progress in self._active.values()]

    def progress_counts(self,done,total):
        if active:=_activity.get():
            with self._state: active[0].update(done=done,total=total)

    @contextmanager
    def phase(self,name,*,display=True):
        active=_activity.get()
        if active is None:
            yield
            return
        progress,timings=active
        with self._state:
            previous=progress['phase']
            if display: progress['phase']=name
        started=time.perf_counter()
        try: yield
        finally:
            timings[name]+=(time.perf_counter()-started)*1000
            if display:
                with self._state: progress['phase']=previous

    @contextmanager
    def lane(self):
        started=time.perf_counter()
        with timed_lock(self._lane,"file_command_lane"):
            active=_activity.get()
            if active:
                with self._state: active[0]['phase']='checking_files'
                active[1]['waiting_lane']+=(time.perf_counter()-started)*1000
            yield

    def blocked(self,path):
        path=str(self.marks.source_path(path))
        if any(owner!=get_ident() and any(mapped(path,source,'@')!=path for source in paths)
               for owner,paths in tuple(self._fences.values())): return True
        return any(mapped(path,i['old'],'@')!=path or mapped(path,i.get('new',''),'@')!=path
                   for r in tuple(self.records.values()) for i in r['items'] if not i.get('done'))

    @contextmanager
    def fence(self,paths):
        resolved=[]
        for path in paths:
            if not path or path in ('Recycle Bin','Trash','Gone for good'): continue
            try: resolved.append(str(Path(str(path).split('|copy|',1)[0]).resolve()))
            except (OSError,RuntimeError,ValueError): continue  # Plan validates invalid paths individually.
        token=object()
        with self.phase('waiting_writer'):
            with self.marks.writer._lane, self.marks._lock:
                self._fences[token]=(get_ident(),tuple(resolved))
        try:
            yield
        finally:
            with self.marks._lock:
                self._fences.pop(token)
            self.marks.writer.wake()

    def planned_paths(self,token):
        record=self.plans.get(token)
        if record is None: raise ValueError('The command preview expired. Open it again; nothing was changed.')
        return [path for item in record['items'] for path in (item['old'],item.get('new',''))] + record.get('copy_paths',[])

    def protected(self,path,folder=False):
        current=getattr(self.store,'_current',None)
        if current is None: return False
        source=current.source_reference().durable_path
        return source is not None and (os.path.normcase(str(source))==os.path.normcase(str(path)) or folder and str(source).casefold().startswith((str(path)+os.sep).casefold()))

    def save(self,record):
        with self._record_lock, self.phase('durable_checkpoints'):
            durable(self.root/(record['id']+'.json'),record)
            self.records[record['id']]=record

    def notify(self,message):
        self.marks.writer.notify(message);log('file_command_notice',message=message)

    def invalidate(self,record):
        if record['id'] in self._invalidated: return
        self._invalidated.add(record['id'])
        self.epoch+=1
        if self.worker is not None:
            with self.worker._lock: jobs=list(self.worker._requests)
            for job in jobs: self.worker.cancel(job)
        with self.index._state: self.index._generation+=1
        with self.index.checks.lock: self.index.checks.revision+=1

    @file_event("plan")
    def plan(self,request):
        if not FILE_COMMANDS_SUPPORTED: raise ValueError(PLATFORM_MESSAGE)
        if request.action in {'delete','delete_rejected'}:
            # Hashes and Windows Recycle Bin probing can block for seconds.
            # The delete planner captures its settings snapshot in a short scope.
            with self.lane(), self.fence(request.paths):
                from .library_file_delete import plan
                return plan(self,request)
        with self.lane(), self.fence(request.paths):
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

    @file_event("confirmation")
    def execute(self,token,confirmation='',*,request_id=''):
        with self.lane(), self.fence(self.planned_paths(token)):
            record=self.plans.get(token)
            if record is None: raise ValueError('The command preview expired. Open it again; nothing was changed.')
            if record['action'] in {'delete','delete_rejected'}:
                expected='permanent' if any(i['new']=='Gone for good' for i in record['items']) else 'recycle'
                if confirmation!=expected: raise ValueError('Confirm this deletion first. Nothing was deleted.')
                record['confirmed']=expected
            for path,document in record.get('copy_documents',{}).items():
                if self.marks.copies.document(path)!=document: raise ValueError('A selected virtual copy changed. Preview again; nothing was deleted.')
            self.plans.pop(token)
            # Revalidate the whole selection before recording or touching originals.
            with self.phase('verify_files'):
                for item in record['items']:
                    if item.get('folder'):
                        from .library_file_folders import validate
                        validate(self,item);continue
                    if self.protected(item['old']): raise ValueError(OPEN_MESSAGE)
                    if not same(item['old'],item['stamp'],item['checksum']): raise ValueError('A photo changed; preview the command again. Nothing was changed.')
                    old=Path(item['old']);side=self.marks._sidecar(old)
                    if optional_signature(side)!=item['side_stamp'] or item['side_stamp'] is not None and digest(side)!=item['side_hash']:
                        raise ValueError('Settings changed; preview the command again. Nothing was changed.')
                    # New pending settings supersede a preview, never silently lose a mark.
                    with self.phase('conflicts_and_marks',display=False):
                        if snapshot(self.marks,item['old'])!=item['rows']: raise ValueError('Marks or grades changed; preview the command again. Nothing was changed.')
            if not record['items']:
                if record.get('copy_paths'):
                    copies=self.marks.copies.remove_many(record['copy_paths'])
                    record['copies_removed']=copies['removed_copies']
                    record['warnings']+=copies['warnings']
                    if copies['removed_copies']:
                        self.invalidate(record)
                        self._invalidated.discard(token)
                        self.publish([],copies['removed_copies'])
                return self.result(record)
            if not self.claim(record): raise ValueError('This file command is already running.')
            handed_off=False
            try:
                self.save(record);self.invalidate(record);self.hook('record',record['items'][0])
                if any(i['cross'] for i in record['items']):
                    Thread(target=self.run,args=(record,),kwargs={'claimed':True},name='hdr-library-file-move',daemon=True).start()
                    handed_off=True
                    return self.result(record,queued=True)
                return self._run(record,fenced=True,revalidated=True)
            finally:
                if not handed_off: self.release(record)

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
        if sys.platform=='darwin':
            from .library_macos import copy_metadata
            copy_metadata(source,stage)
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
        from .library_file_io import removal_pending
        if item['cross'] and (old.exists() or removal_pending(old,item['stamp'])):
            if old.exists() and not same(old,item['stamp'],item['checksum']): raise ValueError('The old location changed. Nothing there was removed.')
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
        if str(old)!=str(new) and (os.path.normcase(str(old))==os.path.normcase(str(new)) or sys.platform=='darwin' and old.parent==new.parent and old.name.casefold()==new.name.casefold() and old.exists() and new.exists() and os.path.samefile(old,new)):
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
                    if sys.platform=='darwin' and old.exists():
                        from .library_macos import copy_metadata
                        copy_metadata(old,temp,preserve_times=False)
                item['settings_stamp']=signature(temp);self.save(record)
                rename(temp,new)
            item['settings_published']=True;self.checkpoint(record,item,'settings_published')
        if not relocated(new,item['settings_stamp'],checksum): raise ValueError('The new settings changed. Both locations were left alone.')
        from .library_file_io import removal_pending
        if (old.exists() or item['side_stamp'] and removal_pending(old,item['side_stamp'])) and str(old)!=str(new):
            if item['side_stamp'] is None: raise ValueError('Unexpected settings appeared at the old location. They were left alone.')
            from .library_file_io import remove_owned,read_guard
            with read_guard(new,item['settings_stamp'],checksum):
                remove_owned(old,item['side_stamp'],item['side_hash'])
        self.checkpoint(record,item,'settings')

    def change_feed(self):
        with self._state:
            recent=list(self._changes)
            return {'revision':self._revision,'recent_changes':recent}

    def publish(self,changes,copies):
        with self._state:
            self._revision+=1
            self._changes.append({'revision':self._revision,'changes':changes,'removed_copies':list(copies)})

    def result(self,record,**extra):
        done=[i for i in record['items'] if (i.get('done') or i.get('photo_gone')) and not i.get('cancelled')]
        return {'photos':[],'warnings':record['warnings']+([record['copy_error']] if record.get('copy_error') else [])+[i['error'] for i in record['items'] if i.get('error')],
                'undo_available':bool(self.marks._undo),'files_changed':True,'count':len(done),
                'settings_pending':sum(bool(i.get('photo_gone') and not i.get('done')) for i in record['items']),
                'copies_count':len(record.get('copies_removed',[])),
                'removed_copies':record.get('copies_removed',[]),
                'changes':[{'old':i['old'],'new':i.get('new','')} for i in done],**self.change_feed(),**extra}

    def claim(self,record,*,retry=False):
        with self._state:
            key=record['id']
            if key in self._inflight or retry and not self.retryable(record): return False
            self._inflight.add(key)
            return True

    def release(self,record):
        with self._state: self._inflight.remove(record['id'])

    @file_event("run")
    def run(self,record,recovery=False,*,claimed=False,retry=False):
        if not claimed and not self.claim(record,retry=retry): return self.result(record,queued=True)
        with self.lane():
            try:
                # Another owner may have finished this snapshot before we got
                # here. Never re-create a completed command from stale input.
                if self.records.get(record['id']) is not record: return self.result(record)
                return self._run(record,recovery,retry=retry)
            finally: self.release(record)

    def _run(self,record,recovery=False,*,fenced=False,revalidated=False,retry=False):
        # Reserve before writer/marks locks; activation checks under the same lock.
        # No session lock is held during file IO or cache scans.
        self.invalidate(record)
        paths={os.path.normcase(p) for i in record['items'] for p in [i['old'],i.get('new','')] + [c[k] for c in i.get('children',[]) for k in ('old','new')]}
        if self.store is not None:
            with self.store._lock:
                self.store.file_command_sources=getattr(self.store,'file_command_sources',set()) | paths
        try: return self._run_reserved(record,recovery,fenced=fenced,revalidated=revalidated,retry=retry)
        finally:
            if self.store is not None:
                with self.store._lock: self.store.file_command_sources.difference_update(paths)

    def _run_reserved(self,record,recovery=False,*,fenced=False,revalidated=False,retry=False):
        from .library_cache import LibraryCache
        paths=[path for item in record['items'] for path in (item['old'],item.get('new','')) if path and path not in ('Recycle Bin','Trash','Gone for good')]
        fence=nullcontext() if fenced else self.fence(paths + record.get('copy_paths',[]))
        with fence, LibraryCache(self.browser.root).mutation(paths,self.root/(record['id']+'.json')):
            if record.get('copy_paths'): record.setdefault('copies_done',False)
            done=sum(bool(i.get('done')) for i in record['items'])
            self.progress_counts(done,len(record['items']))
            for item in record['items']:
                if item.get('done'): continue
                if retry and item.get('error') and not item.get('retryable'): continue
                if self._stop.is_set() or record.get('paused'): break
                if record.get('cancelled') and not item.get('phase'):
                    item['done']=True;item['cancelled']=True;self.save(record);continue
                try:
                    if item.get('delete'):
                        from .library_file_delete import run
                        run(self,record,item,recovery,revalidated=revalidated)
                    elif item.get('folder'):
                        from .library_file_folders import run
                        run(self,record,item)
                    else: self.move_item(record,item)
                    item.pop('error',None);item.pop('retryable',None);item['done']=True;self.save(record);self.hook('cleared_item',item)
                except (OSError,ValueError) as e:
                    item['error']=f"{item['old']} → {item.get('new','')}: {e}"
                    item['retryable']=transient(e) and (not item.get('delete_started') or bool(item.get('photo_gone')))
                    self.save(record);log('file_command_attention',old=item['old'],new=item.get('new',''),reason=str(e),action='both locations retained; retry forward',retryable=item['retryable'])
                done+=1
                self.progress_counts(done,len(record['items']))
            changes=[{'old':i['old'],'new':i.get('new','')} for i in record['items']
                     if (i.get('done') or i.get('photo_gone')) and not i.get('cancelled')]
            if (not record.get('paused') and not self._stop.is_set() and (not record.get('cancelled') or record.get('copies_started'))
                    and (not retry or not record.get('copy_error') or record.get('copy_retryable'))):
                self.remove_record_copies(record)
            elif record.get('cancelled') and not record.get('copies_started'):
                record['copies_done']=True
            copies=record.get('copies_removed',[])
            new_changes=[change for change in changes if change not in record.get('published_changes',[])]
            new_copies=[copy for copy in copies if copy not in record.get('published_copies',[])]
            if new_changes or new_copies:
                record['published_changes']=changes;record['published_copies']=list(copies);self.save(record)
            if all(i.get('done') for i in record['items']) and record.get('copies_done',True):
                self.hook('before_clear',record['items'][0])
                with self._record_lock:
                    (self.root/(record['id']+'.json')).unlink(missing_ok=True);self.records.pop(record['id'],None)
                self._invalidated.discard(record['id'])
                completed=[i for i in record['items'] if not i.get('cancelled')]
                if completed and not recovery and record['action'] in {'delete','delete_rejected'} and all(i['new']=='Trash' for i in completed):
                    from .library_file_delete import restore
                    with self.marks._lock:
                        self.marks._undo.append({'command':lambda:restore(self,completed),'file_command':True})
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
                self.index.queue_membership(
                    folders=[p for i in completed if i.get('folder') for p in (i['old'], i['new']) if p and p != 'Trash'],
                    paths=[p for i in completed if not i.get('folder') for p in (i['old'], i['new']) if p and p != 'Trash'] + record.get('copy_paths', []))
                log('file_command_complete',operation=record['action'],count=len(completed),recovery=recovery)
            if new_changes or new_copies: self.publish(new_changes,new_copies)
            return self.result(record)

    def remove_record_copies(self,record):
        if not record.get('copy_paths') or record.get('copies_done'): return
        record['copies_done']=False
        self.save(record)
        try:
            pending=[]
            for path in record['copy_paths']:
                if path in record.get('copies_skipped',[]): continue
                source,identifier=path.split('|copy|',1)
                if any(i['photo_id']==identifier for i in self.marks.copies.items(source)):
                    pending.append(path)
            if pending:
                for path in pending: self.hook('before_copy_remove',{'old':path})
                record['copies_started']=True;self.save(record)
                if 'copy_undo' not in record:
                    record['copy_undo']=[(source,position,deepcopy(item)) for source in dict.fromkeys(p.split('|copy|',1)[0] for p in pending)
                        for position,item in enumerate(self.marks.copies.items(source)) if source+'|copy|'+item['photo_id'] in pending]
                    self.save(record)
                result=self.marks.copies.remove_many(pending,undo=False)
                for path in pending: self.hook('copy_remove_returned',{'old':path})
                removed=result['removed_copies']
                record['warnings']+=result['warnings']
                record['copies_skipped']=list(dict.fromkeys(record.get('copies_skipped',[])+[p for p in pending if p not in removed]))
            if record.get('copy_undo') and not any(e.get('copy_record')==record['id'] for e in self.marks._undo):
                def restore():
                    copies=self.marks.copies
                    with copies.marks.grades.store._lock, self.marks._lock:
                        entries=[e for e in record['copy_undo'] if e[0]+'|copy|'+e[2]['photo_id'] not in record.get('copies_skipped',[])]
                        _,plans=copies.selection(list(dict.fromkeys(e[0] for e in entries)))
                        for source,position,item in entries:
                            items,doc=plans[source]
                            if not any(i['photo_id']==item['photo_id'] for i in items): items.insert(min(position,len(items)),deepcopy(item))
                        copies.commit_many(plans)
                        return {'photos':[copies.row(p,i) for p,_,i in entries],'copies_changed':True}
                with self.marks._lock: self.marks._undo.append({'command':restore,'copy_record':record['id']})
            sources={p.split('|copy|',1)[0] for p in record['copy_paths'] if p not in record.get('copies_skipped',[])}
            for source in sources:
                writer=self.marks.writer
                if writer._paused or writer._busy(): raise WaitingForSettings('Copy removal is waiting for the settings writer.')
                with writer._lane:
                    writer._attempt(source)
                if writer._snapshot(source) is not None:
                    raise WaitingForSettings('Copy removal is waiting for durable settings.')
                doc=self.marks._document(Path(source)) or {}
                ids={i['photo_id'] for i in doc.get('virtual_copies',[])}
                if any(p.split('|copy|',1)[1] in ids for p in record['copy_paths'] if p.split('|copy|',1)[0]==source and p not in record.get('copies_skipped',[])):
                    raise WaitingForSettings('Copy removal is waiting for durable settings.')
            for path in record['copy_paths']:
                if path in record.get('copies_skipped',[]) or path in record.get('copies_removed',[]): continue
                record.setdefault('copies_removed',[]).append(path)
                self.save(record);self.hook('copy_removed',{'old':path})
            record.pop('copy_error',None)
            record.pop('copy_retryable',None)
            record['copies_done']=True
        except (OSError,ValueError) as error:
            record['copy_error']=str(error)
            record['copy_retryable']=transient(error)
        self.save(record)

    def locations(self,item):
        paths=[item['old'],item.get('new','')]
        for child in item.get('children',[item]):
            paths += [child['old']+'.hdrf',child['new']+'.hdrf' if not child.get('delete') else child.get('settings_receipt',child['new'])]
            paths += child.get('retained_temps',[])
            paths += [child.get(k,'') for k in ('stage','settings_old','side_old_stage','side_stage','photo_receipt','settings_receipt')]
            if sys.platform=='darwin':
                from .library_file_io import removal_folder
                for path,stamp in ((child['old'],child.get('stamp')),(child.get('settings_old',child['old']+'.hdrf'),child.get('side_stamp'))):
                    if stamp:
                        captured=removal_folder(path,stamp)
                        if captured.exists(): paths.append(str(captured/'item'))
        return list(dict.fromkeys(p for p in paths if p))

    def status(self):
        records=list(self.records.values())
        feed=self.change_feed()
        latest=feed['recent_changes'][-1] if feed['recent_changes'] else {'changes':[],'removed_copies':[]}
        return {**feed,'changes':latest['changes'],'removed_copies':latest['removed_copies'],'active':self.progress(),
                'jobs':[{'id':r['id'],'action':r['action'],'done':sum(bool(i.get('done')) for i in r['items']),'total':len(r['items']),'paused':r.get('paused',False)} for r in records],
                'attention':[{'id':r['id'],'old':i['old'],'new':i.get('new',''),'message':i['error'],'locations':self.locations(i)} for r in records for i in r['items'] if i.get('error')]+[{'id':r['id'],'old':'Separate virtual copies','new':'','message':r['copy_error'],'locations':r.get('copy_paths',[])} for r in records if r.get('copy_error')]}

    def retryable(self,record):
        return not record.get('paused') and (
            any(not i.get('done') and (not i.get('error') or i.get('retryable')) for i in record['items'])
            or bool(record.get('copy_paths') and not record.get('copies_done')
                    and (not record.get('copy_error') or record.get('copy_retryable')))
            or all(i.get('done') for i in record['items']) and record.get('copies_done',True))

    def retry_pending(self):
        for record in list(self.records.values()):
            with self._state:
                eligible=record['id'] not in self._inflight and self.retryable(record)
            if eligible and self._lane.acquire(blocking=False):
                try: self.run(record,True,retry=True)
                finally: self._lane.release()

    def start(self):
        # Read and finish records before the settings writer/indexer is started.
        self.retry_pending()
        def retry():
            while not self._stop.wait(15):
                self.retry_pending()
        self._thread=Thread(target=retry,name='hdr-library-file-recovery',daemon=True);self._thread.start()

    def control(self,id,action):
        with self._record_lock:
            record=self.records.get(id)
            if record is None: return self.status()
            if action=='cancel': record['cancelled']=True;record['paused']=False
            elif action in {'pause','resume'}: record['paused']=action=='pause'
            else: raise ValueError('That file-job command is not available.')
            self.save(record)
        if action!='pause':
            def resume():
                # Let a running owner see the control request or finish first.
                # Try again is explicit consent, unlike an automatic retry.
                with self._lane: self.run(record)
            Thread(target=resume,name='hdr-library-file-resume',daemon=True).start()
        return self.status()


def add_file_routes(router,marks,browser,index,worker,store):
    service=FileCommands(marks,browser,index,worker,store)
    @router.post('/file-command')
    async def command(request:FileRequest):
        # The asyncio executor is separate from Starlette's request pool. A
        # file command waiting for the writer must leave health/log/pixel
        # requests their request threads, and never block the event loop.
        try:
            return await asyncio.to_thread(service.execute,request.token,request.confirmation,request_id=request.request_id) if request.token else await asyncio.to_thread(service.plan, request)
        except (OSError,ValueError) as e: raise HTTPException(400,str(e)) from e
    class Job(BaseModel):
        id:str
        action:str
    @router.post('/file-jobs')
    def control(request:Job): return service.control(request.id,request.action)
    @router.get('/file-jobs')
    async def progress(): return {'active':service.progress()}
    return service
