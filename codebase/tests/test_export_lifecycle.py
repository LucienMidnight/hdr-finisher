from __future__ import annotations

import inspect
from pathlib import Path
from types import SimpleNamespace

import pytest

from hdr_finisher import exporters
from hdr_finisher.models import ExportSettings


def _settings(path: Path) -> ExportSettings:
    return ExportSettings(format="sdr_png", output_path=str(path))


def test_all_six_backends_delegate_to_the_shared_export_executor() -> None:
    backend_types = (
        exporters.SDRPNGExportBackend,
        exporters.SDRJPEGExportBackend,
        exporters.SDRJPEGXLExportBackend,
        exporters.AVIFGainMapExportBackend,
        exporters.JPEGUltraHDRExportBackend,
        exporters.JPEGXLHDRExportBackend,
    )

    for backend_type in backend_types:
        source = inspect.getsource(backend_type.export)
        assert source.count("_execute_export(") == 1, backend_type.__name__
        assert "os.replace(" not in source
        assert "_remove_incomplete_output(" not in source


def test_shared_export_executor_normalizes_expected_preparation_failures(tmp_path: Path) -> None:
    backend = SimpleNamespace(name="fixture")

    def fail_preparation():
        raise ValueError("invalid export recipe")

    result = exporters._execute_export(
        backend,
        SimpleNamespace(session_id="session"),
        _settings(tmp_path / "output.png"),
        suffix=".png",
        prepare=fail_preparation,
        success_message=lambda *_args: "unused",
        failure_prefix="Fixture export failed",
    )

    assert result.accepted is False
    assert result.message == "Fixture export failed: invalid export recipe"
    assert not (tmp_path / "output.png").exists()


def test_shared_export_executor_keeps_programming_errors_visible(tmp_path: Path) -> None:
    with pytest.raises(RuntimeError, match="programming defect"):
        exporters._execute_export(
            SimpleNamespace(name="fixture"),
            SimpleNamespace(session_id="session"),
            _settings(tmp_path / "output.png"),
            suffix=".png",
            prepare=lambda: (_ for _ in ()).throw(RuntimeError("programming defect")),
            success_message=lambda *_args: "unused",
            failure_prefix="Fixture export failed",
        )


def test_shared_export_executor_removes_failed_staging_file(tmp_path: Path) -> None:
    staged_paths: list[Path] = []

    def prepare() -> exporters._PreparedExport:
        def fail_write(path: Path) -> None:
            staged_paths.append(path)
            path.write_bytes(b"partial")
            raise OSError("disk stopped")

        return exporters._PreparedExport(".tmp.png", fail_write, lambda _path: None)

    result = exporters._execute_export(
        SimpleNamespace(name="fixture"),
        SimpleNamespace(session_id="session"),
        _settings(tmp_path / "output.png"),
        suffix=".png",
        prepare=prepare,
        success_message=lambda *_args: "unused",
        failure_prefix="Fixture export failed",
    )

    assert result.accepted is False
    assert len(staged_paths) == 1
    assert not staged_paths[0].exists()
    assert not (tmp_path / "output.png").exists()
