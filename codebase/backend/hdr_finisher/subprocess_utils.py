from __future__ import annotations

import os
import subprocess
from typing import Any


def hidden_window_options() -> dict[str, Any]:
    """Return Popen options that prevent command-line tools flashing a console."""
    if os.name != "nt":
        return {}

    startupinfo = subprocess.STARTUPINFO()
    startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    startupinfo.wShowWindow = subprocess.SW_HIDE
    return {
        "creationflags": getattr(subprocess, "CREATE_NO_WINDOW", 0),
        "startupinfo": startupinfo,
    }
