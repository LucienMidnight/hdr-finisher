"""Repeatable clone/worktree setup; run via setup.sh or setup.ps1."""
import ast
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import tempfile
from lib.machine_settings import CODEBASE, settings, python_executable, photos_path

TOOLS = ('avifenc', 'avifdec', 'avifgainmaputil', 'ultrahdr_app')


def run(args, **kwargs):
    print('+', ' '.join(map(str, args)), flush=True)
    subprocess.run(list(map(str, args)), check=True, **kwargs)


def link_directory(source, destination):
    source, destination = Path(source).absolute(), Path(destination).absolute()
    if source == destination or destination.exists() and source.exists() and source.samefile(destination):
        return
    if destination.exists() or destination.is_symlink():
        raise RuntimeError(f'Refusing to replace existing folder {destination}; move its contents into {source} first')
    destination.parent.mkdir(parents=True, exist_ok=True)
    if os.name == 'nt':
        run(['cmd', '/c', 'mklink', '/J', str(destination), str(source)])
    else:
        destination.symlink_to(source, target_is_directory=True)


def hash_file(file):
    return hashlib.sha256(Path(file).read_bytes()).hexdigest()


def native_tools(config):
    if os.name == 'nt':
        return
    name = 'macos' if sys.platform == 'darwin' else 'linux'
    script = CODEBASE / f'tools/build_native_{name}.sh'
    # Key on the exact recipe and architecture. Never adopt unknown old binaries.
    identity = hashlib.sha256(script.read_bytes() + platform.machine().encode() + sys.platform.encode() + ''.join(os.environ.get(key, '') for key in ('HDR_FINISHER_LIBAVIF_REF', 'HDR_FINISHER_LIBULTRAHDR_REF')).encode()).hexdigest()
    shared = Path(config['nativeToolsRoot']) / f'{sys.platform}-{platform.machine()}' / identity[:16]
    manifest = shared / 'validated.json'
    valid = False
    if manifest.exists():
        record = json.loads(manifest.read_text())
        valid = record.get('recipe') == identity and all((shared / tool).exists() and hash_file(shared / tool) == record['sha256'].get(tool) for tool in TOOLS)
    if not valid:
        shared.mkdir(parents=True, exist_ok=True)
        # A non-GPU build lock prevents concurrent worktrees building into one folder.
        lock = shared / 'setup.lock'
        try:
            lock.mkdir()
        except FileExistsError:
            raise RuntimeError(f'Native setup already running (or interrupted): {lock}. Retry after it finishes; remove this empty lock only if no setup is running.')
        try:
            with tempfile.TemporaryDirectory(prefix='hdr-finisher-native-', dir='/tmp') as work:
                env = dict(os.environ, HDR_FINISHER_NATIVE_WORK_DIR=work, HDR_FINISHER_NATIVE_BIN_DIR=str(shared))
                env['PATH'] = str(Path(python_executable()).parent) + os.pathsep + env['PATH']
                run(['bash', script], cwd=CODEBASE, env=env)
            manifest.write_text(json.dumps(dict(recipe=identity, sha256={tool: hash_file(shared / tool) for tool in TOOLS}), indent=2) + '\n')
        finally:
            lock.rmdir()
    else:
        print(f'Reusing validated native tools: {shared}', flush=True)
    for tool in TOOLS:
        destination = CODEBASE / 'bin' / tool
        if destination.is_symlink():
            destination.unlink()
        shutil.copy2(shared / tool, destination)
    for license in (shared / 'licenses').iterdir():
        destination = CODEBASE / 'bin/licenses' / license.name
        # Keep committed notices byte-for-byte; build recipes own updates to them.
        if not destination.exists():
            shutil.copy2(license, destination)


def report(config):
    missing = []
    for key in ('photosRoot', 'testFixturesRoot', 'sharedTestPhotos', 'sharedLocalTestMedia'):
        if not Path(config[key]).exists():
            missing.append(f'{key}: {config[key]}')
    fixture = Path(config['testFixturesRoot']) / 'library-mixed-v1'
    fixture_manifest = json.loads((CODEBASE / 'tools/library-mixed-v1.manifest.json').read_text())
    for entry in fixture_manifest['files']:
        file = fixture / entry['name']
        if not file.exists() or file.stat().st_size != entry['bytes']:
            missing.append(f'Mixed fixture: {file}')
    drivers = json.loads((CODEBASE / 'tests/release/drivers.json').read_text())
    for value in drivers['protectedProjects']:
        file = Path(photos_path(value))
        if not file.is_absolute():
            file = CODEBASE / file
        if file.exists():
            if os.name != 'nt':
                file.chmod(file.stat().st_mode & ~0o222)
        else:
            missing.append(f'Protected project: {file}')
    # Report every literal external photo dependency in active test/tool sources.
    # Templates are reported by their folder; generated filenames cannot be inferred.
    references = set(json.loads(subprocess.check_output(['node', str(CODEBASE / 'tools/lib/media-dependencies.cjs')], text=True)))
    for folder in ('tests', 'tools'):
        for source in (CODEBASE / folder).rglob('*.py'):
            if 'lib' in source.parts or source.name.startswith('test_'):
                continue
            for node in ast.walk(ast.parse(source.read_text(encoding='utf-8'))):
                if isinstance(node, ast.Constant) and isinstance(node.value, str) and re.match(r'D:[/\\]+Photos(?:[/\\]|$)', node.value, re.I):
                    references.add(re.sub(r'\\+', '/', node.value))
    for value in sorted(references):
        file = Path(photos_path(value))
        if not file.exists():
            missing.append(f'Photo dependency: {value}')
    print(f'\nSetup ready: {CODEBASE}\nMachine settings: {config["settingsFile"]}\nGPU window: {config["windowSize"]}')
    if missing:
        print('Missing private media (setup cannot download Steve\'s photos):\n' + '\n'.join('  - ' + item for item in missing))
    else:
        print('All declared private media dependencies are present.')
    return missing


def main():
    if sys.version_info[:2] != (3, 12):
        raise RuntimeError('Setup requires Python 3.12 (set HDR_FINISHER_SETUP_PYTHON to its executable)')
    if len(sys.argv) > 1:
        raise RuntimeError('Usage: setup.sh / setup.ps1 (no arguments)')
    for command in ('git', 'node', 'npm'):
        if not shutil.which(command):
            raise RuntimeError(f'Install {command} before running setup')
    config = settings()
    file = Path(config['settingsFile'])
    file.parent.mkdir(parents=True, exist_ok=True)
    if not file.exists():
        # Exclusive create: two worktrees can initialize the same defaults safely.
        try:
            with file.open('x', encoding='utf-8') as stream:
                json.dump({key: value for key, value in config.items() if key not in ('settingsFile', 'mainRepository')}, stream, indent=2)
                stream.write('\n')
        except FileExistsError:
            config = settings()
    python = Path(python_executable())
    if not python.exists():
        run([sys.executable, '-m', 'venv', CODEBASE / '.venv'])
    run([python, '-c', 'import sys; assert sys.version_info[:2] == (3, 12), "Recreate .venv with Python 3.12"'])
    run([python, '-m', 'pip', 'install', '-r', CODEBASE / 'requirements-dev.txt'])
    npm = shutil.which('npm')
    # npm.cmd needs cmd.exe on Windows; no shell interpretation of user paths.
    for cwd in (CODEBASE, CODEBASE / 'desktop'):
        run(([os.environ.get('COMSPEC', 'cmd.exe'), '/c', npm, 'install'] if os.name == 'nt' else [npm, 'install']), cwd=cwd)
    if sys.platform == 'darwin':
        run([python, '-m', 'pip', 'install', 'cmake>=3.28,<5'])
    native_tools(config)
    run([python, CODEBASE / 'tools/fetch_exiftool.py'], cwd=CODEBASE)
    for key, destination in (('sharedTestPhotos', CODEBASE / 'output/test-photos'), ('sharedLocalTestMedia', CODEBASE / 'local-test-media')):
        source = Path(config[key])
        # Missing private folders remain missing, reported below, not populated with fake media.
        if source.exists():
            link_directory(source, destination)
    report(config)


if __name__ == '__main__':
    try:
        main()
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f'Setup stopped: {error}', file=sys.stderr)
        sys.exit(1)
