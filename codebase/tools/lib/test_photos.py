"""The approved, identical photo corpus on both development machines."""
import hashlib
import json
from pathlib import Path, PurePosixPath

from .machine_settings import CODEBASE, settings

MANIFEST = CODEBASE / 'tests/test-photos.manifest.json'


def photo_root(config=None):
    return Path((config or settings())['photosRoot']) / 'HDR Test Images'


def manifest_files(manifest=MANIFEST):
    entries = json.loads(Path(manifest).read_text(encoding='utf-8'))['files']
    names = set()
    for entry in entries:
        name = entry['name']
        relative = PurePosixPath(name)
        if relative.is_absolute() or '..' in relative.parts or '\\' in name or name in names:
            raise ValueError(f'Invalid or duplicate test photo: {name}')
        names.add(name)
    return entries


def sha256(file):
    digest = hashlib.sha256()
    with Path(file).open('rb') as stream:
        for chunk in iter(lambda: stream.read(8 << 20), b''):
            digest.update(chunk)
    return digest.hexdigest()


def verify_photos(root=None, manifest=MANIFEST):
    root = Path(root) if root is not None else photo_root()
    entries = manifest_files(manifest)
    problems = []
    for entry in entries:
        file = root / entry['name']
        if not file.is_file():
            problems.append(f'Missing test photo: {file}')
        elif file.stat().st_size != entry['bytes']:
            problems.append(f'Different size: {file} (expected {entry["bytes"]}, found {file.stat().st_size})')
        elif sha256(file) != entry['sha256']:
            problems.append(f'Different SHA-256: {file}')
    expected = {entry['name'] for entry in entries}
    actual = {file.relative_to(root).as_posix() for file in root.rglob('*')
              if file.is_file() and file.name != '.DS_Store'}
    problems.extend(f'Unexpected test photo: {root / name}' for name in sorted(actual - expected))
    return problems
