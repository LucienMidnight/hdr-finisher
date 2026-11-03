"""Separate Library disk allowances in one managed folder. Only marked, app-owned cache directories are cleared."""
import json
import os
from pathlib import Path
from threading import RLock
import sqlite3
from tempfile import NamedTemporaryFile
import time

DIRECTORIES = ('library-pictures', 'library-full-pictures', 'library-raw-thumbnails', 'library-thumbnails')
ALLOWANCES = {'thumbnail': 2, 'full_size': 10, 'saved_grade': 2}
LIMITS = (1, 2, 5, 10, 20)
_LOCK = RLock()
_LEDGERS = {}
MARKER = '.hdr-finisher-cache'


class LibraryCache:
    def __init__(self, profile):
        self.profile = Path(profile).resolve()
        self.settings = self.profile / 'library-cache-settings.json'

    def preferences(self):
        from .config import APP_DATA_DIR
        isolated = self.profile != APP_DATA_DIR.resolve() or 'test-' in str(self.profile).lower()
        default = self.profile / 'Cache' if isolated else Path(os.environ.get('LOCALAPPDATA', str(self.profile))) / 'HDR Finisher' / 'Cache'
        try:
            value = json.loads(self.settings.read_text(encoding='utf-8'))
        except FileNotFoundError:
            value = {}
        return {'enabled': True, **{name + '_limit_gb': limit for name, limit in ALLOWANCES.items()}, 'location': str(default), 'old_locations': [], **value}

    def directory(self, name):
        if name not in DIRECTORIES:
            raise ValueError('Unknown Library cache.')
        directory = Path(self.preferences()['location']) / name
        if directory.is_symlink() or getattr(directory, 'is_junction', lambda: False)():
            raise ValueError('Library cache directories cannot be links to other folders.')
        return directory

    def prepare(self):
        root = Path(self.preferences()['location'])
        with _LOCK:
            if not root.is_dir():
                root.mkdir(parents=True, exist_ok=True)
            marker = root / MARKER
            if not marker.exists():
                if any((root / name).exists() for name in DIRECTORIES):
                    raise ValueError('Choose an empty cache folder; this folder already has unrecognised cache directories.')
                marker.write_text('HDR Finisher Library cache v1\n', encoding='utf-8')
        return root

    def entries(self, location=None):
        root = Path(location or self.preferences()['location'])
        if not (root / MARKER).is_file() or root.is_symlink():
            return []
        result = []
        for name in DIRECTORIES:
            directory = root / name
            if directory.is_symlink() or getattr(directory, 'is_junction', lambda: False)():
                continue
            for file in directory.glob('*'):
                if file.is_symlink() or not file.is_file() or file.suffix == '.tmp' or file.name.startswith('kept-'):
                    continue
                try:
                    result.append((file.stat().st_mtime_ns, file.stat().st_size, file))
                except FileNotFoundError:
                    pass
        return result

    @staticmethod
    def allowance(file):
        if file.parent.name == 'library-full-pictures':
            return 'full_size'
        if file.parent.name == 'library-pictures' and file.suffix in ('.jpg', '.avif', '.json'):
            return 'saved_grade'
        return 'thumbnail'

    def _ledger(self, reconcile=False):
        """Shared durable accounting across backend/helper processes.

        Only final published files count. A new ledger and explicit Settings
        usage reconcile outside edits; routine restarts trust the saved totals.
        """
        root = self.prepare()
        key = str(root.resolve())
        if key not in _LEDGERS:
            new_ledger = not (root / '.library-cache-size.sqlite3').exists()
            db = sqlite3.connect(root / '.library-cache-size.sqlite3', timeout=30, check_same_thread=False)
            db.execute('PRAGMA journal_mode=WAL')
            # Disposable size bookkeeping is rebuilt from published files. WAL
            # stays consistent; a power loss may lose a count, never a photo.
            # Avoid flushing the drive for every thumbnail publication.
            db.execute('PRAGMA synchronous=NORMAL')
            db.executescript("""
                CREATE TABLE IF NOT EXISTS files(path TEXT PRIMARY KEY, category TEXT, size INTEGER);
                CREATE TABLE IF NOT EXISTS totals(category TEXT PRIMARY KEY, size INTEGER);
                CREATE TABLE IF NOT EXISTS ages(path TEXT PRIMARY KEY, stamp INTEGER);
                CREATE INDEX IF NOT EXISTS cache_age ON ages(stamp);
            """)
            _LEDGERS[key] = db
            try:
                if reconcile or new_ledger:
                    self._reconcile(db)
            except BaseException:
                del _LEDGERS[key]
                db.close()
                raise
        return _LEDGERS[key]

    def _reconcile(self, db):
        db.execute('BEGIN IMMEDIATE')
        try:
            preferences = self.preferences()
            for location in [preferences['location'], *preferences['old_locations']]:
                self._discard_finished_pictures(location)
            entries = self.entries()
            db.execute('DELETE FROM files')
            db.execute('DELETE FROM totals')
            db.execute('DELETE FROM ages')
            db.executemany('INSERT INTO files VALUES (?, ?, ?)',
                           [(str(file), self.allowance(file), size) for _, size, file in entries])
            db.executemany('INSERT INTO ages VALUES (?, ?)', [(str(file), stamp) for stamp, _, file in entries])
            db.execute('INSERT INTO totals SELECT category, SUM(size) FROM files GROUP BY category')
            db.commit()
        except BaseException:
            db.rollback()
            raise

    @staticmethod
    def _discard_finished_pictures(location):
        """Retired display files have no producer or reader. Never follow links."""
        root = Path(location)
        if (root.is_symlink() or getattr(root, 'is_junction', lambda: False)()
                or not (root / MARKER).is_file()):
            return
        for name in ('library-pictures', 'library-thumbnails'):
            directory = root / name
            if directory.is_symlink() or getattr(directory, 'is_junction', lambda: False)():
                continue
            for file in directory.glob('*'):
                if file.is_symlink() or not file.is_file():
                    continue
                obsolete = file.suffix in ('.jpg', '.avif')
                if name == 'library-thumbnails':
                    obsolete = obsolete or file.suffix == '.tmp'
                elif file.suffix == '.json':
                    try:
                        metadata = json.loads(file.read_text(encoding='utf-8'))
                        obsolete = isinstance(metadata, dict) and (
                            'picture_version' in metadata or
                            ('grade_identity' in metadata and metadata.get('extension') in ('jpg', 'avif')))
                    except (OSError, ValueError):
                        continue
                if obsolete:
                    file.unlink(missing_ok=True)
                    if file.suffix in ('.jpg', '.avif'):
                        companion = file.with_suffix('.json')
                        if not companion.is_symlink():
                            companion.unlink(missing_ok=True)

    def reconcile_background(self, wait):
        """Recover drift after the first page, with no directory-sized lock."""
        from .library_diagnostics import startup_phase
        root = self.prepare()
        with startup_phase("cache_reconciliation"):
            for name in DIRECTORIES:
                directory = self.directory(name)
                for file in directory.glob('*'):
                    wait()
                    if file.is_symlink() or not file.is_file() or file.suffix == '.tmp' or file.name.startswith('kept-'):
                        continue
                    self.record(file)
            # Missing files are not in the directory walk. Page the saved keys
            # too, checking each file under the short publication lock.
            after = ""
            while True:
                wait()
                with _LOCK:
                    rows = self._ledger().execute('SELECT path FROM files WHERE path>? ORDER BY path LIMIT 128', (after,)).fetchall()
                if not rows:
                    break
                for (filename,) in rows:
                    wait()
                    self.record(filename)
                after = rows[-1][0]

    def record(self, file):
        """Record a final publication/replacement or removal in constant time."""
        file = Path(file)
        with _LOCK:
            db = self._ledger()
            db.execute('BEGIN IMMEDIATE')
            try:
                old = db.execute('SELECT category, size FROM files WHERE path=?', (str(file),)).fetchone()
                if old:
                    db.execute('UPDATE totals SET size=size-? WHERE category=?', (old[1], old[0]))
                db.execute('DELETE FROM files WHERE path=?', (str(file),))
                db.execute('DELETE FROM ages WHERE path=?', (str(file),))
                try:
                    stat = file.stat()
                    size = stat.st_size
                except FileNotFoundError:
                    size = None
                if size is not None:
                    category = self.allowance(file)
                    db.execute('INSERT INTO files VALUES (?, ?, ?)', (str(file), category, size))
                    db.execute('INSERT INTO ages VALUES (?, ?)', (str(file), stat.st_mtime_ns))
                    db.execute('INSERT INTO totals VALUES (?, ?) ON CONFLICT(category) DO UPDATE SET size=size+excluded.size', (category, size))
                db.commit()
            except BaseException:
                db.rollback()
                raise

    def _used(self, db):
        return {**{name: 0 for name in ALLOWANCES}, **dict(db.execute('SELECT category, size FROM totals'))}

    def usage(self):
        with _LOCK:
            db = self._ledger(reconcile=False)
            self._reconcile(db)  # Settings is also the explicit drift-recovery point.
            used = self._used(db)
            return {**self.preferences(), 'used_bytes': sum(used.values()),
                    **{name + '_used_bytes': size for name, size in used.items()}}

    def update(self, change):
        if set(change) - {'enabled', 'location', *(name + '_limit_gb' for name in ALLOWANCES)}:
            raise ValueError('Unknown Library cache setting.')
        with _LOCK:
            value = self.preferences()
            candidate = value | change
            if type(candidate['enabled']) is not bool or any(type(candidate[name + '_limit_gb']) is not int or candidate[name + '_limit_gb'] not in LIMITS for name in ALLOWANCES):
                raise ValueError('Choose a cache limit of 1, 2, 5, 10 or 20 GB.')
            target = Path(candidate['location']).expanduser()
            if not target.is_absolute():
                raise ValueError('Choose an absolute cache folder.')
            candidate['location'] = str(target.resolve())
            if candidate['location'] != value['location']:
                target.mkdir(parents=True, exist_ok=True)
                if any(target.iterdir()):
                    raise ValueError('Choose an empty folder for the cache.')
                # Verify write access without elevation; the old location stays untouched.
                with NamedTemporaryFile(dir=target):
                    pass
                candidate['old_locations'] = list(dict.fromkeys([*value['old_locations'], value['location']]))
            self.profile.mkdir(parents=True, exist_ok=True)
            with NamedTemporaryFile(dir=self.profile, delete=False) as f:
                temp = Path(f.name)
                f.write(json.dumps(candidate).encode())
            try:
                os.replace(temp, self.settings)
            finally:
                temp.unlink(missing_ok=True)
            self.trim()
            return self.usage()

    def clear(self, location=None):
        with _LOCK:
            value = self.preferences()
            target = str(Path(location or value['location']).resolve())
            if target not in [value['location'], *value['old_locations']]:
                raise ValueError('Only a selected Library cache can be cleared.')
            freed = 0
            for _, size, file in self.entries(target):
                try:
                    file.unlink()
                    freed += size
                except FileNotFoundError:
                    pass
            return {'freed_bytes': freed, **self.usage()}

    def trim_soon(self):
        """Check running totals on every save; evict from the publication ledger."""
        self.trim()

    def trim(self, limit_bytes=None, allowance='thumbnail'):
        if allowance not in ALLOWANCES:
            raise ValueError('Unknown Library cache allowance.')
        preferences = self.preferences()
        limits = {name: limit_bytes if limit_bytes is not None and name == allowance
                  else preferences[name + '_limit_gb'] * 1024 ** 3 for name in ALLOWANCES}
        # Publication already maintains totals and ages. Never rescan the disk
        # under the shared lock on an over-budget save. Release it after each
        # small LRU family so visible producers and reclaim can make progress.
        for name in ALLOWANCES:
            while True:
                with _LOCK:
                    db = self._ledger()
                    if self._used(db)[name] <= limits[name]:
                        break
                    row = db.execute(
                        'SELECT files.path FROM files LEFT JOIN ages USING(path) '
                        'WHERE category=? ORDER BY COALESCE(stamp,0), files.path LIMIT 1', (name,)).fetchone()
                    if row is None:
                        break
                    file = Path(row[0])
                    prefix = str(file.with_suffix('')) + '.'
                    siblings = db.execute('SELECT path FROM files WHERE category=? AND path>=? AND path<?',
                                          (name, prefix, prefix + '\uffff')).fetchall() or [row]
                    for (filename,) in siblings:
                        candidate = Path(filename)
                        if candidate.stem != file.stem:
                            continue
                        directory = candidate.parent
                        if (directory not in [Path(preferences['location']) / part for part in DIRECTORIES]
                                or directory.is_symlink() or getattr(directory, 'is_junction', lambda: False)()
                                or candidate.is_symlink() or candidate.name.startswith('kept-') or candidate.suffix == '.tmp'):
                            raise ValueError('Unsafe entry in disposable Library cache ledger; reconcile cache usage.')
                        candidate.unlink(missing_ok=True)
                        self.record(candidate)
                # Yield between families, never with the publication lock held.
                time.sleep(.001)
