from __future__ import annotations

from dataclasses import dataclass, field
import hashlib
import json
from pathlib import Path
from threading import RLock
from typing import Any, Callable
from uuid import uuid4

import numpy as np

from .capabilities import probe_capabilities
from .loader import load_image
from .metadata import extract_metadata
from .models import (
    AdjustmentState,
    EditCommand,
    EditDocument,
    EditStateResponse,
    HDRAnalysis,
    LocalAdjustment,
    PreviewKind,
    PreviewSettings,
    RawImportSettings,
    SessionPayload,
    SourceImageDescriptor,
    SourceInterpretationOverride,
    SourceReference,
)
from .render_cache import SessionRenderCache


class RevisionConflictError(RuntimeError):
    def __init__(self, expected: int, actual: int) -> None:
        super().__init__(f"Edit revision mismatch: expected {expected}, current revision is {actual}.")
        self.expected = expected
        self.actual = actual


class EditCommandError(ValueError):
    pass


@dataclass
class HistoryEntry:
    forward: EditCommand
    inverse: EditCommand
    byte_size: int


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
    durable_source_path: Path | None = None
    adjustments: AdjustmentState = field(default_factory=AdjustmentState)
    local_adjustments: list[LocalAdjustment] = field(default_factory=list)
    interpretation_override: SourceInterpretationOverride = field(default_factory=SourceInterpretationOverride)
    raw_import_settings: RawImportSettings = field(default_factory=RawImportSettings)
    edit_revision: int = 0
    dirty: bool = False
    undo_history: list[HistoryEntry] = field(default_factory=list, repr=False)
    redo_history: list[HistoryEntry] = field(default_factory=list, repr=False)
    history_bytes: int = 0
    source_fingerprint_sha256: str = field(init=False)
    source_byte_size: int = field(init=False)
    preview: PreviewSettings = field(default_factory=PreviewSettings)
    preview_tokens: dict[PreviewKind, int] = field(default_factory=lambda: {PreviewKind.HDR: 0, PreviewKind.SDR: 0})
    scope_tokens: dict[PreviewKind, int] = field(default_factory=lambda: {PreviewKind.HDR: 0, PreviewKind.SDR: 0})
    render_cache: SessionRenderCache = field(init=False, repr=False)

    def __post_init__(self) -> None:
        self.source_fingerprint_sha256 = _sha256_file(self.source_path)
        self.source_byte_size = self.source_path.stat().st_size
        self.render_cache = SessionRenderCache(self.image, self.sdr_reference_image)
        self._sync_highlight_source_peaks()

    def _sync_highlight_source_peaks(self) -> None:
        hdr = self.adjustments.hdr
        measured = self.analysis.peak_luma_linear
        if measured is None:
            measured = self.analysis.peak_linear
        source_peak_nits = max(1.0, float(measured) * 100.0 / 0.18)
        hdr.highlight_compression_source_peak_nits = source_peak_nits

    def source_reference(self) -> SourceReference:
        durable = self.durable_source_path
        if durable is None and not self.owns_source_path:
            durable = self.source_path
        return SourceReference(
            filename=self.source.filename,
            fingerprint_sha256=self.source_fingerprint_sha256,
            durable_path=str(durable.resolve()) if durable is not None else None,
            byte_size=self.source_byte_size,
            raw_import_settings=self.raw_import_settings,
        )

    def edit_document(self) -> EditDocument:
        return EditDocument(
            source=self.source_reference(),
            interpretation_override=self.interpretation_override,
            global_adjustments=self.adjustments,
            local_adjustments=self.local_adjustments,
        )

    def edit_state(self) -> EditStateResponse:
        return EditStateResponse(
            revision=self.edit_revision,
            document=self.edit_document(),
            dirty=self.dirty,
            can_undo=bool(self.undo_history),
            can_redo=bool(self.redo_history),
        )

    def to_payload(self) -> SessionPayload:
        return SessionPayload(
            session_id=self.session_id,
            source=self.source,
            metadata=extract_metadata(self.source_path, self.metadata),
            analysis=self.analysis,
            adjustments=self.adjustments,
            edit_document=self.edit_document(),
            edit_revision=self.edit_revision,
            dirty=self.dirty,
            can_undo=bool(self.undo_history),
            can_redo=bool(self.redo_history),
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
        raw_import_settings: RawImportSettings | None = None,
        progress: Callable[[str, str], None] | None = None,
    ) -> SessionPayload:
        session = self.prepare_session(
            source_path,
            original_filename=original_filename,
            owns_source_path=owns_source_path,
            raw_import_settings=raw_import_settings,
            progress=progress,
        )
        return self.activate_session(session)

    def prepare_session(
        self,
        source_path: Path,
        original_filename: str | None = None,
        owns_source_path: bool = False,
        raw_import_settings: RawImportSettings | None = None,
        progress: Callable[[str, str], None] | None = None,
    ) -> LoadedSession:
        try:
            resolved_raw_settings = raw_import_settings or RawImportSettings()
            image, source, metadata, analysis, sdr_reference_image = load_image(
                source_path, raw_import_settings=resolved_raw_settings, progress=progress
            )
            lens_result = metadata.get("lens_correction") or {}
            if (
                source_path.suffix.lower() == ".dng"
                and metadata.get("raw_mosaiced") is False
                and resolved_raw_settings.lens.mode == "auto"
                and lens_result.get("mode") == "off"
            ):
                resolved_raw_settings = resolved_raw_settings.model_copy(
                    update={"lens": resolved_raw_settings.lens.model_copy(update={"mode": "off"})}
                )
            elif lens_result.get("requested_mode") == "manual" and lens_result.get("mode") == "off":
                resolved_raw_settings = resolved_raw_settings.model_copy(
                    update={"lens": resolved_raw_settings.lens.model_copy(update={"mode": "off"})}
                )
            elif lens_result.get("applied"):
                profile = lens_result.get("profile") or {}
                resolved_raw_settings = resolved_raw_settings.model_copy(
                    update={
                        "lens": resolved_raw_settings.lens.model_copy(
                            update={
                                "profile_id": profile.get("id") or resolved_raw_settings.lens.profile_id,
                                "database_version": lens_result.get("database_version"),
                            }
                        )
                    }
                )
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
                raw_import_settings=resolved_raw_settings,
            )
        except Exception:
            if owns_source_path:
                _remove_owned_source(source_path)
            raise
        return session

    def activate_session(self, session: LoadedSession) -> SessionPayload:
        payload = session.to_payload()
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

    def edit_state(self, session_id: str) -> EditStateResponse:
        with self._lock:
            return self.get(session_id).edit_state()

    def replace_edit_document(self, session_id: str, document: EditDocument, expected_revision: int) -> EditStateResponse:
        command = EditCommand(
            expected_revision=expected_revision,
            command_type="replace_document",
            payload={"document": document.model_dump(mode="json")},
        )
        return self.apply_edit_commands(session_id, [command])

    def apply_edit_commands(self, session_id: str, commands: list[EditCommand]) -> EditStateResponse:
        with self._lock:
            session = self.get(session_id)
            original = (
                session.adjustments.model_copy(deep=True),
                [item.model_copy(deep=True) for item in session.local_adjustments],
                session.interpretation_override.model_copy(deep=True),
                session.edit_revision,
                session.dirty,
                list(session.undo_history),
                list(session.redo_history),
                session.history_bytes,
            )
            try:
                for command in commands:
                    if command.expected_revision != session.edit_revision:
                        raise RevisionConflictError(command.expected_revision, session.edit_revision)
                    self._apply_edit_command(session, command)
            except Exception:
                (
                    session.adjustments,
                    session.local_adjustments,
                    session.interpretation_override,
                    session.edit_revision,
                    session.dirty,
                    session.undo_history,
                    session.redo_history,
                    session.history_bytes,
                ) = original
                session.render_cache.clear_adjusted()
                raise
            return session.edit_state()

    def _apply_edit_command(self, session: LoadedSession, command: EditCommand) -> None:
        if command.command_type == "undo":
            self._undo(session)
            return
        if command.command_type == "redo":
            self._redo(session)
            return

        inverse = self._execute_command(session, command)
        entry_size = len(
            json.dumps(
                {"forward": command.model_dump(mode="json"), "inverse": inverse.model_dump(mode="json")},
                separators=(",", ":"),
            ).encode("utf-8")
        )
        entry = HistoryEntry(forward=command, inverse=inverse, byte_size=entry_size)
        session.undo_history.append(entry)
        session.history_bytes += entry_size
        session.redo_history.clear()
        while len(session.undo_history) > 100 or session.history_bytes > 64 * 1024 * 1024:
            removed = session.undo_history.pop(0)
            session.history_bytes -= removed.byte_size
        session.edit_revision += 1
        session.dirty = True

    def _execute_command(self, session: LoadedSession, command: EditCommand) -> EditCommand:
        current_revision = session.edit_revision
        command_type = command.command_type
        payload = command.payload

        if command_type == "replace_document":
            previous = session.edit_document()
            document = EditDocument.model_validate(payload.get("document"))
            session.adjustments = document.global_adjustments
            session.local_adjustments = document.local_adjustments
            session.interpretation_override = document.interpretation_override
            session.render_cache.clear_adjusted()
            return EditCommand(
                expected_revision=current_revision,
                command_type="replace_document",
                payload={"document": previous.model_dump(mode="json")},
            )

        if command_type == "set_global_adjustments":
            previous = session.adjustments
            session.adjustments = AdjustmentState.model_validate(payload.get("adjustments"))
            session.render_cache.clear_adjusted()
            return EditCommand(
                expected_revision=current_revision,
                command_type="set_global_adjustments",
                payload={"adjustments": previous.model_dump(mode="json")},
            )

        if command_type == "create_local":
            local = LocalAdjustment.model_validate(payload.get("local"))
            if any(item.id == local.id for item in session.local_adjustments):
                raise EditCommandError(f"Local adjustment '{local.id}' already exists.")
            if len(session.local_adjustments) >= 256:
                raise EditCommandError("A project may contain at most 256 local adjustments.")
            index = int(payload.get("index", len(session.local_adjustments)))
            if not 0 <= index <= len(session.local_adjustments):
                raise EditCommandError("Local adjustment insertion index is out of range.")
            session.local_adjustments.insert(index, local)
            session.render_cache.clear_adjusted()
            return EditCommand(
                expected_revision=current_revision,
                command_type="delete_local",
                target_id=local.id,
            )

        if command_type == "update_local":
            index = _local_index(session.local_adjustments, command.target_id)
            previous = session.local_adjustments[index]
            updated = LocalAdjustment.model_validate(payload.get("local"))
            if updated.id != previous.id:
                raise EditCommandError("A local adjustment UUID cannot be changed.")
            session.local_adjustments[index] = updated
            session.render_cache.clear_adjusted()
            return EditCommand(
                expected_revision=current_revision,
                command_type="update_local",
                target_id=previous.id,
                payload={"local": previous.model_dump(mode="json")},
            )

        if command_type == "delete_local":
            index = _local_index(session.local_adjustments, command.target_id)
            previous = session.local_adjustments.pop(index)
            session.render_cache.clear_adjusted()
            return EditCommand(
                expected_revision=current_revision,
                command_type="create_local",
                target_id=previous.id,
                payload={"local": previous.model_dump(mode="json"), "index": index},
            )

        if command_type == "reorder_locals":
            requested = payload.get("order")
            if not isinstance(requested, list):
                raise EditCommandError("reorder_locals requires an order array.")
            previous_order = [item.id for item in session.local_adjustments]
            if len(requested) != len(previous_order) or set(requested) != set(previous_order):
                raise EditCommandError("Reorder payload must contain every local UUID exactly once.")
            by_id = {item.id: item for item in session.local_adjustments}
            session.local_adjustments = [by_id[item_id] for item_id in requested]
            session.render_cache.clear_adjusted()
            return EditCommand(
                expected_revision=current_revision,
                command_type="reorder_locals",
                payload={"order": previous_order},
            )

        raise EditCommandError(f"Unsupported edit command '{command_type}'.")

    def _undo(self, session: LoadedSession) -> None:
        if not session.undo_history:
            raise EditCommandError("There is no edit to undo.")
        entry = session.undo_history.pop()
        session.history_bytes -= entry.byte_size
        inverse = entry.inverse.model_copy(update={"expected_revision": session.edit_revision})
        self._execute_command(session, inverse)
        session.redo_history.append(entry)
        session.edit_revision += 1
        session.dirty = True

    def _redo(self, session: LoadedSession) -> None:
        if not session.redo_history:
            raise EditCommandError("There is no edit to redo.")
        entry = session.redo_history.pop()
        forward = entry.forward.model_copy(update={"expected_revision": session.edit_revision})
        self._execute_command(session, forward)
        session.undo_history.append(entry)
        session.history_bytes += entry.byte_size
        session.edit_revision += 1
        session.dirty = True

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
                raw_import_settings=session.raw_import_settings,
            )
            source.filename = original_filename
            session.image = image
            session.sdr_reference_image = sdr_reference_image
            session.source = source
            session.metadata = metadata
            session.analysis = analysis
            session.interpretation_override = override
            if session.adjustments.hdr.highlight_compression_peak_measurement != "manual":
                session._sync_highlight_source_peaks()
            session.preview_tokens = {PreviewKind.HDR: 0, PreviewKind.SDR: 0}
            session.scope_tokens = {PreviewKind.HDR: 0, PreviewKind.SDR: 0}
            session.render_cache.replace_source(image, sdr_reference_image)
            session.edit_revision += 1
            session.dirty = True
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

    def next_scope_token(self, session_id: str, kind: PreviewKind) -> int:
        with self._lock:
            session = self.get(session_id)
            session.scope_tokens[kind] += 1
            return session.scope_tokens[kind]

    def is_scope_current(self, session_id: str, kind: PreviewKind, token: int) -> bool:
        with self._lock:
            session = self.get(session_id)
            return session.scope_tokens[kind] == token


def _remove_owned_source(path: Path) -> None:
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass


def _local_index(locals_: list[LocalAdjustment], target_id: str | None) -> int:
    if not target_id:
        raise EditCommandError("This command requires a target UUID.")
    for index, local in enumerate(locals_):
        if local.id == target_id:
            return index
    raise EditCommandError(f"Local adjustment '{target_id}' was not found.")


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()
