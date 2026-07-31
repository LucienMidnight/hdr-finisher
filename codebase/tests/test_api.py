from __future__ import annotations

from pathlib import Path

from conftest import make_png_bytes
from fastapi.testclient import TestClient

from hdr_finisher.loader import LoaderError
from hdr_finisher.main import app, store
from hdr_finisher.models import ExportResponse, HDRAnalysis, HDRClassification, MetadataPayload, SessionPayload, SourceImageDescriptor


client = TestClient(app)


def test_capabilities_endpoint() -> None:
    response = client.get("/api/capabilities")
    assert response.status_code == 200
    assert "capabilities" in response.json()


def test_upload_creates_session(monkeypatch) -> None:
    def fake_create_session(source_path: Path, **_kwargs):
        source_path.unlink()
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


def test_upload_decode_failure_returns_json_detail(monkeypatch) -> None:
    observed: dict[str, Path] = {}

    def fail_create_session(source_path: Path, **_kwargs):
        observed["source_path"] = source_path
        raise LoaderError("Could not decode TIFF input: invalid floating-point predictor")

    monkeypatch.setattr("hdr_finisher.main.store.create_session", fail_create_session)
    response = client.post("/api/session", files={"file": ("fixture.tif", b"stub", "image/tiff")})

    assert response.status_code == 400
    assert response.json() == {"detail": "Could not decode TIFF input: invalid floating-point predictor"}
    assert not observed["source_path"].exists()


def test_real_png_upload_preview_and_scopes() -> None:
    upload = client.post("/api/session", files={"file": ("fixture.png", make_png_bytes(), "image/png")})
    assert upload.status_code == 200
    assert upload.json()["session"]["source"]["filename"] == "fixture.png"
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
    assert len(payload["channels"]) == 4
    assert payload["scope_type"] == "reference_nits_histogram"
    assert payload["x_axis"] == "reference_nits_log10"
    assert len(payload["stats"]) >= 3

    waveform = client.get(f"/api/session/{session_id}/scopes?kind=hdr&mode=waveform")
    assert waveform.status_code == 200
    waveform_payload = waveform.json()
    assert waveform_payload["scope_type"] == "reference_nits_waveform"
    assert len(waveform_payload["channels"][0]["grid"]) == 64


def test_clearing_session_removes_owned_upload_temp_file() -> None:
    upload = client.post("/api/session", files={"file": ("owned.png", make_png_bytes(), "image/png")})
    assert upload.status_code == 200
    staged_path = store.current().source_path
    assert staged_path.exists()

    response = client.delete("/api/session/current")
    assert response.status_code == 200
    assert not staged_path.exists()


def test_source_interpretation_preserves_uploaded_filename() -> None:
    upload = client.post("/api/session", files={"file": ("original-name.png", make_png_bytes(), "image/png")})
    assert upload.status_code == 200
    session_id = upload.json()["session"]["session_id"]

    response = client.post(
        f"/api/session/{session_id}/interpretation",
        json={"color_space": "sRGB", "transfer_function": "sRGB"},
    )
    assert response.status_code == 200
    assert response.json()["session"]["source"]["filename"] == "original-name.png"


def test_overlay_endpoint_returns_png_when_enabled() -> None:
    upload = client.post("/api/session", files={"file": ("fixture.png", make_png_bytes(), "image/png")})
    assert upload.status_code == 200
    session_id = upload.json()["session"]["session_id"]

    overlay = client.post(
        f"/api/session/{session_id}/overlay/sdr",
        json={
            "adjustments": {
                "hdr": {"exposure": 0, "highlight_rolloff": 0.25, "shadow_lift": 0, "white_balance_kelvin": 6500, "tint": 0},
                "sdr": {"exposure": 0, "highlight_recovery": 0.25, "shadow": 0, "contrast": 0, "tone_mapper": "aces"},
                "shared": {
                    "active_focus": "sdr",
                    "curves_enabled": False,
                    "overlay_mode": "zebra",
                    "overlay_opacity": 0.72,
                    "overlay_threshold": 0.2,
                },
            }
        },
    )
    assert overlay.status_code == 200
    assert overlay.headers["content-type"] == "image/png"


def test_real_exr_upload_preview_and_scopes() -> None:
    exr_path = Path(__file__).resolve().parent / "fixtures" / "linear_unconfirmed.exr"
    upload = client.post(
        "/api/session",
        files={"file": ("linear_unconfirmed.exr", exr_path.read_bytes(), "image/x-exr")},
    )
    assert upload.status_code == 200
    payload = upload.json()
    session_id = payload["session"]["session_id"]
    assert payload["session"]["source"]["suffix"] == ".exr"
    assert payload["session"]["analysis"]["classification"] == "HDR_LINEAR_UNCONFIRMED"

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

    scopes = client.get(f"/api/session/{session_id}/scopes?kind=hdr&mode=waveform")
    assert scopes.status_code == 200
    scope_payload = scopes.json()
    assert scope_payload["scope_type"] == "reference_nits_waveform"


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


def test_export_directory_endpoint_returns_selected_folder(monkeypatch) -> None:
    monkeypatch.setattr("hdr_finisher.main.pick_directory", lambda initial_directory=None: "D:\\Exports")
    response = client.post("/api/export-directory", json={"initial_directory": "D:\\"})
    assert response.status_code == 200
    assert response.json()["directory"] == "D:\\Exports"


def test_export_directory_endpoint_allows_cancel(monkeypatch) -> None:
    monkeypatch.setattr("hdr_finisher.main.pick_directory", lambda initial_directory=None: None)
    response = client.post("/api/export-directory", json={})
    assert response.status_code == 200
    assert response.json()["directory"] is None
