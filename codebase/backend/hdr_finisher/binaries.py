from __future__ import annotations

import os
import shutil
from pathlib import Path

from .config import BIN_DIR


def bundled_binary_dir() -> Path:
    return BIN_DIR


def resolve_binary(command: str) -> Path | None:
    candidates: list[Path] = []
    names = [command]
    if os.name == "nt" and not command.lower().endswith(".exe"):
        names.insert(0, f"{command}.exe")

    for name in names:
        candidates.append(bundled_binary_dir() / name)

    for candidate in candidates:
        if candidate.exists():
            return candidate.resolve()

    resolved = shutil.which(command)
    if resolved:
        return Path(resolved).resolve()
    return None
