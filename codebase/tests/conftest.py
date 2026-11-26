from __future__ import annotations

import os
from pathlib import Path
import sys

import pytest
import tempfile

_TEST_STATE = tempfile.TemporaryDirectory(prefix="hdr-finisher-test-pytest-")
_TEST_ENV = {key: os.environ.get(key) for key in (
    "HDR_FINISHER_APP_DATA_DIR", "LOCALAPPDATA", "HDR_FINISHER_SOURCE_CACHE_DIR",
    "HDR_FINISHER_PROOF_ROOT",
)}
os.environ["HDR_FINISHER_APP_DATA_DIR"] = str(Path(_TEST_STATE.name) / "profile")
os.environ["LOCALAPPDATA"] = str(Path(_TEST_STATE.name) / "local")
os.environ["HDR_FINISHER_SOURCE_CACHE_DIR"] = str(Path(_TEST_STATE.name) / "source-mips")
os.environ["HDR_FINISHER_PROOF_ROOT"] = str(Path(_TEST_STATE.name) / "proof")
Path(os.environ["HDR_FINISHER_PROOF_ROOT"]).mkdir()

def pytest_unconfigure(config):
    # SQLite ledgers are process-cached. Close only this disposable profile's
    # handles before Windows tries to remove the files they keep open.
    library_cache = sys.modules.get("hdr_finisher.library_cache")
    if library_cache is not None:
        with library_cache._LOCK:
            for root, db in list(library_cache._LEDGERS.items()):
                if Path(root).resolve().is_relative_to(Path(_TEST_STATE.name).resolve()):
                    db.close()
                    del library_cache._LEDGERS[root]
    for key, value in _TEST_ENV.items():
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = value
    _TEST_STATE.cleanup()

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
FIXTURES = ROOT / "tests" / "fixtures"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

# Standalone exports otherwise default to a shared codebase/exports folder.
# Set this before collection imports exporters and captures the constant.
from hdr_finisher import config as _app_config
_app_config.EXPORTS_DIR = Path(_TEST_STATE.name) / "exports"

# GPU broker tests simulate delivery on the CPU. Its stale-spool sweeper must
# never inspect the live app's or another worker's system-temp spools.
from functools import partial
from types import SimpleNamespace
from hdr_finisher import gpu_delivery as _gpu_delivery
_gpu_scratch = Path(_TEST_STATE.name) / "gpu-spools"
_gpu_scratch.mkdir()
_gpu_delivery.tempfile = SimpleNamespace(mkdtemp=partial(tempfile.mkdtemp, dir=_gpu_scratch))



def _parallel_worker_count(cpu_count, total_bytes, available_bytes):
    """Reserve 2 GiB for the OS/app and allow 3 GiB per CPU test process.

    Low-memory machines stay at one worker; unknown memory is conservative.
    The 8 GB Mac is additionally capped at two workers, the PC at four.
    """
    gib = 1024**3
    if not total_bytes or not available_bytes:
        return 1
    machine_cap = 2 if total_bytes <= 8 * gib else 4
    return max(1, min(cpu_count or 1, machine_cap, (available_bytes - 2 * gib) // (3 * gib)))


@pytest.hookimpl(optionalhook=True)
def pytest_xdist_auto_num_workers(config):
    # This hook only affects -n auto/-n logical. Explicit -n N is an override.
    from hdr_finisher.resource_preflight import detect_memory_resources
    resources = detect_memory_resources()
    return _parallel_worker_count(os.cpu_count(), resources.total_ram_bytes, resources.available_ram_bytes)


@pytest.fixture(scope="session", autouse=True)
def _isolate_source_mip_cache(tmp_path_factory) -> None:
    """Keep the persistent source cache out of the real application data.

    Sessions resolve the store lazily, so setting the root before the first
    session is created is enough. Tests that exercise the store directly
    construct it with their own temporary root.
    """
    os.environ.setdefault(
        "HDR_FINISHER_SOURCE_CACHE_DIR",
        str(tmp_path_factory.mktemp("source-mips")),
    )


@pytest.fixture(autouse=True)
def _photos_written_by_tests_are_settled(monkeypatch):
    """Tests write small stand-in photos and use them at once. The file gate's
    "still being copied" wait and 1 KB minimum are tested with their real
    values in test_file_gate.py."""
    from hdr_finisher import file_gate
    monkeypatch.setattr(file_gate, "SETTLE_SECONDS", 0.0)
    monkeypatch.setattr(file_gate, "MIN_PHOTO_BYTES", 0)


def make_png_bytes(color: tuple[int, int, int] = (120, 90, 60)) -> bytes:
    import io

    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (16, 12), color=color).save(buffer, format="PNG")
    return buffer.getvalue()


def fixture_path(name: str) -> Path:
    return FIXTURES / name


@pytest.fixture
def native_preflight_memory():
    """Opt memory-reader tests into the actual platform reader."""


@pytest.fixture(autouse=True)
def ample_preflight_memory(monkeypatch, request):
    """Pixel/route fixtures exercise their intended path regardless of host load.

    Resource-safety tests use explicit low/unknown snapshots or the real reader
    instead; no production allowance or expected output is changed here.
    """
    if "native_preflight_memory" in request.fixturenames:
        return
    from hdr_finisher import library_grants, linear_dng, main, resource_preflight
    resources = resource_preflight.ResourceSnapshot(16 * 1024**3, 8 * 1024**3, "test")
    for module in (resource_preflight, linear_dng, main, library_grants):
        monkeypatch.setattr(module, "detect_memory_resources", lambda: resources)
