"""Abort a serial research command before its process tree exceeds its budget."""
import argparse
import json
import os
from pathlib import Path
import signal
import subprocess
import time


def resident_rows():
    if os.name == 'nt':
        command = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize | ConvertTo-Json -Compress'
        processes = json.loads(subprocess.check_output(['powershell', '-NoProfile', '-Command', command], text=True))
        return [(int(row['ProcessId']), int(row['ParentProcessId']), int(row['WorkingSetSize'])) for row in processes]
    processes = subprocess.check_output(['ps', '-axo', 'pid=,ppid=,rss='], text=True)
    return [(int(parts[0]), int(parts[1]), int(parts[2])*1024) for line in processes.splitlines() if (parts := line.split())]


def terminate(child):
    if os.name == 'nt':
        subprocess.run(['taskkill', '/PID', str(child.pid), '/T', '/F'], capture_output=True)
    else:
        os.killpg(child.pid, signal.SIGTERM)
        try:
            child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--receipt', type=Path, required=True)
    parser.add_argument('--seconds', type=float, default=1500)
    parser.add_argument('--bytes', type=int, default=2_500_000_000)
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[0] == '--' else args.command
    start = time.monotonic()
    child = subprocess.Popen(command, start_new_session=True)
    peak, reason = 0, None
    while child.poll() is None:
        rows = resident_rows()
        descendants = {child.pid}
        while True:
            expanded = descendants | {pid for pid, parent, rss in rows if parent in descendants}
            if expanded == descendants:
                break
            descendants = expanded
        resident = sum(rss for pid, parent, rss in rows if pid in descendants)
        peak = max(peak, resident)
        if resident > args.bytes or time.monotonic()-start > args.seconds:
            reason = 'RSS limit' if resident > args.bytes else 'time limit'
            terminate(child)
            break
        time.sleep(.2)
    status = child.wait()
    args.receipt.parent.mkdir(parents=True, exist_ok=True)
    args.receipt.write_text(json.dumps(dict(command=command, elapsed_seconds=time.monotonic()-start,
                                          peak_tree_rss_bytes=peak, returncode=status, aborted=reason,
                                          polling_seconds=.2, rss_limit=args.bytes), indent=2))
    raise SystemExit(status if status else (1 if reason else 0))


if __name__ == '__main__':
    main()
