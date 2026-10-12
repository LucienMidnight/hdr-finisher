"""Independent folder controls; no command here moves or deletes originals."""
import json
import os
import re
from pathlib import Path
from pydantic import BaseModel, ConfigDict
from fastapi import HTTPException
from .library_folders import checked_folder
from .library_kept import atomic_json
from .library_diagnostics import log


def folder_name(value):
    if not isinstance(value, str) or not value or value in {".", ".."}:
        raise ValueError("Enter a folder name.")
    if value.endswith((" ", ".")):
        raise ValueError("Windows names cannot end in a space or a full stop.")
    if any(ord(c) < 32 or c in '<>:"/\\|?*' for c in value):
        raise ValueError("The name contains a character Windows cannot use.")
    if re.fullmatch(r"CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³]", value.split(".")[0], re.I):
        raise ValueError("That name is reserved by Windows.")
    if len(value.encode("utf-16-le")) // 2 > 255:
        raise ValueError("That folder name is too long.")
    return value


class FolderControl(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: str
    paths: list[str]
    name: str = ""


class FolderCommands:
    def __init__(self, marks, browser, index):
        self.marks, self.browser, self.index = marks, browser, index

    def labels(self):
        try: saved = json.loads(self.index.preferences_path.read_text(encoding="utf-8"))
        except FileNotFoundError: saved = {}
        if not isinstance(saved, dict) or not isinstance(saved.get("pin_labels", {}), dict):
            raise ValueError("Library settings could not be read; nothing was changed.")
        return saved

    def pins(self):
        saved = self.labels()
        return [{**pin, "name": saved.get("pin_labels", {}).get(pin["path"], pin["name"])} for pin in self.browser.pinned()]

    def label(self, path, name, undo=True):
        with self.marks._lock, self.index._state:
            if path not in {p["path"] for p in self.browser.pinned()}:
                raise ValueError("Only a pinned folder has a label.")
            saved = self.labels(); labels = saved.setdefault("pin_labels", {}); before = labels.get(path, "")
            if name:
                name = " ".join(name.split())
                if not name or len(name) > 120: raise ValueError("Use a label of 1 to 120 characters.")
                labels[path] = name
            else: labels.pop(path, None)
            atomic_json(self.index.preferences_path, saved)
            if undo and before != name:
                self.marks._undo.append({"command": lambda: self.label(path, before, False) | {"copies_changed": True, "warnings": ["Restored the folder label."]}})
            log("folder_label", folder=path, name=name, action="display label saved; folder unchanged")
            return {"photos": [], "warnings": [], "undo_available": bool(self.marks._undo)}

    def create(self, parent, name):
        parent = checked_folder(parent); name = folder_name(name); target = parent / name
        with self.marks._lock:
            # mkdir is exclusive; a concurrent arrival cannot be overwritten.
            if any(p.name.casefold() == name.casefold() for p in parent.iterdir()):
                raise ValueError("That name is taken. Nothing was created.")
            try: target.mkdir()
            except FileExistsError as e: raise ValueError("That name is taken. Nothing was created.") from e
            identity = (target.stat().st_dev, target.stat().st_ino, target.stat().st_ctime_ns)
            def undo():
                info = target.stat()
                if (info.st_dev, info.st_ino, info.st_ctime_ns) != identity:
                    raise ValueError("The new folder changed; Undo left it untouched.")
                # Only this new, empty folder can be removed. rmdir refuses contents.
                try: target.rmdir()
                except OSError as e: raise ValueError("The new folder is no longer empty or is in use; Undo left it untouched.") from e
                log("folder_create_undo", folder=target, action="empty new folder removed")
                return {"photos": [], "warnings": ["Removed the empty new folder."], "copies_changed": True}
            self.marks._undo.append({"command": undo})
            log("folder_create", folder=target, action="new empty folder created")
            return {"path": str(target), "photos": [], "warnings": [], "undo_available": True}

    def show(self, paths):
        checked = [checked_folder(p) for p in dict.fromkeys(paths)]
        for path in checked: os.startfile(str(path))
        log("folder_show", paths=[str(p) for p in checked], action="opened in Explorer")
        return {"photos": [], "warnings": [], "undo_available": bool(self.marks._undo)}


def add_folder_command_routes(router, marks, browser, index):
    commands = FolderCommands(marks, browser, index)
    @router.post("/folder-command")
    def command(request: FolderControl):
        try:
            if request.action == "show": return commands.show(request.paths)
            if len(request.paths) != 1: raise ValueError("Select one folder for this command.")
            if request.action == "new": return commands.create(request.paths[0], request.name)
            if request.action == "label": return commands.label(request.paths[0], request.name)
            raise ValueError("That folder command is not available in this build. Nothing was changed.")
        except (ValueError, OSError) as e: raise HTTPException(400, str(e)) from e
    return commands
