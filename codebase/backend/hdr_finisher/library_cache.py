"""Separate Library disk allowances in one managed folder. Only marked, app-owned cache directories are cleared."""
import json
import os
from pathlib import Path
from threading import RLock
from time import monotonic
from tempfile import NamedTemporaryFile

DIRECTORIES = ('library-pictures', 'library-full-pictures', 'library-raw-thumbnails', 'library-thumbnails')
ALLOWANCES = {'thumbnail': 2, 'full_size': 10, 'saved_grade': 2}
LIMITS = (1, 2, 5, 10, 20)
_LOCK = RLock()
TRIM_INTERVAL_S = 20.0
_LAST_TRIM = {}
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
                if file.is_symlink() or not file.is_file():
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

    def usage(self):
        used = {name: 0 for name in ALLOWANCES}
        for _, size, file in self.entries():
            used[self.allowance(file)] += size
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
        """Routine trim after a saved picture: listing a large cache takes
        seconds, so this runs at most every 20 s per cache folder."""
        location = str(self.preferences()['location'])
        now = monotonic()
        if now - _LAST_TRIM.get(location, -1e9) < TRIM_INTERVAL_S:
            return
        _LAST_TRIM[location] = now
        self.trim()

    def trim(self, limit_bytes=None, allowance='thumbnail'):
        if allowance not in ALLOWANCES:
            raise ValueError('Unknown Library cache allowance.')
        with _LOCK:
            entries = self.entries()
            preferences = self.preferences()
            for name in ALLOWANCES:
                owned = [item for item in entries if self.allowance(item[2]) == name]
                total = sum(size for _, size, _ in owned)
                limit = limit_bytes if limit_bytes is not None and name == allowance else preferences[name + '_limit_gb'] * 1024 ** 3
                groups = {}
                for stamp, size, file in owned:
                    # An active producer publishes these under a final key later.
                    if file.name.startswith('kept-') or file.suffix == '.tmp':
                        continue
                    group = groups.setdefault((file.parent, file.stem), [])
                    group.append((stamp, size, file))
                # A saved-grade image and its metadata form one LRU item.
                for group in sorted(groups.values(), key=lambda files: max(item[0] for item in files)):
                    if total <= limit:
                        break
                    for _, size, file in group:
                        try:
                            file.unlink()
                            total -= size
                        except FileNotFoundError:
                            pass
