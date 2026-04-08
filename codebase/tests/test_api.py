from __future__ import annotations

from pathlib import Path

from conftest import make_png_bytes
from fastapi.testclient import TestClient

from hdr_finisher.main import app
from hdr_finisher.models import ExportResponse, HDRAnalysis, HDRClassification, MetadataPayload, SessionPayload, SourceImageDescriptor


client = TestClient(app)


def test_capabilities_endpoint() -> None:
    response = client.get("/api/capabilities")
    assert response.status_code == 200
    assert "capabilities" in response.json()


def test_upload_creates_session(monkeypatch) -> None:
    def fake_create_session(source_path: Path):
        _ = source_path
        return SessionPayload(
            session_id="abc123",
            source=SourceImageDescriptor(
                filename="fixture.png",
                suffix=".png",
                width=8,
                height=6,
                channels=3,
                dtype="float32",
            ),
            metadata=MetadataPayload(bit_depth="8", color_space="sRGB"),
            analysis=HDRAnalysis(
                classification=HDRClassification.SDR_ONLY,
                peak_linear=0.9,
                peak_stops_above_diffuse_white=0.0,
                badge_message="mock",
            ),
            adjustments={
                "hdr": {"exposure": 0, "highlight_rolloff": 0.25, "shadow_lift": 0, "white_balance_kelvin": 6500, "tint": 0},
                "sdr": {"exposure": 0, "highlight_recovery": 0.25, "shadow": 0, "contrast": 0, "tone_mapper": "aces"},
                "shared": {"active_focus": "hdr", "curves_enabled": False},
            },
            preview={"long_edge": 1600, "format": "png"},
            capabilities={},
        )

    monkeypatch.setattr("hdr_finisher.main.store.create_session", fake_create_session)
    response = client.post("/api/session", files={"file": ("fixture.png", b"stub", "image/png")})
    assert response.status_code == 200
    assert response.json()["session"]["session_id"] == "abc123"


def test_real_png_upload_preview_and_scopes() -> None:
    upload = client.post("/api/session", files={"file": ("fixture.png", make_png_bytes(), "image/png")})
    assert upload.status_code == 200
    session_id = upload.json()["session"]["session_id"]

    preview = client.post(
        f"/api/session/{session_id}/preview/hdr",
        json={
            "adjustments": {
                "hdr": {"exposure": 0, "highlight_rolloff": 0.25, "shadow_lift": 0, "white_balance_kelvin": 6500, "tint": 0},
                "sdr": {"exposure": 0, "highlight_recovery": 0.25, "shadow": 0, "contrast": 0, "tone_mapper": "aces"},
                "shared": {"active_focus": "hdr", "curves_enabled": False},
            }
        },
    )
    assert preview.status_code == 200
    assert preview.headers["content-type"] in {"image/png", "image/avif"}

    scopes = client.get(f"/api/session/{session_id}/scopes?kind=hdr")
    assert scopes.status_code == 200
    payload = scopes.json()
    assert payload["preview_kind"] == "hdr"
    assert len(payload["channels"]) == 3


def test_interpretation_endpoint_returns_updated_session(monkeypatch) -> None:
    def fake_update_source_interpretation(session_id, override):
        _ = session_id
        _ = override

        class FakeSession:
            def to_payload(self):
                return SessionPayload(
                    session_id="override123",
                    source=SourceImageDescriptor(
                        filename="fixture.hdr",
                        suffix=".hdr",
                        width=18,
                        height=12,
                        channels=3,
                        dtype="float32",
                        source_color_space="ACEScg",
                        transfer_function="LINEAR",
                    ),
                    metadata=MetadataPayload(bit_depth="32f", color_space="ACEScg", transfer_function="LINEAR"),
                    analysis=HDRAnalysis(
                        classification=HDRClassification.HDR_LINEAR_UNCONFIRMED,
                        peak_linear=0.8,
                        peak_stops_above_diffuse_white=2.0,
                        needs_color_override=False,
                        badge_message="override applied",
                    ),
                    adjustments={
                        "hdr": {"exposure": 0, "highlight_rolloff": 0.25, "shadow_lift": 0, "white_balance_kelvin": 6500, "tint": 0},
                        "sdr": {"exposure": 0, "highlight_recovery": 0.25, "shadow": 0, "contrast": 0, "tone_mapper": "aces"},
                        "shared": {"active_focus": "hdr", "curves_enabled": False},
                    },
                    preview={"long_edge": 1600, "format": "png"},
                    capabilities={},
                )

        return FakeSession()

    monkeypatch.setattr("hdr_finisher.main.store.update_source_interpretation", fake_update_source_interpretation)
    response = client.post("/api/session/override123/interpretation", json={"color_space": "ACEScg", "transfer_function": "LINEAR"})
    assert response.status_code == 200
    assert response.json()["session"]["source"]["source_color_space"] == "ACEScg"


def test_export_endpoint_returns_backend_payload(monkeypatch) -> None:
    upload = client.post("/api/session", files={"file": ("fixture.png", make_png_bytes(), "image/png")})
    assert upload.status_code == 200
    session_id = upload.json()["session"]["session_id"]

    class FakeBackend:
        def export(self, session, settings):
            _ = session
            _ = settings
            return ExportResponse(
                accepted=True,
                backend="avif_gain_map",
                message="mock export ok",
                output_path="D:/tmp/mock.avif",
            )

    monkeypatch.setattr("hdr_finisher.main.export_backends", {"avif_gain_map": FakeBackend()})
    response = client.post(f"/api/session/{session_id}/export", json={"format": "avif_gain_map", "quality": 85})
    assert response.status_code == 200
    assert response.json()["backend"] == "avif_gain_map"
    assert response.json()["output_path"].endswith(".avif")
