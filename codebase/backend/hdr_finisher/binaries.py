from __future__ import annotations

import os
import shutil
from pathlib import Path

from .config import BIN_DIR, RUNTIME_ROOT


def bundled_binary_dir() -> Path:
    return BIN_DIR


def runtime_binary_dir() -> Path:
    return RUNTIME_ROOT / "bin"


def resolve_binary(command: str) -> Path | None:
    candidates: list[Path] = []
    names = [command]
    if os.name == "nt" and not command.lower().endswith(".exe"):
        names.insert(0, f"{command}.exe")

    for directory in (bundled_binary_dir(), runtime_binary_dir()):
        for name in names:
            candidate = directory / name
            if candidate not in candidates:
                candidates.append(candidate)

    for candidate in candidates:
        if candidate.exists():
            return candidate.resolve()

    resolved = shutil.which(command)
    if resolved:
        return Path(resolved).resolve()
    return None
