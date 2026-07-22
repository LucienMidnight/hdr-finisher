from __future__ import annotations

from pathlib import Path


def pick_directory(initial_directory: str | None = None) -> str | None:
    try:
        import tkinter as tk
        from tkinter import filedialog
    except ImportError as exc:
        raise RuntimeError("Native folder picker is unavailable because tkinter is not installed.") from exc

    initial_path = _usable_initial_directory(initial_directory)
    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    root.update()
    try:
        directory = filedialog.askdirectory(
            parent=root,
            title="Choose Export Folder",
            initialdir=str(initial_path) if initial_path else None,
            mustexist=True,
        )
    finally:
        root.destroy()

    return directory or None


def _usable_initial_directory(value: str | None) -> Path | None:
    if not value:
        return None
    path = Path(value).expanduser()
    if path.is_dir():
        return path
    if path.parent.is_dir():
        return path.parent
    return None
