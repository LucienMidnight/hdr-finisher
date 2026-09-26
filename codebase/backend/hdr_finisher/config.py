from __future__ import annotations

import os
import sys
from pathlib import Path


APP_NAME = "HDR Finisher"
APP_VERSION = "0.8.13"
PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _resource_root() -> Path:
    if hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS).resolve()
    return PROJECT_ROOT


def _is_bundled() -> bool:
    """Whether this is running from a packaged build rather than the repository.

    PyInstaller sets both of these; a development run sets neither. Asking
    directly matters because the alternative -- testing whether some directory
    happens to sit beside the backend -- is a proxy that silently stopped being
    true. See MINOR-11: `codebase/docs` was added for two audit notes, which
    made the packaged branch win in development and took the in-app Help with
    it for a fortnight.
    """
    return hasattr(sys, "_MEIPASS") or bool(getattr(sys, "frozen", False))


def _runtime_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return PROJECT_ROOT


RESOURCE_ROOT = _resource_root()
RUNTIME_ROOT = _runtime_root()
FRONTEND_DIR = RESOURCE_ROOT / "frontend"
# Packaged builds carry their own `docs` beside the backend; a development run
# serves the repository's, which is the parent of `codebase/`. Keyed on whether
# this is bundled, not on whether a directory exists.
DOCS_DIR = RESOURCE_ROOT / "docs" if _is_bundled() else PROJECT_ROOT.parent / "docs"
BIN_DIR = RESOURCE_ROOT / "bin"
SAMPLES_DIR = RESOURCE_ROOT / "samples"
APP_DATA_DIR = Path(
    os.environ.get("HDR_FINISHER_APP_DATA_DIR")
    or (Path(os.environ["LOCALAPPDATA"]) / "HDR Finisher" if "LOCALAPPDATA" in os.environ else RUNTIME_ROOT)
)
EXPORTS_DIR = APP_DATA_DIR / "exports" if os.environ.get("HDR_FINISHER_DESKTOP_SECRET") else RUNTIME_ROOT / "exports"
MAX_PREVIEW_LONG_EDGE = 1920
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = int(os.environ.get("HDR_FINISHER_PORT", "8000"))
PREVIEW_IMAGE_FORMAT = "PNG"
