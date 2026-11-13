"""Confirmed original deletion, with recorded settings and no Bin fallback."""
from copy import deepcopy
import json
import sys
from pathlib import Path
from uuid import uuid4
from .library_file_io import signature,digest,same,rename,remove_owned,relocated,check_streams
from .library_file_state import snapshot,retarget,pictures
from . import library_recycle


def plan(service,request):
    items=[];warnings=[];copies=[];attached=0
    originals={p for p in request.paths if '|copy|' not in p}
    for value in dict.fromkeys(request.paths):
        try:
            if '|copy|' in value:
                if value.split('|copy|',1)[0] not in originals and (request.action!='delete_rejected' or service.marks.copies.document(value).get('marks',{}).get('pick')=='reject'): copies.append(value)
                continue
            old=service.marks._path(value)
            if service.protected(old): raise ValueError('Open another photo before changing this one. Nothing was changed for it.')
            service.marks.conflicts.scan([str(old)])
            if any(str(old)+'.hdrf' in c['files'] or c.get('photo')==str(old) for c in service.marks.conflicts.status()):
                raise ValueError('More than one settings file was found. This photo was left alone.')
            doc=service.marks._document(old);row=service.marks.read([str(old)])['photos'][0]
            if request.action=='delete_rejected' and row['marks']['pick']!='reject': continue
            with service.marks._lock:
                row=service.marks._rows([str(old)]).get(str(old)) or row
                payload=deepcopy(doc)
                if row['storage']=='database':
                    payload=payload or service.marks._new_document(row);payload['marks']=row['marks'];payload['albums']=row['albums']
                    if getattr(service.marks,'grades',None): payload=service.marks.grades.merge(str(old),payload)
                rows=snapshot(service.marks,str(old))
            side=service.marks._sidecar(old);key=uuid4().hex
            if side.exists(): check_streams(side)
            recyclable=library_recycle.available(old)
            if sys.platform=='darwin' and not recyclable:
                raise ValueError('Trash is unavailable on this volume. Nothing was changed; permanent deletion is not offered on macOS.')
            items.append({'old':str(old),'new':library_recycle.label() if recyclable else 'Gone for good',
                'delete':True,'settings_target':str(old),'cross':False,'stamp':signature(old),'checksum':digest(old),
                'side_stamp':signature(side) if side.exists() else None,'side_hash':digest(side) if side.exists() else None,
                'payload':payload,'rows':rows,
                'settings_old':str(old.parent/('.hdr-old-settings-'+key+'.tmp')),
                'side_stage':str(old.parent/('.hdr-settings-'+key+'.tmp')),'done':False})
        except (OSError,ValueError) as e: warnings.append(f'{Path(value).name}: {e}')
    if copies and getattr(service.marks,'copies',None):
        # Read and validate the independent grades without treating their sources
        # as selected originals. Their existing smaller removal action is used.
        service.marks.copies.selection(copies)
    attached=sum(len((i['payload'] or {}).get('virtual_copies',[])) for i in items)
    token=uuid4().hex
    service.plans[token]={'id':token,'action':request.action,'items':items,'warnings':warnings,'copy_paths':copies,'copy_documents':{p:service.marks.copies.document(p) for p in copies}}
    return {'token':token,'count':len(items),'attached_copies':attached,'copy_paths':copies,
        'recycle':sum(i['new'] in {'Recycle Bin','Trash'} for i in items),'permanent':sum(i['new']=='Gone for good' for i in items),
        'recycle_label':library_recycle.label(),
        'warnings':warnings,'clashes':[]}


def prepare_settings(service,record,item):
    if item.get('prepared'): return
    old=Path(item['old']);side=service.marks._sidecar(old);backup=Path(item['settings_old'])
    # Put the complete pending grade beside the photo before recycling it, so
    # restoring both entries restores current marks and copies too.
    if item['side_stamp'] is not None and not item.get('settings_published') and not backup.exists():
        if not relocated(side,item['side_stamp'],item['side_hash']): raise ValueError('Settings changed. They were left alone.')
        rename(side,backup);service.checkpoint(record,item,'delete_settings_staged')
    service.settings(record,item)
    if item['payload']:
        item['delete_side_stamp']=signature(side);item['delete_side_hash']=digest(side)
    item['prepared']=True;service.checkpoint(record,item,'delete_prepared')


def take(service,record,item,path,stamp,checksum,key):
    label=library_recycle.label()
    if item['new'] in {'Recycle Bin','Trash'}:
        receipt=item.get(key)
        # Search old receipts only for interrupted work whose file is absent.
        # A fresh, still-present original must be recycled, not confused with
        # an earlier identical entry; scanning a large Bin can take minutes.
        if receipt is None and not Path(path).exists(): receipt=find_receipt(service,item,path,stamp,checksum,key)
        if not receipt:
            if not same(path,stamp,checksum): raise ValueError(f'The recorded file is absent or changed, and its {label} entry could not be found. Both locations were left alone.')
            reference=library_recycle.reference(path)
            if reference:
                item[key+'_reference']=reference;service.save(record)
            receipt=service.recycle(path)
            service.hook('recycle_returned' if key=='photo_receipt' else 'settings_recycle_returned',item)
        if not relocated(receipt,stamp,checksum): raise ValueError(f'The system did not return the checked {label} entry. Nothing was permanently deleted.')
        item[key]=receipt;service.save(record)
    elif Path(path).exists():
        remove_owned(path,stamp,checksum)
        service.hook('permanent_returned' if key=='photo_receipt' else 'settings_permanent_returned',item)


def run(service,record,item,recovery=False):
    old=Path(item['old']);side=service.marks._sidecar(old)
    if item.get('photo_gone') and old.exists():
        # A restoration always wins, including a different arrival at the name.
        # Do not remove settings under a photo that is now present.
        if not relocated(old,item['stamp'],item['checksum']): raise ValueError('A different photo now has the old name. Its settings were left alone in Needs attention.')
        item['restored']=True;item['cancelled']=True
        service.notify(f'{old.name} is back. Its leftover settings were left alone.');return
    if recovery and item.get('delete_started') and not item.get('photo_gone') and old.exists():
        raise ValueError('The photo is present after an interrupted delete. It may have been restored; its settings were left alone. Delete it again only if intended.')
    if service.protected(old): raise ValueError('Open another photo before changing this one. Nothing was changed for it.')
    # A crash after RecycleItem, before checkpoint, is identified by a receipt.
    if not item.get('photo_gone') and not old.exists():
        if item['new'] in {'Recycle Bin','Trash'}:
            receipt=find_receipt(service,item,old,item['stamp'],item['checksum'],'photo_receipt')
            if not receipt: raise ValueError(f'The photo is absent and its {library_recycle.label()} entry could not be found. Its settings were left alone.')
            item['photo_receipt']=receipt
        else: raise ValueError('The photo is absent after an interrupted permanent delete, and its deletion could not be proved. Its settings were left alone in Needs attention.')
        item['photo_gone']=True;service.checkpoint(record,item,'photo_deleted')
    if not item.get('photo_gone'):
        if not same(old,item['stamp'],item['checksum']): raise ValueError('The photo changed. It was left alone.')
        prepare_settings(service,record,item)
        item['delete_started']=True;service.checkpoint(record,item,'delete_started')
        take(service,record,item,old,item['stamp'],item['checksum'],'photo_receipt')
        item['photo_gone']=True;service.checkpoint(record,item,'photo_deleted')
    if old.exists():
        item['restored']=True;item['cancelled']=True;return
    if item.get('delete_side_stamp'):
        take(service,record,item,side,item['delete_side_stamp'],item['delete_side_hash'],'settings_receipt')
        service.checkpoint(record,item,'settings_deleted')
    elif side.exists(): raise ValueError('Unexpected settings appeared. They were left alone.')
    with service.marks._lock:
        retarget(service.marks,item,delete=True)
        service.retired.add(item['old'])
    pictures(service.browser.root,item,delete=True)
    service.checkpoint(record,item,'indexed')


def find_receipt(service,item,path,stamp,checksum,key):
    reference=item.get(key+'_reference')
    return service.recycle_find(path,stamp,checksum,reference) if reference else service.recycle_find(path,stamp,checksum)


def restore(service,deleted):
    paths=[path for item in deleted for path in (item['old'],item.get('photo_receipt',''),item.get('settings_receipt','')) if path]
    with service._lane, service.fence(paths):
        return restore_reserved(service,deleted)


def restore_reserved(service,deleted):
    items=[]
    for original in deleted:
        old=Path(original['old']);side=service.marks._sidecar(old)
        if service.protected(old) or old.exists() or side.exists():
            raise ValueError(f'{old}: the original location is occupied or open. Nothing was restored or overwritten.')
        receipt=original.get('photo_receipt')
        if not receipt or not relocated(receipt,original['stamp'],original['checksum']):
            raise ValueError(f'{old}: the checked Trash entry is absent or changed. Nothing was restored.')
        settings=original.get('settings_receipt')
        if original.get('delete_side_stamp') and (not settings or not relocated(settings,original['delete_side_stamp'],original['delete_side_hash'])):
            raise ValueError(f'{old}: the checked settings entry in Trash is absent or changed. Nothing was restored.')
        key=uuid4().hex
        items.append({'old':receipt,'new':str(old),'stamp':original['stamp'],'checksum':original['checksum'],
            'side_stamp':original.get('delete_side_stamp'),'side_hash':original.get('delete_side_hash'),
            'settings_old':settings or receipt+'.hdrf','payload':deepcopy(original['payload']),
            'rows':deepcopy(original['rows']),'cross':False,'done':False,
            'stage':str(old.parent/('.hdr-moving-'+key+'.tmp')),
            'side_stage':str(old.parent/('.hdr-settings-'+key+'.tmp'))})
    record={'id':uuid4().hex,'action':'undo','items':items,'warnings':[]}
    service.save(record);service.invalidate();service.hook('record',items[0])
    return service.run(record)
