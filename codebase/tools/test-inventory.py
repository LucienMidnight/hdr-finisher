"""Refresh file-level everyday-test inventory from actual pytest/Node reports.

From codebase (PowerShell):
  $env:HDR_TEST_INVENTORY_REPORT='output/test-inventory/python'
  .venv/Scripts/python.exe tools/test-python.py --durations=0 -p tools.test_inventory_plugin
  node --test --test-reporter=./tools/test-inventory-reporter.cjs tests/*.test.js > output/test-inventory-node.jsonl
  .venv/Scripts/python.exe tools/test-inventory.py

Use a clean output/test-inventory directory for each measurement. Timings are
summed setup/call/teardown or Node test durations, not parallel wall time.
Collection-only refreshes counts without changing measured timing baselines.
"""
from __future__ import annotations

import ast
import argparse
from collections import defaultdict
import json
from pathlib import Path
import platform
import re

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'tests/inventory.json'


def discover():
    return sorted([*(ROOT / 'tests').rglob('test_*.py'), *ROOT.glob('tests/*.test.js')])


def mark_slow(reports):
    """Add descriptive function markers; never change serial/skip selection."""
    targets = defaultdict(set)
    for nodeid, record in reports.items():
        if record.get('seconds', 0) > 5 and 'outcome' in record:
            parts = nodeid.split('::')
            targets[parts[0]].add(parts[-1].split('[')[0])
    for name, functions in targets.items():
        path = ROOT / name
        raw = path.read_bytes()
        text = raw.decode('utf-8')
        tree = ast.parse(text)
        newline = '\r\n' if b'\r\n' in raw else '\n'
        additions = {}
        for element in ast.walk(tree):
            if isinstance(element, (ast.FunctionDef, ast.AsyncFunctionDef)) and element.name in functions:
                if any(ast.unparse(d) == 'pytest.mark.slow' for d in element.decorator_list):
                    continue
                start = min([element.lineno] + [d.lineno for d in element.decorator_list]) - 1
                additions[start] = ' ' * element.col_offset + '@pytest.mark.slow' + newline
        if not additions:
            continue
        if not any(isinstance(n, ast.Import) and any(a.name == 'pytest' for a in n.names) for n in tree.body):
            imports_after = max([n.end_lineno for n in tree.body if isinstance(n, ast.ImportFrom) and n.module == '__future__'] + [tree.body[0].end_lineno if ast.get_docstring(tree) else 0])
            additions[imports_after] = 'import pytest' + newline + additions.get(imports_after, '')
        path.write_bytes(''.join(additions.get(i, '') + line for i, line in enumerate(text.splitlines(keepends=True))).encode('utf-8'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mark-slow', action='store_true', help='add slow markers to functions with measured cases over 5 seconds')
    options = parser.parse_args()
    previous = {entry['file']: entry for entry in json.loads(DEST.read_text(encoding='utf-8'))['files']} if DEST.exists() else {}
    timing_platform = {'Windows': 'windows', 'Darwin': 'mac'}.get(platform.system(), 'linux')
    reports = {}
    for path in sorted(ROOT.glob('output/test-inventory/python-*.json')):
        for nodeid, item in json.loads(path.read_text(encoding='utf-8-sig')).items():
            if nodeid not in reports or 'outcome' in item:
                reports[nodeid] = item
    if options.mark_slow:
        mark_slow(reports)
    node = defaultdict(list)
    for report in sorted(ROOT.glob('output/test-inventory-node*.jsonl')):
        raw = report.read_bytes()
        current = defaultdict(list)
        for line in raw.decode('utf-16' if raw.startswith(b'\xff\xfe') else 'utf-8-sig').splitlines():
            item = json.loads(line)
            if item.get('file') and item['details'].get('type') != 'suite':
                current[Path(item['file']).name].append(item)
        node.update(current)
    entries = []
    for path in discover():
        relative = path.relative_to(ROOT).as_posix()
        source = path.read_text(encoding='utf-8-sig')
        python = path.suffix == '.py'
        records = [v for k, v in reports.items() if k.split('::')[0].replace('\\', '/') == relative] if python else node[path.name]
        markers = set()
        notes = []
        if python:
            tree = ast.parse(source)
            purpose = (ast.get_docstring(tree) or '').split('\n')[0]
            for element in ast.walk(tree):
                if isinstance(element, ast.Attribute) and isinstance(element.value, ast.Attribute) and ast.unparse(element.value) == 'pytest.mark':
                    markers.add(element.attr)
                if isinstance(element, ast.Call) and ast.unparse(element.func) in ('pytest.skip', 'pytest.mark.skipif'):
                    notes.append(ast.get_source_segment(source, element).replace('\n', ' '))
                if isinstance(element, ast.If) and any(isinstance(child, ast.Call) and ast.unparse(child.func) == 'pytest.skip' for statement in element.body for child in ast.walk(statement)):
                    notes.append('Conditional skip: ' + ast.unparse(element.test))
        else:
            purpose = next((v['name'] for v in records), '')
            notes = [line.strip() for line in source.splitlines() if re.search(r'skip\s*:.*process.platform', line)]
        label = path.stem.removeprefix('test_').removesuffix('.test').replace('_', ' ').replace('-', ' ')
        if not purpose:
            purpose = 'Checks ' + label + ' behavior and regression contracts.'
        seconds = {'windows': None, 'mac': None, **previous.get(relative, {}).get('seconds', {})}
        seconds[timing_platform] = round(sum(v.get('seconds', 0) if python else v['details']['duration_ms'] / 1000 for v in records), 4) if records and (not python or any('outcome' in v for v in records)) else None
        entries.append({
            'file': relative, 'suite': 'python' if python else 'node',
            'area': label.split()[0], 'purpose': purpose,
            'test_count': len(records),
            'seconds': seconds,
            'markers': sorted(markers),
            'requirements': sorted(markers & {'gpu', 'needs_test_photos', 'needs_native_helper', 'windows_only', 'mac_only', 'posix_only'}),
            'platform_notes': sorted(set(notes)),
        })
    DEST.write_text(json.dumps({'schema_version': 1, 'measurement': {
        'platform': platform.system(), 'machine': platform.node(),
        'common_requirements': {'python': 'Project .venv with setup-pinned dependencies; pytest-xdist for phased runner.', 'node': 'Node and installed project dependencies; subprocess/tooling tests also use Git and the project Python.'},
        'timing_basis': 'Sum of reported test durations including Python setup/teardown; parallel wall time differs; skipped tests include skip-check cost.',
        'counts': 'Collected parametrized pytest cases; Node reported test events excluding suites (includes parent tests).',
        'requirements_scope': 'File-level union: only the marked subset may require each optional resource. Existing skip conditions remain authoritative.',
        'refresh': 'See tools/test-inventory.py docstring; never infer Mac timings from Windows.'},
        'files': entries}, indent=2) + '\n', encoding='utf-8')
    print(f'{len(entries)} test files -> {DEST}')


if __name__ == '__main__':
    main()
