"""Separate Library disk allowances in one managed folder. Only marked, app-owned cache directories are cleared."""
import json
import os
from pathlib import Path
from threading import RLock
import sqlite3
import shutil
from tempfile import NamedTemporaryFile
import time
from zipfile import BadZipFile
import contextlib
from contextlib import contextmanager

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
                CREATE TABLE IF NOT EXISTS sources(path TEXT PRIMARY KEY, source TEXT, size INTEGER, stamp INTEGER);
                CREATE INDEX IF NOT EXISTS cache_source ON sources(source);
                CREATE TABLE IF NOT EXISTS source_generations(path TEXT PRIMARY KEY, epoch INTEGER);
                CREATE TABLE IF NOT EXISTS source_mutations(source TEXT PRIMARY KEY, epoch INTEGER, owner TEXT);
                CREATE TABLE IF NOT EXISTS refresh_files(path TEXT PRIMARY KEY, source TEXT, kind TEXT, protected INTEGER);
                CREATE INDEX IF NOT EXISTS refresh_source ON refresh_files(source);
                CREATE TABLE IF NOT EXISTS pending_deletes(path TEXT PRIMARY KEY, size INTEGER, stamp INTEGER);
                CREATE TABLE IF NOT EXISTS grade_scratch(path TEXT PRIMARY KEY, size INTEGER, pid INTEGER);
            """)
            _LEDGERS[key] = db
            try:
                self._recover_mutations(db)
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
            db.execute('DELETE FROM sources WHERE path NOT IN (SELECT path FROM files)')
            db.execute('DELETE FROM source_generations WHERE path NOT IN (SELECT path FROM sources)')
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
            with _LOCK:
                self._recover_mutations(self._ledger())
            for name in DIRECTORIES:
                directory = self.directory(name)
                for file in directory.glob('*'):
                    wait()
                    if file.is_symlink() or not file.is_file() or file.suffix == '.tmp' or file.name.startswith('kept-'):
                        continue
                    self.record(file)
                    if file.suffix == '.surface':
                        try:
                            stamp = file.stat()
                            with file.open('rb') as handle:
                                identity = json.loads(handle.readline())['identity']
                            if not self._source_current(file):
                                self._recover_source(file, identity['path'], identity.get('cache_epoch', 0), stamp)
                        except (OSError, ValueError, KeyError, TypeError):
                            pass
                    if file.suffix == '.npz' and not self._source_current(file):
                        try:
                            import numpy as np
                            stamp = file.stat()
                            with np.load(file, allow_pickle=False) as stored:
                                metadata = json.loads(str(stored['metadata']))
                            source = metadata.get('path') if isinstance(metadata, dict) else None
                            if isinstance(source, str) and source:
                                self._recover_source(file, source, metadata.get('cache_epoch', 0), stamp)
                        except (OSError, ValueError, KeyError, EOFError, BadZipFile):
                            pass
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

    def _recover_source(self, file, source, epoch, stamp):
        """Inventory may recover ownership, but cannot renew obsolete pixels.

        Metadata is read outside the publication lock. Recheck that exact file
        under the same process/SQLite locks used by publication and deletion.
        """
        source = os.path.normcase(str(Path(source).resolve()))
        with _LOCK:
            db = self._ledger()
            db.execute('BEGIN IMMEDIATE')
            try:
                current, active = self._source_state(db, source)
                pending = db.execute('SELECT 1 FROM pending_deletes WHERE path=?', (str(file),)).fetchone()
                latest = file.stat()
                if (not active and not pending and epoch == current
                        and (stamp.st_size, stamp.st_mtime_ns) == (latest.st_size, latest.st_mtime_ns)):
                    self._record(db, file, source)
                db.commit()
            except BaseException:
                db.rollback()
                raise

    @staticmethod
    def _recover_mutations(db):
        with db:
            for source, owner in db.execute("SELECT source, owner FROM source_mutations WHERE owner<>''").fetchall():
                if not Path(owner).exists():
                    db.execute("UPDATE source_mutations SET owner='' WHERE source=? AND owner=?", (source, owner))

    def record(self, file, source=None):
        """Record a final publication/replacement or removal in constant time."""
        file = Path(file)
        with _LOCK:
            db = self._ledger()
            db.execute('BEGIN IMMEDIATE')
            try:
                self._record(db, file, source)
                db.commit()
            except BaseException:
                db.rollback()
                raise

    def _record(self, db, file, source=None, retarget=False):
        old = db.execute('SELECT category, size FROM files WHERE path=?', (str(file),)).fetchone()
        if old:
            db.execute('UPDATE totals SET size=size-? WHERE category=?', (old[1], old[0]))
        db.execute('DELETE FROM files WHERE path=?', (str(file),))
        db.execute('DELETE FROM ages WHERE path=?', (str(file),))
        try:
            stat = file.stat()
        except FileNotFoundError:
            stat = None
        if stat is not None:
            category = self.allowance(file)
            db.execute('INSERT INTO files VALUES (?, ?, ?)', (str(file), category, stat.st_size))
            db.execute('INSERT INTO ages VALUES (?, ?)', (str(file), stat.st_mtime_ns))
            db.execute('INSERT INTO totals VALUES (?, ?) ON CONFLICT(category) DO UPDATE SET size=size+excluded.size', (category, stat.st_size))
            if source is not None:
                source = os.path.normcase(str(Path(source).resolve()))
                epoch, active = self._source_state(db, source)
                if retarget or not active:
                    db.execute('INSERT OR REPLACE INTO sources VALUES (?, ?, ?, ?)',
                               (str(file), str(source), stat.st_size, stat.st_mtime_ns))
                    db.execute('INSERT OR REPLACE INTO source_generations VALUES (?, ?)', (str(file), epoch))
                else:
                    db.execute('DELETE FROM sources WHERE path=?', (str(file),))
            else:
                db.execute('DELETE FROM sources WHERE path=? AND (size<>? OR stamp<>?)',
                           (str(file), stat.st_size, stat.st_mtime_ns))
        else:
            db.execute('DELETE FROM sources WHERE path=?', (str(file),))
        db.execute('DELETE FROM source_generations WHERE path=? AND NOT EXISTS (SELECT 1 FROM sources WHERE path=?)', (str(file), str(file)))

    @staticmethod
    def _source_state(db, source):
        source = Path(str(source).split('|copy|', 1)[0]).resolve()
        keys = [os.path.normcase(str(path)) for path in (source, *source.parents)]
        return db.execute('SELECT COALESCE(MAX(epoch),0), COALESCE(MAX(owner<>\'\'),0) FROM source_mutations WHERE source IN (' +
                          ','.join('?' for _ in keys) + ')', keys).fetchone()

    def publication_epoch(self, source):
        with _LOCK:
            epoch, active = self._source_state(self._ledger(), source)
        if active:
            raise ValueError('A file command owns this photo; cached pixels were not published.')
        return epoch

    def publish(self, temporary, destination, source, epoch, retarget=False, accounted=True):
        with _LOCK:
            db = self._ledger()
            db.execute('BEGIN IMMEDIATE')
            try:
                current, active = self._source_state(db, source)
                if not retarget and (epoch != current or active):
                    raise ValueError('Photo moved or was deleted before cached pixels could be published.')
                os.replace(temporary, destination)
                # This publication replaces the exact file queued for deletion.
                db.execute('DELETE FROM pending_deletes WHERE path=?', (str(destination),))
                if accounted:
                    self._record(db, Path(destination), source, retarget=retarget)
                db.commit()
            except BaseException:
                db.rollback()
                raise

    @contextmanager
    def mutation(self, sources, owner):
        keys = {os.path.normcase(str(Path(source).resolve())) for source in sources if source}
        with _LOCK:
            db = self._ledger()
            with db:
                db.execute('BEGIN IMMEDIATE')
                epoch = db.execute('SELECT COALESCE(MAX(epoch),0)+1 FROM source_mutations').fetchone()[0]
                db.executemany('INSERT OR REPLACE INTO source_mutations VALUES (?, ?, ?)',
                               [(source, epoch, str(owner)) for source in keys])
        try:
            yield
        finally:
            with _LOCK:
                db = self._ledger()
                with db:
                    db.executemany("UPDATE source_mutations SET owner='' WHERE source=? AND owner=?",
                                   [(source, str(owner)) for source in keys])

    def has_source_record(self, file):
        with _LOCK:
            return self._ledger().execute('SELECT 1 FROM sources WHERE path=?', (str(file),)).fetchone() is not None

    def _source_current(self, file):
        with _LOCK:
            db = self._ledger()
            row = db.execute('SELECT size, stamp, source, epoch FROM sources JOIN source_generations USING(path) WHERE path=?', (str(file),)).fetchone()
            if row is None or db.execute('SELECT 1 FROM pending_deletes WHERE path=?', (str(file),)).fetchone():
                return False
            epoch, active = self._source_state(db, row[2])
        try:
            stat = Path(file).stat()
            return not active and row[:2] == (stat.st_size, stat.st_mtime_ns) and row[3] == epoch
        except OSError:
            return False

    def source_valid(self, file, source):
        if not isinstance(source, (str, Path)) or not source:
            return False
        source = os.path.normcase(str(Path(source).resolve()))
        with _LOCK:
            db = self._ledger()
            row = db.execute('SELECT source, epoch FROM sources JOIN source_generations USING(path) WHERE path=?', (str(file),)).fetchone()
            epoch, active = self._source_state(db, source)
        return not active and row == (str(source), epoch) and self._source_current(file)

    def source_files(self, source, folder=False, retarget=False):
        source = os.path.normcase(str(Path(source).resolve()))
        prefix = source + os.sep
        with _LOCK:
            db = self._ledger()
            rows = db.execute('SELECT path, size, stamp, source FROM sources WHERE source=?' +
                              (' OR (source>=? AND source<?)' if folder else ''),
                              (source, prefix, prefix[:-1] + chr(ord(prefix[-1]) + 1)) if folder else (source,)).fetchall()
        directories = {self.directory(name) for name in DIRECTORIES}
        for filename, size, stamp, recorded_source in rows:
            file = Path(filename)
            try:
                safe = (file.parent in directories and not file.is_symlink() and not file.parent.is_symlink()
                        and not file.name.startswith('kept-') and file.suffix in ('.npz', '.json', '.surface'))
                stat = file.stat() if safe else None
                if stat is not None and (stat.st_size, stat.st_mtime_ns) == (size, stamp) and (retarget or self.source_valid(file, recorded_source)):
                    yield file
                    continue
            except OSError:
                pass
            self.forget_source(file)

    def index_refresh_file(self, file, source, kind, protected=False):
        with _LOCK:
            db = self._ledger()
            with db:
                db.execute('INSERT OR REPLACE INTO refresh_files VALUES (?,?,?,?)',
                    (str(file), os.path.normcase(str(Path(source).resolve())), kind, int(protected)))

    def refresh_files(self, source):
        source = os.path.normcase(str(Path(source).resolve()))
        with _LOCK:
            db = self._ledger()
            return db.execute("SELECT path,kind FROM refresh_files WHERE source=? AND protected=0", (source,)).fetchall()

    def remove_disposable(self, file):
        file = Path(file)
        with _LOCK:
            db = self._ledger()
            db.execute('BEGIN IMMEDIATE')
            try:
                removed = self._remove_disposable(db, file)
                db.commit()
                return removed
            except BaseException:
                db.rollback()
                raise

    def _remove_disposable(self, db, file):
        try:
            stat = file.stat()
            file.unlink()
        except FileNotFoundError:
            pass
        except PermissionError:
            db.execute('INSERT OR REPLACE INTO pending_deletes VALUES (?,?,?)',
                       (str(file), stat.st_size, stat.st_mtime_ns))
            return False
        if file.parent.name in DIRECTORIES:
            self._record(db, file)
        db.execute('DELETE FROM pending_deletes WHERE path=?', (str(file),))
        db.execute('DELETE FROM refresh_files WHERE path=?', (str(file),))
        return True

    def cleanup_pending(self):
        with _LOCK:
            db = self._ledger()
            rows = db.execute('SELECT path,size,stamp FROM pending_deletes').fetchall()
        for filename, size, stamp in rows:
            file = Path(filename)
            with _LOCK:
                db.execute('BEGIN IMMEDIATE')
                try:
                    # A replacement (including one from a helper process) cannot
                    # publish between this comparison and the physical removal.
                    pending = db.execute('SELECT size,stamp FROM pending_deletes WHERE path=?', (filename,)).fetchone()
                    if pending == (size, stamp):
                        try:
                            current = file.stat()
                            matches = (current.st_size, current.st_mtime_ns) == (size, stamp)
                        except FileNotFoundError:
                            matches = True
                        if matches:
                            self._remove_disposable(db, file)
                        else:
                            db.execute('DELETE FROM pending_deletes WHERE path=?', (filename,))
                    db.commit()
                except BaseException:
                    db.rollback()
                    raise

    def forget_source(self, file):
        with _LOCK:
            db = self._ledger()
            with db:
                db.execute('DELETE FROM sources WHERE path=?', (str(file),))
                db.execute('DELETE FROM source_generations WHERE path=?', (str(file),))

    def remove_abandoned_grade_scratch(self):
        """Recover app-owned scratch in current and former cache locations."""
        from .launcher import _parent_is_alive
        preferences = self.preferences()
        for root in (preferences["location"], *preferences["old_locations"]):
            cache_root = Path(root)
            directory = cache_root / "library-full-pictures"
            ledger = cache_root / ".library-cache-size.sqlite3"
            if (cache_root.is_symlink() or directory.is_symlink() or
                    getattr(directory, "is_junction", lambda: False)() or not (cache_root / MARKER).is_file()
                    or not ledger.is_file()):
                continue
            with _LOCK, contextlib.closing(sqlite3.connect(ledger, timeout=30)) as db, db:
                db.execute("BEGIN IMMEDIATE")
                tracked = db.execute("SELECT 1 FROM sqlite_master WHERE name='grade_scratch'").fetchone()
                for file in directory.glob("grade-grain-*.tmp"):
                    pid, _, token = file.stem.removeprefix("grade-grain-").partition("-")
                    if pid.isdecimal() and len(token) == 32 and not _parent_is_alive(int(pid)):
                        file.unlink(missing_ok=True)
                        if tracked:
                            db.execute("DELETE FROM grade_scratch WHERE path=?", (str(file),))
                if tracked:
                    # A forced shutdown can occur after unlink and before the
                    # reservation is released, so also reclaim lost entries.
                    for filename, pid in db.execute("SELECT path, pid FROM grade_scratch").fetchall():
                        if Path(filename).parent == directory and not _parent_is_alive(pid):
                            db.execute("DELETE FROM grade_scratch WHERE path=?", (filename,))

    def open_grade_scratch(self, size):
        """Reserve the full logical byte size before writing any Grade samples."""
        from uuid import uuid4
        with _LOCK:
            db = self._ledger()
            directory = self.directory("library-full-pictures")
            directory.mkdir(parents=True, exist_ok=True)
            preferences = self.preferences()
            limit = preferences["full_size_limit_gb"] * 1024**3
            file = directory / f"grade-grain-{os.getpid()}-{uuid4().hex}.tmp"
            handle = None
            try:
                with db:
                    db.execute("BEGIN IMMEDIATE")
                    room = min(limit - self._used(db)["full_size"], shutil.disk_usage(directory).free)
                    if size > room:
                        raise OSError(f"Full-size disk cache has {max(0, room):,} bytes free. "
                                      f"Grain Denoise needs {size:,} bytes.")
                    db.execute("INSERT INTO grade_scratch VALUES (?, ?, ?)", (str(file), size, os.getpid()))
                    handle = file.open("x+b", buffering=0)
                    handle.truncate(size)
            except BaseException:
                if handle is not None:
                    handle.close()
                    file.unlink(missing_ok=True)
                raise

        def close():
            with _LOCK, db:
                db.execute("BEGIN IMMEDIATE")
                handle.close()
                file.unlink(missing_ok=True)
                db.execute("DELETE FROM grade_scratch WHERE path=?", (str(file),))

        return handle, close

    def _used(self, db):
        used = {**{name: 0 for name in ALLOWANCES}, **dict(db.execute('SELECT category, size FROM totals'))}
        used["full_size"] += db.execute("SELECT COALESCE(SUM(size),0) FROM grade_scratch").fetchone()[0]
        return used

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
        self.cleanup_pending()
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
