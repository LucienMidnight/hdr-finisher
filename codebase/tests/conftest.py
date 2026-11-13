from __future__ import annotations

import os
from pathlib import Path
import sys

import pytest

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
FIXTURES = ROOT / "tests" / "fixtures"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

# Tests assume the standard 4 GB app memory budget. Machines under 16 GB RAM
# (such as the macOS CI runner) otherwise get the smaller 2.5 GB default.
os.environ.setdefault("HDR_FINISHER_MEMORY_BYTES", "4000000000")


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
def ample_preflight_memory(monkeypatch):
    """Pixel/route fixtures exercise their intended path regardless of host load.

    Resource-safety tests use explicit low/unknown snapshots or the real reader
    instead; no production allowance or expected output is changed here.
    """
    from hdr_finisher import linear_dng, resource_preflight
    resources = resource_preflight.ResourceSnapshot(16 * 1024**3, 8 * 1024**3, "test")
    monkeypatch.setattr(resource_preflight, "detect_memory_resources", lambda: resources)
    monkeypatch.setattr(linear_dng, "detect_memory_resources", lambda: resources)
