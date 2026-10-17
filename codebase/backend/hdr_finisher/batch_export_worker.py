"""Entrypoint for the isolated batch CPU worker."""
import json
from pathlib import Path
import sys
from .batch_export import export_photo
from .export_presets import ExportPreset

def main():
    from .library_worker import _lower_priority
    _lower_priority()
    task = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    results = export_photo(task["photo"], ExportPreset.model_validate(task["preset"]), task["directory"], task["sequence"])
    Path(sys.argv[2]).write_text(json.dumps(results), encoding="utf-8")

if __name__ == "__main__": main()
