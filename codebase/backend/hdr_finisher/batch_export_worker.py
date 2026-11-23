"""Entrypoint for the isolated batch worker."""
import json
from pathlib import Path
import sys
from threading import Event, Lock, Thread
from time import sleep
from .batch_export import PhotoProgress, export_photo
from .diagnostics import action_scope, process_scope
from .export_presets import ExportPreset

LIVE_INTERVAL_S = .5

def main():
    from .library_worker import _lower_priority
    _lower_priority()
    task = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    preset = ExportPreset.model_validate(task["preset"])
    live = PhotoProgress(len(preset.versions))
    state = {"results": [], "live": live.snapshot()}
    target = Path(task["progress"])
    temporary = target.with_suffix(".tmp")
    lock = Lock()
    def write():
        # Caller holds the lock. A Windows reader can briefly block replace.
        try:
            temporary.write_text(json.dumps(state), encoding="utf-8")
            for attempt in range(3):
                try:
                    temporary.replace(target)
                    return
                except OSError:
                    if attempt < 2:
                        sleep(.01)
        except OSError:
            pass
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            pass  # Progress is advisory. The final result has its own file.

    def progress(results):
        with lock:
            state["results"] = list(results)
            write()
    stop = Event()
    def publish():
        while not stop.wait(LIVE_INTERVAL_S):
            try:
                snapshot = live.snapshot()
                with lock:
                    state["live"] = snapshot
                    write()
            except Exception:  # noqa: BLE001 - progress is advisory
                pass
    publisher = Thread(target=publish, daemon=True, name="batch-progress")
    publisher.start()
    try:
        with process_scope("batch_worker"), action_scope(task.get("diagnostic_action")):
            results = export_photo(task["photo"], preset, task["directory"], task["sequence"], progress,
                                   lambda: Path(task["cancel"]).exists(), live=live)
    finally:
        stop.set()
        publisher.join()
    Path(sys.argv[2]).write_text(json.dumps(results), encoding="utf-8")

if __name__ == "__main__": main()
