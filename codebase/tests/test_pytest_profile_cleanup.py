"""Exercise pytest shutdown itself, including Windows' open-file restriction."""
import os
from pathlib import Path
import subprocess
import sys


def test_process_cached_cache_ledger_does_not_break_profile_cleanup(tmp_path):
    codebase = Path(__file__).resolve().parents[1]
    tests = tmp_path / "tests"
    tests.mkdir()
    (tests / "conftest.py").write_bytes((codebase / "tests/conftest.py").read_bytes())
    marker = tmp_path / "profile.txt"
    (tests / "test_ledger.py").write_text(
        "from pathlib import Path\n"
        "from hdr_finisher.config import APP_DATA_DIR\n"
        "from hdr_finisher.library_cache import LibraryCache\n"
        "def test_open_ledger():\n"
        "    LibraryCache(APP_DATA_DIR).usage()\n"
        f"    Path({str(marker)!r}).write_text(str(APP_DATA_DIR.parent))\n",
        encoding="utf-8",
    )
    result = subprocess.run(
        [sys.executable, "-m", "pytest", "tests", "-q"], cwd=tmp_path,
        env={**os.environ, "PYTHONPATH": str(codebase / "backend")},
        capture_output=True, text=True, timeout=45,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert marker.exists()
    assert not Path(marker.read_text()).exists()
