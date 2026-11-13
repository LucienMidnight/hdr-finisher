"""Machine-local test tooling settings. No application settings are changed."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys

CODEBASE = Path(__file__).resolve().parents[2]


def main_repository(codebase=CODEBASE):
    common = subprocess.check_output(
        ['git', '-C', str(codebase), 'rev-parse', '--path-format=absolute', '--git-common-dir'], text=True
    ).strip()
    return Path(common).parent


def settings(codebase=CODEBASE):
    repo = main_repository(codebase)
    file = Path(os.environ.get('HDR_FINISHER_MACHINE_SETTINGS', repo.parent / 'hdr-finisher-machine.json')).expanduser().absolute()
    base = file.parent
    result = dict(windowSize='1408x794' if sys.platform == 'darwin' else '2560x1440',
                  photosRoot='D:/Photos' if os.name == 'nt' else str(base / 'Photos'),
                  testFixturesRoot=str(base / 'test-fixtures'),
                  sharedTestPhotos=str(repo / 'codebase/output/test-photos'),
                  sharedLocalTestMedia=str(repo / 'codebase/local-test-media'),
                  lockFolder=str(repo.parent), nativeToolsRoot=str(base / 'native-tools'))
    if file.exists():
        result.update(json.loads(file.read_text(encoding='utf-8')))
    overrides = {'windowSize': 'HDR_FINISHER_ELECTRON_WINDOW_SIZE', 'photosRoot': 'HDR_FINISHER_PHOTOS_ROOT'}
    for key in result:
        if key in overrides and os.environ.get(overrides[key]):
            result[key] = os.environ[overrides[key]]
        if key != 'windowSize':
            value = Path(result[key]).expanduser()
            result[key] = str(value if value.is_absolute() else base / value)
    if not re.fullmatch(r'[1-9]\d*x[1-9]\d*', result['windowSize']):
        raise ValueError('windowSize must be WIDTHxHEIGHT')
    result['settingsFile'] = str(file)
    result['mainRepository'] = str(repo)
    return result


def photos_path(value):
    text = str(value)
    match = re.match(r'D:[\\/]+Photos(?=[\\/]|$)', text, re.I)
    if match:
        return str(Path(settings()['photosRoot']).joinpath(*filter(None, re.split(r'[\\/]+', text[match.end():]))))
    return text


def python_executable(codebase=CODEBASE):
    return os.environ.get('HDR_FINISHER_PYTHON') or str(Path(codebase) / '.venv' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python'))


if __name__ == '__main__':
    print(json.dumps(settings(), indent=2))
