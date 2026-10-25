from __future__ import annotations

from dataclasses import InitVar, dataclass, field
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from time import perf_counter
from pathlib import Path
from threading import RLock
from typing import Any, Callable
from uuid import uuid4

import numpy as np

from .import_defaults import apply_import_defaults, starting_adjustments, sync_highlight_source_peaks
from .capabilities import probe_capabilities
from .color_context import DEFAULT_HDR_REFERENCE_WHITE_NITS, RenderColorContext, scene_linear_to_nits
from .adjustments import SDR_SCENE_TO_DISPLAY_SCALE
from .import_bands import grade_import_bands
from .loader import SOURCE_COLOR_TRANSFORM_VERSION, SOURCE_DECODER_VERSION, load_image
from .metadata import extract_metadata
from .models import (
    AdjustmentState,
    DenoiseDocumentSettings,
    DenoiseLaneSettings,
    EditCommand,
    PhotoFraming,
    EditDocument,
    EditStateResponse,
    HDRAnalysis,
    LocalAdjustment,
    LocalGrade,
    PreviewKind,
    PreviewSettings,
    RawImportSettings,
    RepairRecord,
    SdrMatchState,
    SessionPayload,
    SourceImageDescriptor,
    SourceLuminanceDescriptor,
    SourceInterpretationOverride,
    SourceReference,
)
from .render_cache import SessionRenderCache, SourceMipIdentity, default_source_mip_store
from .source_luminance import describe_source_luminance
from .sdr_match import MATCH_ANALYSIS_EDGE, SDRMatchMaterializationError, materialize_sdr_match
from .sdr_match_remote import RemoteCandidateBridge


class RevisionConflictError(RuntimeError):
    def __init__(self, expected: int, actual: int) -> None:
        super().__init__(f"Edit revision mismatch: expected {expected}, current revision is {actual}.")
        self.expected = expected
        self.actual = actual


class EditCommandError(ValueError):
    pass


from .adjustments import apply_adjustments


def _source_mip_identity(session: "LoadedSession", lane: str = "hdr") -> SourceMipIdentity:
    """The persistent source cache key for this session's decoded pixels.

    Everything folded in here changes the decoded scene-linear data for the
    same file: the decode route and color transform versions, the reference
    white used at decode, and any user interpretation override or RAW recipe.
    Grade state is deliberately absent (PRD 5.3).
    """
    interpretation = json.dumps(
        {
            "override": session.interpretation_override.model_dump(mode="json"),
            "raw": session.raw_import_settings.model_dump(mode="json"),
            "repairs": [r.model_dump(mode="json") for r in session.repairs],
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return SourceMipIdentity(
        content_key=session.source_fingerprint_sha256,
        byte_size=session.source_byte_size,
        width=int(session.image.shape[1]),
        height=int(session.image.shape[0]),
        decoder_version=SOURCE_DECODER_VERSION,
        color_transform_version=SOURCE_COLOR_TRANSFORM_VERSION,
        orientation=1,
        lane=lane,
        reference_white_nits=int(session.hdr_reference_white_nits),
        interpretation=interpretation,
    )


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
    hdr_reference_white_nits: int = DEFAULT_HDR_REFERENCE_WHITE_NITS
    source_luminance: SourceLuminanceDescriptor | None = None
    owns_source_path: bool = False
    durable_source_path: Path | None = None
    adjustments: AdjustmentState = field(default_factory=AdjustmentState)
    local_adjustments: list[LocalAdjustment] = field(default_factory=list)
    repairs: list[RepairRecord] = field(default_factory=list)
    retouch_original: np.ndarray = field(init=False, repr=False)
    retouch_worker: Any = field(default=None, repr=False)
    retouch_generation: int = field(default=0, repr=False)
    retouch_cancelled_requests: list[str] = field(default_factory=list, repr=False)
    denoise: DenoiseDocumentSettings = field(default_factory=DenoiseDocumentSettings)
    sdr_match: SdrMatchState = field(default_factory=SdrMatchState)
    framing: PhotoFraming = field(default_factory=PhotoFraming)
    interpretation_override: SourceInterpretationOverride = field(default_factory=SourceInterpretationOverride)
    raw_import_settings: RawImportSettings = field(default_factory=RawImportSettings)
    edit_revision: int = 0
    dirty: bool = False
    undo_history: list[HistoryEntry] = field(default_factory=list, repr=False)
    redo_history: list[HistoryEntry] = field(default_factory=list, repr=False)
    history_bytes: int = 0
    prepared_fingerprint: InitVar[str | None] = None
    source_fingerprint_sha256: str = field(init=False)
    source_byte_size: int = field(init=False)
    preview: PreviewSettings = field(default_factory=PreviewSettings)
    preview_tokens: dict[PreviewKind, int] = field(default_factory=lambda: {PreviewKind.HDR: 0, PreviewKind.SDR: 0})
    scope_tokens: dict[PreviewKind, int] = field(default_factory=lambda: {PreviewKind.HDR: 0, PreviewKind.SDR: 0})
    render_cache: SessionRenderCache = field(init=False, repr=False)

    def __post_init__(self, prepared_fingerprint: str | None) -> None:
        self.retouch_original = self.image
        self.color_context = RenderColorContext(self.hdr_reference_white_nits)
        self.hdr_reference_white_nits = self.color_context.hdr_reference_white_nits
        if self.source_luminance is None:
            self.source_luminance = describe_source_luminance(
                self.source, self.metadata, has_authored_sdr=self.sdr_reference_image is not None
            )
        self.source_fingerprint_sha256 = prepared_fingerprint if prepared_fingerprint is not None else _sha256_file(self.source_path)
        self.source_byte_size = self.source_path.stat().st_size
        self._apply_import_defaults(self.adjustments)
        self.render_cache = SessionRenderCache(
            self.image,
            self.sdr_reference_image,
            color_context=self.color_context,
            source_identity=_source_mip_identity(self),
            sdr_identity=_source_mip_identity(self, lane="sdr") if self.sdr_reference_image is not None else None,
            mip_store=default_source_mip_store(),
        )
        self._sync_highlight_source_peaks()

    def _apply_import_defaults(self, adjustments: AdjustmentState) -> None:
        apply_import_defaults(adjustments, self.sdr_reference_image)

    def starting_adjustments(self) -> AdjustmentState:
        """The neutral grade before any edit, shared with Library pictures."""
        return starting_adjustments(self.analysis, self.sdr_reference_image, self.hdr_reference_white_nits)

    def _sync_highlight_source_peaks(self, adjustments: AdjustmentState | None = None) -> None:
        sync_highlight_source_peaks(
            adjustments or self.adjustments, self.analysis, self.sdr_reference_image, self.hdr_reference_white_nits
        )

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
            luminance=self.source_luminance,
        )

    def edit_document(self) -> EditDocument:
        return EditDocument(
            hdr_reference_white_nits=self.hdr_reference_white_nits,
            source=self.source_reference(),
            interpretation_override=self.interpretation_override,
            global_adjustments=self.adjustments,
            local_adjustments=self.local_adjustments,
            repairs=self.repairs,
            denoise=self.denoise,
            sdr_match=self.sdr_match,
            framing=self.framing,
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
    def __init__(self, *, grade_import_parallel: bool = False) -> None:
        # Library kept-preview stores retain their established serial path.
        self._grade_import_parallel = grade_import_parallel
        self._lock = RLock()
        self._current: LoadedSession | None = None

    def create_session(
        self,
        source_path: Path,
        original_filename: str | None = None,
        owns_source_path: bool = False,
        raw_import_settings: RawImportSettings | None = None,
        progress: Callable[[str, str], None] | None = None,
        hdr_reference_white_nits: int = DEFAULT_HDR_REFERENCE_WHITE_NITS,
    ) -> SessionPayload:
        session = self.prepare_session(
            source_path,
            original_filename=original_filename,
            owns_source_path=owns_source_path,
            raw_import_settings=raw_import_settings,
            progress=progress,
            hdr_reference_white_nits=hdr_reference_white_nits,
        )
        return self.activate_session(session)

    def prepare_session(
        self,
        source_path: Path,
        original_filename: str | None = None,
        owns_source_path: bool = False,
        raw_import_settings: RawImportSettings | None = None,
        interpretation_override: SourceInterpretationOverride | None = None,
        progress: Callable[[str, str], None] | None = None,
        cancelled: Callable[[], bool] | None = None,
        hdr_reference_white_nits: int = DEFAULT_HDR_REFERENCE_WHITE_NITS,
    ) -> LoadedSession:
        try:
            resolved_raw_settings = raw_import_settings or RawImportSettings()
            resolved_override = interpretation_override or SourceInterpretationOverride()
            # One hash lane: SHA-256 is an ordered byte stream (I/O bound); splitting
            # it into independent hashes would change the source identity. Join
            # before constructing the identity; the worker retains no image.
            with grade_import_bands(enabled=self._grade_import_parallel), ThreadPoolExecutor(max_workers=1, thread_name_prefix="source-hash") as pool:
                initial_stat = source_path.stat()
                fingerprint = pool.submit(_sha256_file, source_path)
                image, source, metadata, analysis, sdr_reference_image = load_image(
                    source_path,
                    overrides={
                        "color_space": resolved_override.color_space,
                        "transfer_function": resolved_override.transfer_function,
                        "linear_reference": resolved_override.linear_reference,
                    },
                    raw_import_settings=resolved_raw_settings,
                    progress=progress,
                    cancelled=cancelled,
                    retained_session_bytes=self._retained_session_bytes(),
                    hdr_reference_white_nits=hdr_reference_white_nits,
                )
                prepared_fingerprint = fingerprint.result()
            final_stat = source_path.stat()
            if (initial_stat.st_size, initial_stat.st_mtime_ns, initial_stat.st_ctime_ns) != (
                final_stat.st_size, final_stat.st_mtime_ns, final_stat.st_ctime_ns
            ):
                # An external source edit is exceptional: retain the old
                # post-decode fingerprint rather than trust the early hash.
                prepared_fingerprint = _sha256_file(source_path)
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
            if progress:
                progress("session_indexing", "Finalizing source fingerprint and render cache")
            if cancelled is not None and cancelled():
                raise RuntimeError("Import cancelled")
            session = LoadedSession(
                session_id=uuid4().hex,
                source_path=source_path,
                prepared_fingerprint=prepared_fingerprint,
                image=image,
                sdr_reference_image=sdr_reference_image,
                source=source,
                analysis=analysis,
                metadata=metadata,
                hdr_reference_white_nits=hdr_reference_white_nits,
                owns_source_path=owns_source_path,
                interpretation_override=resolved_override,
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
        if previous is not None and previous.retouch_worker is not None:
            previous.retouch_worker.close()
        return payload

    def redevelop_session(self, session_id: str, developed: LoadedSession) -> SessionPayload:
        """Atomically replace source pixels while preserving the edit document."""
        with self._lock:
            current = self.get(session_id)
            if developed.source_fingerprint_sha256 != current.source_fingerprint_sha256:
                raise ValueError("RAW re-development source no longer matches the active session.")

            developed.session_id = current.session_id
            developed.source.filename = current.source.filename
            developed.owns_source_path = current.owns_source_path
            developed.durable_source_path = current.durable_source_path
            developed.adjustments = current.adjustments
            developed.local_adjustments = current.local_adjustments
            developed.repairs = current.repairs
            developed.sdr_match = current.sdr_match.model_copy(deep=True)
            developed.denoise = current.denoise
            developed.framing = current.framing
            developed.interpretation_override = current.interpretation_override
            developed.hdr_reference_white_nits = current.hdr_reference_white_nits
            developed.color_context = current.color_context
            developed.source_luminance = current.source_luminance
            developed.edit_revision = current.edit_revision + 1
            developed.dirty = True
            developed.undo_history = current.undo_history
            developed.redo_history = current.redo_history
            developed.history_bytes = current.history_bytes
            developed.preview = current.preview
            from .retouch_source import restore_repairs
            restore_repairs(developed, _source_mip_identity(developed))
            payload = developed.to_payload()
            self._current = developed
            if current.retouch_worker is not None:
                current.retouch_worker.close()
            if getattr(self, "grade_recovery_observer", None):
                self.grade_recovery_observer(developed)
            return payload

    def current(self) -> LoadedSession | None:
        with self._lock:
            return self._current

    def _retained_session_bytes(self) -> int:
        current = self.current()
        if current is None:
            return 0
        total = int(current.image.nbytes)
        if current.retouch_original is not current.image:
            total += int(current.retouch_original.nbytes)
        if current.sdr_reference_image is not None:
            total += int(current.sdr_reference_image.nbytes)
        return total

    def clear(self) -> None:
        with self._lock:
            previous = self._current
            self._current = None
        if previous is not None and previous.owns_source_path:
            _remove_owned_source(previous.source_path)
        if previous is not None and previous.retouch_worker is not None:
            previous.retouch_worker.close()

    def get(self, session_id: str) -> LoadedSession:
        from .library_live import session as library_session
        retained = library_session(session_id)
        if retained is not None: return retained
        from .gpu_delivery import session as delivery_session
        retained = delivery_session(session_id)
        if retained is not None:
            return retained
        session = self.current()
        if session is None or session.session_id != session_id:
            raise KeyError(f"Session '{session_id}' was not found.")
        return session

    def update_adjustments(self, session_id: str, adjustments: AdjustmentState) -> LoadedSession:
        with self._lock:
            session = self.get(session_id)
            session.adjustments = adjustments
            if getattr(self, "grade_recovery_observer", None):
                self.grade_recovery_observer(session)
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

    def cancel_repair(self, session_id: str, request_id: str | None = None) -> None:
        with self._lock:
            session = self.get(session_id)
            session.retouch_generation += 1
            if request_id:
                session.retouch_cancelled_requests = (session.retouch_cancelled_requests + [request_id])[-32:]
            if session.retouch_worker is not None:
                session.retouch_worker.set_current(None)

    def apply_edit_commands(self, session_id: str, commands: list[EditCommand]) -> EditStateResponse:
        """Prepare repair pixels before committing document/history atomically."""
        if not any(c.command_type in {"set_repairs", "undo", "redo", "replace_document"} for c in commands):
            return self._commit_edit_commands(session_id, commands)
        from copy import copy
        from types import SimpleNamespace
        from concurrent.futures import CancelledError
        from .retouch_source import build_repaired_source, repair_identity
        with self._lock:
            session = self.get(session_id)
            if any(c.command_type == "set_repairs" and c.payload.get("repair_request_id") in session.retouch_cancelled_requests for c in commands):
                raise EditCommandError("Repair cancelled before processing; the previous image was retained")
            revision, generation, original = session.edit_revision, session.retouch_generation, session.retouch_original
            draft = copy(session)
            for name in ("adjustments", "denoise", "sdr_match", "interpretation_override"):
                setattr(draft, name, getattr(session, name).model_copy(deep=True))
            draft.local_adjustments = [r.model_copy(deep=True) for r in session.local_adjustments]
            draft.repairs = [r.model_copy(deep=True) for r in session.repairs]
            draft.undo_history, draft.redo_history = list(session.undo_history), list(session.redo_history)
            draft.render_cache = SimpleNamespace(clear_adjusted=lambda **kw: None, set_color_context=lambda *a: None)
            for command in commands:
                if command.expected_revision != draft.edit_revision:
                    raise RevisionConflictError(command.expected_revision, draft.edit_revision)
                self._apply_edit_command(draft, command)
            changed = repair_identity(draft.repairs) != repair_identity(session.repairs)
            if changed and session.retouch_worker is None:
                from .retouch_jobs import RepairWorker
                session.retouch_worker = RepairWorker()
        if not changed:
            return self._commit_edit_commands(session_id, commands)

        def check():
            if (session.edit_revision != revision or session.retouch_generation != generation
                    or session.retouch_original is not original or self.current() is not session):
                raise CancelledError("Repair cancelled or superseded; the previous image was retained")
        try:
            pixels = build_repaired_source(session, draft.repairs, check, previous_records=session.repairs)
        except CancelledError as exc:
            raise EditCommandError(str(exc)) from exc
        try:
            with self._lock:
                check()
                return self._commit_edit_commands(session_id, commands, repaired_pixels=pixels)
        except CancelledError as exc:
            raise EditCommandError(str(exc)) from exc

    def _commit_edit_commands(self, session_id: str, commands: list[EditCommand], *, repaired_pixels=None) -> EditStateResponse:
        with self._lock:
            session = self.get(session_id)
            original = (
                session.adjustments.model_copy(deep=True),
                [item.model_copy(deep=True) for item in session.local_adjustments],
                [item.model_copy(deep=True) for item in session.repairs],
                session.denoise.model_copy(deep=True),
                session.sdr_match.model_copy(deep=True),
                session.framing.model_copy(deep=True),
                session.interpretation_override.model_copy(deep=True),
                session.hdr_reference_white_nits,
                session.color_context,
                session.edit_revision,
                session.dirty,
                list(session.undo_history),
                list(session.redo_history),
                session.history_bytes,
                session.image,
            )
            try:
                for command in commands:
                    if command.expected_revision != session.edit_revision:
                        raise RevisionConflictError(command.expected_revision, session.edit_revision)
                    self._apply_edit_command(session, command)
                if repaired_pixels is not None:
                    from .retouch_source import install_repaired_source
                    install_repaired_source(session, repaired_pixels, _source_mip_identity(session))
            except Exception:
                (
                    session.adjustments,
                    session.local_adjustments,
                    session.repairs,
                    session.denoise,
                    session.sdr_match,
                    session.framing,
                    session.interpretation_override,
                    session.hdr_reference_white_nits,
                    session.color_context,
                    session.edit_revision,
                    session.dirty,
                    session.undo_history,
                    session.redo_history,
                    session.history_bytes,
                    session.image,
                ) = original
                if session.render_cache.image is not session.image:
                    session.render_cache.replace_source(session.image, session.sdr_reference_image,
                        identity=_source_mip_identity(session), sdr_identity=session.render_cache.sdr_identity)
                session.render_cache.set_color_context(session.color_context)
                session.render_cache.clear_adjusted()
                raise
            if getattr(self, "grade_recovery_observer", None):
                self.grade_recovery_observer(session)
            return session.edit_state()

    def apply_sdr_match_action(
        self,
        session_id: str,
        *,
        expected_revision: int,
        authored_sdr_override_consent: bool = False,
        timing: dict[str, object] | None = None,
        candidate_bridge: RemoteCandidateBridge | None = None,
    ) -> EditStateResponse:
        """Fit the SDR grade to the HDR grade and write it as ordinary SDR settings.

        ``candidate_bridge`` lets the page's GPU render the candidates.
        """
        with self._lock:
            session = self.get(session_id)
            if session.edit_revision != expected_revision:
                raise RevisionConflictError(expected_revision, session.edit_revision)
            current_adjustments = session.adjustments.model_copy(deep=True)
            current_locals = [item.model_copy(deep=True) for item in session.local_adjustments]
            current_denoise = session.denoise.model_copy(deep=True)
            reference_white = session.hdr_reference_white_nits
            has_authored_sdr = session.sdr_reference_image is not None

        if has_authored_sdr and not authored_sdr_override_consent:
            raise EditCommandError("Replacing the authored SDR rendition requires explicit consent.")

        source_started = perf_counter()
        source, _ = session.render_cache.source_pair(MATCH_ANALYSIS_EDGE)
        if timing is not None:
            timing["source_proxy_ms"] = round((perf_counter() - source_started) * 1000.0, 3)
        try:
            materialized = materialize_sdr_match(
                source,
                current_adjustments.model_copy(deep=True),
                [item.model_copy(deep=True) for item in current_locals],
                reference_white_nits=reference_white,
                source_pixel_scale=min(1.0, 768 / max(session.image.shape[:2])),
                timing=timing,
                candidate_bridge=candidate_bridge,
            )
        except SDRMatchMaterializationError as exc:
            raise EditCommandError(str(exc)) from exc

        target_adjustments = current_adjustments.model_copy(deep=True)
        target_adjustments.sdr = materialized.adjustments.sdr.model_copy(deep=True)
        translated_by_id = {item.id: item.sdr_grade for item in materialized.local_adjustments}
        target_locals = [
            item.model_copy(
                update={"sdr_grade": translated_by_id.get(item.id, LocalGrade()).model_copy(deep=True)},
                deep=True,
            )
            for item in current_locals
        ]
        target_denoise = current_denoise.model_copy(deep=True)
        target_denoise.sdr = current_denoise.hdr.model_copy(deep=True)
        target_match = SdrMatchState(
            materialized_status=materialized.status,
            materialized_metrics=materialized.quality,
        )

        command = EditCommand(
            expected_revision=expected_revision,
            command_type="set_sdr_match",
            payload={
                "match_state": target_match.model_dump(mode="json"),
                "global_adjustments": target_adjustments.model_dump(mode="json"),
                "local_adjustments": [item.model_dump(mode="json") for item in target_locals],
                "denoise": target_denoise.model_dump(mode="json"),
                "authored_sdr_override_consent": authored_sdr_override_consent,
                "replaces_authored_sdr": has_authored_sdr,
            },
        )
        commit_started = perf_counter()
        response = self.apply_edit_commands(session_id, [command])
        if timing is not None:
            timing["document_commit_ms"] = round((perf_counter() - commit_started) * 1000.0, 3)
        return response

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
        previous_entry = session.undo_history[-1] if session.undo_history else None
        coalesces_gesture = bool(
            command.history_group
            and previous_entry
            and previous_entry.forward.history_group == command.history_group
            and previous_entry.forward.command_type == command.command_type
            and previous_entry.forward.target_id == command.target_id
        )
        if coalesces_gesture:
            # Keep the inverse captured at interaction start and replace only
            # the forward state with the gesture's latest settled value.
            session.history_bytes -= previous_entry.byte_size
            entry = HistoryEntry(forward=command, inverse=previous_entry.inverse, byte_size=0)
            entry.byte_size = len(
                json.dumps(
                    {
                        "forward": entry.forward.model_dump(mode="json"),
                        "inverse": entry.inverse.model_dump(mode="json"),
                    },
                    separators=(",", ":"),
                ).encode("utf-8")
            )
            session.undo_history[-1] = entry
        else:
            session.undo_history.append(entry)
        session.history_bytes += entry.byte_size
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
            if document.source != previous.source:
                raise EditCommandError("The edit-state endpoint cannot replace the session source.")
            if document.interpretation_override != previous.interpretation_override:
                raise EditCommandError(
                    "Source interpretation changes must use the interpretation endpoint so pixels are reloaded."
                )
            session.adjustments = document.global_adjustments
            session.local_adjustments = document.local_adjustments
            session.repairs = document.repairs
            session.denoise = document.denoise
            session.sdr_match = document.sdr_match
            session.framing = document.framing
            session.hdr_reference_white_nits = document.hdr_reference_white_nits
            session.color_context = RenderColorContext(document.hdr_reference_white_nits)
            session.render_cache.set_color_context(session.color_context)
            session.render_cache.clear_adjusted()
            return EditCommand(
                expected_revision=current_revision,
                command_type="replace_document",
                payload={"document": previous.model_dump(mode="json")},
            )

        if command_type == "set_hdr_reference_white":
            previous = session.hdr_reference_white_nits
            context = RenderColorContext(payload.get("hdr_reference_white_nits"))
            session.hdr_reference_white_nits = context.hdr_reference_white_nits
            session.color_context = context
            session.render_cache.set_color_context(context)
            if session.adjustments.hdr.highlight_compression_peak_measurement != "manual":
                session._sync_highlight_source_peaks()
            return EditCommand(
                expected_revision=current_revision,
                command_type="set_hdr_reference_white",
                payload={"hdr_reference_white_nits": previous},
            )

        if command_type == "set_photo_framing":
            previous = session.framing
            session.framing = PhotoFraming.model_validate(payload.get("framing"))
            # Composition is independent of RAW development and creative pixels.
            return EditCommand(expected_revision=current_revision, command_type=command_type,
                payload={"framing": previous.model_dump(mode="json")})

        if command_type == "set_global_adjustments":
            previous = session.adjustments
            updated = AdjustmentState.model_validate(payload.get("adjustments"))
            session.adjustments = updated
            session.render_cache.clear_adjusted()
            return EditCommand(
                expected_revision=current_revision,
                command_type="set_global_adjustments",
                payload={"adjustments": previous.model_dump(mode="json")},
            )

        if command_type == "set_sdr_match":
            previous_match = session.sdr_match.model_copy(deep=True)
            previous_adjustments = session.adjustments.model_copy(deep=True)
            previous_locals = [item.model_copy(deep=True) for item in session.local_adjustments]
            previous_denoise = session.denoise.model_copy(deep=True)
            match_state = SdrMatchState.model_validate(payload.get("match_state"))
            adjustments = AdjustmentState.model_validate(payload.get("global_adjustments"))
            raw_locals = payload.get("local_adjustments")
            if not isinstance(raw_locals, list):
                raise EditCommandError("set_sdr_match requires a local_adjustments array.")
            if len(raw_locals) > 256:
                raise EditCommandError("A project may contain at most 256 local adjustments.")
            local_adjustments = [LocalAdjustment.model_validate(item) for item in raw_locals]
            denoise = DenoiseDocumentSettings.model_validate(
                payload.get("denoise", session.denoise.model_dump(mode="json"))
            )
            local_ids = [item.id for item in local_adjustments]
            if len(local_ids) != len(set(local_ids)):
                raise EditCommandError("Local adjustment UUIDs must be unique.")
            replacing_authored = bool(payload.get("replaces_authored_sdr", False))
            if replacing_authored and session.sdr_reference_image is not None and not bool(
                payload.get("authored_sdr_override_consent", False)
            ):
                raise EditCommandError("Replacing the authored SDR rendition requires explicit consent.")
            session.sdr_match = match_state
            session.adjustments = adjustments
            session.local_adjustments = local_adjustments
            session.denoise = denoise
            session.render_cache.clear_adjusted()
            return EditCommand(
                expected_revision=current_revision,
                command_type="set_sdr_match",
                payload={
                    "match_state": previous_match.model_dump(mode="json"),
                    "global_adjustments": previous_adjustments.model_dump(mode="json"),
                    "local_adjustments": [item.model_dump(mode="json") for item in previous_locals],
                    "denoise": previous_denoise.model_dump(mode="json"),
                    "authored_sdr_override_consent": True,
                },
            )

        if command_type == "revert_rendition":
            lane = payload.get("lane")
            if lane not in ("hdr", "sdr"):
                raise EditCommandError("revert_rendition requires a lane of 'hdr' or 'sdr'.")
            previous_document = session.edit_document().model_dump(mode="json")
            # The other rendition, the shared geometry, the locals and their
            # masks, and the source settings are left as they are.
            adjustments = session.adjustments.model_copy(deep=True)
            setattr(adjustments, lane, getattr(session.starting_adjustments(), lane))
            denoise = session.denoise.model_copy(deep=True)
            setattr(denoise, lane, DenoiseLaneSettings())
            session.adjustments = adjustments
            session.denoise = denoise
            session.local_adjustments = [
                item.model_copy(update={f"{lane}_grade": LocalGrade()}, deep=True)
                for item in session.local_adjustments
            ]
            if lane == "sdr":
                session.sdr_match = SdrMatchState()
            session.render_cache.clear_adjusted()
            return EditCommand(
                expected_revision=current_revision,
                command_type="replace_document",
                payload={"document": previous_document},
            )

        if command_type == "set_repairs":
            previous = [r.model_dump(mode="json") for r in session.repairs]
            previous_rematch = session.sdr_match.rematch_required
            raw = payload.get("repairs")
            if not isinstance(raw, list) or len(raw) > 256:
                raise EditCommandError("Repairs must be an array with at most 256 records")
            records = [RepairRecord.model_validate(r) for r in raw]
            if len({r.id for r in records}) != len(records):
                raise EditCommandError("Repair IDs must be unique")
            session.repairs = records
            session.sdr_match = session.sdr_match.model_copy(update={"rematch_required": payload.get(
                "rematch_required", previous_rematch or (previous != raw and (session.sdr_match.materialized_status is not None or session.sdr_reference_image is not None)))})
            return EditCommand(expected_revision=current_revision, command_type="set_repairs",
                payload={"repairs": previous, "rematch_required": previous_rematch})

        if command_type == "set_denoise_settings":
            previous = session.denoise
            session.denoise = DenoiseDocumentSettings.model_validate(payload.get("denoise"))
            return EditCommand(
                expected_revision=current_revision,
                command_type="set_denoise_settings",
                payload={"denoise": previous.model_dump(mode="json")},
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
                    "linear_reference": override.linear_reference,
                },
                raw_import_settings=session.raw_import_settings,
                retained_session_bytes=self._retained_session_bytes(),
                hdr_reference_white_nits=session.hdr_reference_white_nits,
            )
            source.filename = original_filename
            from copy import copy
            from .retouch_source import build_repaired_source
            candidate = copy(session)
            candidate.retouch_original = image
            candidate.interpretation_override = override
            candidate.retouch_worker = None
            try:
                repaired = build_repaired_source(candidate, session.repairs)
            finally:
                if candidate.retouch_worker is not None:
                    candidate.retouch_worker.close()
            session.image = repaired
            session.retouch_original = image
            session.retouch_generation += 1
            session.sdr_reference_image = sdr_reference_image
            session.source = source
            session.metadata = metadata
            session.source_luminance = describe_source_luminance(
                source, metadata, has_authored_sdr=sdr_reference_image is not None
            )
            session.analysis = analysis
            session.interpretation_override = override
            if session.adjustments.hdr.highlight_compression_peak_measurement != "manual":
                session._sync_highlight_source_peaks()
            session.preview_tokens = {PreviewKind.HDR: 0, PreviewKind.SDR: 0}
            session.scope_tokens = {PreviewKind.HDR: 0, PreviewKind.SDR: 0}
            session.render_cache.replace_source(
                repaired,
                sdr_reference_image,
                identity=_source_mip_identity(session),
                sdr_identity=_source_mip_identity(session, lane="sdr") if sdr_reference_image is not None else None,
            )
            session.edit_revision += 1
            session.dirty = True
            if getattr(self, "grade_recovery_observer", None):
                self.grade_recovery_observer(session)
            return session

    def is_source_current(self, session_id: str, source_epoch: int) -> bool:
        """Lock-free cancellation check, like SessionRenderCache.source_epoch.

        Cache persistence holds its memory lock; taking the session lock here
        would invert source replacement's session/cache lock order.
        """
        current = self._current
        return bool(current is not None and current.session_id == session_id
                    and current.render_cache.source_epoch == source_epoch)

    def next_preview_token(self, session_id: str, kind: PreviewKind) -> int:
        with self._lock:
            session = self.get(session_id)
            session.preview_tokens[kind] += 1
            return session.preview_tokens[kind]

    def is_preview_current(self, session_id: str, kind: PreviewKind, token: int) -> bool:
        with self._lock:
            session = self._current
            return bool(
                session is not None
                and session.session_id == session_id
                and session.preview_tokens[kind] == token
            )

    def next_scope_token(self, session_id: str, kind: PreviewKind) -> int:
        with self._lock:
            session = self.get(session_id)
            session.scope_tokens[kind] += 1
            return session.scope_tokens[kind]

    def is_scope_current(self, session_id: str, kind: PreviewKind, token: int) -> bool:
        with self._lock:
            session = self._current
            return bool(
                session is not None
                and session.session_id == session_id
                and session.scope_tokens[kind] == token
            )


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
