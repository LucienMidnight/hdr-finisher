from __future__ import annotations

from dataclasses import dataclass
import hmac
from pathlib import Path
from threading import RLock
import time
from uuid import uuid4


SOURCE_EXTENSIONS = {
    ".exr", ".tif", ".tiff", ".hdr", ".pfm", ".heic", ".heif",
    ".avif", ".jxl", ".png", ".jpg", ".jpeg", ".dng", ".arw", ".cr2",
    ".cr3", ".nef", ".nrw", ".raf", ".rw2", ".orf", ".ori", ".pef", ".srw",
}
EXPORT_EXTENSIONS = {".avif", ".jpg", ".jpeg", ".png", ".jxl"}


@dataclass(frozen=True)
class PathGrant:
    path: Path
    intent: str
    expires_at: float


class DesktopPathGrants:
    """Short-lived, one-use grants for paths selected by the desktop shell."""

    def __init__(self, ttl_seconds: float = 600.0) -> None:
        self._ttl_seconds = ttl_seconds
        self._lock = RLock()
        self._grants: dict[str, PathGrant] = {}

    def issue(self, path: str, intent: str) -> tuple[str, Path]:
        resolved = Path(path).expanduser().resolve(strict=False)
        self._validate(resolved, intent)
        token = uuid4().hex
        with self._lock:
            self._purge_expired()
            self._grants[token] = PathGrant(resolved, intent, time.monotonic() + self._ttl_seconds)
        return token, resolved

    def consume(self, token: str, intent: str) -> Path:
        return self.resolve(token, intent, consume=True)

    def resolve(self, token: str, intent: str, *, consume: bool = False) -> Path:
        with self._lock:
            self._purge_expired()
            grant = self._grants.get(token)
            if consume and grant is not None and grant.intent == intent:
                self._grants.pop(token, None)
        if grant is None or grant.intent != intent:
            raise ValueError("The desktop file selection expired or is not valid for this operation.")
        return grant.path

    def _purge_expired(self) -> None:
        now = time.monotonic()
        self._grants = {token: grant for token, grant in self._grants.items() if grant.expires_at > now}

    @staticmethod
    def _validate(path: Path, intent: str) -> None:
        if intent in {"source-open", "source-relink"}:
            if not path.is_file() or path.suffix.lower() not in SOURCE_EXTENSIONS:
                raise ValueError("Select a supported HDR Finisher source file.")
            return
        if intent == "project-open":
            if not path.is_file() or path.suffix.lower() != ".hdrfinisher":
                raise ValueError("Select an existing .hdrfinisher project.")
            return
        if intent == "project-save":
            destination = path if path.suffix.lower() == ".hdrfinisher" else path.with_suffix(".hdrfinisher")
            if not destination.parent.is_dir():
                raise ValueError("The selected project folder is not available.")
            return
        if intent == "export-file":
            if path.suffix.lower() not in EXPORT_EXTENSIONS or not path.parent.is_dir():
                raise ValueError("Select a supported export filename in an available folder.")
            return
        raise ValueError("Unsupported desktop path intent.")


def secret_matches(actual: str | None, expected: str | None) -> bool:
    return bool(actual and expected and hmac.compare_digest(actual, expected))
