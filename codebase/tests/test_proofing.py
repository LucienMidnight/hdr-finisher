from __future__ import annotations

from io import BytesIO
import math
from pathlib import Path

import numpy as np
import pytest
import tifffile
from fastapi.testclient import TestClient
from PIL import Image

import hdr_finisher.proofing as proofing_module
from hdr_finisher.models import (
    AdjustmentState,
    BrowserEvidenceRecord,
    CapabilityInfo,
    CapabilityStatus,
    ExportResponse,
    JPEGGainMapProofMetadata,
    ProofArtifactRequest,
    ProofReconstructionRequest,
)
from hdr_finisher.proofing import (
    EvidenceStore,
    GainMapParameters,
    ProofArtifact,
    ProofArtifactStore,
    _inspect_jpeg_gain_map,
    apply_gain_map_formula,
    reconstruct_from_endpoints,
    target_headroom_for_peak_nits,
)
from hdr_finisher.color import linear_bt2020_to_acescg, linear_srgb_to_acescg
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


@pytest.mark.parametrize(
    ("peak_nits", "expected_headroom"),
    [(400, 2.0), (600, math.log2(6)), (1000, math.log2(10)), (2000, math.log2(20)), (4000, math.log2(40))],
)
def test_chrome_proof_nit_presets_use_100_nit_reference_white(peak_nits: float, expected_headroom: float) -> None:
    assert target_headroom_for_peak_nits(peak_nits) == pytest.approx(expected_headroom)


def test_endpoint_reconstruction_uses_encoded_offsets_and_clamps_above_capacity() -> None:
    base = np.array([[[0.0, 0.02, 0.4], [0.08, 0.25, 0.7]]], dtype=np.float32)
    alternate = np.array([[[0.001, 0.18, 1.2], [0.5, 1.5, 3.0]]], dtype=np.float32)
    midpoint = reconstruct_from_endpoints(
        base,
        alternate,
        2.0,
        1.0,
        display_ratio_sdr=1.0,
        offset_sdr=1e-7,
        offset_hdr=2e-7,
    )
    full = reconstruct_from_endpoints(
        base,
        alternate,
        2.0,
        12.0,
        display_ratio_sdr=1.0,
        offset_sdr=1e-7,
        offset_hdr=2e-7,
    )
    assert np.all(midpoint >= 0)
    assert np.any(np.abs(midpoint - reconstruct_from_endpoints(base, alternate, 2.0, 1.0)) > 1e-5)
    np.testing.assert_allclose(full, alternate, rtol=2e-5, atol=2e-6)


def test_jpeg_probe_metadata_is_parsed_into_structured_fields(monkeypatch, tmp_path: Path) -> None:
    probe = """
--maxContentBoost 16
--offsetSdr 1e-07
--offsetHdr 2e-07
--hdrCapacityMin 1.25
--hdrCapacityMax 8
--useBaseColorSpace 1
"""
    monkeypatch.setattr(proofing_module, "resolve_binary", lambda _name: tmp_path / "ultrahdr_app.exe")
    monkeypatch.setattr(
        proofing_module,
        "_run_command",
        lambda command: type("Result", (), {"stdout": probe, "stderr": ""})(),
    )
    metadata = _inspect_jpeg_gain_map(tmp_path / "proof.jpg")
    assert metadata.use_base_color_space is True
    assert metadata.base_gamut == "sRGB / BT.709"
    assert metadata.alternate_gamut == "BT.2020"
    assert metadata.reconstruction_gamut == "sRGB / BT.709"
    assert metadata.max_content_boost == pytest.approx(16.0)
    assert metadata.hdr_capacity_min == pytest.approx(1.25)
    assert metadata.hdr_capacity_max == pytest.approx(8.0)
    assert metadata.offset_sdr == pytest.approx(1e-7)
    assert metadata.offset_hdr == pytest.approx(2e-7)


@pytest.mark.parametrize("use_base_color_space", [True, False])
def test_jpeg_full_endpoint_uses_metadata_selected_decoded_gamut(
    monkeypatch,
    tmp_path: Path,
    use_base_color_space: bool,
) -> None:
    store = ProofArtifactStore()
    store.root = tmp_path
    jpeg_path = tmp_path / "fixture.jpg"
    Image.new("RGB", (2, 1), (64, 96, 128)).save(jpeg_path, quality=95)
    decoded = np.array([[[0.9, 0.15, 0.05], [0.1, 0.7, 0.2]]], dtype=np.float32)
    decoded_rgba = np.concatenate([decoded, np.ones((1, 2, 1), dtype=np.float32)], axis=2)
    decoded_rgba.astype("<f2").tofile(tmp_path / "decoded-gamut-test.rgba-f16.raw")
    metadata = JPEGGainMapProofMetadata(
        use_base_color_space=use_base_color_space,
        base_gamut="sRGB / BT.709",
        alternate_gamut="BT.2020",
        reconstruction_gamut="sRGB / BT.709" if use_base_color_space else "BT.2020",
        min_content_boost=1.0,
        max_content_boost=8.0,
        gamma=1.0,
        hdr_capacity_min=1.0,
        hdr_capacity_max=8.0,
        offset_sdr=1e-7,
        offset_hdr=1e-7,
    )
    artifact = ProofArtifact(
        artifact_id="gamut-test",
        format="jpeg_ultrahdr",
        path=jpeg_path,
        media_type="image/jpeg",
        sha256="0" * 64,
        width=2,
        height=1,
        quality=85,
        metadata_summary="fixture",
        encoded_headroom=3.0,
        hdr_authored=np.zeros((1, 2, 3), dtype=np.float32),
        sdr_authored=np.zeros((1, 2, 3), dtype=np.float32),
        jpeg_gain_map=metadata,
    )
    monkeypatch.setattr(proofing_module, "resolve_binary", lambda _name: tmp_path / "ultrahdr_app.exe")
    _, endpoint = store._matrix_endpoints(artifact)
    scaled = decoded * np.float32(203.0 * 0.18 / 100.0)
    expected = linear_srgb_to_acescg(scaled) if use_base_color_space else linear_bt2020_to_acescg(scaled)
    np.testing.assert_allclose(endpoint, np.clip(expected, 0, None), rtol=2e-3, atol=3e-4)

    expected_sum = np.maximum(expected.sum(axis=-1, keepdims=True), 1e-8)
    endpoint_sum = np.maximum(endpoint.sum(axis=-1, keepdims=True), 1e-8)
    mean_chromaticity_error = float(np.mean(np.abs(endpoint / endpoint_sum - expected / expected_sum)))
    assert mean_chromaticity_error < 0.01


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
    fixed = store.reconstruction(
        ProofReconstructionRequest(
            artifact_id=first.artifact_id,
            target={"mode": "fixed", "peak_nits": 400, "display_id": "display-1"},
        ),
        [{"id": "display-1", "name": "Reference display", "nominal_headroom": 4.0, "max_luminance_nits": 1600}],
    )
    fixed_again = store.reconstruction(
        ProofReconstructionRequest(
            artifact_id=first.artifact_id,
            target={"mode": "fixed", "peak_nits": 400, "display_id": "display-1"},
        ),
        [{"id": "display-1", "name": "Reference display", "nominal_headroom": 4.0, "max_luminance_nits": 1600}],
    )
    auto = store.reconstruction(
        ProofReconstructionRequest(
            artifact_id=first.artifact_id,
            target={"mode": "auto", "display_id": "display-1"},
        ),
        [{"id": "display-1", "name": "Reference display", "nominal_headroom": 1.5, "max_luminance_nits": 1000}],
    )
    capped = store.reconstruction(
        ProofReconstructionRequest(
            artifact_id=first.artifact_id,
            target={"mode": "fixed", "peak_nits": 10000},
        ),
        [],
    )
    with pytest.raises(ValueError, match="display headroom"):
        store.reconstruction(
            ProofReconstructionRequest(artifact_id=first.artifact_id, target={"mode": "auto"}),
            [],
        )

    assert first.artifact_id == second.artifact_id
    assert first.sha256 == second.sha256
    assert first.url.endswith(f"{first.artifact_id}.jpg")
    assert len(matrix.tiles) == 5
    assert matrix.tiles[0].above_display_headroom is False
    assert matrix.tiles[-1].above_display_headroom is True
    assert fixed.resolved_headroom == pytest.approx(2.0)
    assert fixed.tile.id == matrix.tiles[2].id
    assert fixed_again.cache_id == fixed.cache_id
    assert fixed_again.tile.id == fixed.tile.id
    assert fixed.display_can_represent is True
    assert auto.resolved_headroom == pytest.approx(1.5)
    assert auto.display_label == "Reference display"
    assert capped.resolved_headroom == pytest.approx(3.0)
    assert capped.capped_by_encoded_headroom is True


def test_auto_reconstruction_requires_display_headroom() -> None:
    response = client.post(
        "/api/proof/reconstruction",
        json={"artifact_id": "missing", "target": {"mode": "auto"}},
    )
    assert response.status_code == 404

    validation = client.post(
        "/api/proof/reconstruction",
        json={"artifact_id": "missing", "target": {"mode": "fixed"}},
    )
    assert validation.status_code == 422
    for invalid_peak in (99, 10001):
        bounds = client.post(
            "/api/proof/reconstruction",
            json={"artifact_id": "missing", "target": {"mode": "fixed", "peak_nits": invalid_peak}},
        )
        assert bounds.status_code == 422


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

    reconstruction_response = client.post(
        "/api/proof/reconstruction",
        json={
            "artifact_id": artifact["artifact_id"],
            "target": {"mode": "fixed", "peak_nits": 1000},
        },
    )
    assert reconstruction_response.status_code == 200, reconstruction_response.text
    reconstruction = reconstruction_response.json()
    assert reconstruction["format"] == format_name
    assert reconstruction["target_label"] == "1000 nits"
    assert reconstruction["resolved_headroom"] <= reconstruction["encoded_headroom"]
    assert client.get(reconstruction["tile"]["url"]).status_code == 200
    session_store.clear()
