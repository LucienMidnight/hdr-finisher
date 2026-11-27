"""The everyday inventory must cover every collected source file."""
import json
from pathlib import Path


def test_everyday_inventory_covers_test_files():
    root = Path(__file__).resolve().parents[1]
    inventory = json.loads((root / 'tests/inventory.json').read_text(encoding='utf-8'))
    expected = {p.relative_to(root).as_posix() for p in [*(root / 'tests').rglob('test_*.py'), *(root / 'tests').glob('*.test.js')]}
    actual = [entry['file'] for entry in inventory['files']]
    assert len(actual) == len(set(actual)), 'Duplicate inventory entries'
    assert set(actual) == expected, 'Refresh tools/test-inventory.py for added/removed files'
    assert actual == sorted(actual)
    assert all(entry['purpose'] and entry['test_count'] > 0 for entry in inventory['files'])
