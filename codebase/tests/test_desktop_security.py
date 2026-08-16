from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from hdr_finisher.desktop_security import DesktopPathGrants, secret_matches
from hdr_finisher import main as main_module


def test_source_grant_is_scoped_and_consumed(tmp_path: Path) -> None:
    source = tmp_path / "source.exr"
    source.write_bytes(b"fixture")
    grants = DesktopPathGrants()

    token, resolved = grants.issue(str(source), "source-open")

    assert resolved == source.resolve()
    assert grants.consume(token, "source-open") == source.resolve()
    with pytest.raises(ValueError, match="expired"):
        grants.consume(token, "source-open")


def test_grant_rejects_wrong_intent_and_unsupported_paths(tmp_path: Path) -> None:
    text_file = tmp_path / "notes.txt"
    text_file.write_text("not an image", encoding="utf-8")
    grants = DesktopPathGrants()

    with pytest.raises(ValueError, match="supported"):
        grants.issue(str(text_file), "source-open")

    project = tmp_path / "grade.hdrfinisher"
    project.write_bytes(b"project")
    token, _ = grants.issue(str(project), "project-open")
    with pytest.raises(ValueError, match="not valid"):
        grants.consume(token, "source-open")


def test_export_grant_can_be_checked_for_overwrite_retry(tmp_path: Path) -> None:
    grants = DesktopPathGrants()
    output = tmp_path / "finished.avif"
    token, _ = grants.issue(str(output), "export-file")

    assert grants.resolve(token, "export-file") == output.resolve()
    assert grants.resolve(token, "export-file") == output.resolve()


def test_secret_comparison_requires_two_nonempty_values() -> None:
    assert secret_matches("secret", "secret") is True
    assert secret_matches("secret", "different") is False
    assert secret_matches(None, "secret") is False


def test_external_proof_link_is_read_only_and_tokenized(monkeypatch, tmp_path: Path) -> None:
    media = tmp_path / "proof.avif"
    media.write_bytes(b"proof-bytes")
    artifact = SimpleNamespace(format="avif_gain_map", path=media, media_type="image/avif")
    monkeypatch.setattr(main_module.proof_store, "artifact", lambda _artifact_id: artifact)
    main_module.external_proof_tokens.clear()
    client = TestClient(main_module.app)

    issued = client.post("/api/proof/external/example")
    proof_url = issued.json()["url"]
    page = client.get(proof_url)
    delivered = client.get(f"{proof_url}/media")

    assert issued.status_code == 200
    assert page.status_code == 200
    assert "read-only browser proof" in page.text
    assert "/api/" not in page.text
    assert delivered.status_code == 200
    assert delivered.content == b"proof-bytes"
