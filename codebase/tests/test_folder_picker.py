from __future__ import annotations

from pathlib import Path
import subprocess

import pytest

import hdr_finisher.folder_picker as folder_picker


def test_windows_folder_picker_passes_initial_path_through_environment(monkeypatch, tmp_path: Path) -> None:
    initial = tmp_path / "Folder With Spaces"
    initial.mkdir()
    observed: dict[str, object] = {}

    def fake_run(command, **kwargs):
        observed["command"] = command
        observed["env"] = kwargs["env"]
        return subprocess.CompletedProcess(command, 0, f"OK\n{initial}", "")

    monkeypatch.setattr(folder_picker.sys, "platform", "win32")
    monkeypatch.setattr(folder_picker.subprocess, "run", fake_run)

    assert folder_picker.pick_directory(str(initial)) == str(initial)
    command = observed["command"]
    assert command[:5] == ["powershell.exe", "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass"]
    assert str(initial) not in command[-1]
    assert "$owner.Show()" in command[-1]
    assert "$owner.Activate()" in command[-1]
    assert "$dialog.ShowDialog($owner)" in command[-1]
    assert observed["env"]["HDR_FINISHER_INITIAL_DIRECTORY"] == str(initial)


def test_windows_folder_picker_distinguishes_cancellation(monkeypatch) -> None:
    monkeypatch.setattr(
        folder_picker.subprocess,
        "run",
        lambda command, **kwargs: subprocess.CompletedProcess(command, 0, "CANCEL", ""),
    )
    assert folder_picker._pick_directory_windows(None) is None


def test_windows_folder_picker_reports_launch_failure(monkeypatch) -> None:
    def fail(*args, **kwargs):
        raise FileNotFoundError("powershell missing")

    monkeypatch.setattr(folder_picker.subprocess, "run", fail)
    with pytest.raises(RuntimeError, match="could not be launched"):
        folder_picker._pick_directory_windows(None)


def test_windows_folder_picker_reports_dialog_failure(monkeypatch) -> None:
    monkeypatch.setattr(
        folder_picker.subprocess,
        "run",
        lambda command, **kwargs: subprocess.CompletedProcess(command, 1, "", "init.tcl is missing"),
    )
    with pytest.raises(RuntimeError, match="init.tcl is missing"):
        folder_picker._pick_directory_windows(None)


def test_non_windows_keeps_tk_fallback(monkeypatch, tmp_path: Path) -> None:
    expected = str(tmp_path)
    monkeypatch.setattr(folder_picker.sys, "platform", "linux")
    monkeypatch.setattr(folder_picker, "_pick_directory_tk", lambda initial: expected)
    assert folder_picker.pick_directory(expected) == expected
