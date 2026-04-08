from __future__ import annotations

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
FIXTURES = ROOT / "tests" / "fixtures"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))


def make_png_bytes(color: tuple[int, int, int] = (120, 90, 60)) -> bytes:
    import io

    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (16, 12), color=color).save(buffer, format="PNG")
    return buffer.getvalue()


def fixture_path(name: str) -> Path:
    return FIXTURES / name
