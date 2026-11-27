"""Exercise pytest shutdown itself, including Windows' open-file restriction."""
import pytest
import os
from pathlib import Path
import subprocess
import sys


@pytest.mark.slow
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
        "    import os\n"
        "    from conftest import _parallel_worker_count\n"
        "    from hdr_finisher.config import EXPORTS_DIR\n"
        "    gib = 1024**3\n"
        "    assert _parallel_worker_count(12, 64*gib, 48*gib) == 4\n"
        "    assert _parallel_worker_count(6, 8*gib, 8*gib) == 2\n"
        "    assert _parallel_worker_count(6, 8*gib, 3*gib) == 1\n"
        "    assert _parallel_worker_count(6, None, None) == 1\n"
        "    assert _parallel_worker_count(1, 64*gib, 48*gib) == 1\n"
        "    assert EXPORTS_DIR.parent == APP_DATA_DIR.parent\n"
        "    for key in ('HDR_FINISHER_PROOF_ROOT',):\n"
        "        assert Path(os.environ[key]).parent == APP_DATA_DIR.parent\n"
        "    from hdr_finisher import gpu_delivery\n"
        "    spool = Path(gpu_delivery.tempfile.mkdtemp(prefix='hdr-gpu-delivery-'))\n"
        "    assert spool.parent == APP_DATA_DIR.parent / 'gpu-spools'\n"
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
