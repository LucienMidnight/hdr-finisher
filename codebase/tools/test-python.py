"""Run every Python test with bounded parallelism, then resource/deadline checks."""
from __future__ import annotations

import argparse
from pathlib import Path
import subprocess
import sys
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serial", action="store_true", help="run the entire suite in one process")
    options, extra = parser.parse_known_args()
    base = [sys.executable, "-m", "pytest", "tests", "-q", *extra]
    phases = [([], "serial suite")] if options.serial else [
        (["-m", "not serial", "-n", "auto", "--maxprocesses=4", "--dist=worksteal"], "parallel tests"),
        (["-m", "serial"], "serial resource/deadline checks"),
    ]
    started = time.perf_counter()
    failed = False
    for flags, label in phases:
        print(f"\nPython tests: {label}", flush=True)
        result = subprocess.run([*base, *flags], cwd=Path(__file__).resolve().parents[1])
        # Still run the second phase on an assertion failure; never hide coverage.
        if result.returncode not in (0, 1):
            return result.returncode
        failed |= result.returncode != 0
    print(f"\nPython suite wall time: {time.perf_counter() - started:.2f}s", flush=True)
    return int(failed)


if __name__ == "__main__":
    raise SystemExit(main())
