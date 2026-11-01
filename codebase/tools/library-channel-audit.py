"""Count stored Library pictures with a colour channel that is (almost) all zero.

Run from codebase: .venv/Scripts/python.exe tools/library-channel-audit.py <cache folder>
Prints JSON. A real photo never has every red, green or blue value exactly
zero, so any hit means a development step wrote nothing (November 1, 2026:
teal and black 42 MP RAW thumbnails). Read-only.
"""
import json
import sys
from pathlib import Path

import numpy as np


def audit(folder: Path) -> dict:
    result = {"pictures": 0, "one_channel_zero": [], "all_channels_zero": [], "unreadable": 0}
    for file in sorted(folder.rglob("*.npz")):
        try:
            with np.load(file, allow_pickle=False) as stored:
                if "pixels" not in stored.files:
                    continue
                pixels = stored["pixels"]
                metadata = json.loads(str(stored["metadata"])) if "metadata" in stored.files else {}
        except Exception:
            result["unreadable"] += 1
            continue
        if pixels.ndim != 3 or pixels.shape[-1] < 3:
            continue
        result["pictures"] += 1
        # 99%: faulty VRAM can sprinkle stray values into an empty channel; real
        # photos peak near 29% exact zeros (Steve's cache, November 1).
        zero = [bool(np.mean(pixels[..., c] == 0) >= 0.99) for c in range(3)]
        name = f"{Path(str(metadata.get('path', file.name))).name} @{metadata.get('edge', '?')}"
        if all(zero):
            result["all_channels_zero"].append(name)
        elif any(zero):
            result["one_channel_zero"].append(name)
    return result


if __name__ == "__main__":
    print(json.dumps(audit(Path(sys.argv[1]))))
