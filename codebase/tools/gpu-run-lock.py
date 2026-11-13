"""Serialize GPU/Electron checks across all worktrees, including the old wrapper.

python tools/gpu-run-lock.py --label who-what [--minutes 20] -- command args...
Standard library only. A timeout returns 124; interruption returns 130.
"""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import time
from datetime import datetime, timezone
from lib.machine_settings import settings

STALE_SECONDS = 60 * 60


def pid_alive(pid):
    if os.name == 'nt':
        result = subprocess.run(['tasklist', '/FI', f'PID eq {pid}', '/NH'], capture_output=True, text=True)
        return str(pid) in result.stdout
    try:
        os.kill(pid, 0)
        state = subprocess.check_output(['ps', '-o', 'stat=', '-p', str(pid)], text=True).strip()
        return bool(state) and not state.startswith('Z')
    except (OSError, subprocess.CalledProcessError):
        return False


def old_lock_held(folder):
    try:
        owner = json.loads((folder / 'gpu-check.lock').read_text(encoding='utf-8'))
        return pid_alive(int(owner['pid']))
    except (OSError, ValueError, KeyError):
        return False


def acquire(folder, owner):
    folder.mkdir(parents=True, exist_ok=True)
    lock = folder / 'gpu-run.lock'
    waited = 0
    while True:
        if not old_lock_held(folder):
            try:
                lock.mkdir()
                try:
                    (lock / 'owner.txt').write_text(owner, encoding='utf-8')
                except BaseException:
                    lock.rmdir()
                    raise
                return lock
            except FileExistsError:
                record = lock / 'owner.txt'
                try:
                    text = record.read_text(encoding='utf-8')
                    pid = re.search(r'pid=(\d+)', text)
                    # Age alone cannot make a live GPU holder safe to overlap.
                    if time.time() - record.stat().st_mtime > STALE_SECONDS and pid and not pid_alive(int(pid[1])):
                        tomb = lock.with_name(f'gpu-run.stale-{os.getpid()}')
                        lock.rename(tomb)
                        shutil.rmtree(tomb)
                        continue
                except (OSError, ValueError):
                    # A process can die between mkdir and owner publication.
                    if not record.exists() and time.time() - lock.stat().st_mtime > STALE_SECONDS:
                        try:
                            lock.rmdir()
                        except OSError:
                            pass
        if waited % 120 == 0:
            print(f'[gpu-run-lock] waiting for {lock}', flush=True)
        time.sleep(5)
        waited += 5


def process_rows():
    if os.name == 'nt':
        return {}
    output = subprocess.check_output(['ps', '-eo', 'pid=,ppid=,stat=,lstart='], text=True)
    rows = {}
    for line in output.splitlines():
        parts = line.split(None, 3)
        if len(parts) == 4 and not parts[2].startswith('Z'):
            rows[int(parts[0])] = (int(parts[1]), parts[3])
    return rows


def descendants(rows, tracked):
    changed = True
    while changed:
        changed = False
        for pid, (parent, born) in rows.items():
            if pid not in tracked and parent in tracked and rows.get(parent, (None, None))[1] == tracked[parent]:
                tracked[pid] = born
                changed = True


def kill_tree(child, tracked):
    if child is None:
        return
    if os.name == 'nt':
        # Keep Windows' established whole-tree termination.
        subprocess.run(['taskkill', '/T', '/F', '/PID', str(child.pid)], capture_output=True)
        child.wait(timeout=30)
        return
    rows = process_rows()
    descendants(rows, tracked)
    try:
        os.killpg(child.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    # Electron launchers can create their own process groups. Include those too.
    for pid, born in tracked.items():
        if rows.get(pid, (None, None))[1] == born:
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
    child.wait(timeout=30)
    for _ in range(100):
        rows = process_rows()
        survivors = [pid for pid, born in tracked.items() if rows.get(pid, (None, None))[1] == born]
        if not survivors:
            return
        time.sleep(.1)
    raise RuntimeError(f'GPU lock retained: process tree still alive: {survivors}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--label', default='unnamed')
    parser.add_argument('--minutes', type=float, default=20)
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    if not command or args.minutes <= 0:
        parser.error('a command and positive --minutes are required')
    config = settings()
    # Always acquire the legacy parent lock too, even with a custom lock folder.
    folders = sorted({Path(config['lockFolder']).resolve(), Path(config['mainRepository']).parent.resolve()})
    locks = []
    owner = f'{args.label} {datetime.now(timezone.utc).isoformat()} pid={os.getpid()}\n'
    child, tracked, safe = None, {}, True
    code = 1
    def interrupted(_signal, _frame):
        raise KeyboardInterrupt
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, interrupted)
    try:
        for folder in folders:
            locks.append(acquire(folder, owner))
        env = dict(os.environ, HDR_FINISHER_ELECTRON_WINDOW_SIZE=config['windowSize'])
        print(f'[gpu-run-lock] acquired: {args.label}; window {config["windowSize"]}', flush=True)
        program = Path(command[0])
        if program.exists():
            command[0] = str(program.absolute())
        elif shutil.which(command[0]):
            command[0] = shutil.which(command[0])
        child = subprocess.Popen(command, env=env, start_new_session=os.name != 'nt',
                                 shell=os.name == 'nt' and command[0].lower().endswith(('.cmd', '.bat')))
        deadline = time.monotonic() + args.minutes * 60
        if os.name != 'nt':
            rows = process_rows()
            if child.pid in rows:
                tracked[child.pid] = rows[child.pid][1]
        while child.poll() is None:
            if os.name != 'nt':
                descendants(process_rows(), tracked)
            if time.monotonic() >= deadline:
                print('[gpu-run-lock] time limit reached; stopping process tree', flush=True)
                code = 124
                break
            time.sleep(.1)
        else:
            code = child.returncode
    except KeyboardInterrupt:
        code = 130
    finally:
        try:
            kill_tree(child, tracked)
        except BaseException:
            safe = False
            raise
        finally:
            if safe:
                for lock in reversed(locks):
                    try:
                        if (lock / 'owner.txt').read_text(encoding='utf-8') == owner:
                            shutil.rmtree(lock)
                    except OSError:
                        pass
                print(f'[gpu-run-lock] released (exit {code})', flush=True)
    return code


if __name__ == '__main__':
    sys.exit(main())
