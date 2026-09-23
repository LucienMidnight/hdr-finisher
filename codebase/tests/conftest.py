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


def make_png_bytes(color: tuple[int, int, int] = (120, 90, 60)) -> bytes:
    import io

    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (16, 12), color=color).save(buffer, format="PNG")
    return buffer.getvalue()


def fixture_path(name: str) -> Path:
    return FIXTURES / name
