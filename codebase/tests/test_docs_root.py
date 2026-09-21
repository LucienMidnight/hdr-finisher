"""MINOR-11 -- the in-app Help documents must be the ones the app serves.

Help rendered "Documentation unavailable" for every topic for a fortnight.
`DOCS_DIR` decided between the packaged and development roots by testing
whether a `docs` directory sat beside the backend, which is a proxy for "am I
packaged?" rather than the question itself. `codebase/docs` was then added in
`4d32eb2` for two audit notes, the packaged branch started winning in
development, and every help topic became a 404.

So these pin the decision rather than the path: the branch is keyed on whether
the build is bundled, and the directory it picks actually holds the documents
the Help navigation asks for.
"""

from __future__ import annotations

import importlib
import sys
from pathlib import Path

import pytest

from hdr_finisher import config


# The first entry in the Help navigation, and the document it opens on. If this
# moves, Help's default topic moved with it and this test should be updated
# deliberately rather than relaxed.
DEFAULT_HELP_DOCUMENT = Path("getting-started") / "quick-start.md"


def test_development_docs_root_holds_the_help_documents() -> None:
    """A development run serves the repository's docs, not codebase/docs."""
    assert not config._is_bundled(), "This suite runs from source, not a bundle."
    assert config.DOCS_DIR == config.PROJECT_ROOT.parent / "docs"
    assert (config.DOCS_DIR / DEFAULT_HELP_DOCUMENT).is_file(), (
        f"Help's default topic is not under {config.DOCS_DIR}. "
        "Every topic would render 'Documentation unavailable'."
    )


def test_docs_root_ignores_a_docs_directory_beside_the_backend() -> None:
    """The regression itself: `codebase/docs` must not capture the decision.

    It exists in this repository and holds audit notes rather than help
    content, so if its mere presence still chose the root, Help would break
    again exactly as it did.
    """
    beside_backend = config.RESOURCE_ROOT / "docs"
    if not beside_backend.is_dir():
        pytest.skip("No docs directory beside the backend, so there is nothing to shadow.")
    assert config.DOCS_DIR != beside_backend
    assert not (beside_backend / DEFAULT_HELP_DOCUMENT).is_file(), (
        "codebase/docs now holds help content too, so this test no longer "
        "distinguishes the two roots and needs rethinking."
    )


def test_bundled_docs_root_is_the_resource_root(monkeypatch: pytest.MonkeyPatch) -> None:
    """A packaged build serves the docs bundled beside it.

    Both branches matter. Keying on `_is_bundled()` is only correct if the
    packaged branch still resolves to the bundle, which a development-only
    assertion would never notice going wrong.
    """
    bundle = Path(r"C:\bundle") if sys.platform == "win32" else Path("/bundle")
    monkeypatch.setattr(sys, "_MEIPASS", str(bundle), raising=False)
    reloaded = importlib.reload(config)
    try:
        assert reloaded._is_bundled()
        assert reloaded.DOCS_DIR == reloaded.RESOURCE_ROOT / "docs"
        assert reloaded.RESOURCE_ROOT == bundle.resolve()
    finally:
        monkeypatch.undo()
        importlib.reload(config)
