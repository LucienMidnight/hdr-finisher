from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import tempfile
import zipfile

from .models import EditDocument, ProjectResponse
from .sessions import LoadedSession, SessionStore


PROJECT_STATE_NAME = "edit-state.json"
PROJECT_MANIFEST_NAME = "manifest.json"


class ProjectError(ValueError):
    pass


def save_project(session: LoadedSession, path: Path, source_path: Path | None = None) -> ProjectResponse:
    destination = _project_path(path)
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
            archive.writestr(PROJECT_MANIFEST_NAME, json.dumps(manifest, separators=(",", ":")))
            archive.writestr(PROJECT_STATE_NAME, document.model_dump_json())
        os.replace(temporary_path, destination)
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)
    session.dirty = False
    return ProjectResponse(path=str(destination), revision=session.edit_revision, document=document)


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
            schema_version = manifest.get("schema_version")
            if schema_version in {1, 2}:
                raise ProjectError(
                    f"Unsupported prototype project schema v{schema_version}. Migration is not supported; create a new v3 project."
                )
            if schema_version != 3:
                raise ProjectError(f"Unsupported HDR Finisher project schema {schema_version!r}.")
            if manifest.get("contains_source_pixels") is not False:
                raise ProjectError("Invalid project manifest.")
            document = EditDocument.model_validate_json(archive.read(PROJECT_STATE_NAME))
    except (zipfile.BadZipFile, KeyError, json.JSONDecodeError) as exc:
        raise ProjectError("The project file is malformed or unreadable.") from exc

    candidate = source_path
    if candidate is None and document.source.durable_path:
        candidate = Path(document.source.durable_path)
    if candidate is None or not candidate.expanduser().is_file():
        raise ProjectError("The project source is missing. Select the original source to relink it.")
    resolved_source = candidate.expanduser().resolve()
    fingerprint = _sha256_file(resolved_source)
    if document.source.fingerprint_sha256 and fingerprint != document.source.fingerprint_sha256:
        raise ProjectError("The selected source fingerprint does not match this project.")

    payload = store.create_session(
        resolved_source,
        original_filename=document.source.filename,
        owns_source_path=False,
        raw_import_settings=document.source.raw_import_settings,
        hdr_reference_white_nits=document.hdr_reference_white_nits,
    )
    session = store.get(payload.session_id)
    if (
        document.interpretation_override.color_space
        or document.interpretation_override.transfer_function
        or document.interpretation_override.linear_reference
    ):
        session = store.update_source_interpretation(payload.session_id, document.interpretation_override)
    session.adjustments = document.global_adjustments
    session.local_adjustments = document.local_adjustments
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
    return session


def _project_path(path: Path) -> Path:
    expanded = path.expanduser().resolve()
    return expanded if expanded.suffix.lower() == ".hdrfinisher" else expanded.with_suffix(".hdrfinisher")


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()
