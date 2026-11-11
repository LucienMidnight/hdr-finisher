from __future__ import annotations

import hashlib
import json
import logging
import os
from pathlib import Path
import tempfile
import zipfile

from .models import EditDocument, ProjectResponse
from .sessions import LoadedSession, SessionStore


PROJECT_STATE_NAME = "edit-state.json"
PROJECT_MANIFEST_NAME = "manifest.json"

logger = logging.getLogger(__name__)


class ProjectError(ValueError):
    pass


class ProjectSourceRelinkRequired(ProjectError):
    """The project is valid, but its original source must be selected again."""

    pass


def save_project(session: LoadedSession, path: Path, source_path: Path | None = None) -> ProjectResponse:
    destination = _project_path(path)
    if getattr(session, "grade_notice", None):
        raise ProjectError("This grade needs a choice before saving: Continue without them, Revert to original or Leave as is.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    if source_path is not None:
        durable_source = source_path.expanduser().resolve()
        if not durable_source.is_file():
            raise ProjectError(f"Source file '{durable_source}' was not found.")
        if _sha256_file(durable_source) != session.source_fingerprint_sha256:
            raise ProjectError("The selected source does not match the loaded image fingerprint.")
        session.durable_source_path = durable_source
    elif session.durable_source_path is None and session.owns_source_path:
        raise ProjectError("The first project save requires the durable original source path.")

    if destination.exists():
        current_hash = _sha256_file(destination)
        expected = getattr(session, "grade_project_fingerprint", None)
        if getattr(session, "grade_project_path", None) == destination and expected and current_hash != expected:
            raise ProjectError("The project changed elsewhere. Open it again before saving.")
        with zipfile.ZipFile(destination) as existing:
            old = validate_saved_document(_read_state(existing))
        if getattr(old, "_saved_grade_notice", None) and getattr(session, "grade_project_consent", None) != current_hash:
            raise ProjectError("This project's grade needs a choice before it can be replaced.")
    document = session.edit_document()
    manifest = {
        "format": "HDR Finisher Project",
        "schema_version": document.schema_version,
        "contains_source_pixels": False,
    }
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb",
            prefix=f".{destination.name}.",
            suffix=".tmp",
            dir=destination.parent,
            delete=False,
        ) as temporary:
            temporary_path = Path(temporary.name)
        with zipfile.ZipFile(temporary_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for name, body in getattr(session, "grade_project_backups", {}).items():
                archive.writestr(name, body)
            archive.writestr(PROJECT_MANIFEST_NAME, json.dumps(manifest, separators=(",", ":")))
            archive.writestr(PROJECT_STATE_NAME, document.model_dump_json())
        os.replace(temporary_path, destination)
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)
    session.dirty = False
    session.grade_project_fingerprint = _sha256_file(destination)
    return ProjectResponse(path=str(destination), revision=session.edit_revision, document=document)


def _read_state(archive):
    text = archive.read(PROJECT_STATE_NAME).decode("utf-8", errors="replace")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return text


def open_project(store: SessionStore, path: Path, source_path: Path | None = None) -> LoadedSession:
    project_path = _project_path(path)
    if not project_path.is_file():
        raise ProjectError(f"Project file '{project_path}' was not found.")
    try:
        with zipfile.ZipFile(project_path, "r") as archive:
            names = set(archive.namelist())
            if PROJECT_STATE_NAME not in names or PROJECT_MANIFEST_NAME not in names:
                raise ProjectError("The project container is missing required entries.")
            manifest = json.loads(archive.read(PROJECT_MANIFEST_NAME))
            backups = {name: archive.read(name) for name in names if name.startswith("grade-backups/")}
            schema_version = manifest.get("schema_version")
            if manifest.get("contains_source_pixels") is not False:
                raise ProjectError("Invalid project manifest.")
            state_payload = _read_state(archive)
            document = _validate_ignoring_unknown_fields(state_payload)
    except (zipfile.BadZipFile, KeyError, json.JSONDecodeError) as exc:
        raise ProjectError("The project file is malformed or unreadable.") from exc

    session = open_document(store, document, source_path)
    session.grade_project_path = project_path
    session.grade_project_backups = backups
    session.grade_project_fingerprint = _sha256_file(project_path)
    errors = getattr(getattr(getattr(store, "library_grades", None), "marks", None), "picture_errors", None)
    if errors and session.grade_notice and errors.grade_dismissed(str(project_path), session.grade_original):
        session.grade_notice = {**session.grade_notice, "dismissed": True}
    return session


def open_document(store: SessionStore, document: EditDocument, source_path: Path | None = None,
                  reuse_session_id: str | None = None) -> LoadedSession:
    """Open the same grade document from a project container or photo settings."""
    with store._lock:
        return _open_document(store, document, source_path, reuse_session_id)


def _open_document(store, document, source_path, reuse_session_id):
    candidate = source_path
    if candidate is None and document.source.durable_path:
        candidate = Path(document.source.durable_path)
    if candidate is None or not candidate.expanduser().is_file():
        raise ProjectSourceRelinkRequired("The project source is missing. Select the original source to relink it.")
    resolved_source = candidate.expanduser().resolve()
    reusable = store.get(reuse_session_id) if reuse_session_id else None
    if reusable is not None and reusable.source_path.resolve() != resolved_source:
        raise ProjectSourceRelinkRequired("The grade belongs to another source.")
    fingerprint = reusable.source_fingerprint_sha256 if reusable is not None else _sha256_file(resolved_source)
    if document.source.fingerprint_sha256 and fingerprint != document.source.fingerprint_sha256:
        raise ProjectSourceRelinkRequired("The selected source fingerprint does not match this project.")

    same_decode = reusable is not None and (
        reusable.raw_import_settings == document.source.raw_import_settings
        and reusable.interpretation_override == document.interpretation_override
        and reusable.render_cache.source_identity.reference_white_nits == document.hdr_reference_white_nits
    )
    if same_decode:
        session = reusable
    else:
        # Recovery/external grades may select another RAW recipe or source
        # interpretation. Preserve their existing re-open semantics.
        session = store.prepare_session(
            resolved_source,
            original_filename=document.source.filename,
            owns_source_path=False,
            raw_import_settings=document.source.raw_import_settings,
            interpretation_override=document.interpretation_override,
            hdr_reference_white_nits=document.hdr_reference_white_nits,
        )
    # Replay before replacing any live document or its last valid pixels.
    from copy import copy
    from .retouch_source import build_repaired_source, install_repaired_source
    from .sessions import _source_mip_identity
    candidate_session = copy(session)
    candidate_session.retouch_worker = None
    candidate_session._repair_routes = {}
    try:
        from .saved_grades import recover_repairs
        repaired = recover_repairs(document, candidate_session)
    except BaseException:
        if candidate_session.retouch_worker is not None:
            candidate_session.retouch_worker.close()
        raise
    session.grade_notice = getattr(document, "_saved_grade_notice", None)
    session.grade_original = getattr(document, "_saved_grade_original", None)
    from .saved_grades import whole_grade_fallback
    session.adjustments = session.starting_adjustments() if whole_grade_fallback(session.grade_notice) else document.global_adjustments
    session.local_adjustments = document.local_adjustments
    session.repairs = document.repairs
    session._repair_routes = candidate_session._repair_routes
    session.denoise = document.denoise
    session.sdr_match = document.sdr_match
    session.framing = document.framing
    session.interpretation_override = document.interpretation_override
    session.hdr_reference_white_nits = document.hdr_reference_white_nits
    session.color_context = session.color_context.__class__(document.hdr_reference_white_nits)
    session.source_luminance = document.source.luminance
    session.render_cache.set_color_context(session.color_context)
    session.durable_source_path = resolved_source
    session.edit_revision = 0
    session.dirty = False
    session.undo_history.clear()
    session.redo_history.clear()
    session.history_bytes = 0
    session.render_cache.clear_adjusted()
    install_repaired_source(session, repaired, _source_mip_identity(session))
    # The successful replay belongs to this open session, including its bounded
    # completed patches. Later edits can reuse them without another solve.
    previous_worker = session.retouch_worker
    session.retouch_worker = candidate_session.retouch_worker
    if previous_worker is not None:
        previous_worker.close()
    if not same_decode:
        store.activate_session(session)
    return session


def choose_saved_grade(store, session_id, action):
    """Explicit choice for a project; Library choices use its existing writer."""
    with store._lock:
        session = store.get(session_id)
        if action == "leave" or not session.grade_notice and action != "original":
            return {"session": session.to_payload()}
        if action == "dismiss":
            if any(i["kind"] != "look" for i in session.grade_notice["issues"]):
                raise ProjectError("Unreadable or newer grades need a choice before dismissing their warning.")
            errors = getattr(getattr(getattr(store, "library_grades", None), "marks", None), "picture_errors", None)
            if errors:
                errors.dismiss_grade(str(getattr(session, "grade_project_path", session.source_path)), session.grade_original)
            session.grade_notice = {**session.grade_notice, "dismissed": True}
            return {"session": session.to_payload()}
        if action not in ("continue", "original"):
            raise ProjectError("Choose Continue without them, Revert to original or Leave as is.")
        project = getattr(session, "grade_project_path", None)
        if project is None:
            raise ProjectError("Review this photo's warning in the Library before saving.")
        # Keep the untouched JSON, including future fields, inside the project.
        if _sha256_file(project) != getattr(session, "grade_project_fingerprint", None):
            raise ProjectError("The project changed elsewhere. Open it again before choosing.")
        consent = session.grade_project_fingerprint
        original = session.grade_original if session.grade_original is not None else session.edit_document().model_dump(mode="json")
        raw = json.dumps(original, ensure_ascii=False).encode("utf-8")
        backups = dict(getattr(session, "grade_project_backups", {}))
        backups["grade-backups/" + hashlib.sha256(raw).hexdigest() + ".json"] = raw
        previous_notice = session.grade_notice
        if action == "original":
            clean = session.edit_document().model_copy(deep=True)
            from .models import DenoiseDocumentSettings, PhotoFraming, SdrMatchState
            clean.global_adjustments = session.starting_adjustments()
            clean.local_adjustments = []
            clean.repairs = []
            clean.denoise = DenoiseDocumentSettings()
            clean.framing = PhotoFraming()
            clean.sdr_match = SdrMatchState()
            clean.source.raw_import_settings = __import__("hdr_finisher.models", fromlist=["RawImportSettings"]).RawImportSettings()
            clean.interpretation_override = __import__("hdr_finisher.models", fromlist=["SourceInterpretationOverride"]).SourceInterpretationOverride()
            session = open_document(store, clean, session.source_path)
        session.grade_project_path = project
        session.grade_project_consent = consent
        session.grade_project_fingerprint = consent
        session.grade_project_backups = backups
        session.grade_notice = None
        try:
            save_project(session, project)
        except Exception:
            session.grade_notice = previous_notice
            raise
        session.grade_original = None
        return {"session": session.to_payload()}


def _project_path(path: Path) -> Path:
    expanded = path.expanduser().resolve()
    return expanded if expanded.suffix.lower() == ".hdrfinisher" else expanded.with_suffix(".hdrfinisher")


def validate_saved(model, payload: object):
    """The sole saved-data reader. Recover panel sections; live edits stay strict."""
    from .saved_grades import read_saved
    value, dropped = read_saved(model, payload)
    if dropped:
        logger.info("Saved %s read with %d outdated field(s) ignored: %s",
                    model.__name__, len(dropped), ", ".join(sorted(dropped)))
    return value


def _validate_ignoring_unknown_fields(state_payload: object) -> EditDocument:
    return validate_saved(EditDocument, state_payload)


def validate_saved_document(state_payload: object) -> EditDocument:
    return validate_saved(EditDocument, state_payload)


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()
