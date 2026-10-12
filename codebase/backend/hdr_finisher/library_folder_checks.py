"""Session-only scheduling of checks using the existing library index."""
from collections import deque
from concurrent.futures import CancelledError, TimeoutError
from copy import deepcopy
from pathlib import Path
from threading import Event, RLock, Thread
import time
import os
from .library_diagnostics import log, problem

class CheckAhead(Exception):
    _library_control = True


class FolderChecks:
    def __init__(self, index):
        self.index = index
        self.visible_seconds, self.pinned_seconds = 15, 300
        self.clock = time.monotonic
        self.lock, self.wake = RLock(), Event()
        self.thread = self.running = None
        self.views, self.folders = {}, {}
        self.requested, self.events = deque(), deque(maxlen=50)
        self.revision = 0
        self.pins = []
        self.availability = None
        self.next_availability = 0

    def start(self):
        if self.index.worker is None:
            return
        with self.lock:
            if self.thread is None or not self.thread.is_alive():
                self.thread = Thread(target=self._run, name="hdr-library-checks", daemon=True)
                self.thread.start()

    def visible(self, client, path):
        with self.lock:
            self.views = {key: value for key, value in self.views.items() if value[1] > self.clock()}
            if path:
                self.views[client] = (path, self.clock() + 4)
            else:
                self.views.pop(client, None)
        self.start()
        self.wake.set()

    def request(self, paths):
        with self.lock:
            for path in dict.fromkeys(paths):
                if path not in self.requested:
                    self.requested.append(path)
        self.start()
        self.wake.set()

    def seed(self, result):
        with self.lock:
            previous = self.folders.get(result["path"], {})
            self.folders[result["path"]] = {**previous, "scan": deepcopy(result),
                "observed": {p["path"]: p["bytes"] for p in result["photos"]},
                "last": previous.get("last", self.clock()), "duration": previous.get("duration", 0)}

    def status(self):
        with self.lock:
            return {"running": deepcopy(self.running), "requested": list(self.requested),
                "revision": self.revision, "events": list(self.events),
                "folders": [{"path": path, "last_checked": row.get("wall_time"),
                    "duration": row.get("duration", 0), "offline": row.get("offline", False),
                    "failure": row.get("failure", ""), "warnings": list(dict.fromkeys(w for values in row.get("warnings", {}).values() for w in values))} for path, row in self.folders.items()]}

    def choose(self, pins):
        now = self.clock()
        with self.lock:
            if self.requested:
                return self.requested.popleft(), True
            if self.index._paused:
                return None
            visible = {path for path, expires in self.views.values() if expires > now}
            enabled = self.index.preferences()["background_indexing"]
            available = {p["path"]: p.get("available", True) for p in pins}
            for path in dict.fromkeys([*sorted(visible), *([p["path"] for p in pins] if enabled else [])]):
                row = self.folders.setdefault(path, {"last": now, "duration": 0})
                if row.get("offline") and available.get(path, row.get("connected", False)):
                    return path, False
                base = 15 if row.get("failure") and not row.get("offline") else self.visible_seconds if path in visible else self.pinned_seconds
                if now - row.get("last", 0) >= max(base, 10 * row.get("duration", 0)):
                    return path, False
        return None

    def _job(self, command, **arguments):
        job, future = self.index.worker.submit_library(command, priority=20, background=True, checking=True, **arguments)
        try:
            while not self.index._stop.is_set():
                if not self.running["requested"] and (self.requested or self.index._paused):
                    raise CheckAhead()
                try:
                    return future.result(timeout=.1)
                except TimeoutError:
                    continue
            raise CancelledError()
        finally:
            self.index.worker.cancel(job)

    def check(self, path, requested=False):
        files = getattr(self.index.marks, "file_commands", None)
        epoch = files.epoch if files else 0
        started = self.clock()
        with self.lock:
            previous = deepcopy(self.folders.get(path, {}))
            self.running = {"path": path, "requested": requested, "state": "checking"}
        try:
            result = self._job("scan", path=path)
            if result.get("unreadable_folders"):
                raise OSError("Some sub-folders could not be read; existing entries kept")
            if files and epoch != files.epoch: raise CheckAhead()
            old = previous.get("scan", {"photos": [], "settings": {}, "folders": []})
            known = {p["path"]: p for p in old["photos"]}
            current = {p["path"]: p["bytes"] for p in result["photos"]}
            held = {p["path"] for p in result["photos"]
                if (p["path"] not in known or p["bytes"] != known[p["path"]]["bytes"])
                and previous.get("observed", {}).get(p["path"]) != p["bytes"]}
            result["photos"] = [known[p["path"]] if p["path"] in held else p for p in result["photos"]
                if p["path"] not in held or p["path"] in known]
            new = {p["path"]: p for p in result["photos"]}
            added, removed = set(new) - set(known), set(known) - set(new)
            changed = {p for p in set(new) & set(known)
                if (new[p]["bytes"], new[p]["mtime_ns"]) != (known[p]["bytes"], known[p]["mtime_ns"])}
            settings, old_settings = result.get("settings", {}), old.get("settings", {})
            settings_changed = {p for p in set(settings) | set(old_settings) if settings.get(p) != old_settings.get(p)}
            read = ((added | changed | {p[:-5] for p in settings_changed if p.endswith(".hdrf")}) & set(new)) - held
            found = bool(added or removed or changed or settings_changed or result.get("folders", []) != old.get("folders", []))
            warnings = previous.get("warnings", {})
            if found:
                self.running["changed"] = True
                self.index.wait_for_grade()
                self.index.remember_scan(path, result["photos"])
                # Reuse existing reconciliation; pending marks still win.
                missing = sorted(removed)
                if missing:
                    self.index.marks.read(missing, documents=[None] * len(missing), canonical=True, connected=True)
                paths = sorted(read)
                for start in range(0, len(paths), 200):
                    self.index.wait_for_grade()
                    batch = paths[start:start + 200]
                    record = self.index.marks.read(batch)
                    for value in batch:
                        messages = [message for message in record["warnings"] if Path(value).name in message]
                        if messages:
                            warnings[value] = messages
                        else:
                            warnings.pop(value, None)
                if settings_changed:
                    self.index.marks.conflicts.scan(list(new))
                waiting = [p["path"] for p in result["photos"] if p["path"] in added | changed and not p.get("indexed")]
                for start in range(0, len(waiting), 32):
                    records = self._job("metadata", paths=waiting[start:start + 32])["photos"]
                    self.index.remember_facts(records)
                    facts = {p["path"]: p for p in records}
                    for photo in result["photos"]:
                        photo.update(facts.get(photo["path"], {}))
                log("folder_check_changed", folder=path, added=len(added), removed=len(removed), changed=len(changed),
                    settings=len(settings_changed), action="library refreshed; originals and settings untouched")
            if files and epoch != files.epoch: raise CheckAhead()
            # Refresh cached ancestor/descendant views from this read, without another walk.
            with self.lock:
                for other_path, other in self.folders.items():
                    if other_path == path or not other.get("scan"):
                        continue
                    prefix = str(Path(path)) + os.sep
                    other_prefix = str(Path(other_path)) + os.sep
                    if path.startswith(other_prefix):
                        other["scan"]["photos"] = [p for p in other["scan"]["photos"] if not p["path"].startswith(prefix)] + deepcopy(result["photos"])
                    elif other_path.startswith(prefix):
                        other["scan"]["photos"] = [deepcopy(p) for p in result["photos"] if p["path"].startswith(other_prefix)]
                self.folders[path] = {"scan": deepcopy(result), "observed": current, "last": self.clock(),
                    "wall_time": time.time(), "duration": self.clock() - started, "offline": False, "warnings": warnings}
                if previous.get("offline"):
                    log("folder_check_recovered", folder=path, action="folder available; checked immediately")
                if found or requested:
                    self.revision += 1
                    message = f"{len(added)} new photos in {Path(path).name}" if added else f"Checked {Path(path).name}: " + ("library updated" if found else "no new photos")
                    if held:
                        message += f" · {len(held)} photos still arriving"
                    self.events.append({"id": self.revision, "path": path, "message": message, "changed": found})
                if requested:
                    log("folder_check_end", folder=path, added=len(added), removed=len(removed), changed=len(changed),
                        held=len(held), duration=round(self.clock() - started, 3))
            return {"added": len(added), "removed": len(removed), "changed": len(changed), "held": len(held)}
        except CheckAhead:
            return {"interrupted": True}
        except CancelledError:
            raise
        except Exception as error:
            offline = not Path(path).is_dir()
            with self.lock:
                row = self.folders.setdefault(path, previous)
                if row.get("failure") != str(error):
                    problem("folder_check_offline" if offline else "folder_check_failed", path, error, "entries kept; retry automatically")
                row.update(last=self.clock(), duration=self.clock() - started, offline=offline, failure=str(error))
                if requested:
                    self.revision += 1
                    self.events.append({"id": self.revision, "path": path, "changed": False,
                        "message": f"Could not check {Path(path).name}: " + ("folder is not connected; photos and marks are kept" if offline else "it will try again automatically")})
            return {"failed": True}
        finally:
            with self.lock:
                self.running = None

    def view(self, path):
        with self.lock:
            return deepcopy(self.folders.get(path, {}).get("scan"))

    def _refresh_availability(self):
        try:
            pins = self.index.browser.pinned()
            with self.lock:
                visible = {path for path, expires in self.views.values() if expires > self.clock()}
            known = {pin["path"] for pin in pins}
            extra = {path: Path(path).is_dir() for path in visible - known}
            with self.lock:
                self.pins = pins
                for path, connected in extra.items():
                    if path in self.folders:
                        self.folders[path]["connected"] = connected
        except Exception as error:
            problem("folder_check_availability_failed", self.index.browser.root, error, "known pins retained; retry availability")

    def _run(self):
        while not self.index._stop.is_set():
            if self.clock() >= self.next_availability and (self.availability is None or not self.availability.is_alive()):
                self.next_availability = self.clock() + 1
                self.availability = Thread(target=self._refresh_availability, name="hdr-library-availability", daemon=True)
                self.availability.start()
            task = self.choose(self.pins)
            if task:
                path, requested = task
                if not requested and (self.index._paused or self.index.worker.status()["paused"]):
                    self.wake.wait(.25)
                else:
                    try:
                        self.check(path, requested)
                    except CancelledError:
                        break
            else:
                self.wake.wait(.25)
            self.wake.clear()
