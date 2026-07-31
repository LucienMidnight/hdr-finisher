from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from threading import RLock
from uuid import uuid4

import numpy as np

from .capabilities import probe_capabilities
from .loader import load_image
from .metadata import extract_metadata
from .models import AdjustmentState, HDRAnalysis, PreviewKind, PreviewSettings, SessionPayload, SourceImageDescriptor, SourceInterpretationOverride


@dataclass
class LoadedSession:
    session_id: str
    source_path: Path
    image: np.ndarray
    sdr_reference_image: np.ndarray | None
    source: SourceImageDescriptor
    analysis: HDRAnalysis
    metadata: dict
    owns_source_path: bool = False
    adjustments: AdjustmentState = field(default_factory=AdjustmentState)
    preview: PreviewSettings = field(default_factory=PreviewSettings)
    preview_tokens: dict[PreviewKind, int] = field(default_factory=lambda: {PreviewKind.HDR: 0, PreviewKind.SDR: 0})

    def to_payload(self) -> SessionPayload:
        return SessionPayload(
            session_id=self.session_id,
            source=self.source,
            metadata=extract_metadata(self.source_path, self.metadata),
            analysis=self.analysis,
            adjustments=self.adjustments,
            preview=self.preview,
            capabilities=probe_capabilities(),
        )


class SessionStore:
    def __init__(self) -> None:
        self._lock = RLock()
        self._current: LoadedSession | None = None

    def create_session(
        self,
        source_path: Path,
        original_filename: str | None = None,
        owns_source_path: bool = False,
    ) -> SessionPayload:
        try:
            image, source, metadata, analysis, sdr_reference_image = load_image(source_path)
            if original_filename:
                source.filename = Path(str(original_filename).replace("\\", "/")).name
            session = LoadedSession(
                session_id=uuid4().hex,
                source_path=source_path,
                image=image,
                sdr_reference_image=sdr_reference_image,
                source=source,
                analysis=analysis,
                metadata=metadata,
                owns_source_path=owns_source_path,
            )
            payload = session.to_payload()
        except Exception:
            if owns_source_path:
                _remove_owned_source(source_path)
            raise
        with self._lock:
            previous = self._current
            self._current = session
        if previous is not None and previous.owns_source_path:
            _remove_owned_source(previous.source_path)
        return payload

    def current(self) -> LoadedSession | None:
        with self._lock:
            return self._current

    def clear(self) -> None:
        with self._lock:
            previous = self._current
            self._current = None
        if previous is not None and previous.owns_source_path:
            _remove_owned_source(previous.source_path)

    def get(self, session_id: str) -> LoadedSession:
        session = self.current()
        if session is None or session.session_id != session_id:
            raise KeyError(f"Session '{session_id}' was not found.")
        return session

    def update_adjustments(self, session_id: str, adjustments: AdjustmentState) -> LoadedSession:
        with self._lock:
            session = self.get(session_id)
            session.adjustments = adjustments
            return session

    def update_source_interpretation(self, session_id: str, override: SourceInterpretationOverride) -> LoadedSession:
        with self._lock:
            session = self.get(session_id)
            original_filename = session.source.filename
            image, source, metadata, analysis, sdr_reference_image = load_image(
                session.source_path,
                overrides={
                    "color_space": override.color_space,
                    "transfer_function": override.transfer_function,
                },
            )
            source.filename = original_filename
            session.image = image
            session.sdr_reference_image = sdr_reference_image
            session.source = source
            session.metadata = metadata
            session.analysis = analysis
            session.preview_tokens = {PreviewKind.HDR: 0, PreviewKind.SDR: 0}
            return session

    def next_preview_token(self, session_id: str, kind: PreviewKind) -> int:
        with self._lock:
            session = self.get(session_id)
            session.preview_tokens[kind] += 1
            return session.preview_tokens[kind]

    def is_preview_current(self, session_id: str, kind: PreviewKind, token: int) -> bool:
        with self._lock:
            session = self.get(session_id)
            return session.preview_tokens[kind] == token


def _remove_owned_source(path: Path) -> None:
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass
