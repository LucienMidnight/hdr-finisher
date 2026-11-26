"""Tooling checks use disposable locks and small child processes, never the GPU."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import pytest

CODEBASE = Path(__file__).resolve().parents[1]
TOOLS = CODEBASE / 'tools'
sys.path.insert(0, str(TOOLS))


def load_lock():
    spec = importlib.util.spec_from_file_location('gpu_run_lock', TOOLS / 'gpu-run-lock.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def lock_command(tmp_path, *args):
    # Override settings in the subprocess: no production lock is acquired.
    script = ('import importlib.util,sys;sys.path.insert(0,sys.argv.pop(1));'
              's=importlib.util.spec_from_file_location("lock",sys.argv.pop(1));'
              'm=importlib.util.module_from_spec(s);s.loader.exec_module(m);m.POLL_SECONDS=.05;'
              'folder=sys.argv.pop(1);m.settings=lambda:dict(lockFolder=folder,mainRepository=folder+"/repo",windowSize="1408x794");'
              'sys.exit(m.main())')
    return [sys.executable, '-c', script, str(TOOLS), str(TOOLS / 'gpu-run-lock.py'), str(tmp_path), *map(str, args)]


def test_js_python_settings_agree(tmp_path, monkeypatch):
    from lib.machine_settings import settings
    file = tmp_path / 'machine.json'
    file.write_text(json.dumps(dict(windowSize='1234x789', photosRoot='photos', testFixturesRoot='fixtures',
                                   sharedTestPhotos='test-photos', sharedLocalTestMedia='media', lockFolder='locks', nativeToolsRoot='native')))
    monkeypatch.setenv('HDR_FINISHER_MACHINE_SETTINGS', str(file))
    monkeypatch.delenv('HDR_FINISHER_ELECTRON_WINDOW_SIZE', raising=False)
    monkeypatch.delenv('HDR_FINISHER_PHOTOS_ROOT', raising=False)
    result = subprocess.check_output(['node', '-e', 'console.log(JSON.stringify(require("./tools/lib/machine-settings.cjs").machineSettings()))'], cwd=CODEBASE, text=True)
    assert json.loads(result) == settings()


def test_lock_passes_window_and_return_code(tmp_path):
    result = subprocess.run(lock_command(tmp_path, '--label', 'test', '--', sys.executable, '-c',
                           'import os,sys;print(os.environ["HDR_FINISHER_ELECTRON_WINDOW_SIZE"]);sys.exit(7)'), capture_output=True, text=True, timeout=15)
    assert result.returncode == 7, result.stderr
    assert '1408x794' in result.stdout
    assert not (tmp_path / 'gpu-run.lock').exists()


def test_legacy_lock_blocks_new_wrapper(tmp_path):
    lock = tmp_path / 'gpu-run.lock'
    lock.mkdir()
    owner = lock / 'owner.txt'
    owner.write_text(f'legacy pid={os.getpid()}\n')
    marker = tmp_path / 'ran'
    child = subprocess.Popen(lock_command(tmp_path, '--', sys.executable, '-c', f'from pathlib import Path;Path({str(marker)!r}).touch()'), stdout=subprocess.DEVNULL)
    try:
        time.sleep(.5)
        assert not marker.exists()
        owner.unlink()
        lock.rmdir()
        assert child.wait(timeout=10) == 0
        assert marker.exists()
    finally:
        if child.poll() is None:
            child.kill()
            child.wait()


def test_stale_dead_lock_is_recovered(tmp_path, monkeypatch):
    module = load_lock()
    lock = tmp_path / 'gpu-run.lock'
    lock.mkdir()
    owner = lock / 'owner.txt'
    owner.write_text('dead pid=999999999\n')
    os.utime(owner, (time.time() - 3601,) * 2)
    monkeypatch.setattr(module, 'pid_alive', lambda pid: False)
    assert module.acquire(tmp_path, 'replacement') == lock
    assert owner.read_text() == 'replacement'


@pytest.mark.skipif(os.name == 'nt', reason='POSIX groups; Windows uses existing taskkill /T')
def test_timeout_stops_detached_grandchild(tmp_path):
    module = load_lock()
    marker = tmp_path / 'grandchild.pid'
    grandchild = 'import time;time.sleep(60)'
    parent = ('import subprocess,sys,time;from pathlib import Path;'
              f'p=subprocess.Popen([sys.executable,"-c",{grandchild!r}],start_new_session=True);'
              f'Path({str(marker)!r}).write_text(str(p.pid));time.sleep(60)')
    result = subprocess.run(lock_command(tmp_path, '--minutes', '.025', '--', sys.executable, '-c', parent), capture_output=True, text=True, timeout=20)
    assert result.returncode == 124, result.stderr
    assert marker.exists()
    assert not module.pid_alive(int(marker.read_text()))
    assert not (tmp_path / 'gpu-run.lock').exists()


def test_live_owner_is_not_broken_after_sixty_minutes(tmp_path):
    module = load_lock()
    lock = tmp_path / 'gpu-run.lock'
    lock.mkdir()
    owner = lock / 'owner.txt'
    owner.write_text(f'live pid={os.getpid()}\n')
    os.utime(owner, (time.time() - 3601,) * 2)
    assert not module.recover_stale(lock)
    assert owner.exists()


def test_shared_media_link_is_repeatable_and_keeps_one_copy(tmp_path):
    spec = importlib.util.spec_from_file_location('setup_machine', TOOLS / 'setup-machine.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    source = tmp_path / 'shared'
    source.mkdir()
    (source / 'photo').write_text('one original')
    target = tmp_path / 'worktree' / 'test-photos'
    module.link_directory(source, target)
    module.link_directory(source, target)
    assert (source / 'photo').samefile(target / 'photo')
    (target / 'photo').write_text('same original')
    assert (source / 'photo').read_text() == 'same original'


@pytest.mark.skipif(sys.platform != 'darwin', reason='macOS physical-footprint diagnostic')
def test_memory_sampler_keeps_native_footprint():
    child = subprocess.Popen([sys.executable, str(TOOLS / 'sample-process-memory.py'), str(os.getpid())],
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        time.sleep(1.5)
        child.terminate()
        output, errors = child.communicate(timeout=10)
        assert output, errors
        rows = json.loads(output.splitlines()[0])['processes']
        own = next(row for row in rows if row['id'] == os.getpid())
        assert own['chargedBytes'] > 0
        assert own['workingSetBytes'] > 0
        assert own['privateBytes'] is None
    finally:
        if child.poll() is None:
            child.kill()
            child.communicate(timeout=10)


def test_waiters_acquire_in_registration_order(tmp_path):
    # Block registration behind a legacy owner, then release a queued burst.
    lock = tmp_path / 'gpu-run.lock'
    lock.mkdir()
    (lock / 'owner.txt').write_text(f'legacy pid={os.getpid()}\n')
    order = tmp_path / 'order.txt'
    children = []
    def until(predicate):
        deadline = time.monotonic() + 15
        while not predicate() and time.monotonic() < deadline:
            time.sleep(.02)
        assert predicate()
    try:
        for index in range(3):
            script = f'from pathlib import Path;p=Path({str(order)!r});p.open("a").write("{index}\\n")'
            children.append(subprocess.Popen(lock_command(tmp_path, '--label', f'fifo-{index}', '--',
                                                       sys.executable, '-c', script),
                                             stdout=subprocess.DEVNULL, stderr=subprocess.PIPE))
            until(lambda: len(list((tmp_path / 'gpu-run.queue').glob('*.ticket'))) == index + 1)
        (lock / 'owner.txt').unlink()
        lock.rmdir()
        for child in children:
            _, errors = child.communicate(timeout=30)
            assert child.returncode == 0, errors
        assert order.read_text().splitlines() == ['0', '1', '2']
        assert not list((tmp_path / 'gpu-run.queue').glob('*.ticket'))
        assert not lock.exists()
    finally:
        for child in children:
            if child.poll() is None:
                child.kill()
                child.communicate(timeout=10)


def test_dead_waiter_is_skipped_but_live_waiter_is_never_bypassed(tmp_path, monkeypatch):
    module = load_lock()
    earlier = module.enqueue(tmp_path)
    later = module.enqueue(tmp_path)
    monkeypatch.setattr(module, 'pid_alive', lambda pid: True)
    assert not module.queue_turn(tmp_path, later)
    assert earlier.exists()
    monkeypatch.setattr(module, 'pid_alive', lambda pid: False)
    assert module.queue_turn(tmp_path, later)
    assert not earlier.exists()
    later.unlink()


def test_interrupted_wait_removes_its_ticket(tmp_path, monkeypatch):
    module = load_lock()
    monkeypatch.setattr(module, 'old_lock_held', lambda folder: True)
    def interrupt(seconds):
        raise KeyboardInterrupt
    monkeypatch.setattr(module.time, 'sleep', interrupt)
    with pytest.raises(KeyboardInterrupt):
        module.acquire(tmp_path, 'interrupted')
    assert not list((tmp_path / 'gpu-run.queue').glob('*.ticket'))
    assert not (tmp_path / 'gpu-run.lock').exists()
