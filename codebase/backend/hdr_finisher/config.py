from __future__ import annotations

from pathlib import Path


APP_NAME = "HDR Finisher"
APP_VERSION = "0.1.10"
PROJECT_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_DIR = PROJECT_ROOT / "frontend"
BIN_DIR = PROJECT_ROOT / "bin"
EXPORTS_DIR = PROJECT_ROOT / "exports"
SAMPLES_DIR = PROJECT_ROOT / "samples"
MAX_PREVIEW_LONG_EDGE = 1920
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8000
PREVIEW_IMAGE_FORMAT = "PNG"
