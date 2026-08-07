from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys


def pick_directory(initial_directory: str | None = None) -> str | None:
    initial_path = _usable_initial_directory(initial_directory)
    if sys.platform == "win32":
        return _pick_directory_windows(initial_path)
    return _pick_directory_tk(initial_path)


def _pick_directory_windows(initial_path: Path | None) -> str | None:
    script = r"""
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Choose Export Folder'
$dialog.ShowNewFolderButton = $true
if ($env:HDR_FINISHER_INITIAL_DIRECTORY) {
    $dialog.SelectedPath = $env:HDR_FINISHER_INITIAL_DIRECTORY
}
$owner = New-Object System.Windows.Forms.Form
$owner.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedToolWindow
$owner.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$owner.Size = New-Object System.Drawing.Size(1, 1)
$owner.Opacity = 0.01
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
try {
    # A form that has never been shown is not a usable native owner. In that
    # state FolderBrowserDialog can open behind the browser (or on no visible
    # z-order at all) while the HTTP request waits forever. Show the tiny,
    # effectively transparent owner first so the picker is modal, foreground,
    # and attached to the interactive desktop.
    $owner.Show()
    $owner.Activate()
    $owner.BringToFront()
    $result = $dialog.ShowDialog($owner)
    if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
        [Console]::Out.Write('OK' + [Environment]::NewLine + $dialog.SelectedPath)
    } else {
        [Console]::Out.Write('CANCEL')
    }
} finally {
    $owner.Hide()
    $dialog.Dispose()
    $owner.Dispose()
}
"""
    environment = os.environ.copy()
    environment["HDR_FINISHER_INITIAL_DIRECTORY"] = str(initial_path) if initial_path else ""
    try:
        result = subprocess.run(
            ["powershell.exe", "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script],
            capture_output=True,
            text=True,
            check=False,
            env=environment,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except OSError as exc:
        raise RuntimeError("Native Windows folder picker could not be launched.") from exc
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip() or "unknown Windows Forms error"
        raise RuntimeError(f"Native Windows folder picker failed: {detail}")
    output = result.stdout.strip()
    if output == "CANCEL" or not output:
        return None
    marker, separator, directory = output.partition("\n")
    if marker.strip() != "OK" or not separator or not directory.strip():
        raise RuntimeError("Native Windows folder picker returned an invalid response.")
    return directory.strip()


def _pick_directory_tk(initial_path: Path | None) -> str | None:
    try:
        import tkinter as tk
        from tkinter import filedialog
    except ImportError as exc:
        raise RuntimeError("Native folder picker is unavailable because tkinter is not installed.") from exc

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
