"""Open a project in-process for reference renders, without touching it.

The preview-versus-export comparison and the Proof identity check both need the
export pipeline's own pixels for a real project. Neither may save the project
or its source, so the project archive is only read, and an edit document that
came from a running app is written to a *new* archive under the caller's output
directory before it is opened.
"""
from __future__ import annotations

import json
import os
import sys
import zipfile
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))


def isolate_source_cache(directory: Path) -> None:
    """Keep the persistent source-level cache out of the owner's app data."""
    directory.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("HDR_FINISHER_SOURCE_CACHE_DIR", str(directory))


def write_project_archive(document: dict[str, Any], destination: Path) -> Path:
    """Write an edit document as a new project archive (never over an existing one)."""
    from hdr_finisher import projects

    if destination.exists():
        raise FileExistsError(f"Refusing to overwrite {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    manifest = {
        "format": "HDR Finisher Project",
        "schema_version": document["schema_version"],
        "contains_source_pixels": False,
    }
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        archive.writestr(projects.PROJECT_MANIFEST_NAME, json.dumps(manifest, separators=(",", ":")))
        archive.writestr(projects.PROJECT_STATE_NAME, json.dumps(document))
    return destination


def open_reference_session(project: Path, source: Path | None = None):
    """Decode the project's source and apply its document, as the app's open does."""
    from hdr_finisher.projects import open_project
    from hdr_finisher.sessions import SessionStore

    store = SessionStore()
    session = open_project(store, project, source)
    return store, session
