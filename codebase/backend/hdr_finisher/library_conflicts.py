"""Read-only detection of extra settings documents, during visits and indexing."""
from collections import defaultdict
import json
import os
from pathlib import Path
from threading import RLock

from .library_diagnostics import log, problem


class LibraryConflicts:
    def __init__(self):
        self._folders = {}
        self._lock = RLock()

    def status(self):
        with self._lock:
            return [item for groups in self._folders.values() for item in groups]

    def scan(self, paths):
        with self._lock:
            self._scan(paths)

    def _scan(self, paths):
        folders = defaultdict(set)
        for value in paths:
            source = Path(value)
            folders[source.parent].add(source.name)
        for folder, sources in folders.items():
            try:
                entries = list(folder.iterdir())
            except FileNotFoundError:
                continue  # Retain known conflicts while a drive is disconnected.
            except OSError as error:
                problem("settings_conflict_scan_failed", folder, error, "existing attention retained; retry on next visit")
                continue
            # Source filenames in valid documents identify copies regardless of
            # the sync service's naming convention. Never follow links or temps.
            copies = defaultdict(list)
            canonical_names = {os.path.normcase(name + ".hdrf") for name in sources}
            entry_names = {os.path.normcase(entry.name) for entry in entries}
            for entry in entries:
                if ".hdrf" not in entry.name.casefold() or entry.name.endswith(".tmp"):
                    continue
                # Ordinary canonical files are not extra documents. Still include
                # them in a conflict's pair even if they themselves are invalid.
                key = os.path.normcase(entry.name)
                if key in canonical_names or (key.endswith(".hdrf") and key[:-5] in entry_names):
                    continue
                if entry.is_symlink() or not entry.is_file():
                    continue
                named = next((name for name in sources if "conflict" in entry.name.casefold()
                    and any(entry.name.casefold().startswith((name + suffix).casefold())
                        for suffix in (".hdrf", " (", " -"))), None)
                if named:
                    copies[named].append(str(entry))
                    continue  # Even an unreadable sync conflict is identifiable.
                try:
                    document = json.loads(entry.read_text(encoding="utf-8"))
                except (ValueError, OSError) as error:
                    problem("settings_conflict_read_failed", entry, error, "unidentified extra file left untouched")
                    continue
                if not isinstance(document, dict) or document.get("format") != "HDR Finisher Photo":
                    continue
                source = document.get("source")
                name = source.get("filename") if isinstance(source, dict) else None
                if name in sources and document.get("photo_id"):
                    copies[name].append(str(entry))
            groups = []
            for name, extras in sorted(copies.items()):
                canonical = folder / (name + ".hdrf")
                files = ([str(canonical)] if canonical.exists() or canonical.is_symlink() else []) + sorted(extras)
                # A renamed lone settings document isn't a second settings file.
                if len(files) < 2:
                    continue
                groups.append({"folder": str(folder), "photo": str(folder / name), "files": files,
                    "message": f"More than one settings file was found for {name}. All files were left untouched; nothing was merged."})
            # Preserve groups for other photos when the caller reads a subset.
            previous = self._folders.get(str(folder), [])
            retained = [item for item in previous if Path(item["photo"]).name not in sources]
            if groups != [item for item in previous if Path(item["photo"]).name in sources]:
                if groups:
                    log("settings_conflict", folder=folder, count=len(groups), examples=groups[:3], action="all copies left untouched; Needs attention")
                else:
                    log("settings_conflict_cleared", folder=folder, action="extra settings files no longer found")
            self._folders[str(folder)] = retained + groups
