from __future__ import annotations

from io import BytesIO
from pathlib import Path

import numpy as np
import pytest
import tifffile
from fastapi.testclient import TestClient

import hdr_finisher.proofing as proofing_module
from hdr_finisher.models import (
    AdjustmentState,
    BrowserEvidenceRecord,
    CapabilityInfo,
    CapabilityStatus,
    ExportResponse,
    ProofArtifactRequest,
)
from hdr_finisher.proofing import (
    EvidenceStore,
    GainMapParameters,
    ProofArtifactStore,
    apply_gain_map_formula,
    reconstruct_from_endpoints,
)
from hdr_finisher.render_cache import SessionRenderCache
from hdr_finisher.main import app, capabilities, store as session_store


client = TestClient(app)


def test_delivery_test_pattern_is_float_hdr_and_has_known_patch_range() -> None:
    response = client.get("/api/proof/test-pattern")
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/tiff"
    pattern = tifffile.imread(BytesIO(response.content))
    assert pattern.shape == (720, 1280, 3)
    assert pattern.dtype == np.float32
    assert float(pattern.max()) >= 5.7
    assert float(pattern.min()) >= 0.0


def test_gain_map_formula_matches_known_whole_stop_targets() -> None:
    base = np.full((2, 3, 3), 0.125, dtype=np.float32)
    gain = np.ones_like(base)
    parameters = GainMapParameters(
        display_ratio_sdr=1.0,
        display_ratio_hdr=16.0,
        gain_min=np.zeros(3, dtype=np.float32),
        gain_max=np.full(3, np.log(16.0), dtype=np.float32),
        gamma=np.ones(3, dtype=np.float32),
        epsilon_sdr=np.zeros(3, dtype=np.float32),
        epsilon_hdr=np.zeros(3, dtype=np.float32),
    )

    np.testing.assert_allclose(apply_gain_map_formula(base, gain, parameters, 0.0), base, rtol=1e-6)
    np.testing.assert_allclose(apply_gain_map_formula(base, gain, parameters, 2.0), base * 4.0, rtol=1e-6)
    np.testing.assert_allclose(apply_gain_map_formula(base, gain, parameters, 4.0), base * 16.0, rtol=1e-6)


def test_endpoint_reconstruction_preserves_base_and_alternate() -> None:
    base = np.linspace(0.02, 0.5, 36, dtype=np.float32).reshape(3, 4, 3)
    alternate = base * np.array([4.0, 3.0, 2.0], dtype=np.float32)
    np.testing.assert_allclose(reconstruct_from_endpoints(base, alternate, 3.0, 0.0), base, atol=2e-6)
    np.testing.assert_allclose(reconstruct_from_endpoints(base, alternate, 3.0, 3.0), alternate, atol=2e-5)


class _FakeBackend:
    def export(self, session: object, settings: object) -> ExportResponse:
        output = Path(getattr(settings, "output_path"))
        output.write_bytes(b"encoded-proof-artifact")
        assert getattr(session, "image").shape[:2] == (12, 16)
        return ExportResponse(accepted=True, backend="fake", message="ok", output_path=str(output))


def test_artifact_is_content_hashed_cached_and_matrix_is_stable(monkeypatch, tmp_path: Path) -> None:
    store = ProofArtifactStore()
    store.root = tmp_path
    image = np.full((12, 16, 3), 0.18, dtype=np.float32)
    session = type(
        "Session",
        (),
        {"session_id": "proof-session", "render_cache": SessionRenderCache(image, None)},
    )()
    request = ProofArtifactRequest(adjustments=AdjustmentState(), format="jpeg_ultrahdr", long_edge=256)
    monkeypatch.setattr(proofing_module, "_inspect_artifact", lambda *_args: (3.0, "test metadata"))
    monkeypatch.setattr(store, "_matrix_endpoints", lambda artifact: (artifact.sdr_authored, artifact.hdr_authored))
    monkeypatch.setattr(store, "_encoded_matrix_tile", lambda *_args: b"stable-tile")

    first = store.create(session, request, _FakeBackend())
    second = store.create(session, request, _FakeBackend())
    matrix = store.matrix(first.artifact_id, display_headroom=1.5)

    assert first.artifact_id == second.artifact_id
    assert first.sha256 == second.sha256
    assert first.url.endswith(f"{first.artifact_id}.jpg")
    assert len(matrix.tiles) == 5
    assert matrix.tiles[0].above_display_headroom is False
    assert matrix.tiles[-1].above_display_headroom is True


def test_evidence_store_round_trips_records(tmp_path: Path) -> None:
    store = EvidenceStore(tmp_path / "evidence.json")
    result = store.add(
        BrowserEvidenceRecord(
            artifact_id="abc",
            format="jpeg_ultrahdr",
            browser_name="Chrome",
            browser_version="150",
            highlight_observation="matched",
            midtone_observation="matched",
            color_observation="matched",
            overall_observation="effectively-equivalent",
        )
    )
    assert len(result.records) == 1
    loaded = store.list()
    assert loaded.records[0].browser_version == "150"
    assert loaded.stale_after_days == 180


@pytest.mark.parametrize(
    ("format_name", "capability_name", "suffix", "media_type"),
    [
        ("jpeg_ultrahdr", "ultrahdr_encoder", ".jpg", "image/jpeg"),
        ("avif_gain_map", "avif_gain_map_encoder", ".avif", "image/avif"),
    ],
)
def test_real_proof_artifact_and_matrix_endpoints(
    format_name: str,
    capability_name: str,
    suffix: str,
    media_type: str,
) -> None:
    if capabilities[capability_name].status != CapabilityStatus.AVAILABLE:
        pytest.skip(capabilities[capability_name].detail)
    fixture = Path(__file__).resolve().parent / "fixtures" / "hdr_headroom.tiff"
    upload = client.post("/api/session", files={"file": (fixture.name, fixture.read_bytes(), "image/tiff")})
    assert upload.status_code == 200
    session = upload.json()["session"]

    artifact_response = client.post(
        f"/api/session/{session['session_id']}/proof/artifact",
        json={
            "adjustments": session["adjustments"],
            "format": format_name,
            "quality": 88,
            "long_edge": 256,
        },
    )
    assert artifact_response.status_code == 200, artifact_response.text
    artifact = artifact_response.json()
    assert artifact["url"].endswith(suffix)
    assert artifact["encoded_headroom"] > 0
    delivered = client.get(artifact["url"])
    assert delivered.status_code == 200
    assert delivered.headers["content-type"] == media_type
    assert delivered.headers["x-content-sha256"] == artifact["sha256"]

    wrong_mime = client.get(artifact["wrong_mime_url"])
    assert wrong_mime.headers["content-type"] == "application/octet-stream"

    matrix_response = client.post(
        "/api/proof/matrix",
        json={"artifact_id": artifact["artifact_id"], "display_headroom": 2.0},
    )
    assert matrix_response.status_code == 200, matrix_response.text
    matrix = matrix_response.json()
    assert len(matrix["tiles"]) >= 5
    assert all(client.get(tile["url"]).status_code == 200 for tile in matrix["tiles"])
    session_store.clear()
