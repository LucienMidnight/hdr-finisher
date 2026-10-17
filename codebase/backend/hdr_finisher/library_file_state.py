"""Retarget the disposable index and app-owned pictures after a recorded move."""
from copy import deepcopy
import json
import os
from pathlib import Path
from hashlib import sha256
from .library_file_io import durable

TABLES = {'photos':'path','photo_tags':'path','album_photos':'path','files':'path',
          'settings_writes':'path','photo_grades':'path','library_copies':'source'}


def mapped(value, old, new):
    if value == old or value.startswith(old + '|copy|'):
        return new + value[len(old):]
    if value.startswith(old + os.sep):
        return new + value[len(old):]
    return value


def document_paths(value, old, new):
    if isinstance(value, list):
        return [document_paths(v, old, new) for v in value]
    if not isinstance(value, dict):
        return value
    value = {k:document_paths(v, old, new) for k,v in value.items()}
    source = value.get('source')
    if isinstance(source, dict):
        if source.get('filename') == Path(old).name:
            source['filename'] = Path(new).name
        for key in ('durable_path','path'):
            if isinstance(source.get(key),str): source[key] = mapped(source[key],old,new)
    return value


def snapshot(marks, old, folder=False):
    db = marks._connect(); result = {}
    try:
        tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        for table, column in TABLES.items():
            if table not in tables: continue
            names = [r[1] for r in db.execute(f'PRAGMA table_info({table})')]
            rows = []
            for row in db.execute(f'SELECT * FROM {table}'):
                item = dict(zip(names,row)); p = item[column]
                if p == old or p.startswith(old+'|copy|') or folder and p.startswith(old+os.sep): rows.append(item)
            result[table] = rows
    finally: db.close()
    return result


def retarget(marks, item, delete=False):
    old, new = item['old'], item.get('new','')
    db=marks._connect()
    try:
        with db:
            for table, rows in item['rows'].items():
                column=TABLES[table]
                for original in rows:
                    row=deepcopy(original); previous=row[column]
                    db.execute(f'DELETE FROM {table} WHERE {column}=?', (previous,))
                    if delete: continue
                    row[column]=mapped(previous,old,new)
                    if table == 'album_photos':
                        db.execute('INSERT OR IGNORE INTO albums (name) VALUES (?)', (row['album'],))
                    if table in {'photo_grades','library_copies'}:
                        row['state']=json.dumps(document_paths(json.loads(row['state']),old,new))
                    db.execute(f"INSERT OR REPLACE INTO {table} ({','.join(row)}) VALUES ({','.join('?' for _ in row)})",tuple(row.values()))
    finally: db.close()


def pictures(root, item, delete=False):
    """Only app cache files are replaced. Originals are never opened for writing."""
    import numpy as np
    from .library_pictures import PICTURE_VERSION
    from .library_overlays import VERSION as MAP_VERSION
    from .library_kept import kept_picture_key
    from .library_cache import LibraryCache
    root=LibraryCache(root).directory('library-pictures')
    if not root.exists(): return
    old,new=item['old'],item.get('new','')
    pairs=[(r['path'],mapped(r['path'],old,new)) for r in item['rows'].get('photo_grades',[])]
    if (old,new) not in pairs: pairs.append((old,new))
    for file in list(root.glob('*.json')):
        try:
            meta=json.loads(file.read_text(encoding='utf-8')); grade=meta.get('grade_identity')
            if grade is None: continue
            pair=next(((a,b) for a,b in pairs if file.stem==kept_picture_key(a,grade,meta['edge'])),None)
            if pair is None: continue
            picture=root/(file.stem+'.'+meta['extension'])
            if delete:
                file.unlink(missing_ok=True);picture.unlink(missing_ok=True);continue
            key=kept_picture_key(pair[1],grade,meta['edge'])
            if picture.exists(): os.replace(picture,root/(key+'.'+meta['extension']))
            meta['path']=mapped(meta.get('path',pair[0]),old,new)
            durable(root/(key+'.json'),meta);file.unlink(missing_ok=True)
        except (OSError,ValueError,KeyError): continue
    for file in list(root.glob('*.npz')):
        try:
            with np.load(file,allow_pickle=False) as data:
                meta=json.loads(str(data['metadata'])); p=meta.get('path','')
                if mapped(p,old,new)==p: continue
                arrays={k:data[k] for k in data.files}
            if delete: file.unlink(missing_ok=True);continue
            target=mapped(p,old,new); s=Path(target).stat();meta['path']=target
            if file.name.endswith('.map.npz'):
                key=sha256(f"{MAP_VERSION}:{Path(target).resolve()}:{s.st_size}:{s.st_mtime_ns}:{meta['kind']}:{meta['quality']}".encode()).hexdigest();suffix='.map.npz'
            else:
                key=sha256(f"{PICTURE_VERSION}:{Path(target).resolve()}:{s.st_mtime_ns}:{s.st_size}:{meta['edge']}:{meta['quality']}".encode()).hexdigest();suffix='.npz'
            arrays['metadata']=np.asarray(json.dumps(meta));temporary=root/(key+'.file-command.tmp')
            with temporary.open('wb') as f: np.savez_compressed(f,**arrays)
            os.replace(temporary,root/(key+suffix));file.unlink(missing_ok=True)
        except (OSError,ValueError,KeyError): continue
