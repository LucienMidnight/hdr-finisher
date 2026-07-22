from __future__ import annotations

import os
import sys
from pathlib import Path


APP_NAME = "HDR Finisher"
APP_VERSION = "0.1.16"
PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _resource_root() -> Path:
    if hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS).resolve()
    return PROJECT_ROOT


def _runtime_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return PROJECT_ROOT


RESOURCE_ROOT = _resource_root()
RUNTIME_ROOT = _runtime_root()
FRONTEND_DIR = RESOURCE_ROOT / "frontend"
BIN_DIR = RESOURCE_ROOT / "bin"
EXPORTS_DIR = RUNTIME_ROOT / "exports"
SAMPLES_DIR = RESOURCE_ROOT / "samples"
MAX_PREVIEW_LONG_EDGE = 1920
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = int(os.environ.get("HDR_FINISHER_PORT", "8000"))
PREVIEW_IMAGE_FORMAT = "PNG"
