from __future__ import annotations

import os
import subprocess

from hdr_finisher.subprocess_utils import hidden_window_options


def test_external_tools_do_not_create_console_windows_on_windows() -> None:
    options = hidden_window_options()

    if os.name != "nt":
        assert options == {}
        return

    assert options["creationflags"] & subprocess.CREATE_NO_WINDOW
    assert options["startupinfo"].dwFlags & subprocess.STARTF_USESHOWWINDOW
    assert options["startupinfo"].wShowWindow == subprocess.SW_HIDE
