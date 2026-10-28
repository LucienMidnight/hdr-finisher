"""How much space the repository's scratch output uses (AGENTS.md "Disk space").

Run from codebase:  .venv/Scripts/python.exe tools/output_size.py
Prints each output folder's size and its largest runs. Exits with status 1 when
the total is over the limit Steve set (100 GB), so whoever runs it must tell him.
Read-only: it never deletes anything.
"""
import os
import sys
from pathlib import Path

LIMIT_GB = 100.0
REPO = Path(__file__).resolve().parents[2]
FOLDERS = [REPO / "codebase" / "output", REPO / "output"]


def size(path: Path) -> int:
    total = 0
    stack = [str(path)]
    while stack:
        try:
            with os.scandir(stack.pop()) as entries:
                for entry in entries:
                    try:
                        if entry.is_dir(follow_symlinks=False):
                            stack.append(entry.path)
                        elif entry.is_file(follow_symlinks=False):
                            total += entry.stat(follow_symlinks=False).st_size
                    except OSError:
                        pass
        except OSError:
            pass
    return total


def main() -> int:
    grand = 0
    for folder in FOLDERS:
        if not folder.is_dir():
            continue
        runs = sorted(((size(Path(e.path)) if e.is_dir() else e.stat().st_size, e.name)
                       for e in os.scandir(folder)), reverse=True)
        total = sum(s for s, _ in runs)
        grand += total
        print(f"{folder}: {total / 1e9:.1f} GB in {len(runs)} items")
        for s, name in runs[:5]:
            if s > 1e9:
                print(f"    {s / 1e9:6.1f} GB  {name}")
    print(f"Total scratch output: {grand / 1e9:.1f} GB (limit {LIMIT_GB:.0f} GB)")
    if grand / 1e9 > LIMIT_GB:
        print("OVER THE LIMIT: tell Steve before doing anything else (AGENTS.md, Disk space).")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
