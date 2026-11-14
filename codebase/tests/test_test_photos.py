"""Corpus validation uses tiny disposable files, never the private photos."""
import hashlib
import json
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from lib.test_photos import manifest_files, verify_photos


def test_manifest_reports_missing_size_hash_and_extra(tmp_path):
    root = tmp_path / 'photos'
    root.mkdir()
    payload = b'photo'
    entries = [dict(name=name, bytes=len(payload), sha256=hashlib.sha256(payload).hexdigest())
               for name in ('good.arw', 'missing.cr2', 'size.tif', 'hash.jpg', 'Projects/saved.hdrfinisher')]
    manifest = tmp_path / 'manifest.json'
    manifest.write_text(json.dumps(dict(files=entries)))
    (root / 'good.arw').write_bytes(payload)
    (root / 'size.tif').write_bytes(b'shorter')
    (root / 'hash.jpg').write_bytes(b'other')
    (root / 'Projects').mkdir()
    (root / 'Projects/saved.hdrfinisher').write_bytes(payload)
    (root / 'extra.png').touch()
    (root / '.DS_Store').touch()
    problems = verify_photos(root, manifest)
    assert len(problems) == 4
    assert any('Missing test photo:' in problem and 'missing.cr2' in problem for problem in problems)
    assert any('Different size:' in problem and 'size.tif' in problem for problem in problems)
    assert any('Different SHA-256:' in problem and 'hash.jpg' in problem for problem in problems)
    assert any('Unexpected test photo:' in problem and 'extra.png' in problem for problem in problems)


@pytest.mark.parametrize('names', [['../outside.arw'], ['/absolute.arw'], ['bad\\name.arw'], ['same.jpg', 'same.jpg']])
def test_manifest_rejects_unsafe_or_duplicate_names(tmp_path, names):
    manifest = tmp_path / 'manifest.json'
    manifest.write_text(json.dumps(dict(files=[dict(name=name) for name in names])))
    with pytest.raises(ValueError, match='Invalid or duplicate'):
        manifest_files(manifest)
