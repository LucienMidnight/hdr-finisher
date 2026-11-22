"""Entrypoint for the isolated batch worker."""
import json
from pathlib import Path
import sys
from threading import Event, Lock, Thread
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
    lock = Lock()
    def write():
        # One writer: finished versions and live progress share the file.
        with lock:
            target = Path(task["progress"])
            temporary = target.with_suffix(".tmp")
            temporary.write_text(json.dumps(state), encoding="utf-8")
            temporary.replace(target)
    def progress(results):
        state["results"] = list(results)
        write()
    stop = Event()
    def publish():
        while not stop.wait(LIVE_INTERVAL_S):
            try:
                state["live"] = live.snapshot()
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
